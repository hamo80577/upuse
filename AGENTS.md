# Upuse Agent Instructions

## Project overview
This repository is an npm workspaces monorepo.

- `apps/server`: Express backend, auth/session handling, monitoring, branches, settings, Scano services
- `apps/web`: React frontend
- `root`: workspace scripts, production start flow, repo-level docs

## Working modes

### Review mode
Use when the user asks for review, audit, regression checks, or bug finding.

- Find confirmed bugs only
- Do not change code unless the user explicitly asks for a fix
- Prefer active execution paths over speculation
- Prioritize auth, permissions, routing, settings, monitoring, Scano access, and frontend/backend mismatches
- Distinguish clearly between:
  - build errors
  - runtime errors
  - logic bugs
  - security issues
  - DX / maintainability issues

### Patch mode
Use when the user asks to fix, implement, patch, or update.

- Apply the smallest safe change
- Do not refactor unrelated code
- Preserve active contracts unless a backend change is strictly required
- Reuse current helpers and patterns where practical
- Add or update only the narrowest tests that protect the changed behavior

### Debug mode
Use when the user asks why something fails to build, run, start, or connect.

- Identify whether the failure is build, runtime, config, network, or environment
- Prefer the root cause over a workaround
- Verify with the narrowest relevant command before broader test runs

## Evidence standard
A bug is confirmed only if at least one is true:

- It is reachable from current imports, routes, rendered UI, or live endpoints
- It is reproducible by test, build, or runtime execution
- The frontend/backend contract clearly disagrees on an active path

Do not report:

- Hypothetical issues without a live trigger path
- Dead code unless it is imported or reachable
- Style-only comments unless the user explicitly asks for them

## Dual workspace auth/routing rule
This repo now has two workspaces inside one product shell:

- `UPuse`
- `Scano`

Access is not inferred from one role anymore. Always distinguish:

- `upuseAccess`
- `role` as the UPuse role only (`admin` / `user`)
- `isPrimaryAdmin`
- `scanoRole` (`team_lead` / `scanner`)
- switcher visibility
- redirect behavior when a user opens an unauthorized workspace directly

When reviewing or changing auth, permissions, routing, system switching, user creation, or visibility, trace this path when relevant:

1. `apps/web/src/pages/users/ui/UsersPage.tsx`
2. `apps/web/src/app/providers/AuthProvider.tsx`
3. `apps/web/src/app/router.tsx`
4. `apps/web/src/widgets/top-bar/ui/TopBar.tsx`
5. `apps/web/src/shared/api/*`
6. `apps/server/src/routes/auth.ts`
7. `apps/server/src/services/authStore.ts`
8. `apps/server/src/http/auth.ts`
9. `apps/server/src/config/db.ts`

Do not conclude a mismatch until both frontend and backend are traced.

## Scano-specific rules

- `Scano` is treated as a largely separate workspace under `/scano/*`
- The first operational page is `/scano/assign-task`
- Scano access management belongs to `User Management`; do not reintroduce a separate Scano team page unless the user explicitly asks
- `Scano Settings` may stay in the top dropdown navigation, not as a page-level CTA on `Assign Task`, unless the user asks otherwise
- `team_lead` can manage Scano tasks
- `team_lead` must be able to load assignable scanners from the active Scano flow
- `scanner` can see Scano and start assigned tasks only
- `primary admin` can access Scano automatically and manage team/settings/tasks
- For Scano team membership, the linked app user is the source of truth for display name and identity. Do not introduce a separate editable Scano-only name unless the user asks for that model

## Severity rubric

- `critical`: auth bypass, destructive security flaw, data loss, or app unusable for all users
- `high`: active frontend/backend contract mismatch, broken protected route, broken workspace guard, or major runtime failure in a primary flow
- `medium`: real logic bug with limited scope or a recoverable failure in an active flow
- `low`: minor but real behavior bug with limited impact

## Output rules

### For review tasks
For every issue, always include:

- Severity: `critical` / `high` / `medium` / `low`
- File path
- Exact cause
- Why it is a real bug
- Likely impact
- Suggested fix

Group findings by severity.

### For patch or debug tasks
Always include:

- Exact files changed
- Why the change fixes the bug
- Verification performed
- Anything not verified

## Repo-specific implementation rules

- Do not assume legacy files are active unless they are imported or routed
- Treat frontend/backend mismatches as high priority
- Prefer focused local fixes over broad rewrites
- When unsure whether code is active, trace imports, routes, and endpoints first
- If the user asks for a minimal patch, keep the scope limited to the confirmed issue
- When changing access model, workspace routing, or switcher behavior, update `README.md` and `CHANGELOG.md` in the same task unless the user explicitly says not to

## Important files

### Backend
- `apps/server/src/index.ts`
- `apps/server/src/config/db.ts`
- `apps/server/src/http/auth.ts`
- `apps/server/src/routes/auth.ts`
- `apps/server/src/routes/scano.ts`
- `apps/server/src/services/authStore.ts`

### Frontend
- `apps/web/src/app/router.tsx`
- `apps/web/src/app/providers/*`
- `apps/web/src/app/permissions.ts`
- `apps/web/src/shared/api/*`
- `apps/web/src/widgets/top-bar/ui/TopBar.tsx`
- `apps/web/src/pages/**/*`

## Commands

- install: `npm install`
- dev: `npm run dev`
- server build: `npm --workspace apps/server run build`
- web build: `npm --workspace apps/web run build`
- start: `npm run start`
- full prod helper on Windows: `.\start.ps1`

## Test policy

- For behavior changes, add or update the narrowest relevant tests
- Do not add broad coverage unrelated to the requested change
- For auth/routing changes, prefer at least one focused route/auth test plus one UI-facing test when practical
- If tests were not run, say so explicitly

## Definition of done

### A review is complete only if:
1. Each reported issue has file path, cause, impact, and fix
2. False positives are avoided
3. Dead or legacy code is not reported unless it affects current execution
4. Findings are grouped by severity

### A patch is complete only if:
1. The fix is limited to the confirmed issue unless the user asked for more
2. Relevant tests were added or updated when needed
3. Verification was run when practical, or the lack of verification was stated
4. If access/routing/workspace behavior changed, `README.md` and `CHANGELOG.md` were updated to match
