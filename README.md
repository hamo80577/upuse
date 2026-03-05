# UPuse — All Under Control.

A production-ready monitoring control tower for branch availability, driven by real-time order health.

## Requirements
- Node.js 18+ (recommended 20+)
- npm 9+

## Quick start (dev)
1) Install deps (root):
   - `npm install`
2) Start server + web:
   - `npm run dev`

- Web: http://localhost:5173
- API: http://localhost:8080

## Build
- `npm run build`

## Run server (prod)
- `npm run start`

## Notes
- Settings, branch mappings, and logs are stored in `apps/server/data/upuse.sqlite`.
- Tokens are stored encrypted-at-rest using a local key derived from `UPUSE_SECRET` (see `.env.example`).
- In development only, if `UPUSE_SECRET` is missing, the server creates and reuses `apps/server/data/.dev-secret` with a loud warning so localhost stays usable.
- In production, `UPUSE_SECRET` is mandatory and the server refuses to start without it.
- If `UPUSE_ADMIN_KEY` is enabled, the web UI stores the key in `sessionStorage` (8h expiry) from the Settings page and sends it only as `Authorization: Bearer <key>`.

## Server env vars
- `PORT`: API port. Default `8080`.
- `UPUSE_SECRET`: encryption key seed for stored tokens. Required in production.
- `UPUSE_DATA_DIR`: optional data directory override for SQLite files. Relative values are resolved from `apps/server`, not the shell working directory. Default stays `apps/server/data`.
- `UPUSE_ADMIN_KEY`: optional bearer token for API protection. When set, `/api/*` requires `Authorization: Bearer <key>` except `/api/health`.
- `UPUSE_CORS_ORIGINS`: optional comma-separated allowed origins. By default only `http://localhost:*` and `http://127.0.0.1:*` are allowed.
- `UPUSE_ORDERS_MODE`: optional orders fetching mode. Supported values: `fullday` (default) and `incremental`. The current safe implementation keeps the same full-day fetch window in both modes until a source-safe incremental cursor can be introduced.
- `UPUSE_BRANCH_DETAIL_CACHE_TTL_SECONDS`: optional in-memory cache TTL for branch detail dialog order fetches. Default `0` (disabled).
- `UPUSE_ORDERS_CHUNK_CONCURRENCY`: optional concurrency for orders vendor chunks. Default `3` (range `1..8`).
- `UPUSE_ORDERS_WINDOW_SPLIT_MAX_DEPTH`: optional max recursive depth for automatic time-window split when pagination is too large. Default `8`.
- `UPUSE_ORDERS_WINDOW_MIN_SPAN_MS`: optional minimum UTC window span (ms) before further split. Default `300000` (5 minutes).

## Validation commands
- `npm --workspace apps/server run build`
- `npm --workspace apps/server test`
- `npm --workspace apps/web run build`

## Refactor structure (progressive feature-sliced)
- Web:
  - `apps/web/src/app`: router + providers
  - `apps/web/src/pages/*/ui`: page containers
  - `apps/web/src/widgets`: composed UI blocks (`top-bar`, `branch-detail`, `operations-summary`)
  - `apps/web/src/entities`: shared domain UI/model (`branch`, `monitoring`)
  - `apps/web/src/shared`: cross-cutting API + lib helpers
- Server:
  - `apps/server/src/monitor`: monitor engine entrypoint
  - `apps/server/src/services/orders`: aggregate/detail/pagination/http split
  - `apps/server/src/services/reports`: CSV/range/action events split
