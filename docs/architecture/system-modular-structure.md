# System Modular Structure

## Goal

The repo is now organized around registered product systems instead of a flat mix of `UPuse` and `Scano` code. Shared platform code stays outside systems, and each system owns its own routes, pages, features, widgets, API adapters, and server orchestration.

This structure is designed so a future third system can be added by registration plus local modules, without another top-level rewrite.

## Web Layout

```text
apps/web/src/
  app/
    providers/
    router/
    shell/
  core/
    systems/
      navigation/
      permissions/
      registry/
      types/
  shared/
    api/
    lib/
    ui/
  systems/
    upuse/
      api/
      entities/
      features/
      pages/
      providers/
      routes/
      widgets/
    scano/
      api/
      features/
      pages/
      routes/
      widgets/
```

### Web Rules

- `app/*` owns bootstrap, auth providers, generic route guards, and the app shell.
- `core/systems/*` owns the system contract and the registry-driven navigation model.
- `shared/*` contains only code that is truly system-agnostic.
- `systems/<system-id>/*` owns all system-specific behavior.
- Route composition happens through registered `WebSystemModule` objects, not hardcoded workspace switches.

### Web System Contract

Each system registers a `WebSystemModule` with:

- `id`
- `label`
- `basePath`
- `switcher` shell metadata
- `resolveAccess(user)` for system access, role labels, and capabilities
- `resolveLegacyAuth(context)` only for temporary compatibility aliases
- `canAccess(auth)`
- `resolveHomePath(auth)`
- `getNavigation(auth, location)`
- `getAccountNavigation(auth, location)` for system-owned account-menu links
- `getRoutes(context)`

This lets the router, shell, and system switcher remain generic.

Shared app code should use `hasSystemAccess(systemId)` and `hasSystemCapability(systemId, capability)`. Fields such as `canAccessUpuse`, `canAccessScano`, and `scanoRole` are compatibility aliases and should not be the primary model for new code.

## Server Layout

```text
apps/server/src/
  app/
    bootstrap/
    error-handling/
    middleware/
    server/
  core/
    systems/
      auth/
      registry/
      types/
  shared/
    db/
    http/
    persistence/
    security/
  systems/
    upuse/
      module.ts
      policies/
      routes/
      websocket/
    scano/
      db/
      module.ts
      policies/
      routes/
      services/
```

### Server Rules

- `app/*` owns Express/bootstrap composition, middleware, asset serving, and error handling.
- `core/systems/*` owns system contracts and cross-system registries.
- `shared/*` owns reusable infrastructure such as session persistence helpers and security primitives.
- `systems/<system-id>/*` owns route registration, policies, runtimes, websocket attachment, and system-only services.
- `src/index.ts` stays a composition root only.

### Server System Contract

Each system registers a `ServerSystemModule` with:

- `id`
- `auth` access projection, assignment resolution, synchronizers, and user projection hooks
- `db` schema, migrations, seed defaults, and isolated legacy repair hooks
- `start(deps)` for runtime side effects
- `registerRoutes(app, deps)`
- `registerWebSockets(server, deps)` when needed

Shared auth and migration code composes registered hooks instead of importing Scano or UPuse policies/schema modules directly.

## Dependency Direction

Allowed:

- `app -> core | shared | systems`
- `core -> shared | systems` only for registry wiring
- `systems -> shared | core`
- `shared -> shared`

Avoid:

- `shared -> systems`
- one system importing features/pages/routes from another system
- shell/router code making business decisions by hardcoding `"upuse"` or `"scano"`

## Current Architectural Highlights

- Web routing is registry-driven through `core/systems/registry` and system modules under `systems/upuse/routes` and `systems/scano/routes`.
- `TopBar` moved to `app/shell` and consumes generic system navigation data from the registry.
- `MonitorStatusProvider` is scoped to the UPuse route shell instead of the global app provider tree.
- Shared web API transport stays in `shared/api/httpClient.ts`, while owned API surfaces live under `systems/upuse/api` and `systems/scano/api`.
- Server auth/security entry files are now compatibility barrels over smaller shared/system modules.
- DB bootstrap now lives under `shared/db/*`, with Scano-owned schema and migration slices under `systems/scano/db/*`, while `config/db.ts` remains a thin compatibility barrel.
- `authStore` was split so shared session/user persistence lives under `shared/persistence/auth`, while Scano membership synchronization lives in `systems/scano/services/userAccessSynchronizer.ts`.
- Server startup is now composed from system modules instead of registering everything directly in `src/index.ts`.

## Adding A Third System

### Web

1. Create `apps/web/src/systems/<new-system>/`.
2. Add local `routes`, `pages`, `features`, `widgets`, `api`, and `lib`.
3. Implement a `WebSystemModule`.
4. Register it in `core/systems/registry`.
5. Provide system-local navigation and access rules.

### Server

1. Create `apps/server/src/systems/<new-system>/`.
2. Add local `routes`, `services`, `policies`, and runtime code.
3. Implement a `ServerSystemModule`.
4. Register it in `core/systems/registry`.
5. If the system needs user-access sync, expose assignment resolvers, synchronizers, projections, and access checks from the system module.

## Compatibility Policy

- Legacy import paths may remain as thin re-export shims while the repo transitions.
- Shared public API contracts and URLs should stay stable.
- New work should target the owning system module directly instead of adding more logic to compatibility shims.
