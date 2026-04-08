export type WorkspaceSystem = "upuse" | "scano";

interface PendingSystemSwitch {
  system: WorkspaceSystem;
  targetPath: string;
  startedAt: number;
}

const SYSTEM_SWITCH_STORAGE_KEY = "upuse.pending-system-switch";
const ACTIVE_SYSTEM_STORAGE_KEY = "upuse.active-system";
const SYSTEM_SWITCH_STALE_MS = 15_000;

export function isWorkspaceSystem(value: string | null | undefined): value is WorkspaceSystem {
  return value === "upuse" || value === "scano";
}

export function resolveSystemPath(system: WorkspaceSystem, options?: { scanoPath?: string }) {
  return system === "scano" ? (options?.scanoPath ?? "/scano") : "/";
}

export function readActiveSystem(): WorkspaceSystem {
  if (typeof window === "undefined") return "upuse";

  const stored = window.sessionStorage.getItem(ACTIVE_SYSTEM_STORAGE_KEY);
  return isWorkspaceSystem(stored) ? stored : "upuse";
}

export function writeActiveSystem(system: WorkspaceSystem) {
  if (typeof window === "undefined") return;
  window.sessionStorage.setItem(ACTIVE_SYSTEM_STORAGE_KEY, system);
}

export function beginPendingSystemSwitch(system: WorkspaceSystem, options?: { targetPath?: string; scanoPath?: string }) {
  if (typeof window === "undefined") return;

  const payload: PendingSystemSwitch = {
    system,
    targetPath: options?.targetPath ?? resolveSystemPath(system, { scanoPath: options?.scanoPath }),
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
