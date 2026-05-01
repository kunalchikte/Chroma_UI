import "dotenv/config";
import express from "express";
import {
  embeddingHintFromMetadata,
  normalizeCollectionsListPayload,
  normalizeGetResult,
  normalizeQueryResult,
  type NormalizedCollection,
} from "./chroma/normalize.js";
import type { ResolvedChromaRoutes } from "./chroma/paths.js";
import { ApiError } from "./chroma/types.js";
import {
  chromaFetchJson,
  detectChromaMode,
  structuredLog,
  type FetchJsonOpts,
} from "./chroma/upstream.js";

function envStr(name: string, fallback: string): string {
  const v = process.env[name]?.trim();
  return v ? v : fallback;
}

function envInt(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

const CHROMA_BASE = envStr("CHROMA_URL", "http://localhost:8000").replace(/\/+$/, "");
const PORT = envInt("PORT", 8787);
const BIND = envStr("HOST", "127.0.0.1");

const HEALTH_TIMEOUT_MS = envInt("CHROMA_HEALTH_TIMEOUT_MS", 2500);
const READ_TIMEOUT_MS = envInt("CHROMA_READ_TIMEOUT_MS", 12_000);
const COLLECTIONS_TTL_MS = envInt("COLLECTIONS_CACHE_TTL_MS", 25_000);
const SAMPLE_MAX = Math.min(envInt("SAMPLE_HARD_CAP", 50), 200);
const QUERY_MAX = Math.min(envInt("QUERY_HARD_CAP", 40), 200);

/** Optional Bearer token forwarded to upstream */
function chromaHeaders(): Record<string, string> | undefined {
  const token = process.env.CHROMA_TOKEN?.trim();
  if (!token) return undefined;
  return { Authorization: `Bearer ${token}` };
}

type ModeState =
  | { status: "ready"; routes: ResolvedChromaRoutes }
  | { status: "degraded"; routes: ResolvedChromaRoutes | null };

let modeState: ModeState = { status: "degraded", routes: null };

async function ensureRoutes(): Promise<ResolvedChromaRoutes> {
  if (modeState.status === "ready") return modeState.routes;
  if (modeState.status === "degraded" && modeState.routes) return modeState.routes;

  try {
    const det = await detectChromaMode(CHROMA_BASE, HEALTH_TIMEOUT_MS, chromaHeaders());
    modeState = { status: "ready", routes: det.routes };
    return det.routes;
  } catch {
    modeState = { status: "degraded", routes: null };
    throw new ApiError("Chroma unreachable or incompatible", "UNREACHABLE");
  }
}

async function heartbeatOnce(): Promise<{
  reachable: boolean;
  latencyMs?: number;
  version?: string;
}> {
  try {
    const det = await detectChromaMode(CHROMA_BASE, HEALTH_TIMEOUT_MS, chromaHeaders());
    modeState = { status: "ready", routes: det.routes };
    structuredLog({
      template: "probeChromaMode",
      method: "GET",
      elapsedMs: det.heartbeatMs ?? 0,
      upstreamPath: det.routes.mode === "v2" ? "/api/v2/heartbeat" : "/api/v1/heartbeat",
    });

    const ver = await chromaFetchJson<unknown>({
      baseUrl: CHROMA_BASE,
      pathname: det.routes.versionPath(),
      method: "GET",
      template: "GET chromaVersion",
      headers: chromaHeaders(),
      timeoutMs: HEALTH_TIMEOUT_MS,
    });
    if (ver.ok) structuredLog(ver.log);
    else structuredLog({ ...ver.log, errorKind: ver.error.code });

    const versionPayload = ver.ok ? ver.data : undefined;
    const version =
      typeof versionPayload === "string"
        ? versionPayload
        : typeof (versionPayload as { version?: string } | undefined)?.version === "string"
        ? ((versionPayload as { version?: string }).version as string)
        : undefined;

    return { reachable: true, latencyMs: det.heartbeatMs, version };
  } catch {
    modeState = { status: "degraded", routes: modeState.routes };
    return { reachable: false };
  }
}

async function chromaMustRead<T>(
  pathname: string,
  template: string,
  overrides?: Partial<Pick<FetchJsonOpts, "method" | "headers" | "body" | "timeoutMs">>,
): Promise<T> {
  await ensureRoutes();

  const baseHeaders = chromaHeaders() ?? {};
  const mergedHeaders = overrides?.headers
    ? { ...baseHeaders, ...overrides.headers }
    : baseHeaders;

  const res = await chromaFetchJson<T>({
    baseUrl: CHROMA_BASE,
    pathname,
    template,
    method: overrides?.method ?? "GET",
    timeoutMs: overrides?.timeoutMs ?? READ_TIMEOUT_MS,
    ...(Object.keys(mergedHeaders).length ? { headers: mergedHeaders } : {}),
    ...(overrides?.body !== undefined ? { body: overrides.body } : {}),
  });

  structuredLog(res.ok ? res.log : { ...res.log, errorKind: res.error.code });
  if (!res.ok) throw res.error;
  return res.data;
}

async function chromaMustPost<T>(
  pathname: string,
  template: string,
  body: unknown,
): Promise<T> {
  await ensureRoutes();
  const res = await chromaFetchJson<T>({
    baseUrl: CHROMA_BASE,
    pathname,
    method: "POST",
    body,
    template,
    timeoutMs: READ_TIMEOUT_MS,
    headers: chromaHeaders(),
  });
  structuredLog(res.ok ? res.log : { ...res.log, errorKind: res.error.code });
  if (!res.ok) throw res.error;
  return res.data;
}

function parseCountResponse(raw: unknown): number | undefined {
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (typeof raw !== "object" || raw === null) return undefined;
  const n = (raw as { count?: unknown }).count;
  if (typeof n === "number" && Number.isFinite(n)) return n;
  return undefined;
}

type CachedCollections = {
  expiry: number;
  items: NormalizedCollection[];
};

let collectionsCache: CachedCollections | null = null;

async function retryingCollectionsList(routes: ResolvedChromaRoutes): Promise<unknown> {
  const delays = [0, 120, 250];
  let lastErr: ApiError | null = null;
  for (const d of delays) {
    if (d) await new Promise((r) => setTimeout(r, d));
    const res = await chromaFetchJson<unknown>({
      baseUrl: CHROMA_BASE,
      pathname: routes.listCollectionsPath(),
      method: "GET",
      template: "GET chromaCollections",
      headers: chromaHeaders(),
      timeoutMs: READ_TIMEOUT_MS,
    });
    structuredLog(res.ok ? res.log : { ...res.log, errorKind: res.error.code });
    if (res.ok) return res.data;
    lastErr = res.error;
    if (res.error.code !== "TIMEOUT" && res.error.code !== "UNREACHABLE" &&
      res.error.code !== "SERVER_ERROR") {
      break;
    }
  }
  if (lastErr) throw lastErr;
  throw new ApiError("Chroma collections request failed", "UNKNOWN");
}

async function hydrateCountsParallel(
  routes: ResolvedChromaRoutes,
  cols: NormalizedCollection[],
): Promise<NormalizedCollection[]> {
  const concurrency = 8;
  const out = [...cols];
  let idx = 0;

  async function worker() {
    while (idx < out.length) {
      const cur = idx++;
      const item = out[cur];
      if (!item || item.count !== undefined) continue;
      try {
        const payload = await chromaMustRead<unknown>(
          routes.countPath(item.id),
          "GET chromaCount",
        );
        const c = parseCountResponse(payload);
        if (typeof c === "number") item.count = c;
      } catch {
        /** best-effort */
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, cols.length) }, () => worker()));
  return out;
}

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "512kb" }));

