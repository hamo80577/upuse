import { listResolvedBranches } from "../../../../services/branchStore.js";
import { getSettings } from "../../../../services/settingsStore.js";
import { syncOrdersMirror } from "./index.js";

let runtimeStarted = false;
let runtimeTimer: NodeJS.Timeout | null = null;

async function runRuntimeCycle() {
  const settings = getSettings();
  await syncOrdersMirror({
    token: settings.ordersToken,
    branches: listResolvedBranches(),
    ordersRefreshSeconds: settings.ordersRefreshSeconds,
  });
}

function clearRuntimeTimer() {
  if (!runtimeTimer) return;
  clearTimeout(runtimeTimer);
  runtimeTimer = null;
}

function scheduleRuntime(delayMs: number) {
  clearRuntimeTimer();
  runtimeTimer = setTimeout(async () => {
    runtimeTimer = null;
    try {
      await runRuntimeCycle();
    } catch {
      // Keep the runtime alive; state is already recorded in the sync table.
    } finally {
      if (runtimeStarted) {
        const settings = getSettings();
        scheduleRuntime(Math.max(5_000, settings.ordersRefreshSeconds * 1000));
      }
    }
  }, delayMs);
}

export function startOrdersMirrorRuntime() {
  if (runtimeStarted) return;
  runtimeStarted = true;
  scheduleRuntime(0);
}

export function stopOrdersMirrorRuntime() {
  runtimeStarted = false;
  clearRuntimeTimer();
}

export async function refreshOrdersMirrorNow() {
  const settings = getSettings();
  return syncOrdersMirror({
    token: settings.ordersToken,
    branches: listResolvedBranches(),
    ordersRefreshSeconds: settings.ordersRefreshSeconds,
    force: true,
  });
}
