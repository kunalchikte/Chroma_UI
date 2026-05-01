import { useCallback, useEffect, useMemo, useState } from "react";
import {
  type CollectionDetail,
  type CollectionRow,
  type Hit,
  getCollection,
  getHealth,
  getSamples,
  listCollections,
  runQuery,
  type SampleRow,
} from "./api";
import "./App.css";

function jsonPretty(meta: Record<string, unknown> | undefined) {
  if (!meta || Object.keys(meta).length === 0) return "";
  try {
    return JSON.stringify(meta, null, 2);
  } catch {
    return String(meta);
  }
}

function stringifyUnknown(payload: unknown) {
  try {
    return JSON.stringify(payload, null, 2);
  } catch {
    return String(payload);
  }
}

export default function App() {
  const [healthBanner, setHealthBanner] = useState<Awaited<ReturnType<typeof getHealth>> | null>(
    null,
  );
  const [collections, setCollections] = useState<CollectionRow[]>([]);
  const [filter, setFilter] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<CollectionDetail | null>(null);
  const [inspectorTab, setInspectorTab] = useState<"overview" | "samples" | "raw">(
    "overview",
  );
  const [samples, setSamples] = useState<SampleRow[]>([]);
  const [queryInput, setQueryInput] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [lastQueryMs, setLastQueryMs] = useState<number | undefined>();
  const [queryError, setQueryError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [lastSyncedLabel, setLastSyncedLabel] = useState("--:--");

  const refreshHeartbeat = useCallback(async () => {
    const h = await getHealth().catch(() => ({ health: null, status: "offline" as const }));
    setHealthBanner(h);
  }, []);

  const refreshCollections = useCallback(async () => {
    try {
      setLoadError(null);
      const cols = await listCollections();
      setCollections(cols);
      setLastSyncedLabel(
        new Date().toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" }),
      );
    } catch {
      setLoadError("Collections request failed.");
    }
  }, []);

  useEffect(() => {
    void refreshHeartbeat().then(refreshCollections);
    const iv = window.setInterval(() => {
      void refreshHeartbeat();
    }, 15_000);
    return () => window.clearInterval(iv);
  }, [refreshHeartbeat, refreshCollections]);

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return collections;
    return collections.filter(
      (c) =>
        c.name.toLowerCase().includes(q)
        || c.id.toLowerCase().includes(q),
    );
  }, [collections, filter]);

  useEffect(() => {
    async function loadDetail() {
      if (!selectedId) {
        setDetail(null);
        setSamples([]);
        return;
      }
      const d = await getCollection(selectedId);
      setDetail(d);
    }
    void loadDetail();
  }, [selectedId]);

  useEffect(() => {
    async function loadSamplesTab() {
      if (!selectedId || inspectorTab !== "samples") return;
      const payload = await getSamples(selectedId, 12).catch(() => ({ rows: [] as SampleRow[] }));
      setSamples(payload.rows);
    }
    void loadSamplesTab();
  }, [selectedId, inspectorTab]);

  const chromaFine = !!healthBanner?.health?.chromaReachable;

  const totalDocs = useMemo(() => {
    let acc = 0;
    let hasAny = false;
    for (const c of collections) {
      if (typeof c.count === "number") {
        acc += c.count;
        hasAny = true;
      }
    }
    return hasAny ? acc : undefined;
  }, [collections]);

  const embeddingLabel = detail?.embeddingHint ?? "—";

  const onQuery = async () => {
    if (!selectedId) {
      setQueryError("Select a collection before running quick search.");
      return;
    }
    const text = queryInput.trim();
    if (!text) {
      setQueryError("Enter a query string.");
      return;
    }

    try {
      setQueryError(null);
      const started = performance.now();
      const h = await runQuery(selectedId, text, Math.min(10, 20));
      setHits(h);
      setLastQueryMs(Math.round(performance.now() - started));
    } catch (e) {
      setHits([]);
      setQueryError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="shell">
      <header className="topbar">
        <div className="brand">
          <div className="mark" aria-hidden>
            ●
          </div>
          <div>
            <div className="brand-title">Chroma UI</div>
            <div className="brand-subtitle">Local vector cockpit</div>
          </div>
        </div>

        <div className="env">
          <span className={`pill tone-${healthBanner?.status ?? "offline"}`}>
            {healthBanner?.status ?? "checking"}
          </span>
          <div className="muted small">
            API <kbd>/api → 8787</kbd>
            {' · '}Chroma {healthBanner?.health?.chromaVersion
              ? <span className="version">{healthBanner.health.chromaVersion}</span>
              : <span className="version dim">upstream</span>}
            {healthBanner?.health?.chromaApiMode
              ? <span>{` (${healthBanner.health.chromaApiMode})`}</span>
              : null}
          </div>
          <button type="button" className="ghost" onClick={() => refreshCollections()}>
            Refresh data
          </button>
          <button type="button" className="ghost" onClick={() => refreshHeartbeat()}>
            Ping adapter
          </button>
        </div>
      </header>

      {!chromaFine && (
        <div className={`banner ribbon tone-${healthBanner?.status ?? "offline"}`} role="status">
          <strong>Upstream status.</strong>{' '}
          The adapter responds, but Chroma is not reachable. Confirm your server listens on{' '}
          <code>http://localhost:8000</code>{' '}or point <code>CHROMA_URL</code> where your instance runs,
          then restart <code>npm run dev</code>.
        </div>
      )}

      <main className="grid-main">
        <aside className="panel rail">
          <div className="panel-head">
            <h2>Collections</h2>
            <span className="muted small synced">Synced {lastSyncedLabel}</span>
          </div>
          <input
            className="filter"
            type="search"
            placeholder="Filter by name or id…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            aria-label="Filter collections"
          />
          <div className="list-scroll" role="list">
            {loadError ? <div className="empty">{loadError}</div> : null}
            {!collections.length && !loadError ? (
              <div className="empty">
                No collections surfaced yet.<br />Start Chroma, then retry refresh.
              </div>
            ) : null}
            {filtered.map((c) => (
              <button
                role="listitem"
                type="button"
                key={c.id}
                className={`collection-row ${selectedId === c.id ? "active" : ""}`}
                onClick={() => setSelectedId(c.id)}
              >
                <span className="name">{c.name}</span>
                <span className="muted id">{c.id}</span>
                <span className="count">
                  {typeof c.count === "number" ? c.count.toLocaleString() : "—"}
                </span>
              </button>
            ))}
          </div>
        </aside>

        <section className="panel center">
          <div className="panel-head compact">
            <h2>Pulse</h2>
          </div>
          <div className="tiles">
            <article className="tile">
              <div className="label">Collections</div>
              <div className="stat">{collections.length}</div>
            </article>
            <article className="tile">
              <div className="label">Documents (estimated)</div>
              <div className="stat">
                {totalDocs !== undefined ? totalDocs.toLocaleString() : "—"}
              </div>
            </article>
            <article className="tile">
              <div className="label">Embedding hint</div>
              <div className="stat small">{embeddingLabel}</div>
            </article>
            <article className="tile">
              <div className="label">Last query RTT</div>
              <div className="stat">
                {lastQueryMs !== undefined ? `${lastQueryMs} ms` : "—"}
              </div>
            </article>
          </div>

          <div className="quick-search">
            <div className="panel-head slim">
              <h3>Quick search</h3>
              <span className="muted small">
                {selectedId ? "Scoped to active collection." : "Select a collection to enable search."}
              </span>
            </div>
            <div className="search-controls">
              <input
                className="search-input"
                value={queryInput}
                placeholder="Semantic search phrase…"
                onChange={(e) => setQueryInput(e.target.value)}
                aria-label="Query text"
                disabled={!chromaFine || !selectedId}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void onQuery();
                }}
              />
              <button type="button" className="primary" disabled={!chromaFine || !selectedId} onClick={() => onQuery()}>
                Run
              </button>
            </div>
            {queryError ? (
              <div className="query-error">{queryError}</div>
            ) : null}
            <div className="hits">
              {hits.length === 0 ? (
                <div className="muted small">Awaiting query results.</div>
              ) : (
                hits.map((h, idx) => (
                  <article className="hit-card" key={`${String(h.id)}-${idx}`}>
                    <div className="hit-head">
                      <span className="mono">{String(h.id ?? `row-${idx}`)}</span>
                      {h.distance !== undefined && h.distance !== null ? (
                        <span className="muted small">Δ {typeof h.distance === "number"
                          ? h.distance.toFixed(4)
                          : h.distance}</span>
                      ) : null}
                    </div>
                    {h.document !== undefined ? <p>{String(h.document)}</p> : null}
                    {h.metadata && Object.keys(h.metadata).length > 0 ? (
                      <pre className="meta">{jsonPretty(h.metadata ?? {})}</pre>
                    ) : null}
                  </article>
                ))
              )}
            </div>
          </div>
        </section>

        <aside className="panel inspector">
          <div className="panel-head">
            <h2>Inspector</h2>
          </div>
          {!detail ? (
            <div className="empty muted">Pick a collection to inspect.</div>
          ) : (
            <>
              <div className="tabs">
                <button
                  type="button"
                  className={inspectorTab === "overview" ? "tab active" : "tab"}
                  onClick={() => setInspectorTab("overview")}
                >
                  Overview
                </button>
                <button
                  type="button"
                  className={inspectorTab === "samples" ? "tab active" : "tab"}
                  onClick={() => setInspectorTab("samples")}
                >
                  Samples
                </button>
                <button
                  type="button"
                  className={inspectorTab === "raw" ? "tab active" : "tab muted-font"}
                  onClick={() => setInspectorTab("raw")}
                >
                  Raw JSON
                </button>
              </div>

              {inspectorTab === "overview" ? (
                <div className="inspector-body">
                  <div className="metric-line">
                    <span className="muted">Identifier</span>
                    <strong className="mono">{detail.id}</strong>
                  </div>
                  <div className="metric-line">
                    <span className="muted">Name</span>
                    <strong>{detail.name}</strong>
                  </div>
                  <div className="metric-line">
                    <span className="muted">Estimated count</span>
                    <strong>
                      {typeof detail.count === "number" ? detail.count.toLocaleString() : "—"}
                    </strong>
                  </div>
                  <div className="metric-line vertical">
                    <span className="muted">Embedding hint</span>
                    <code>{embeddingLabel}</code>
                  </div>
                </div>
              ) : null}

              {inspectorTab === "samples" ? (
                <div className="inspector-body">
                  {samples.length === 0 ? (
                    <div className="empty muted small">No sample rows surfaced.</div>
                  ) : (
                    samples.map((s) => (
                      <article key={s.id} className="hit-card condensed">
                        <div className="hit-head mono">{s.id}</div>
                        <p>{s.document ?? "(no doc body)"}</p>
                        {s.metadata ? <pre className="meta">{jsonPretty(s.metadata ?? {})}</pre> : null}
                      </article>
                    ))
                  )}
                </div>
              ) : null}

              {inspectorTab === "raw" ? (
                <pre className="inspector-raw">{stringifyUnknown(detail)}</pre>
              ) : null}
            </>
          )}
        </aside>
      </main>
    </div>
  );
}
