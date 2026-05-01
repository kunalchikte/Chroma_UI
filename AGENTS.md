## Learned User Preferences

- Wants Chroma tooling presented through a straightforward UI that stays visually polished without unnecessary complexity for a senior engineering audience.
- Favors dashboard-first information architecture (mixed KPI emphasis, dependable collection navigation paths, prominent quick retrieval) versus search-monolith-first or encyclopedic inspectors as the landing experience.
- Chooses dark, professional palettes that read as deliberate dev-tool dashboards rather than light-only shells or gratuitously maximal accent palettes.
- Prefers a dedicated local REST adapter between SPA and Chroma-class backends for normalization, safe read retries, structured logging, localhost binding posture, and CORS avoidance over wiring the browser directly to upstream endpoints.
- When offered, prefers enabling browser/visual companion tooling to validate layout drafts and mocks before implementation hardens.

## Learned Workspace Facts

- Primary build target is `docs/superpowers/specs/2026-05-02-chroma-local-dashboard-design.md`: a localhost Chroma dashboard pairing a React + Vite + TypeScript SPA with an Express + TypeScript normalization layer that exposes consolidated `/health`, `/collections`, sample, and capped query routes.
- Default development-facing endpoints remain `5173` for the SPA toolchain, `8787` for the adapter shell, with upstream Chroma selected through `CHROMA_URL` (documented fallback `http://localhost:8000`).
- Accepted engineering defaults include TTL caching only when listing collections, health-driven degraded/offline UX, deterministic logging taxonomies mirroring surfaced UI states, capped sample/query payloads, binding the adapter loopback-first, plus automated sanity tests around normalization fixtures.
