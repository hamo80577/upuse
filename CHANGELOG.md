# Changelog

## 2026-04-16

- Added the standalone `Ops Center` workspace foundation:
  - registered `ops` as a backend and frontend system module
  - added the protected `GET /api/ops/health` endpoint
  - added the `/ops` overview route and initial admin command-center shell
  - hard-coded Ops access to the primary admin identity without adding User Management permissions, roles, or schema changes
- Added the Ops telemetry foundation and frontend instrumentation:
  - added authenticated write-side telemetry endpoints for ingest, heartbeat, and presence end
  - kept Ops health, summary, sessions, events, and errors read/admin APIs primary-admin-only
  - instrumented frontend presence, route changes, API failures, runtime errors, and high-value dashboard, performance, settings, and token-test events
  - added client-side sanitization so query values, tokens, passwords, cookies, and nested metadata are not sent
  - closed the telemetry ownership boundary so foreign session ids rotate to fresh owned sessions, foreign end requests are safe no-ops, logout clears the tab telemetry id, and identity changes in the same tab start a clean session
- Built the live Ops Center dashboard UI on the existing primary-admin-only read APIs:
  - added KPI cards, traffic and error charts, live session tables, event and error intelligence sections, filters, time-range controls, auto-refresh, and health/freshness blocks
  - kept the page read-only and did not add token-management, alerting, or quality-control Phase 5/6 surfaces

## 2026-04-12

- Hardened core backend correctness and cleanup:
  - fixed `settingsStore` so invalid reopen thresholds are rejected instead of being silently clamped before validation
  - converted password hashing and verification to real async `scrypt` usage across login, user create/update, bootstrap-admin seeding, migration, and runtime startup
  - removed expired-session pruning from authenticated request resolution and moved it to startup plus background maintenance
  - decomposed `MonitorEngine` into dedicated scheduling, runtime-tracking, snapshot-building, and upstream-error modules while preserving behavior
  - added repo-level ESLint with type-aware promise checks, React hooks enforcement, and strict `no-explicit-any` coverage for monitor/routes/shared auth persistence/system code
  - deleted dead monitor/web API barrels and legacy compatibility shims after rewriting imports to the authoritative modules

## 2026-04-11

- Finalized the internal system architecture hardening without changing product behavior:
  - server session auth now resolves workspace access exclusively through the registered system-auth registry
  - the shared web auth surface now centers on generic system/capability helpers instead of legacy per-workspace boolean flags
  - the Scano task-runner experience was split into focused orchestration hooks/helpers so the page component is primarily composition
  - the UPuse orders-mirror service was decomposed into responsibility-based modules while keeping the legacy compatibility barrel thin
  - architecture guardrail tests now lock these boundaries so a third system can be added without reintroducing shared leaks or oversized orchestration files

## 2026-04-10

- Refactored the repo around explicit system modules:
  - web routing now composes registered `UPuse` and `Scano` system modules instead of hardcoded workspace branches
  - shell navigation is derived from the system registry
  - UPuse-only monitor status state moved under the UPuse route shell
  - server startup now registers shared routes, system routes, and system websockets through composition modules
- Split shared auth persistence from system-specific access sync:
  - session helpers and user mapping moved under `apps/server/src/shared/persistence/auth`
  - Scano team membership sync/revocation checks moved into a Scano-owned access synchronizer
- Added architecture documentation for the new system-based structure and file-mapping guidance for migrated hotspots.
- Hardened UPuse live-stream authorization so `/api/ws/dashboard` and `/api/ws/performance` now reject authenticated users who do not have `upuseAccess`, matching the protected HTTP dashboard/performance routes.
- Revoked active browser sessions on user password change and aligned user-management password validation with the bootstrap-admin minimum of 12 characters.
- Hashed Scano runner bearer tokens at rest in SQLite and added a compatibility path that rewrites short-lived legacy raw runner-token rows on successful reads.
- Tightened unsafe API origin enforcement so browser-facing mutating `/api/*` requests now require a trusted `Origin`, trusted `Referer`, or same-site fetch metadata instead of implicitly allowing requests with no initiator headers.
- Stopped advertising purged local Scano task-image URLs after review-export confirmation and changed direct reads for purged local images to return `410 Gone` instead of redirecting back to the same API route.
- Added a second login anti-abuse layer keyed by IP-only to slow password spraying across many accounts from one source without changing the generic login error message.

