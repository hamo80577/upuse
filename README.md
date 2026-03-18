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
- `npm run build`
- `npm run start`

`npm run start` now:
- loads root `.env` if present
- forces `NODE_ENV=production`
- refuses to start if `apps/server/dist/index.js` or `apps/web/dist/index.html` is missing

If you want one Windows command that loads `.env`, builds, and starts production, use:
- `.\start.ps1`

## Live deploy checks
- Keep runtime artifacts out of Git. `apps/server/dist`, `apps/web/dist`, and `apps/server/data/upuse.sqlite*` should exist on disk when needed, but should not be tracked.
- Before restart, back up `apps/server/data/upuse.sqlite`.
- Build production artifacts:
  - `npm run build`
- Start production:
  - `npm run start`
- After restart, verify health endpoints:
  - `curl http://127.0.0.1:8080/api/health`
  - `curl http://127.0.0.1:8080/api/ready`

## Notes
- Settings, branch mappings, and logs are stored in `apps/server/data/upuse.sqlite`.
- Tokens are stored encrypted-at-rest using a local key derived from `UPUSE_SECRET` (see `.env.example`).
- In development only, if `UPUSE_SECRET` is missing, the server creates and reuses `apps/server/data/.dev-secret` with a loud warning so localhost stays usable.
- In production, `UPUSE_SECRET` is mandatory and the server refuses to start without it.
- The server supports one-way secret rotation through `UPUSE_SECRET_PREVIOUS`: old secrets can still decrypt stored tokens, and the current `UPUSE_SECRET` is used to re-encrypt them during startup.
- Web access is authenticated with email/password sessions and role-based authorization (`admin` / `user`).
- Session tokens are delivered only through `HttpOnly` same-site cookies. The raw token is never exposed to frontend JavaScript, and the persisted session token is hashed before it is stored in SQLite.
- In production, new sessions are issued under a host-only `__Host-` cookie name for stronger cookie scoping. The server still accepts the legacy cookie name during the transition.
- For the cookie session model, serve the web app and `/api` from the same site or behind one reverse proxy so the browser can keep the session same-origin.
- Mutating API routes enforce trusted request origins. Browser writes should come from the same site or from origins explicitly listed in `UPUSE_CORS_ORIGINS`.

## Server env vars
- `PORT`: API port. Default `8080`.
- `UPUSE_SECRET`: encryption key seed for stored tokens. Required in production.
- `UPUSE_SECRET_PREVIOUS`: optional comma-separated old encryption secrets kept for decrypt-only compatibility during rotation. Stored tokens are re-encrypted with the current `UPUSE_SECRET` during startup when an old key is used.
- `UPUSE_DATA_DIR`: optional data directory override for SQLite files. Relative values are resolved from `apps/server`, not the shell working directory. Default stays `apps/server/data`.
- `UPUSE_CORS_ORIGINS`: optional comma-separated allowed origins. By default only `http://localhost:*` and `http://127.0.0.1:*` are allowed.
- `UPUSE_TRUST_PROXY`: configure Express `trust proxy` when the app is behind a reverse proxy. Accepts `true`, a hop count like `1`, or a subnet/list such as `loopback` or `loopback, linklocal`.
- `UPUSE_LOGIN_RATE_LIMIT_MAX_KEYS`: maximum number of distinct login throttle keys retained in memory. Default `5000`.
- `UPUSE_STREAM_MAX_CONNECTIONS_PER_USER`: maximum concurrent `/api/stream` connections per authenticated user. Default `3`.
- `UPUSE_STREAM_MAX_CONNECTIONS_TOTAL`: maximum concurrent `/api/stream` connections across the process. Default `100`.
- `UPUSE_BOOTSTRAP_ADMIN_EMAIL`: email for creating the first admin account when the database has no users yet.
- `UPUSE_BOOTSTRAP_ADMIN_PASSWORD`: password for the bootstrap admin account. Minimum 12 characters.
- `UPUSE_BOOTSTRAP_ADMIN_NAME`: optional display name for the bootstrap admin. Defaults to `Administrator`.
- `UPUSE_BRANCH_DETAIL_CACHE_TTL_SECONDS`: optional in-memory cache TTL for branch detail dialog order fetches. Default `0` (disabled).
- `UPUSE_ORDERS_HTTP_TIMEOUT_MS`: optional Orders API request timeout in milliseconds. Default `25000`.
- `UPUSE_ORDERS_HISTORY_SYNC_SECONDS`: optional incremental history sync cadence for the local orders mirror. Default `120`.
- `UPUSE_ORDERS_REPAIR_SWEEP_SECONDS`: optional full repair sweep cadence for the local orders mirror. Default `1800`.
- `UPUSE_ORDERS_STALE_MULTIPLIER`: optional number of missed orders cycles before source-wide degradation is surfaced. Default `2`.
- `UPUSE_ORDERS_TEST_CONCURRENCY`: optional concurrency cap for background branch probes in `Test Tokens`. Default `2`.
- `UPUSE_ORDERS_CHUNK_CONCURRENCY`: optional concurrency for orders vendor chunks. Default `3` (range `1..8`).
- `UPUSE_ORDERS_WINDOW_SPLIT_MAX_DEPTH`: optional max recursive depth for automatic time-window split when pagination is too large. Default `8`.
- `UPUSE_ORDERS_WINDOW_MIN_SPAN_MS`: optional minimum UTC window span (ms) before further split. Default `300000` (5 minutes).

