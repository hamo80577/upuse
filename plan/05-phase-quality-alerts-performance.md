# Phase 05 — Add quality scoring, alerts, and deep monitoring of the existing Dashboard and Performance systems

Assume Phases 01–04 are complete and merged.

Before making any change:
- Read the active monitoring, dashboard, and performance paths first.
- Do not rely on docs.
- Follow `AGENTS.md`.
- Focus on active execution paths only.

## Read these files first
- `apps/server/src/routes/dashboard.ts`
- `apps/server/src/routes/performance.ts`
- `apps/server/src/routes/monitor.ts`
- `apps/server/src/http/performanceWebSocket.ts`
- active dashboard websocket files if present
- `apps/server/src/services/performanceStore.ts` and related files if present
- `apps/web/src/systems/upuse/pages/dashboard/ui/DashboardPage.tsx`
- `apps/web/src/systems/upuse/pages/performance/ui/PerformancePage.tsx`
- `apps/web/src/systems/upuse/providers/MonitorStatusProvider.tsx`
- root `package.json`
- any performance audit / soak / burst scripts referenced there
- all current Ops files backend and frontend

## Goal of this phase
Make Ops Center smart enough to answer:
- Is the system healthy right now?
- Is the current Dashboard page healthy?
- Is the current Performance page healthy?
- Is data stale or fresh?
- Are errors increasing?
- Is the live stream stable?
- Are latency and failure rates getting worse or better?

This phase should transform Ops Center from “data viewer” into “system judge”.

## Product intent
The primary admin should be able to open `/ops` and immediately know:
- whether the site is healthy, degraded, or critical
- whether the dashboard/performance experience is safe to trust
- where regressions are happening
- what needs attention first

## Required features
### 1) Quality score
Design and implement a serious quality score from 100.
Base it on real signals already available or newly derived, such as:
- API error rate
- frontend runtime error rate
- stale data rate
- p95 latency if available
- WebSocket disconnect/reconnect instability
- failed or degraded monitor state
- performance snapshot freshness
- dashboard sync health
- auth failure spikes if relevant

Return both:
- final score
- contributing factors / penalties

### 2) Health status model
Create a clear health model such as:
- `healthy`
- `degraded`
- `critical`

It should be explainable, not arbitrary.

### 3) Existing page monitoring
Ops Center must explicitly monitor the health of the existing:
- UPuse Dashboard page
- UPuse Performance page

That means surfacing admin-facing health indicators such as:
- data freshness
- live stream health
- stale snapshots
- repeated API failures
- UI-visible degradation signals

### 4) Alerts and anomaly summaries
Add a clean alerting layer for the admin dashboard.
This does not need external notifications yet.
It must at least produce admin-facing alerts such as:
- error spike detected
- stale data detected
- dashboard sync broken
- performance websocket unstable
- monitor degraded
- token test failures detected

### 5) Rich dashboard visuals for health
Update Ops Center UI so quality and health are shown visually using:
- score cards
- trend arrows
- colored status pills
- alert banners
- trend lines
- pie/donut distribution where useful
- top issue lists

## Existing repo alignment
The repo already has performance-focused tests and audit scripts.
Use that reality.
Do not ignore it.
Make the Ops Center aware of those health dimensions conceptually and through active paths where possible.

## Required API/UI additions
Add whatever Ops summary/detail endpoints are needed to support:
- quality score
- alert list
- health explanation
- dashboard/performance subsystem status
- top regressions / top issues

Then wire them into the Ops UI.

## UX requirements
The admin must be able to answer these questions in seconds:
- What is broken?
- How bad is it?
- Is it getting worse or better?
- Which subsystem is the problem?
- Is the data itself trustworthy right now?

## Important constraints
- Do not invent fake metrics disconnected from the active app.
- Do not do a broad refactor of the existing dashboard/performance pages unless required.
- Keep backend and frontend changes focused on the observability goal.

## Deliverables for this phase
1. Quality score engine
2. Health classification model
3. Dashboard/performance subsystem monitoring inside Ops Center
4. Admin-facing alerts/anomalies
5. Rich visual presentation of system health

## Verification requirements
At minimum verify:
- backend build/tests for relevant changed paths
- frontend build/tests for relevant changed paths
- quality score appears and updates correctly
- alerts show meaningful states
- dashboard/performance health is visible in Ops Center

## Output format
When done, report:
- exact files changed
- how quality score is calculated
- which health states exist and why
- how dashboard/performance are monitored
- what verification was performed
- anything not verified
