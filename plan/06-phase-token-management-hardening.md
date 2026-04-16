# Phase 06 — Add token management inside Ops Center, then harden, polish, and close the project properly

Assume Phases 01–05 are complete and merged.

Before making any change:
- Read the active settings, token, encryption, and security paths first.
- Do not rely on docs.
- Follow `AGENTS.md`.
- Avoid unrelated refactors.

## Read these files first
- `apps/server/src/routes/settings.ts`
- `apps/server/src/services/settingsStore.ts`
- `apps/server/src/shared/db/crypto.ts`
- `apps/server/src/shared/db/migrate.ts`
- `apps/server/src/shared/db/schema/sharedSchema.ts`
- active Scano settings routes/files
- `apps/server/src/systems/scano/routes/registerRoutes.ts`
- `apps/web/src/systems/upuse/pages/settings/ui/SettingsPage.tsx`
- active Scano settings page files
- all current Ops backend/frontend files
- `AGENTS.md`

## Goal of this phase
Finish Ops Center so the primary admin can truly manage the product from one place.

That means Ops Center should now let the admin:
- observe the whole site
- review quality and alerts
- inspect active sessions and errors
- monitor Dashboard and Performance health
- manage key tokens from inside Ops Center
- test token health from inside Ops Center
- trust the page as a premium internal control center

## Required features
### 1) Token management inside Ops Center
Add a serious token management section inside Ops Center for active integrations already present in the codebase.
At minimum include the existing active tokens such as:
- UPuse Orders API token
- UPuse Availability API token
- Scano catalog token
- any other active stable integration token already wired in current code

### 2) Reuse the existing security model
Do **not** invent a second encryption/storage model.
Reuse the current encrypted storage approach and active backend routes/services where it is safe and appropriate.

Requirements:
- never expose raw stored secrets unnecessarily
- keep masking behavior consistent
- keep update flows protected
- do not log token values
- do not leak secrets into telemetry

### 3) Token testing inside Ops Center
Add the ability for the primary admin to trigger token tests from Ops Center.
The UI should feel professional and integrated, not like a copied settings form.

Show:
- current mask state
- save state
- test state
- last result
- clear success/failure indicators
- detailed but readable results

### 4) UX polish for the entire Ops Center
Polish the page so it feels finished.
Examples:
- stronger empty/loading/error states
- refined spacing and card hierarchy
- clearer section transitions
- better trend visualization
- consistent status chips/pills
- elegant banners for critical issues
- subtle but confident motion if already aligned with repo patterns

### 5) Hardening
Harden the implementation across security and reliability.
Review the changed Ops paths for:
- authorization correctness
- accidental leakage of hidden admin functionality
- secret handling
- oversized payload risks
- noisy telemetry risks
- UI failure handling
- stale live state handling

### 6) Documentation updates required by repo rules
If access/routing/workspace behavior changed, update:
- `README.md`
- `CHANGELOG.md`

Keep updates concise but accurate.

## Final UI target
The finished Ops Center should look and behave like a premium admin control room with:
- strong hero metrics
- interactive charts
- pie/donut visuals
- trend arrows up/down
- deep drill-down visibility
- live activity
- error intelligence
- subsystem health
- token management
- all in one polished experience

It should be something an admin can rely on daily.

## Important constraints
- Keep access primary-admin-only.
- Do not expose Ops in User Management.
- Do not break existing settings pages.
- Reuse existing encryption and token test flows where possible.
- Avoid unnecessary broad refactors.

## Deliverables for this phase
1. Token management integrated into Ops Center
2. Token testing integrated into Ops Center
3. Final polish of the Ops UI
4. Security/reliability hardening pass
5. README and CHANGELOG updated if required

## Verification requirements
At minimum verify:
- backend build/tests for changed files
- frontend build/tests for changed files
- token save/test flows work for authorized admin
- unauthorized users cannot access Ops token management
- no token values leak in UI responses or telemetry
- final Ops Center is coherent and polished

## Output format
When done, report:
- exact files changed
- how token management was integrated
- what security protections are in place
- what polishing/hardening was completed
- what verification was performed
- anything not verified
