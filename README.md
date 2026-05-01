# Chroma UI

Local web dashboard for [Chroma](https://www.trychroma.com/) collections: browse collections, sample documents, run semantic quick search over a chosen collection. The browser talks only to a small **Express adapter**; the adapter calls your Chroma HTTP API (`v1` or `v2`, auto-detected).

---

## Prerequisites

| Requirement | Notes |
|-------------|------|
| **Node.js** | **18.18+** (uses native `fetch`). **20.x LTS** recommended. Install from [nodejs.org](https://nodejs.org/) or your package manager. |
| **npm** | Ships with Node. Workspace uses **`npm workspaces`**. |
| **Chroma server** | Reachable HTTP API—typically **port 8000**. Run via Docker or the official Chroma host process. |

Verify Node and npm:

```bash
node -v   # e.g. v20.x.x
npm -v
```

---

## 1. Get the code

```bash
git clone <your-repository-url> Chroma_UI
cd Chroma_UI
```

*(If you already have this folder unpacked, skip `git clone` and `cd` into the project root.)*

---

## 2. Install dependencies

From the **repository root** (where root `package.json` lives):

```bash
npm install
```

This installs the root toolchain (`concurrently`) and all workspace packages (`frontend`, `backend`).

---

## 3. Run Chroma

Chroma UI expects an HTTP-compatible Chroma instance. By default it uses:

**`http://localhost:8000`**

You can change that with the **`CHROMA_URL`** environment variable (see below).

### Examples (pick one)

- **Official / local Chroma docs** — follow [Chroma deployment / local server](https://docs.trychroma.com/) for your OS.
- **Docker** — if you normally run Chroma in a container, start it so the adapter can reach **`host:port`** (often `localhost:8000`).

Confirm Chroma responds (optional):

```bash
curl -s http://localhost:8000/api/v2/heartbeat || curl -s http://localhost:8000/api/v1/heartbeat
```

You should get a JSON HTTP 200 response (exact shape varies by version).

---

## 4. Start Chroma UI (development)

Recommended: **one command** starts both the API adapter and the Vite frontend.

### Default ports

| Service | URL / port | Role |
|---------|-------------|------|
| **Frontend (Vite)** | `http://localhost:5173` | Dashboard in the browser |
| **Adapter (Express)** | `http://127.0.0.1:8787` | Proxied as **`/api/*`** by Vite |

From the repo root:

```bash
npm run dev
```

Then open **`http://localhost:5173`**.

Development flow:

1. Frontend calls **`/api/health`**, **`/api/collections`**, etc.
2. Vite forwards **`/api`** → **`http://127.0.0.1:8787`** (stripping the `/api` prefix).
3. The adapter calls **`CHROMA_URL`** (`/api/v1/...` or `/api/v2/...` as detected).

### Run frontend and backend separately (optional)

**Terminal A — adapter**

```bash
npm run dev -w backend
```

**Terminal B — UI**

```bash
npm run dev -w frontend
```

---

## 5. Configuration (environment variables)

These variables apply to the **backend adapter**. Easiest workflow:

```bash
cp backend/.env.example backend/.env
# Edit backend/.env (values are documented in that file).
```

When you run `npm run dev` or `npm start` against the **`backend`** workspace, the adapter loads **`backend/.env`** automatically (via [dotenv](https://www.npmjs.com/package/dotenv)).

You can instead **export variables in your shell** if you prefer not to use a file.

<!-- Keep table below in sync with `backend/.env.example`. -->

### Core

| Variable | Default | Description |
|----------|---------|--------------|
| **`CHROMA_URL`** | `http://localhost:8000` | Base URL of the Chroma HTTP API (**no trailing slash** required; it is trimmed). |
| **`HOST`** | `127.0.0.1` | Interface the adapter listens on (**localhost-only** by default). |
| **`PORT`** | `8787` | Adapter port. Must match what Vite proxies to (see `frontend/vite.config.ts`). |

Examples:

```bash
# Bash / zsh — one session
export CHROMA_URL=http://127.0.0.1:8000
export PORT=8787
npm run dev
```

Windows **PowerShell**:

```powershell
$env:CHROMA_URL = "http://127.0.0.1:8000"
npm run dev
```

### Authenticated Chroma

If Chroma expects a Bearer token:

| Variable | Description |
|---------|--------------|
| **`CHROMA_TOKEN`** | Sent as **`Authorization: Bearer <token>`** on upstream requests. Omit if Chroma has no auth. |

### Tunables

| Variable | Default | Description |
|----------|---------|--------------|
| **`CHROMA_HEALTH_TIMEOUT_MS`** | `2500` | Timeout for heartbeat / version probes. |
| **`CHROMA_READ_TIMEOUT_MS`** | `12000` | Timeout for heavier reads (collections, query, samples). |
| **`COLLECTIONS_CACHE_TTL_MS`** | `25000` | How long **`GET /collections`** is cached server-side (milliseconds). |
| **`SAMPLE_HARD_CAP`** | `50` | Max **`limit`** for samples (**clamped**, max **200** in code). |
| **`QUERY_HARD_CAP`** | `40` | Max **`limit`** for query (**clamped**, max **200** in code). |

---

## 6. Production-style run (built assets)

### Build everything

```bash
npm run build
```

This compiles the backend into `backend/dist/` and the frontend into `frontend/dist/`.

### Run adapter (production binary)

```bash
npm run start -w backend
```

Or from `backend`:

```bash
cd backend && npm start
```

### Serve the SPA (still proxying `/api` to port 8787)

The built UI is plain static files; **`vite preview`** uses the same `/api` → **8787** proxy as development:

```bash
npm run preview -w frontend -- --host 127.0.0.1
```

Then open the URL printed in the terminal (commonly **`http://127.0.0.1:4173`**).

Ensure the adapter is listening on **`127.0.0.1:8787`** (or adjust `frontend/vite.config.ts` proxy targets to match your **`HOST`** / **`PORT`**).

---

## 7. Scripts reference (repo root)

| Command | Meaning |
|---------|---------|
| **`npm install`** | Install all workspace dependencies. |
| **`npm run dev`** | Dev: adapter + Vite UI together via `concurrently`. |
| **`npm run build`** | Build backend + frontend. |
| **`npm run test`** | Backend unit tests (normalization helpers). |
| **`npm run start`** | Start **compiled** backend only (`node backend/dist/server.js` after build). |

---

## 8. Troubleshooting

### UI shows degraded / upstream banner

- Chroma is not running or not reachable from this machine at **`CHROMA_URL`**.
- Firewall or Docker networking: adapter uses **`127.0.0.1`** to talk Chroma unless `CHROMA_URL` uses another hostname.
- Test: `curl -s "$CHROMA_URL/api/v2/heartbeat"` or `.../api/v1/heartbeat`.

### **`Collections request failed`** or empty list while Chroma works

- Version mismatch / auth: enable **`CHROMA_TOKEN`** if your server requires it.
- Paths: this project supports Chroma **`/api/v1`** and **`/api/v2`** (with default tenant/database for v2 paths). Older or custom gateways may differ.

### Quick search fails

- Select a collection first (search is scoped to one collection).
- Some deployments require embeddings or disallow `query_texts`; read the HTTP error surfaced in the UI and align with your Chroma version.

### **`Port 8787 already in use`**

- Another process is bound to **`8787`**. Stop it **or** set **`PORT`** to another value **and** update **`frontend/vite.config.ts`** `adapterProxy.target` to the same host/port.

### **`Port 5173 already in use`**

Start Vite on another port, e.g.:

```bash
npm run dev -w frontend -- --port 5174
```

(You still need **`npm run dev -w backend`** if not using **`npm run dev`** from root.)

---

## 9. Project layout

```
Chroma_UI/
├── frontend/           # React + Vite SPA (dashboard)
├── backend/            # Express adapter → Chroma HTTP API
├── docs/superpowers/specs/
│   └── 2026-05-02-chroma-local-dashboard-design.md   # Architecture / product spec
├── package.json        # workspaces + compose scripts
└── README.md
```

---

## 10. Documentation

Extended design rationale and API contracts: **`docs/superpowers/specs/2026-05-02-chroma-local-dashboard-design.md`**.
