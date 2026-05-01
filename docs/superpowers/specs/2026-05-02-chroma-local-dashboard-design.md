# Chroma Local Dashboard (UI + Lightweight API Adapter) — Design Spec

Date: `2026-05-02`  
Audience: Implementer  
Status: **Approved for planning / implementation**

## Goal

Deliver a **simple yet attractive, dark professional dashboard** UI that connects to **local Chroma** and surfaces the most valuable operational overview first:

- **Dashboard-first landing** (mixed KPIs + quick search + shortcuts into collections).
- Reliable **offline/degraded UX** while Chroma is starting or unreachable.
- A **thin local API adapter** keeps the frontend stable against Chroma API evolution and simplifies logging.

This spec assumes the repository starts empty (`Chroma_UI/`); implementation will scaffold a small monorepo-style layout.

## Non-goals (v1)

- Multi-user auth, RBAC, remote deployment hardening beyond localhost defaults.
- Full CRUD ingestion pipelines, bulk uploads, graph visualizations.
- Fancy ML explainability dashboards beyond basic query previews.

If these become needed, extend the normalized API contracts rather than coupling the UI to Chroma payloads.

## User choices (validated)

1. Starting point: **A** — new frontend in `Chroma_UI/` (recommended).
2. First screen narrative: **D** — dashboard mix (KPIs + recent/fast access + quick search).
3. Visual theme: **B** — **dark professional** dev-tool look.
4. Architecture: **Approach 1** — frontend + lightweight local API adapter (recommended).

## High-level architecture

### Components

- **Frontend**: React + Vite + TypeScript
  - Local dev server (typical): `http://localhost:5173`
  - Talks **only** to the local adapter (`/api` via proxy in dev).

- **Backend adapter**: Node + Express + TypeScript
  - Local dev server (proposed): `http://localhost:8787`
  - Responsibilities:
    - Normalize upstream responses into stable DTOs
    - Enforce request validation + safe limits
    - Add structured outbound logging + timeouts/retries (read-only)
    - Isolate CORS concerns (browser never calls Chroma directly)

- **Chroma**: local service (upstream)
  - Base URL configurable via **`CHROMA_URL`** (default `http://localhost:8000`)
  - The adapter forwards compatible REST calls based on whatever Chroma version is detected at implementation time.

### Runtime topology (local dev)

Browser → Frontend (Vite) → Backend adapter (`localhost`) → Chroma (`CHROMA_URL`)

## UX / IA (dashboard-first)

### Persistent top bar

- App identity (title/subtitle).
- Connection badge derived from **`GET /health`**:
  - Healthy / Degraded / Offline
- Compact environment hints:
  - Adapter base (`8787`)
  - Chroma base (`CHROMA_URL`)

### Three-panel dashboard layout

1. **Left rail — Collections**
   - Search/filter
   - Rows show: name / id, best-effort count, last successful sync timestamp from client cache freshness

2. **Center stage — KPIs + Quick search**
   - KPI tiles (best-effort, never block render):
     - collections count
     - selected collection docs count (if known)
     - embedding model/provider label when metadata exposes it
     - last `/query` round-trip latency (client-measured against adapter)
   - Quick search:
     - If a collection selected: scope query to collection
     - Else: degrade gracefully (explicit UI copy + optionally global search if feasible)

3. **Right inspector**
   - When collection selected:
     - **Overview**: key metadata/schema hints
     - **Samples**: small bounded previews
     - **Raw**: optional JSON/debug tab (styled as subtle “developer”, not noisy by default)

### Empty / edge states

- No collections returned
- None selected / none match filter
- Chroma unreachable (show actionable recovery steps)

## Backend API surface (frontend contract)

The frontend must only consume these endpoints (adapter responsibility to map upstream):

### Health

- **`GET /health`**
  - Returns:
    - `api: "ok"`
    - `chromaReachable: boolean`
    - optional `chromaLatencyMs`
    - optional version string when available upstream

### Collections

- **`GET /collections`**
  - Returns normalized records:
    - `id`
    - `name`
    - `metadata`
    - `count?` (**best-effort**; omit unknown)

- **`GET /collections/:collectionId`**
  - Stable detail envelope for inspector overview

### Samples / previews (read-only)

- **`GET /collections/:collectionId/samples?limit=N`**
  - Hard cap limit server-side regardless of caller input

### Query

- **`POST /collections/:collectionId/query`**
  - Body:
    - `queryText: string`
    - `limit: number`
    - `where?: object` (forward if supported upstream; reject if unsupported rather than pretending)
  - Returns normalized hits:
    - `id?`
    - `document?`
    - `metadata?`
    - `distance?`

> Note: exact upstream routes/payload naming are intentionally not pinned here; implementation must discover the locally installed Chroma REST surface and codify mappings in **one adapter module**.

## Adapter behaviors (engineering requirements)

### Timeouts / retries

- Every upstream request has explicit timeout.
- **Retries** limited to safe idempotent reads:
  - `GET /health` (lightweight)
  - `GET /collections` list refreshes  
  Policy: **max 2 retries** with small backoff.

### Structured logging

For each outbound Chroma call, emit one structured log line including:

- route template/method name
- upstream status (if HTTP)
- elapsed ms

Classify failures for UI mapping:

- `UNREACHABLE`
- `TIMEOUT`
- `BAD_REQUEST`
- `SERVER_ERROR`

### Normalization guarantees

The adapter returns consistent JSON shapes even if upstream varies by version/config.

### Caching (minimal)

- Short TTL cache for **`GET /collections`** (recommended **10–30s**) to smooth navigation jitter.
- **No caching** for query endpoints.

### Security posture (local default)

- Bind adapter to `127.0.0.1` by default (not `0.0.0.0`) unless intentionally configured otherwise.
- Enforce capped limits on sample/query sizes.

## Frontend reliability UX

Mirrors backend taxonomy:

- **Healthy**: banner hidden; interactions enabled when dependent data exists.
- **Degraded**: show banner; browsing cached collections permitted; disable query unless safe.
- **Offline**: skeleton UI remains readable; actionable guidance to start/verify upstream.

Inline non-blocking error UI for `/query`.

## Verification / acceptance criteria (MVP “done”)

Local smoke checklist (against a running Chroma instance):

1. Frontend loads dashboard without console errors attributable to wiring.
2. `/health` correctly reflects reachable vs unreachable Chroma transitions.
3. Collections list renders; inspector updates on selection when detail/sample endpoints succeed.
4. Quick search renders stable hit cards with normalized fields where upstream provides them.

Automated sanity (small but meaningful):

- Unit tests for normalization helpers using fixture payloads.
- Adapter route tests using mocked upstream fetch client (recommended).

## Open implementation notes

- Scaffold as a workspace with documented scripts (`dev`, `build`) for both packages.
- Vite proxy configuration should forward `/api` to adapter in dev without CORS friction.
- Persist brainstorm artifacts separately (`.superpowers/`) according to tooling; `.gitignore` should exclude them from commits.