app.get("/health", async (_req, res) => {
  const hb = await heartbeatOnce().catch(() => ({ reachable: false as const }));

  const chromaLatencyMs =
    hb.reachable === true ? hb.latencyMs : undefined;
  const chromaVersion =
    hb.reachable === true ? hb.version : undefined;

  res.json({
    api: "ok",
    chromaReachable: !!hb.reachable,
    ...(chromaLatencyMs !== undefined ? { chromaLatencyMs } : {}),
    ...(chromaVersion ? { chromaVersion } : {}),
    chromaApiMode: modeState.status === "ready" ? modeState.routes.mode : null,
  });
});

app.get("/collections", async (_req, res) => {
  try {
    const now = Date.now();
    if (collectionsCache && collectionsCache.expiry > now) {
      return res.json(collectionsCache.items);
    }

    const routes = await ensureRoutes();
    const raw = await retryingCollectionsList(routes);

    let items = normalizeCollectionsListPayload(raw);
    items = await hydrateCountsParallel(routes, items);
    collectionsCache = { expiry: now + COLLECTIONS_TTL_MS, items };

    res.json(items);
  } catch (e) {
    if (e instanceof ApiError) {
      const status =
        e.code === "UNREACHABLE" ? 503
        : e.code === "BAD_REQUEST" ? 400
        : 502;
      return res.status(status).json({ error: { code: e.code, message: e.message } });
    }
    console.error(e);
    res.status(500).json({ error: { code: "UNKNOWN", message: "Adapter error" } });
  }
});

