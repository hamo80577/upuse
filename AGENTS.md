# Upuse Agent Instructions

## Project overview
This is a monorepo using npm workspaces.

- `apps/server`: Express backend, auth, branches, settings, monitoring logic
- `apps/web`: React frontend
- root: workspace scripts and shared repo-level setup

## Task modes

### Review mode
Use when the user asks for audit, review, bug finding, or regression checking.

- Find confirmed bugs only
- Do not change code unless the user explicitly asks for a fix
- Prefer evidence from actual execution paths over speculation
- Flag auth, permissions, routing, branch thresholds, settings, and frontend/backend mismatches first
- Distinguish clearly between:
  - build errors
  - runtime errors
  - logic bugs
  - security issues
  - DX / maintainability issues

### Patch mode
Use when the user asks to fix, patch, update, or implement.

- Apply the smallest safe change
- Do not refactor unrelated code
- Preserve existing backend/API contracts unless the user asks otherwise or a backend change is strictly required
- Reuse existing helpers and patterns where possible
- Add or update only the narrowest relevant tests for the changed behavior

### Debug mode
Use when the user asks why something fails to build, run, or start.

- Identify whether the failure is build, runtime, config, or environment
- Prefer fixing the root cause over adding a workaround
- Verify with the narrowest relevant command before broad test runs

## Evidence standard
A bug is confirmed only if at least one of these is true:

- It is reachable from current imports, routes, rendered UI, or live endpoints
- It is reproducible by test, build, or runtime execution
- The frontend/backend contract clearly disagrees on an active code path

Do not report:

- Hypothetical issues without a live trigger path
- Dead code unless it is imported or reachable from current routes/endpoints
- Style-only comments unless the user explicitly asks for them

## Auth and routing review rule
For auth, permissions, routing, and settings issues, trace the active path when relevant:

1. frontend route or UI entry point
2. frontend auth/permission guard
3. API client or shared helper
4. backend route
5. backend authorization or settings check

Do not conclude mismatch without tracing both sides.

## Severity rubric

- `critical`: auth bypass, destructive security flaw, data loss, or app unusable for all users
- `high`: active frontend/backend contract mismatch, broken protected route, or major runtime failure in a primary flow
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

Group the report by severity.

### For patch or debug tasks
Always include:

- Exact files changed
- Why the change fixes the bug
- Verification performed
- Anything not verified

## Repo-specific rules

- Do not assume old or legacy files are active unless they are imported by current code
- Treat frontend/backend mismatches as high priority
- Do not recommend broad rewrites if a focused patch is enough
- When unsure whether code is dead or active, trace imports, routes, and endpoints first
- Prefer local fixes over large refactors
- If the user asks for a minimal patch, keep the scope limited to the confirmed issue

## Important files and directories

### Backend
- `apps/server/src/index.ts`

### Frontend
- `apps/web/src/app/router.tsx`
- `apps/web/src/app/providers/*`
- `apps/web/src/app/permissions.ts`
- `apps/web/src/shared/api/*`
- `apps/web/src/pages/**/*`

## Commands

- install: `npm install`
- dev: `npm run dev`
- server build: `npm --workspace apps/server run build`
- web build: `npm --workspace apps/web run build`
- start: `npm run start`

## Test policy

- For behavior changes, add or update the narrowest relevant test
- Do not add broad coverage unrelated to the requested fix
- If tests were not run, say so explicitly

## Definition of done

### A review is complete only if:
1. Each reported issue has file path, cause, impact, and fix
2. False positives are avoided
3. Legacy code is not reported unless it affects current execution
4. The report is grouped by severity

### A patch is complete only if:
1. The fix is limited to the confirmed issue unless the user asked for more
2. Relevant tests were added or updated when needed
3. Verification was run when practical, or the lack of verification was stated
