# Phase 02 — Build the backend telemetry foundation for a real admin observability system

Assume Phase 01 is complete and merged.

Before making any change:
- Read the active backend code paths first.
- Do not rely on docs.
- Follow `AGENTS.md`.
- Preserve current contracts unless a backend extension is required.
- Build this as a serious foundation, not a throwaway log table.

## Read these files first
- `apps/server/src/shared/db/migrate.ts`
- `apps/server/src/shared/db/schema/sharedSchema.ts`
- `apps/server/src/config/db.ts`
- `apps/server/src/shared/db/crypto.ts`
- `apps/server/src/app/server/createApp.ts`
- `apps/server/src/shared/http/registerSharedRoutes.ts`
- `apps/server/src/shared/http/auth/sessionAuth.ts`
- `apps/server/src/http/performanceWebSocket.ts`
- `apps/server/src/routes/settings.ts`
- `apps/server/src/services/settingsStore.ts`
- all current files under `apps/server/src/systems/ops/**`

## Goal of this phase
Create a backend-only observability foundation for Ops Center that can:
- ingest telemetry events
- track live presence
- persist sessions and activity
- summarize admin-facing metrics
- support future charts, trend lines, pie charts, status arrows, alerts, and drill-downs

Do **not** build the full UI in this phase.

## Product intent
The final Ops Center should let the primary admin understand everything important happening in the site from one place:
- who is online
- who is active right now
- what pages are being used
- what flows are failing
- what APIs are slow
- what frontend errors are happening
- whether the current dashboard and performance pages are healthy
- whether the system is degraded, stale, or healthy

This phase must create the backend data model that makes that possible.

## Required architecture
Create a clean backend structure under `apps/server/src/systems/ops/`, for example:
- `db/`
- `routes/`
- `services/`
- `policies/`
- `types/`
- `websocket/`

Reuse current repo patterns where they fit.

## Data model requirements
Add schema/migration support for Ops Center. The design must support at least these entities:

### 1) Ops sessions
Store session-level observability state such as:
- session id
- user id if authenticated
- user name/email snapshot if useful
- current system (`upuse`, `scano`, `ops`, or unknown)
- current route/path
- first seen at
- last seen at
- last active at
- ended at
- active/idle/offline state
- user agent summary
- device/browser summary if you choose to derive it
- referrer/source if available

### 2) Ops events
Store product and technical telemetry events such as:
- `page_view`
- `route_change`
- `heartbeat`
- `user_active`
- `user_idle`
- `api_request`
- `api_error`
- `js_error`
- `unhandled_rejection`
- `dashboard_opened`
- `performance_opened`
- `settings_opened`
- `token_test_started`
- `token_test_finished`
- other carefully chosen high-value events

Each event should support enough metadata for filtering and charting without becoming uncontrolled JSON garbage.

### 3) Error records
Persist normalized error records with fields that help the admin actually diagnose issues:
- error source (`frontend`, `backend`, `websocket`, `integration`)
- severity
- route/page context
- message
- code/status if available
- stack fingerprint or normalized signature if possible
- first seen / last seen
- count

### 4) Metric snapshots or aggregates
Create a path for summary metrics the dashboard can consume efficiently:
- online users
- active users
- sessions today
- page views today
- error count today
- API request count
- API failure count
- dashboard health summary
- performance health summary

This can be query-driven or partially aggregated, but it must be practical.

## Routes to add in this phase
Add protected Ops API routes, all admin-only through the Ops system access policy.

At minimum implement:
- `POST /api/ops/ingest`
- `POST /api/ops/presence/heartbeat`
- `POST /api/ops/presence/end`
- `GET /api/ops/summary`
- `GET /api/ops/sessions`
- `GET /api/ops/events`
- `GET /api/ops/errors`

## Ingestion design requirements
### 1) Validation
Use strict runtime validation for request bodies.
Do not accept arbitrary giant payloads.

### 2) Noise control
Do not turn every tiny UI action into stored noise.
The backend contract must encourage high-signal telemetry.

### 3) Security
- keep all Ops routes protected
- validate input shape
- reject oversized payloads
- avoid exposing sensitive raw secrets in telemetry
- do not store token values in events or errors

### 4) Performance
The ingestion model must be lightweight enough for frequent use.
Avoid expensive per-request work unless necessary.

## Summary API requirements
The summary endpoint must return enough data to power a rich future dashboard with:
- KPI cards
- trend charts
- pie charts
- distribution widgets
- up/down movement arrows
- health pills/badges

Include at least:
- current counts
- short time-window trend values
- status buckets
- error buckets
- top pages
- top event types
- freshness timestamps

## UI-facing contract design
Design response shapes so the frontend can build a premium dashboard without constant reshaping.
Prefer dashboard-ready structures.

## Important constraints
- Do not add the full WebSocket live stream yet unless needed as a minimal foundation.
- Do not build the full frontend dashboard yet.
- Do not refactor unrelated systems.
- Do not break existing settings, performance, monitor, or auth routes.

## Deliverables for this phase
1. Ops database foundation added safely
2. Protected Ops ingestion routes
3. Session and event persistence model
4. Error persistence model
5. Summary/session/event/error read APIs for the future dashboard

## Verification requirements
Run the narrowest relevant backend verification possible.
At minimum verify:
- migrations/schema boot cleanly
- backend build or relevant tests pass
- protected Ops routes reject unauthorized access
- primary admin access works
- ingestion accepts valid payloads and rejects invalid payloads

## Output format
When done, report:
- exact files changed
- schema/tables introduced
- new APIs and request/response contracts
- why the data model supports the future admin dashboard well
- verification performed
- anything not verified
