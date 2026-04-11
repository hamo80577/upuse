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
- UPuse live websocket feeds (`/api/ws/dashboard`, `/api/ws/performance`) now enforce the same `upuseAccess` check as the protected HTTP dashboard and performance routes.
- Updating a user's password now revokes that user's active browser sessions, and user-management password create/update flows require a minimum length of 12 characters to match the bootstrap-admin policy.
- Scano runner bearer tokens are short-lived, returned only to the caller that bootstraps the runner, and hashed before they are persisted in SQLite.
- In production, new sessions are issued under a host-only `__Host-` cookie name for stronger cookie scoping. The server still accepts the legacy cookie name during the transition.
- For the cookie session model, serve the web app and `/api` from the same site or behind one reverse proxy so the browser can keep the session same-origin.
- Mutating API routes enforce trusted request origins. Browser writes should come from the same site or from origins explicitly listed in `UPUSE_CORS_ORIGINS`, and unsafe requests that omit `Origin`, `Referer`, and `Sec-Fetch-Site` are rejected.
- Browser logout now depends only on the UPuse session itself. A failing business API or external integration token no longer signs the user out on its own.
- Non-session upstream auth failures are normalized into integration errors so the UI can show a toast/error without collapsing the current workspace session.

## Workspaces and access model
- The product now has two workspaces:
  - `UPuse`
  - `Scano`
- Access is controlled independently:
  - `upuseAccess` controls whether the user can open UPuse routes
  - `scanoRole` controls whether the user can open Scano (`team_lead` or `scanner`)
- `role` remains the UPuse role only: `admin` or `user`
- One `primary admin` is maintained in the database. That user always keeps:
  - `UPuse admin`
  - implicit `Scano admin` capabilities
- Non-primary users gain Scano through a linked Scano team membership, not by their UPuse role
- Internally, server-side workspace authorization now resolves through the registered system auth registry, and the shared web auth layer exposes generic `hasSystemAccess(systemId)`, `hasSystemCapability(systemId, capability)`, and `getSystemAccess(systemId)` helpers instead of workspace-specific shared flags.

## Workspace switching and redirects
- The system switcher appears only for users who can access both workspaces
- UPuse-only users do not see Scano navigation or the switcher
- Scano-only users do not see UPuse navigation or the switcher
- Authorized direct `/scano/*` links win over a stale remembered `UPuse` system, so bookmarks and login returns stay in Scano
- If a user opens a route from a workspace they do not have access to:
  - `Scano-only team_lead` users are redirected to `/scano/assign-task`
  - `Scano-only scanner` users are redirected to `/scano/my-tasks`
  - `UPuse-only` users are redirected to `/`
- The last active system is remembered only for users who can access both workspaces

## User management wizard
- `User Management` now creates and edits users through a 2-step wizard:
  1. account details: name, email, password
  2. workspace access: `UPuse access` and `Scano access`
- A user can be:
  - `UPuse only`
  - `Scano only`
  - `Both`
- `UPuse access` reveals the UPuse role selector: `admin` / `user`
- `Scano access` reveals the Scano role selector: `team_lead` / `scanner`
- Saving a user without access to either workspace is blocked
- Deleting a user from the UI now archives them instead of hard-deleting their row:
  - `users.active` is set to `0`
  - `upuseAccess` is cleared
  - linked `scano_team_members.active` is set to `0`
  - existing sessions are removed
- Archived users stay visible in the list with an `Archived` status and cannot be edited or archived again from the current UI
- Removing Scano access or archiving a user is blocked while that linked user is still assigned to a Scano task in `pending`, `in_progress`, or `awaiting_review`

## Scano workspace
- `team_lead` users land on `Assign Task` at `/scano/assign-task`
- `scanner` users land on `My Tasks` at `/scano/my-tasks`
- Scano access is granted from `User Management`, not from a dedicated Scano team page
- `Scano Settings` and `Master Product` stay under the Scano dropdown navigation
- `Scano Settings` is a minimal token screen used only to test and update the Scano catalog token
- The catalog base URL is fixed on the server side and is not edited from the UI
- `Master Product` is available to `primary admin` and `team_lead` only, and stores one normalized catalog import per chain for lookup fallback
- Every saved `Master Product` chain now seeds a background enrichment queue from the imported barcode column
- The raw CSV rows remain untouched, while a separate local enriched cache stores barcode-backed API results by chain and import revision
- Enrichment runs through one global FIFO worker, so if multiple chains are uploaded together they process one after another instead of competing for upstream capacity
- The `Master Product` table now shows `Products / Enriched`, queue status (`Queued`, `Running`, `Completed`, `Paused`), and a warning icon when enrichment is paused because the Scano catalog token needs attention

