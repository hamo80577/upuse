# Phase 03 — Instrument the frontend so Ops Center can see real user activity, flow health, and runtime issues

Assume Phases 01 and 02 are complete and merged.

Before making any change:
- Read the active frontend code first.
- Do not rely on docs.
- Follow `AGENTS.md`.
- Reuse current API, provider, routing, and shell patterns.

## Read these files first
- `apps/web/src/main.tsx`
- `apps/web/src/App.tsx`
- `apps/web/src/app/providers/AppProviders.tsx`
- `apps/web/src/app/providers/AuthProvider.tsx`
- `apps/web/src/app/router/AppRouter.tsx`
- `apps/web/src/app/router/guards.tsx`
- `apps/web/src/app/shell/TopBar.tsx`
- `apps/web/src/shared/api/httpClient.ts`
- `apps/web/src/api/client.ts`
- `apps/web/src/systems/upuse/api/endpoints.ts`
- `apps/web/src/systems/upuse/providers/MonitorStatusProvider.tsx`
- all current files under `apps/web/src/systems/ops/**`
- all current backend Ops contracts from Phase 02

## Goal of this phase
Add real frontend instrumentation so Ops Center can understand:
- who is online
- who is active vs idle
- what page they are on
- how long sessions last
- what key product actions happen
- what API failures happen in the client
- what JS runtime errors happen
- what unhandled promise rejections happen
- what system area they are using (`upuse`, `scano`, `ops`)

This phase is about **real signals**, not random analytics spam.

## Product direction
The final admin page must be able to show powerful, highly visual, deeply interactive admin observability widgets:
- live user activity tables
- line charts
- area charts
- pie charts
- trend arrows up/down
- status indicators
- top routes
- error hotspots
- recent activity streams
- session drill-downs

So the instrumentation contract must support those outcomes cleanly.

## What to build
### 1) Frontend telemetry client
Create a clean telemetry client/service under the Ops frontend system or shared frontend layer, whichever best fits the current repo patterns.

It should support sending structured events such as:
- identify/start session
- page view
- route change
- heartbeat
- user active
- user idle
- page dwell update if practical
- controlled custom events
- frontend API error capture
- JS error capture
- unhandled rejection capture

### 2) Presence lifecycle
Implement a presence model that supports:
- session start when the app boots or the user becomes visible
- periodic heartbeat
- active/idle transitions based on meaningful user interaction
- session end on unload/page hide when practical

Suggested behavior:
- heartbeat every 15–30 seconds
- idle after a reasonable inactivity window
- active again on keyboard/mouse/touch/navigation activity

### 3) Route tracking
Track route changes across the active shell.
Capture enough context for the Ops dashboard to know:
- current route
- previous route if useful
- current system (`upuse`, `scano`, `ops`)
- timestamp

### 4) Global runtime error capture
Add safe global capture for:
- `window.onerror`
- `unhandledrejection`

Requirements:
- deduplicate obvious repeats where possible
- do not leak secrets
- include route/system context

### 5) API failure capture
Instrument the frontend request layer so the Ops Center can see client-side API failures.
Do not break existing request behavior.

Capture at least:
- endpoint
- method if available
- status/error message
- system context
- route context
- timestamp

### 6) High-value product events only
Add a small number of high-signal events that are useful for admin review. For example:
- dashboard opened
- performance opened
- settings opened
- token test started
- token test finished
- branch detail opened
- report download started

Do not blanket-track meaningless button clicks.

## API client integration
Add clean frontend Ops endpoint bindings in the existing API client style.
Do not create an inconsistent networking layer.

## UX and behavior requirements
Instrumentation must be invisible to normal users and must not degrade UX.
Requirements:
- no noisy console spam
- no blocking UI
- no obvious performance penalty
- safe retries if appropriate
- graceful failure if telemetry ingestion is unavailable

## Important constraints
- Do not build the full admin dashboard here.
- Do not create major cross-app refactors.
- Do not break auth/bootstrap flow.
- Do not leak tokens or sensitive settings into telemetry payloads.

## Deliverables for this phase
1. Frontend telemetry service
2. Presence lifecycle integrated into the app shell
3. Route tracking
4. Global runtime error capture
5. API failure capture
6. A few high-value custom product events

## Verification requirements
At minimum verify:
- frontend build or focused tests pass
- telemetry calls are sent on boot/route change/activity
- runtime errors are captured safely
- API failures are captured safely
- existing user flows still behave normally

## Output format
When done, report:
- exact files changed
- what events are emitted
- where presence is initialized
- how errors are captured
- what verification was performed
- anything not verified