## 2026-04-09

- Added a background Scano master-product enrichment queue that seeds one pending job row per unique imported barcode, persists queue state in SQLite, and processes uploaded chains one at a time in FIFO order.
- Split Scano master-product storage into:
  - raw imported CSV rows kept as-is
  - a separate local enriched cache populated from the Scano catalog API
  - barcode lookup rows for fast local scan resolution
- Reworked Scano scan lookup priority across both `/api/scano/tasks/:id/scans/resolve` and the legacy runner search/hydrate endpoints:
  - duplicate check
  - local enriched cache
  - live external catalog search
  - raw master-product fallback
  - manual entry
- Added enrichment runtime safeguards:
  - adaptive pacing for background API calls
  - per-item retry/backoff for transient upstream failures
  - auth-pause handling when the Scano catalog token is invalid or missing
  - resume-from-place behavior after settings update without restarting the chain from the top
- Updated the `Master Product` page to show `Products / Enriched`, queue status chips, token-pause warnings, and live polling while any chain remains queued, running, or auth-paused.
- Added targeted server and web coverage for FIFO queue behavior, retry/auth-pause handling, local enriched scan hits, raw master fallback, and active queue polling in the UI.

## 2026-04-08

- Unified Scano task-management permissions so `team_lead` and the primary admin now share the same create/edit/assignee/branch/team-read capability across the web auth state, route guards, and route actor context.
- Changed `DELETE /api/auth/users/:id` into archive semantics:
  - users are deactivated instead of hard-deleted
  - linked Scano membership is deactivated
  - active sessions are removed
  - historical Scano task assignments stay intact
- Blocked Scano access revocation and user archive when the linked user is still assigned to a non-completed Scano task (`pending`, `in_progress`, or `awaiting_review`).
- Replaced the old implicit Scano task schema rebuild with an explicit legacy-only hard reset that preserves Scano team membership, settings, and master-product data when incompatible task tables are detected.
- Reworked the Scano runner scan path to resolve products through `/api/scano/tasks/:id/scans/resolve` instead of chaining browser-side runner search and hydrate requests.
- Updated duplicate barcode handling so rescans log `duplicate_blocked` raw scans and reopen the existing confirmed product in the normal dialog instead of a read-only dead end.
- Expanded Scano product edit access during `in_progress` tasks from creator-only to any assigned scanner on the same task, and now product edit logs record the actual editing team member.
- Increased the Scano catalog assignment-check cache TTL from 2 minutes to 10 minutes for repeated runner lookups.

## 2026-04-07

- Added Scano task hard-delete for `team_lead` and the primary admin, including permanent cleanup of task rows, review exports, and local scanner-uploaded images.
- Refreshed the Scano runner/profile UX:
  - search now stays at the top of the runner
  - the runner highlights only the latest confirmed product by default
  - confirmed products stay collapsed on task profiles until opened
  - product cards use a fixed image frame with zoom affordance and full-dialog scrolling
- Preserved external/master product thumbnails without storing remote image files by saving `previewImageUrl` metadata on confirmed task products.
- Fixed Scano product editing so retained uploaded images keep their local file metadata instead of being rewritten as self-referential external URLs.
- Fixed dual-access routing so authorized direct `/scano/*` entries are no longer redirected back to UPuse just because the remembered active system is stale.

## 2026-04-06

- Added Scano Phase 3 product confirmation flow:
  - barcode lookup now starts with external product search, then detail fetch, then vendor/chain assignment checks
  - unresolved products now fall back to `Master Product` data for the task chain before switching to full manual entry
  - multi-result barcode matches now open a selection step before the product card
