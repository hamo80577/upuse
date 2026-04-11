# Refactor File Mapping

## Web Hotspots

| Old path | New ownership |
| --- | --- |
| `apps/web/src/app/router.tsx` | `apps/web/src/app/router/AppRouter.tsx` |
| `apps/web/src/app/systemNavigation.ts` | `apps/web/src/core/systems/navigation/index.ts` |
| `apps/web/src/widgets/top-bar/ui/TopBar.tsx` | `apps/web/src/app/shell/TopBar.tsx` |
| `apps/web/src/app/providers/MonitorStatusProvider.tsx` | `apps/web/src/systems/upuse/providers/MonitorStatusProvider.tsx` |
| `apps/web/src/shared/api/endpoints.ts` | shared-only barrel over `shared/api/authClient.ts` and `shared/api/healthClient.ts`; product API composition lives in `apps/web/src/api/client.ts`, while runtime system clients live under `systems/upuse/api` and `systems/scano/api` |
| `apps/web/src/pages/dashboard/*` | `apps/web/src/systems/upuse/pages/dashboard/*` |
| `apps/web/src/pages/branches/*` | `apps/web/src/systems/upuse/pages/branches/*` |
| `apps/web/src/pages/performance/*` | `apps/web/src/systems/upuse/pages/performance/*` |
| `apps/web/src/pages/settings/*` | `apps/web/src/systems/upuse/pages/settings/*` |
| `apps/web/src/pages/thresholds/*` | `apps/web/src/systems/upuse/pages/thresholds/*` |
| `apps/web/src/pages/users/*` | `apps/web/src/systems/upuse/pages/users/*` |
| `apps/web/src/pages/scano/*` | `apps/web/src/systems/scano/pages/scano/*` |
| `apps/web/src/pages/scano/ui/ScanoTaskRunnerPage.tsx` | compatibility shim to the Scano-owned route page; route page is now a thin wrapper over `systems/scano/features/task-runner/ui/ScanoTaskRunnerExperience.tsx` plus extracted task-runner hooks/lib/ui modules |

## Server Hotspots

| Old path | New ownership |
| --- | --- |
| `apps/server/src/index.ts` | composition root using `app/bootstrap`, `app/server`, shared route registration, and system modules |
| `apps/server/src/config/db.ts` | thin compatibility barrel over `shared/db/connection.ts`, `shared/db/crypto.ts`, `shared/db/migrate.ts`, and `shared/db/logs.ts` |
| `apps/server/src/http/auth.ts` | compatibility barrel over `shared/http/auth/sessionAuth.ts`, `systems/upuse/policies/access.ts`, `systems/scano/policies/access.ts` |
| `apps/server/src/http/security.ts` | compatibility barrel over `app/middleware/*` and `shared/security/origins.ts` |
| `apps/server/src/services/authStore.ts` | thin shared auth store composed from `shared/persistence/auth/*` plus `systems/scano/services/userAccessSynchronizer.ts` |
| `apps/server/src/services/ordersMirrorStore.ts` | pure compatibility barrel to `systems/upuse/services/orders-mirror/index.ts`; responsibilities split into `types.ts`, `normalization.ts`, `detailLookup.ts`, `branchDetail.ts`, `statusPublication.ts`, and `runtime.ts` |
| `apps/server/src/shared/db/migrate.ts` | shared migration orchestrator that composes registered system DB modules instead of importing Scano schema directly |
| `apps/server/src/shared/http/auth/sessionAuth.ts` | shared session resolution plus generic system upgrade authorization through `core/systems/auth/accessRegistry.ts` |
| Scano DB task/master/settings schema inside `apps/server/src/config/db.ts` | `apps/server/src/systems/scano/db/schema.ts` and `apps/server/src/systems/scano/db/migrations.ts` |
| `apps/server/src/routes/*` | route registration now flows through `systems/upuse/module.ts` and `systems/scano/module.ts` |
| `apps/server/src/http/dashboardWebSocket.ts` | attached through `systems/upuse/websocket/dashboard.ts` |
| `apps/server/src/http/performanceWebSocket.ts` | attached through `systems/upuse/websocket/performance.ts` |

## Compatibility Shims

The refactor intentionally keeps some legacy entry paths as thin shims or barrels so tests, imports, and public contracts remain stable while internal ownership becomes explicit.

Current shim patterns include:

- old web page/entity/feature paths re-exporting system-owned modules
- `apps/web/src/app/router.tsx` and `apps/web/src/app/systemNavigation.ts` re-exporting new router/navigation modules
- `apps/server/src/http/auth.ts` and `apps/server/src/http/security.ts` re-exporting smaller modules

## Migration Guidance

- New system-specific work should be added under `systems/upuse/*` or `systems/scano/*`.
- Shared platform work belongs under `app/*`, `core/*`, or `shared/*` only when it is genuinely reusable across systems.
- When touching a compatibility shim, prefer updating downstream imports toward the owning system module instead of expanding the shim.
