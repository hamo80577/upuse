# Phase 04 — Build a premium, fully interactive Ops Center dashboard with strong UI/UX and deep admin visibility

Assume Phases 01–03 are complete and merged.

Before making any change:
- Read the active theme, shell, page, and API patterns.
- Do not rely on docs.
- Follow `AGENTS.md`.
- Reuse the repo’s current design language rather than inventing a disconnected design system.

## Read these files first
- `apps/web/src/theme.ts`
- `apps/web/src/app/shell/TopBar.tsx`
- `apps/web/src/app/providers/AuthProvider.tsx`
- `apps/web/src/shared/api/httpClient.ts`
- `apps/web/src/api/client.ts`
- `apps/web/src/systems/upuse/pages/dashboard/ui/DashboardPage.tsx`
- `apps/web/src/systems/upuse/pages/performance/ui/PerformancePage.tsx`
- `apps/web/src/systems/upuse/pages/settings/ui/SettingsPage.tsx`
- `apps/web/src/systems/upuse/api/endpoints.ts`
- all current files under `apps/web/src/systems/ops/**`
- all relevant backend Ops APIs from Phases 02–03

## Goal of this phase
Turn Ops Center into a serious admin command center page that gives the primary admin a live, detailed, beautifully designed, highly interactive view of the whole product.

This is not a basic dashboard.
It must feel like a high-end internal operations console.

## Design and UX target
The page must be:
- visually strong
- information-dense but still clean
- obviously admin-focused
- highly interactive
- professional and polished
- consistent with the existing product style

Use the current repo stack and style:
- MUI
- current theme
- existing shell/top bar patterns
- current card/border/shadow language
- current chart libraries already present in the repo

## Non-negotiable UI requirements
The Ops Center must include rich visual admin components such as:
- KPI cards
- line charts
- area charts
- bar charts if useful
- pie / donut charts
- up/down trend arrows
- status badges
- health indicators
- live activity feed
- interactive tables
- drill-down details
- filters and time range controls
- auto-refresh/live state indicators

The page must not feel static.
It should feel alive.

## Required page structure
Build `/ops` as a premium admin overview page with at least these sections:

### 1) Executive overview hero
A top section with strong visual presence that includes:
- total online users
- active users
- total sessions today
- requests/min
- errors/min
- current overall health status
- quality score placeholder if available already
- trend arrows showing change vs previous window

### 2) Live user activity section
Show who is currently active or recently active.
Include useful columns such as:
- user
- current system
- current page
- session duration
- last activity
- state (active / idle / offline)

Support:
- sorting
- filtering
- quick search
- click-through to drill-down when possible

### 3) Traffic and navigation intelligence
Show charts and distributions for:
- top pages
- page views by system
- route traffic trends
- active sessions over time
- page/system distribution via pie or donut chart

### 4) Event intelligence
Show:
- top event types
- recent admin-relevant events
- event trends over time
- event severity buckets if applicable

### 5) Error intelligence
Show:
- error count trend
- top frontend errors
- top API failures
- recent critical issues
- severity grouping
- clear empty state when healthy

### 6) Health and freshness section
Show:
- data freshness
- last ingest time
- live connection state
- stale/degraded/healthy status
- any summary status that tells the admin whether the observability data itself is trustworthy right now

## Interaction requirements
Add interaction that makes the page feel genuinely useful, for example:
- time window controls
- refresh button
- live indicator
- hover details on charts
- filters for system/user/error severity/event type
- collapsible detail cards or dialogs
- tabs when needed

## UX quality bar
The page should use clear visual hierarchy:
- strong hero metrics at the top
- charts grouped logically
- supporting details below
- no random card placement
- no “developer tool” ugliness

Use premium admin dashboard conventions:
- concise labels
- readable numbers
- elegant empty/loading/error states
- visually clear status changes
- confident spacing and typography

## Implementation guidance
- Create reusable Ops dashboard components instead of one giant page file.
- Keep page composition clean.
- Shape the API consumption layer so charts do minimal transformation in the UI.
- Favor drill-down-friendly structures.

## Important constraints
- Keep this page admin-only under Ops system access.
- Do not break existing dashboard/performance/settings pages.
- Do not redesign the entire app shell.
- Avoid massive unrelated refactors.

## Deliverables for this phase
1. A polished, premium Ops Center page at `/ops`
2. Multiple rich charts and visual widgets
3. Interactive filtering/search/sorting where appropriate
4. Live or near-live dashboard behavior
5. UI that clearly feels like the single admin source of truth

## Verification requirements
At minimum verify:
- frontend build passes
- charts render correctly
- empty/loading/error states behave well
- primary admin can use the page
- unauthorized users still cannot access it
- the page matches the existing design language

## Output format
When done, report:
- exact files changed
- new UI components created
- which charts/widgets were added
- how interactivity works
- what verification was performed
- anything not verified
