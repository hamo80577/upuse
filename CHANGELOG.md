# Changelog

## 2026-03-04

- Hardened token encryption startup behavior:
  - production now fails fast without `UPUSE_SECRET`
  - development now reuses a persisted `data/.dev-secret` (or generates one) and warns loudly
  - legacy `dev-secret` data remains readable through a safe compatibility path
- Completed admin-key protection end-to-end by letting the web UI store an Admin Key locally and attach it automatically as a bearer header.
- Aligned orders entity resolution across monitor polling and settings token tests so per-branch `globalEntityId` overrides are honored, while single-entity setups keep the previous behavior.
- Removed the dashboard's implicit stale-sync auto-start path; recovery now checks monitor status without starting monitoring behind the user's back.
- Reduced branch detail over-fetch by switching to stable fetch keys, request de-duplication, aborts, and a short in-memory cache while the dialog stays open.
- Fixed branch deletion semantics to validate ids and return not-found instead of reporting success when nothing was deleted.
- Hardened the remaining operational gaps:
  - availability close/open writes now fall back to the global entity id when a branch override is blank
  - `/api/stream` is no longer exempt from admin-key protection
  - dashboard live sync now uses authenticated polling instead of unauthenticated SSE
  - server/web builds clean `dist/` before compiling

## 2026-03-03

- Fixed the server TypeScript build by adding proper type packages for `better-sqlite3` and `luxon`, excluding test files from the production `tsc` build, and tightening SQLite row typing in the server stores.
- Added a stable server data path resolver. The database now resolves from the server app location instead of `process.cwd()`, with optional `UPUSE_DATA_DIR` support and a test to lock that behavior.
- Added lightweight localhost-first API hardening:
  - restricted default CORS to `localhost` / `127.0.0.1`
  - optional bearer-key protection with `UPUSE_ADMIN_KEY`
  - kept `/api/health` and `/api/stream` unprotected for health checks and SSE compatibility
- Enriched `/api/health` with non-breaking monitor status fields (`monitorRunning`, `monitorDegraded`, `lastSnapshotAt`, `lastErrorAt`).
- Added `vitest` to the server workspace with policy tests that lock current monitor decision behavior and path resolution tests for the new DB path logic.
- Added a safe, opt-in orders client optimization layer:
  - optional `UPUSE_ORDERS_MODE`
  - optional branch detail cache TTL via `UPUSE_BRANCH_DETAIL_CACHE_TTL_SECONDS`
  - default behavior remains unchanged
- Refactored frontend maintainability without changing UI behavior:
  - extracted dashboard live sync into a hook
  - extracted dashboard toolbar controls
  - extracted chain group rendering
  - extracted settings chain threshold manager
  - extracted branch detail loading/log state into a hook
  - removed the unused `LogDialog` component
- Added repo ignore rules for generated `dist/` output and SQLite sidecar files.
