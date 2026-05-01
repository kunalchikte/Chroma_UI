const API_ROOT = "/api";

export type ConnectionStatus = "healthy" | "degraded" | "offline";

export type HealthResponse = {
  api: "ok";
  chromaReachable: boolean;
  chromaLatencyMs?: number;
  chromaVersion?: string;
  chromaApiMode?: "v1" | "v2" | null;
};

export type AdapterErrorPayload = {
  error: {
    code: string;
    message: string;
  };
};

export type CollectionRow = {
  id: string;
  name: string;
  metadata: Record<string, unknown> | null;
  count?: number;
};

export type CollectionDetail = CollectionRow & {
  embeddingHint?: string | null;
};

export type SampleRow = {
  id: string;
  document?: string;
  metadata?: Record<string, unknown> | null | undefined;
};

export type Hit = {
  id?: string;
  document?: string | null;
  metadata?: Record<string, unknown> | null;
  distance?: number | null;
};

async function fetchJson<T>(
  path: string,
  init?: RequestInit,
): Promise<{ ok: boolean; status: number; data?: T; text?: string }> {
  const isJsonBody =
    typeof init?.body === "string" ||
    typeof init?.body === "number" ||
    typeof init?.body === "boolean" ||
    (init?.body && typeof init.body === "object");

  const res = await fetch(`${API_ROOT}${path}`, {
    ...init,
    headers: {
      accept: "application/json",
      ...(isJsonBody ? { "Content-Type": "application/json" } : {}),
      ...(init?.headers ?? {}),
    },
  });

  const text = await res.text();
  let data: T | undefined;
  if (text.trim().length > 0) {
    try {
      data = JSON.parse(text) as T;
    } catch {
      data = undefined;
    }
  }

  return {
    ok: res.ok,
    status: res.status,
    data,
    text,
  };
}

export async function getHealth(): Promise<{
  health: HealthResponse | null;
  status: ConnectionStatus;
}> {
  const r = await fetchJson<HealthResponse>("/health", { method: "GET" });

  if (!r.ok || !r.data) return { health: null, status: "offline" };

  const h = r.data;
  const status: ConnectionStatus =
    h.chromaReachable ? "healthy"
    : h.api === "ok" ? "degraded"
    : "offline";

  return { health: h, status };
}

export async function listCollections(): Promise<CollectionRow[]> {
  const r = await fetchJson<CollectionRow[]>("/collections", { method: "GET" });
  if (!r.ok || !Array.isArray(r.data)) throw new Error(r.text ?? `Collections failed (${r.status})`);
  return r.data;
}

export async function getCollection(collectionId: string): Promise<CollectionDetail | null> {
  const r = await fetchJson<CollectionDetail>(
    `/collections/${encodeURIComponent(collectionId)}`,
    { method: "GET" },
  );
  return r.ok && r.data ? r.data : null;
}

export async function getSamples(collectionId: string, limit: number) {
  const r = await fetchJson<{ limit: number; rows: SampleRow[] }>(
    `/collections/${encodeURIComponent(collectionId)}/samples?limit=${limit}`,
    { method: "GET" },
  );
  if (!r.ok) return { limit, rows: [] as SampleRow[] };
  return r.data ?? { limit, rows: [] as SampleRow[] };
}

export async function runQuery(collectionId: string, queryText: string, limit: number) {
  const r = await fetchJson<{ hits: Hit[] } | AdapterErrorPayload>(
    `/collections/${encodeURIComponent(collectionId)}/query`,
    {
      method: "POST",
      body: JSON.stringify({
        queryText,
        limit,
      }),
    },
  );
  if (!r.ok) {
    const errPayload = r.data as AdapterErrorPayload | undefined;
    const msg =
      errPayload?.error?.message ??
      r.text ??
      `Query failed (${r.status})`;
    throw new Error(msg);
  }
  const okBody = r.data as { hits?: Hit[] } | undefined;
  return okBody?.hits ?? [];
}
