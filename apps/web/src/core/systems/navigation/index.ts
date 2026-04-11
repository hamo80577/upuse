import { getDefaultWebSystem, getWebSystemById, getWebSystems } from "../registry";
import type { AuthSystemState, WorkspaceSystem } from "../types";

interface PendingSystemSwitch {
  system: WorkspaceSystem;
  targetPath: string;
  startedAt: number;
}

const SYSTEM_SWITCH_STORAGE_KEY = "upuse.pending-system-switch";
const ACTIVE_SYSTEM_STORAGE_KEY = "upuse.active-system";
const SYSTEM_SWITCH_STALE_MS = 15_000;

function getAccessibleSystems(auth: AuthSystemState) {
  return getWebSystems().filter((system) => system.canAccess(auth));
}

export function isWorkspaceSystem(value: string | null | undefined): value is WorkspaceSystem {
  return getWebSystemById(value) !== null;
}

export function resolveSystemPath(systemId: WorkspaceSystem, auth: AuthSystemState) {
  const system = getWebSystemById(systemId) ?? getDefaultWebSystem();
  return system.resolveHomePath(auth);
}

export function readActiveSystem() {
  const fallback = getDefaultWebSystem().id;
  if (typeof window === "undefined") return fallback;

  const stored = window.sessionStorage.getItem(ACTIVE_SYSTEM_STORAGE_KEY);
  return isWorkspaceSystem(stored) ? stored : fallback;
}

export function writeActiveSystem(system: WorkspaceSystem) {
  if (typeof window === "undefined") return;
  window.sessionStorage.setItem(ACTIVE_SYSTEM_STORAGE_KEY, system);
}

export function resolveSystemFromPath(pathname: string) {
  const nonRootSystems = getWebSystems()
    .filter((system) => system.basePath !== "/")
    .sort((left, right) => right.basePath.length - left.basePath.length);

  return nonRootSystems.find((system) => pathname === system.basePath || pathname.startsWith(`${system.basePath}/`))
    ?? getDefaultWebSystem();
}

export function resolveAccessiblePath(auth: AuthSystemState) {
  const accessibleSystems = getAccessibleSystems(auth);
  if (accessibleSystems.length < 1) {
    return "/login";
  }

  const activeSystem = getWebSystemById(readActiveSystem());
  if (activeSystem && activeSystem.canAccess(auth)) {
    return activeSystem.resolveHomePath(auth);
  }

  return accessibleSystems[0].resolveHomePath(auth);
}

export function syncActiveSystemForPath(pathname: string, auth: AuthSystemState) {
  const system = resolveSystemFromPath(pathname);
  if (system.canAccess(auth)) {
    writeActiveSystem(system.id);
    return system.id;
  }

  const accessibleSystems = getAccessibleSystems(auth);
  if (accessibleSystems.length > 0) {
    writeActiveSystem(accessibleSystems[0].id);
    return accessibleSystems[0].id;
  }

  return system.id;
}

export function beginPendingSystemSwitch(system: WorkspaceSystem, options: { targetPath?: string } = {}) {
  if (typeof window === "undefined") return;

  const payload: PendingSystemSwitch = {
    system,
    targetPath: options.targetPath ?? "/",
    startedAt: Date.now(),
  };
  window.sessionStorage.setItem(SYSTEM_SWITCH_STORAGE_KEY, JSON.stringify(payload));
}

export function readPendingSystemSwitch() {
  if (typeof window === "undefined") return null;

  const raw = window.sessionStorage.getItem(SYSTEM_SWITCH_STORAGE_KEY);
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as Partial<PendingSystemSwitch>;
    if (!isWorkspaceSystem(typeof parsed.system === "string" ? parsed.system : null)) {
      clearPendingSystemSwitch();
      return null;
    }
    if (typeof parsed.targetPath !== "string" || typeof parsed.startedAt !== "number") {
      clearPendingSystemSwitch();
      return null;
    }
    if (Date.now() - parsed.startedAt > SYSTEM_SWITCH_STALE_MS) {
      clearPendingSystemSwitch();
      return null;
    }

    return parsed as PendingSystemSwitch;
  } catch {
    clearPendingSystemSwitch();
    return null;
  }
}

export function clearPendingSystemSwitch() {
  if (typeof window === "undefined") return;
  window.sessionStorage.removeItem(SYSTEM_SWITCH_STORAGE_KEY);
}