## Orders sync model
- Dashboard order cards and branch-level order metrics now read from the local SQLite mirror (`orders_mirror`) instead of recalculating directly from the upstream Orders API every cycle.
- The monitor keeps that mirror healthy via:
  - bootstrap sync for the Cairo day when a vendor has no mirror state yet
  - active sync every `ordersRefreshSeconds`
  - incremental history sync every `UPUSE_ORDERS_HISTORY_SYNC_SECONDS`
  - repair sweep every `UPUSE_ORDERS_REPAIR_SWEEP_SECONDS`
- Source-wide degraded Orders state is now hysteresis-based. A single transient Orders API failure no longer forces the whole dashboard into a hard error state if the cached mirror is still fresh enough to serve operators.

## Token testing
- `POST /api/settings/test` now starts an async token validation job and returns `202 Accepted` with a `jobId`.
- `GET /api/settings/test/:jobId` returns the progressive snapshot for that job.
- Orders token validation now treats `HTTP 200` with an empty orders list as a valid probe result. Recent order presence is no longer required for a branch to pass.

## Auth bootstrap
- The old hardcoded default admin seed has been removed.
- On a fresh database, set `UPUSE_BOOTSTRAP_ADMIN_EMAIL` and `UPUSE_BOOTSTRAP_ADMIN_PASSWORD` before the first server start to create the initial admin account.
- After the initial admin exists, rotate or remove those bootstrap env vars from your deployed environment.

## Validation commands
- `npm --workspace apps/server run build`
- `npm --workspace apps/server test`
- `npm --workspace apps/web run build`

## Secret rotation
1) Set a new `UPUSE_SECRET`.
2) Put the previous secret in `UPUSE_SECRET_PREVIOUS`.
3) Start the server once and verify `/api/settings` loads successfully.
4) After the server logs that stored settings were re-encrypted, remove the old secret from `UPUSE_SECRET_PREVIOUS`.
5) If you still use `start.ps1` and an old `apps/server/data/.dev-secret` file exists from a previous setup, either delete it or replace it with the current secret so the compatibility fallback is not re-added on the next start.

## Refactor structure (progressive feature-sliced)
- Web:
  - `apps/web/src/app`: router + providers
  - `apps/web/src/pages/*/ui`: canonical page entrypoints (`dashboard`, `login`, `branches`, `thresholds`, `settings`, `users`)
  - `apps/web/src/features/branch-mapping`: shared branch/threshold state + pure helpers used by both `BranchesPage` and `ThresholdsPage`
  - `apps/web/src/features/reports/ui`: report download UI
  - `apps/web/src/widgets`: composed UI blocks (`top-bar`, `branch-detail`, `operations-summary`)
  - `apps/web/src/entities`: shared domain UI/model (`branch`, `monitoring`)
  - `apps/web/src/shared`: cross-cutting API + lib helpers
- Server:
  - `apps/server/src/monitor`: monitor engine entrypoint
  - `apps/server/src/services/orders`: aggregate/detail/pagination/http split
  - `apps/server/src/services/reports`: CSV/range/action events split