## Scano task flow
- `Add New Task` opens a multi-step wizard:
  1. search chain
  2. select branch
  3. assign scanners and choose schedule
  4. review and save
- Scano task lifecycle is now:
  - `pending`
  - `in_progress`
  - `awaiting_review`
  - `completed`
- Team leads and the primary admin share the same task-management capability for:
  - chain search
  - branch search
  - scanner loading for assignment
  - creating and editing pending tasks
- Team leads can still update assignees while a task is `in_progress`, but started scanners cannot be removed
- Team leads and the primary admin can permanently delete a Scano task from the manager board or task profile
- Scanners work from `My Tasks`, where each task can be:
  - started
  - continued
  - resumed after a per-scanner end
- Opening a task leads to:
  - `/scano/tasks/:id` for the shared task profile
  - `/scano/tasks/:id/run` for the mobile-first runner
- The runner supports:
  - manual barcode entry
  - hardware scanner input through the same barcode field
  - optional camera scanning with runtime camera permission
- Barcode resolution now follows this order:
  1. server-side duplicate check for the current task barcode
  2. local enriched master-product cache lookup for the task chain
  3. external product search by barcode
  4. server-side vendor/chain assignment lookup for the chosen external product
  5. raw master-product row fallback for the task chain when the external search misses
  6. manual product completion when no enriched, external, or raw master match exists
- The browser no longer performs a separate runner `hydrate` request. The runner resolves scans through `/api/scano/tasks/:id/scans/resolve`, and both the modern scan flow and the legacy runner search/hydrate endpoints now follow the same local-first lookup order
- Background enrichment accepts only exact barcode matches that are assigned to the active chain or vendor. Ambiguous or failed enrichments stay out of the local cache and continue to fall back to live external search or raw master rows at scan time
- Confirmed task products now store:
  - external id when available
  - SKU, price, English and Arabic names
  - one or more barcodes
  - scanner-uploaded product images only
  - optional `previewImageUrl` metadata for external/master thumbnails when no local upload exists
  - source flags: `vendor`, `chain`, `master`, `manual`
  - edit history for assigned-scanner product updates while the task is `in_progress`
- Retaining an uploaded local image during product edit keeps its local file metadata intact so image downloads and review exports still work
- Duplicate barcodes are blocked per task. Re-scanning an existing barcode records a `duplicate_blocked` raw scan, reopens the confirmed product in the normal product dialog, and shows who confirmed it first and when. Assigned scanners can continue editing from that dialog; viewers without edit permission stay read-only
- Task counters now track confirmed products by exclusive source:
  - `Vendor`
  - `Chain`
  - `Master`
  - `Manual`
- Each scanner ends their own participation. Once every assigned scanner has ended, the task moves to `awaiting_review`
- During `awaiting_review`, `team_lead` and the primary admin can export a review package for the task
- Review export produces a `.zip` package that contains:
  - an `.xlsx` review sheet
  - the original captured images in a folder
  - the same images embedded inside the spreadsheet when the format is supported
- Task completion is now gated behind review export confirmation. After the lead confirms the export download, temporary server-side product images are purged, purged local image URLs stop appearing in normal task-product payloads, direct reads return `410 Gone`, and the task can move from `awaiting_review` to `completed`
- If the server detects an old incompatible Scano task schema during migration, it now performs an explicit hard reset of legacy task-domain tables only. `scano_team_members`, `scano_settings`, and master-product data are preserved.