- Reworked the Scano runner from raw barcode capture into confirmed task products:
  - popup product card for confirm/edit/review
  - duplicate barcode blocking per task with the original scanner name and timestamp
  - multiple barcodes and multiple product images per confirmed item
  - scanner-only product editing with before/after audit history
- Expanded Scano task storage on the backend with:
  - confirmed task products
  - product image records
  - product edit logs
  - review export records
  - richer raw scan outcomes
- Added review-package export for `awaiting_review` and `completed` tasks:
  - team leads and the primary admin can generate a review `.zip`
  - the export includes an `.xlsx` sheet plus the original captured images
  - task completion is now gated behind export confirmation and image cleanup confirmation
- Updated the Scano web surfaces to show:
  - confirmed product counts on task cards
  - source counters (`Vendor`, `Chain`, `Master`, `Manual`)
  - review/export actions from the task profile and manager boards

## 2026-04-05

- Added Scano Phase 2 mobile execution flow:
  - new scanner landing page at `/scano/my-tasks`
  - new shared task profile at `/scano/tasks/:id`
  - new mobile-first task runner at `/scano/tasks/:id/run`
  - manual barcode entry, hardware-scanner-friendly input, and optional camera capture
- Expanded the Scano task lifecycle:
  - `pending -> in_progress -> awaiting_review -> completed`
  - per-scanner `start`, `end`, and `resume` participation tracking
  - final completion gated behind team-lead/admin review
- Added Scano task participation and scan storage on the backend:
  - `scano_task_participants`
  - `scano_task_scans`
  - placeholder barcode lookup records for future external product integration
- Expanded Scano task APIs with:
  - task detail/profile reads
  - assignee updates during active work
  - scanner end/resume actions
  - manager completion
  - barcode capture writes
- Hardened the Scano web test surface around the Phase 2 flows:
  - assign-task board
  - scanner my-tasks board
  - task profile actions
  - task runner barcode/end-task flow
- Separated browser logout from business and upstream API failures:
  - only confirmed UPuse session failures now sign the user out
  - business-route `401`s now trigger a single `/api/auth/me` recheck before logout
  - concurrent `401`s share the same in-flight auth recheck
- Normalized Scano catalog upstream auth failures into integration errors:
  - bad Scano tokens no longer surface as session `401`s
  - `/api/scano/settings/test` now returns a handled `502` integration error with a user-facing message instead of forcing logout
- Removed the dedicated Scano `Manage Team` page and its web route.
- Consolidated Scano access management around `User Management` instead of a second Scano-only team UI.
- Fixed the active Scano task flow so `team_lead` users can load `/api/scano/team` for task assignment instead of being blocked by an admin-only backend guard.
- Cleaned the Scano web shell by removing the stale Manage Team navigation entry and the now-unused web client/test surface around it.

## 2026-04-04

- Added the standalone `Scano` workspace foundation:
  - `/scano/assign-task` task board
  - chain and branch catalog lookup through the backend adapter
  - task creation/editing wizard
  - team management and settings pages under the Scano navigation
- Reworked access control into a dual-workspace model:
  - `upuseAccess` is now separate from `scanoRole`
  - `role` remains the UPuse role only
  - one `primary admin` now keeps implicit Scano admin access
  - Scano access for non-primary users is synced through linked Scano team membership
- Hardened routing and navigation around workspace access:
  - direct unauthorized workspace links now redirect to the allowed workspace home
  - the system switcher now appears only for users who can access both `UPuse` and `Scano`
  - dropdown navigation now scrolls when it overflows
- Replaced the old user creation/edit flow with a 2-step wizard that grants:
  - `UPuse access`
  - `Scano access`
  - or both
- Cleaned up Scano page-level navigation so `Manage Team` and `Scano Settings` stay in the dropdown instead of the task page header
- Added targeted server and web coverage for:
  - dual-workspace auth payloads
  - primary-admin-only Scano admin routes
  - workspace redirects and switcher gating
  - Scano team linking through existing users

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