app.get("/collections/:collectionId", async (req, res) => {
  try {
    const routes = await ensureRoutes();
    const collectionId = req.params.collectionId;
    const payload = await chromaMustRead<unknown>(
      routes.getCollectionByIdPath(collectionId),
      "GET chromaCollectionDetail",
    );
    const list = normalizeCollectionsListPayload(Array.isArray(payload) ? payload : [payload]);
    const first = list[0];
    if (!first) {
      return res.status(404).json({ error: { code: "BAD_REQUEST", message: "Unknown collection" } });
    }

    /** Best-effort count */
    try {
      const ct = parseCountResponse(
        await chromaMustRead(
          routes.countPath(first.id),
          "GET chromaCountDetail",
        ),
      );
      if (typeof ct === "number") first.count = ct;
    } catch {
      /** ignore */
    }

    const hint = embeddingHintFromMetadata(first.metadata);
    res.json({ ...first, embeddingHint: hint ?? null });
  } catch (e) {
    if (e instanceof ApiError) {
      const status = e.code === "BAD_REQUEST"
        ? 400
        : e.code === "UNREACHABLE"
        ? 503
        : 502;
      return res.status(status).json({ error: { code: e.code, message: e.message } });
    }
    console.error(e);
    res.status(500).json({ error: { code: "UNKNOWN", message: "Adapter error" } });
  }
});

app.get("/collections/:collectionId/samples", async (req, res) => {
  try {
    const routes = await ensureRoutes();
    const collectionId = req.params.collectionId;
    const limitRaw = Number(req.query.limit ?? 15);
    const limit = Number.isFinite(limitRaw)
      ? Math.max(1, Math.min(limitRaw, SAMPLE_MAX))
      : 15;

    const payload = await chromaMustPost<unknown>(
      routes.getDocsPath(collectionId),
      "POST chromaGetDocs",
      { limit, include: ["documents", "metadatas"], offset: 0 },
    );

    const norm = normalizeGetResult(payload);

    /** compact rows */
    const rows = norm.ids.map((_id, i) => ({
      id: norm.ids[i],
      document: norm.documents[i] ?? undefined,
      metadata: norm.metadatas[i],
    }));

    res.json({ limit, rows });
  } catch (e) {
    if (e instanceof ApiError) {
      const status =
        e.code === "BAD_REQUEST" ? 400 : e.code === "UNREACHABLE" ? 503 : 502;
      return res.status(status).json({ error: { code: e.code, message: e.message } });
    }
    console.error(e);
    res.status(500).json({ error: { code: "UNKNOWN", message: "Adapter error" } });
  }
});

app.post("/collections/:collectionId/query", async (req, res) => {
  try {
    const routes = await ensureRoutes();
    const collectionId = req.params.collectionId;
    const body = req.body ?? {};
    const queryText = typeof body.queryText === "string" ? body.queryText.trim() : "";
    if (!queryText) {
      return res.status(400).json({ error: { code: "BAD_REQUEST", message: "Missing queryText" } });
    }
    const lim = Number(body.limit ?? 10);
    const limit = Number.isFinite(lim)
      ? Math.max(1, Math.min(Math.floor(lim), QUERY_MAX))
      : 10;
    let whereClause: Record<string, unknown> | undefined;
    if (
      typeof body.where === "object" && body.where !== null && !Array.isArray(body.where)
    ) {
      whereClause = body.where as Record<string, unknown>;
    }

    const payload = await chromaMustPost<unknown>(routes.queryPath(collectionId), "POST chromaQuery", {
      query_texts: [queryText],
      n_results: limit,
      ...(whereClause !== undefined ? { where: whereClause } : {}),
    });

    const hits = normalizeQueryResult(payload);

    /** Optional raw echo for inspector */
    const includeRaw = Boolean(body.includeRaw);
    res.json(includeRaw ? { hits, raw: payload } : { hits });
  } catch (e) {
    if (e instanceof ApiError) {
      const status =
        e.code === "BAD_REQUEST" ? 400 : e.code === "UNREACHABLE" ? 503 : 502;
      return res.status(status).json({ error: { code: e.code, message: e.message } });
    }
    console.error(e);
    res.status(500).json({ error: { code: "UNKNOWN", message: "Adapter error" } });
  }
});

app.use((_req, res) => {
  res.status(404).json({ error: { code: "BAD_REQUEST", message: "Not found" } });
});

/** eslint-ignore */
app.listen(PORT, BIND, () => {
  console.log(
    JSON.stringify({
      scope: "adapter",
      listen: `${BIND}:${PORT}`,
      chroma: CHROMA_BASE,
      message: "Chroma UI adapter started",
    }),
  );
});