## Server env vars
- `PORT`: API port. Default `8080`.
- `UPUSE_SECRET`: encryption key seed for stored tokens. Required in production.
- `UPUSE_SECRET_PREVIOUS`: optional comma-separated old encryption secrets kept for decrypt-only compatibility during rotation. Stored tokens are re-encrypted with the current `UPUSE_SECRET` during startup when an old key is used.
- `UPUSE_DATA_DIR`: optional data directory override for SQLite files. Relative values are resolved from `apps/server`, not the shell working directory. Default stays `apps/server/data`.
- `UPUSE_CORS_ORIGINS`: optional comma-separated allowed origins. By default only `http://localhost:*` and `http://127.0.0.1:*` are allowed.
- `UPUSE_TRUST_PROXY`: configure Express `trust proxy` when the app is behind a reverse proxy. Accepts `true`, a hop count like `1`, or a subnet/list such as `loopback` or `loopback, linklocal`.
- `UPUSE_LOGIN_RATE_LIMIT_MAX_KEYS`: maximum number of distinct login throttle keys retained in memory. Default `5000`.
- `UPUSE_LOGIN_IP_RATE_LIMIT_MAX_ATTEMPTS`: maximum failed login attempts allowed per IP across many accounts before the IP-wide spray throttle blocks further login attempts. Default `20`.
- `UPUSE_STREAM_MAX_CONNECTIONS_PER_USER`: maximum concurrent `/api/stream` connections per authenticated user. Default `3`.
- `UPUSE_STREAM_MAX_CONNECTIONS_TOTAL`: maximum concurrent `/api/stream` connections across the process. Default `100`.
- `UPUSE_SCANO_CSV_UPLOAD_MAX_FILE_SIZE_BYTES`: maximum CSV upload size for Scano master-product imports. Default `5242880` (5 MB).
- `UPUSE_SCANO_CSV_UPLOAD_MAX_PARTS`: maximum multipart parts accepted for Scano CSV uploads. Default `5`.
- `UPUSE_SCANO_IMAGE_UPLOAD_MAX_FILE_SIZE_BYTES`: maximum size per uploaded Scano task image. Default `5242880` (5 MB).
- `UPUSE_SCANO_IMAGE_UPLOAD_MAX_FILES`: maximum uploaded Scano task images per request. Default `5`.
- `UPUSE_SCANO_IMAGE_UPLOAD_MAX_PARTS`: maximum multipart parts accepted for Scano task-image uploads. Default `10`.
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
- `npm --workspace apps/server run test:scano:baseline`
- `npm --workspace apps/web run build`
- `npm --workspace apps/web test`
- `npm --workspace apps/web run test:scano:baseline`
- `npm run test:ops`
- `npm run test:scano:baseline`

## Scano refactor baseline
- Phase 0 is documentation plus test scaffolding only. No behavior change is intended at this stage.
- ADR: `docs/adr/0001-scano-canonical-source-of-truth.md`
- Refactor checklist: `docs/refactor/scano-refactor-checklist.md`
- One-command baseline matrix:
  - `npm run test:scano:baseline`

## Secret rotation
1) Set a new `UPUSE_SECRET`.
2) Put the previous secret in `UPUSE_SECRET_PREVIOUS`.
3) Start the server once and verify `/api/settings` loads successfully.
4) After the server logs that stored settings were re-encrypted, remove the old secret from `UPUSE_SECRET_PREVIOUS`.
5) If you still use `start.ps1` and an old `apps/server/data/.dev-secret` file exists from a previous setup, either delete it or replace it with the current secret so the compatibility fallback is not re-added on the next start.

## System modular architecture
- Web platform/shared layers:
  - `apps/web/src/app`: bootstrap, providers, shell, router
  - `apps/web/src/core/systems`: registry, navigation, permissions, system contracts
  - `apps/web/src/shared`: shared API transport, lib helpers, shared UI
- Web system ownership:
  - `apps/web/src/systems/upuse/*`
  - `apps/web/src/systems/scano/*`
- Server platform/shared layers:
  - `apps/server/src/app`: bootstrap, middleware, error handling, server composition
  - `apps/server/src/core/systems`: system contracts and cross-system registries
  - `apps/server/src/shared`: shared auth/session persistence, shared HTTP helpers, security primitives
- Server system ownership:
  - `apps/server/src/systems/upuse/*`
  - `apps/server/src/systems/scano/*`

Key points:
- Shared shell/router/bootstrap code stays outside systems.
- System switching is registry-driven, not hardcoded to only `UPuse` and `Scano`.
- New system-specific pages, routes, services, widgets, and policies should be added under the owning `systems/<system-id>` folder.
- Legacy top-level paths may remain as thin compatibility re-exports during migration, but new work should target the owning module directly.

Reference docs:
- `docs/architecture/system-modular-structure.md`
- `docs/architecture/refactor-file-mapping.md`
  - `apps/server/src/monitor`: monitor engine entrypoint
  - `apps/server/src/services/orders`: aggregate/detail/pagination/http split
  - `apps/server/src/services/reports`: CSV/range/action events split
