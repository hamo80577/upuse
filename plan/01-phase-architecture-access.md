# Phase 01 — Create a fully isolated Ops Center system and lock access to the primary admin only

You are working inside the existing `upuse` monorepo. This repo already has a modular multi-system shell with at least:
- `apps/server`
- `apps/web`
- existing systems: `upuse` and `scano`

Before making any change:
- Read the active code first. Do **not** rely on README or architecture docs to guess behavior.
- Follow `AGENTS.md` strictly.
- Work in **Patch Mode**: smallest safe change that introduces the new system cleanly.
- Trace both backend and frontend registration paths before changing routing or access.

## Read these files first
Backend:
- `apps/server/src/index.ts`
- `apps/server/src/app/bootstrap/initializeRuntime.ts`
- `apps/server/src/app/server/createApp.ts`
- `apps/server/src/core/systems/registry/index.ts`
- `apps/server/src/core/systems/auth/registry/index.ts`
- `apps/server/src/shared/http/auth/sessionAuth.ts`
- `apps/server/src/shared/http/registerSharedRoutes.ts`
- `apps/server/src/services/authStore.ts`
- `apps/server/src/types/models.ts`
- `apps/server/src/systems/upuse/module.ts`
- `apps/server/src/systems/scano/module.ts`

Frontend:
- `apps/web/src/app/router/AppRouter.tsx`
- `apps/web/src/app/router/guards.tsx`
- `apps/web/src/app/providers/AuthProvider.tsx`
- `apps/web/src/core/systems/registry/index.ts`
- `apps/web/src/core/systems/navigation/*`
- `apps/web/src/app/shell/TopBar.tsx`
- `apps/web/src/systems/upuse/routes/systemModule.tsx`
- `apps/web/src/systems/scano/routes/systemModule.tsx`

## Goal of this phase
Create a **third standalone system** named:
- system id: `ops`
- label: `Ops Center`
- base path: `/ops`

This system must become the future admin control center for full website observability, control, telemetry, monitoring, quality review, and token management.

## Non-negotiable access rules
1. The Ops Center must be accessible **only** when `user.isPrimaryAdmin === true`.
2. Do **not** add any checkbox, role, permission toggle, workspace assignment field, or user-management UI for Ops Center.
3. Ops access must be implicit and hard-coded from the primary admin identity, not configurable through User Management.
4. Unauthorized users must not see Ops Center in navigation, switcher, menu, or route links.
5. Direct unauthorized access to `/ops` must not expose the page. Prefer a redirect or not-found style handling that does not reveal internal functionality.
6. WebSocket access for Ops must follow the same hard authorization model when added in later phases.

## Architecture direction
Implement Ops Center as a **real system module**, not as a hidden page under UPuse and not as a quick route hack.

That means:
- backend system module registration
- frontend system module registration
- isolated route shell
- future-ready location for backend routes, services, db, websocket, policies, UI pages, and API clients

## What to build in this phase
### 1) Backend system registration
Create `apps/server/src/systems/ops/` with the minimum clean structure needed for a first-class system module.

Include at least:
- `module.ts`
- `routes/registerRoutes.ts`
- `policies/access.ts`

Register the new system in the backend systems registry.

### 2) Backend access policy
Implement a dedicated access policy for Ops that checks the authenticated user and returns true **only** for the primary admin.

Requirements:
- Do not reuse editable UPuse capability logic.
- Do not create a new app role.
- Keep the rule narrow and obvious.
- Make it safe for both HTTP route guards and later WebSocket upgrade guards.

### 3) Minimal backend route
Add one minimal Ops API route such as:
- `GET /api/ops/health`

It should confirm the system is wired correctly and protected.

### 4) Frontend system registration
Create `apps/web/src/systems/ops/` with the minimum clean structure needed for a first-class web system.

Include at least:
- `routes/systemModule.tsx`
- `routes/OpsRouteShell.tsx`
- `pages/overview/ui/OpsOverviewPage.tsx`

Register the system in the frontend system registry.

### 5) Frontend access model
Implement `resolveAccess` and `canAccess` so Ops is enabled only for `isPrimaryAdmin === true`.

Requirements:
- Do not make it depend on UPuse role only.
- Do not make it visible to normal admins or users.
- Do not expose editable capabilities in User Management.

### 6) Navigation and switcher behavior
Make Ops Center appear as a real system in the product shell **only for the primary admin**.

Requirements:
- it should have a polished label and switcher metadata
- it should route to `/ops`
- it should not break existing UPuse or Scano behavior
- it should not disturb redirect logic for unauthorized users

### 7) Initial page skeleton
Build a clean skeleton page at `/ops` using the same stack and design language already used in the repo.

The page should not be empty. It should clearly establish the intended product direction:
- title: `Ops Center`
- subtitle describing it as the admin-only observability and control workspace
- a few polished placeholder KPI cards
- a clearly structured layout that can evolve into a serious admin command center

Do **not** build the full dashboard yet. Just build a strong shell.

## UI/UX direction for this phase
Use the same design language already present in the repo:
- MUI
- same theme tokens
- same app shell behavior
- same card, spacing, border, and shadow vocabulary

This first screen should already feel premium:
- confident hierarchy
- strong spacing
- visually clean admin aesthetic
- not generic
- not plain scaffolding

## Important constraints
- Do not add broad refactors.
- Do not change existing UPuse or Scano access semantics beyond what is strictly required for system registration.
- Do not add token management yet.
- Do not add telemetry ingestion yet.
- Do not add database schema yet.

## Deliverables for this phase
1. A new backend Ops system registered and protected
2. A new frontend Ops system registered and routed
3. A minimal protected API endpoint
4. A visible Ops Center page for the primary admin only
5. No new editable permissions in User Management

## Verification requirements
Run the narrowest relevant checks you can.
At minimum, verify:
- backend build passes or the changed backend files type-check cleanly
- frontend build passes or the changed frontend files type-check cleanly
- `/ops` is reachable for the primary admin
- Ops is hidden from non-primary-admin users
- existing `upuse` and `scano` system switching still works

## Output format
When done, report:
- exact files changed
- why each change was necessary
- how Ops access is enforced
- what was verified
- what was not verified
