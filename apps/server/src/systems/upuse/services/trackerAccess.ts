import type { AppUser, BranchMapping, BranchSnapshot, DashboardSnapshot } from "../../../types/models.js";

type BranchLike = Pick<BranchMapping, "chainName">;

export function normalizeUpuseChainName(value: string) {
  return value.trim();
}

export function normalizeAssignedChains(values: readonly string[] | undefined | null) {
  const seen = new Set<string>();
  const normalized: string[] = [];

  for (const value of values ?? []) {
    const chainName = normalizeUpuseChainName(String(value ?? ""));
    if (!chainName) continue;

    const key = chainName.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    normalized.push(chainName);
  }

  return normalized;
}

export function isUpuseTracker(user: AppUser | null | undefined) {
  return user?.upuseAccess === true && user.role === "tracker";
}

export function canUserAccessUpuseBranch(user: AppUser | null | undefined, branch: BranchLike) {
  if (!user?.upuseAccess) return false;
  if (!isUpuseTracker(user)) return true;

  const requestedChain = normalizeUpuseChainName(branch.chainName);
  if (!requestedChain) return false;

  const assignedChains = normalizeAssignedChains(user.assignedChains);
  const requestedKey = requestedChain.toLowerCase();
  return assignedChains.some((chainName) => chainName.toLowerCase() === requestedKey);
}

function emptyDashboardTotals(): DashboardSnapshot["totals"] {
  return {
    branchesMonitored: 0,
    open: 0,
    tempClose: 0,
    closed: 0,
    unknown: 0,
    ordersToday: 0,
    cancelledToday: 0,
    doneToday: 0,
    activeNow: 0,
    lateNow: 0,
    unassignedNow: 0,
    onHoldNow: 0,
  };
}

function recomputeDashboardTotals(branches: BranchSnapshot[]) {
  const totals = emptyDashboardTotals();
  totals.branchesMonitored = branches.length;

  for (const branch of branches) {
    if (branch.status === "OPEN") totals.open += 1;
    else if (branch.status === "TEMP_CLOSE") totals.tempClose += 1;
    else if (branch.status === "CLOSED") totals.closed += 1;
    else totals.unknown += 1;

    totals.ordersToday += branch.metrics.totalToday;
    totals.cancelledToday += branch.metrics.cancelledToday;
    totals.doneToday += branch.metrics.doneToday;
    totals.activeNow += branch.metrics.activeNow;
    totals.lateNow += branch.metrics.lateNow;
    totals.unassignedNow += branch.metrics.unassignedNow;
    totals.onHoldNow += branch.metrics.onHoldNow ?? 0;
  }

  return totals;
}

export function filterDashboardSnapshotForUser(snapshot: DashboardSnapshot, user: AppUser | null | undefined) {
  if (!isUpuseTracker(user)) {
    return snapshot;
  }

  const branches = snapshot.branches.filter((branch) => canUserAccessUpuseBranch(user, branch));
  const ordersSync = snapshot.monitoring.ordersSync
    ? {
        ...snapshot.monitoring.ordersSync,
        staleBranchCount: branches.filter((branch) => branch.ordersDataState === "stale").length,
      }
    : undefined;

  return {
    ...snapshot,
    monitoring: {
      ...snapshot.monitoring,
      ...(ordersSync ? { ordersSync } : {}),
    },
    totals: recomputeDashboardTotals(branches),
    branches,
  };
}
