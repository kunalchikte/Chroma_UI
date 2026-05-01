import { resolveRoutes, type ResolvedChromaRoutes } from "./paths.js";
import { ApiError, type FailureCode, type ChromaCallLog } from "./types.js";

function classifyFetchError(err: unknown): FailureCode {
  const msg = String((err as { cause?: unknown })?.cause ?? err);
  const name = typeof err === "object" && err && "name" in err ? String((err as Error).name) : "";
  if (name === "AbortError") return "TIMEOUT";
  if (msg.includes("ECONNREFUSED") || msg.includes("ENOTFOUND") || msg.includes("EAI_AGAIN")) {
    return "UNREACHABLE";
  }
  return "UNKNOWN";
}

function classifyHttpStatus(status: number): FailureCode {
  if (status === 408) return "TIMEOUT";
  if (status >= 400 && status < 500) return "BAD_REQUEST";
  if (status >= 500) return "SERVER_ERROR";
  return "UNKNOWN";
}

export type FetchJsonOpts = {
  baseUrl: string;
  pathname: string;
  method: string;
  body?: unknown;
  headers?: Record<string, string>;
  template: string;
  timeoutMs: number;
};

export type FetchJsonOk<T> = {
  ok: true;
  data: T;
  status: number;
  elapsedMs: number;
  log: ChromaCallLog;
};

export type FetchJsonErr = {
  ok: false;
  log: ChromaCallLog;
  error: ApiError;
};

export async function chromaFetchJson<T>(
  opts: FetchJsonOpts,
): Promise<FetchJsonOk<T> | FetchJsonErr> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), opts.timeoutMs);
  const started = performance.now();
  try {
    const headers: Record<string, string> = {
      ...(opts.headers ?? {}),
      accept: "application/json",
      ...(opts.body !== undefined ? { "content-type": "application/json" } : {}),
    };

    const res = await fetch(new URL(opts.pathname, opts.baseUrl), {
      method: opts.method,
      headers,
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      signal: controller.signal,
    });

    const elapsedMs = Math.round(performance.now() - started);
    clearTimeout(t);

    const text = await res.text();
    let data: unknown = null;
    if (text.trim().length > 0) {
      try {
        data = JSON.parse(text);
      } catch {
        data = text;
      }
    }

    if (!res.ok) {
      const code = classifyHttpStatus(res.status);
      const err = new ApiError(`Chroma upstream error (${res.status})`, code, res.status);
      return {
        ok: false,
        error: err,
        log: {
          template: opts.template,
          method: opts.method,
          elapsedMs,
          upstreamStatus: res.status,
          upstreamPath: opts.pathname,
          errorKind: code,
        },
      };
    }

    return {
      ok: true,
      data: data as T,
      status: res.status,
      elapsedMs,
      log: {
        template: opts.template,
        method: opts.method,
        elapsedMs,
        upstreamStatus: res.status,
        upstreamPath: opts.pathname,
      },
    };
  } catch (err) {
    clearTimeout(t);
    const elapsedMs = Math.round(performance.now() - started);
    const kind = classifyFetchError(err);
    const ae = kind === "TIMEOUT"
      ? new ApiError("Chroma upstream timeout", "TIMEOUT")
      : kind === "UNREACHABLE"
      ? new ApiError("Cannot reach Chroma server", "UNREACHABLE")
      : new ApiError("Chroma upstream request failed", "UNKNOWN");
    return {
      ok: false,
      error: ae,
      log: {
        template: opts.template,
        method: opts.method,
        elapsedMs,
        upstreamPath: opts.pathname,
        errorKind: kind,
      },
    };
  }
}

/** Probe v2 first (Chroma defaults), fallback to v1. */
export async function detectChromaMode(
  baseUrl: string,
  timeoutMs: number,
  headers?: Record<string, string>,
): Promise<{ routes: ResolvedChromaRoutes } & { heartbeatMs?: number }> {
  const v2 = await chromaFetchJson<unknown>({
    baseUrl,
    pathname: "/api/v2/heartbeat",
    method: "GET",
    template: "GET chromaHeartbeatV2",
    timeoutMs,
    headers,
  });
  if (v2.ok) {
    const routes = resolveRoutes("v2");
    return { routes, heartbeatMs: v2.elapsedMs };
  }

  const v1 = await chromaFetchJson<unknown>({
    baseUrl,
    pathname: "/api/v1/heartbeat",
    method: "GET",
    template: "GET chromaHeartbeatV1",
    timeoutMs,
    headers,
  });

  if (v1.ok) {
    const routes = resolveRoutes("v1");
    return { routes, heartbeatMs: v1.elapsedMs };
  }

  throw lastUpstreamAsApiError(v1);
}

function lastUpstreamAsApiError(last: FetchJsonOk<unknown> | FetchJsonErr): never {
  if (last.ok) throw new ApiError("Unexpected ok branch", "UNKNOWN");
  throw last.error;
}

export function structuredLog(entry: ChromaCallLog): void {
  console.log(JSON.stringify({ scope: "chroma-upstream", ...entry }));
}
