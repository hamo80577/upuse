import type { DashboardSnapshot } from "../../../api/types";

export type SortMode = "total" | "late" | "unassigned";
export type StatusFilter = "all" | "open" | "tempClose" | "closed" | "unknown";
export type GroupMode = "chain" | "status" | "all";

export type DashboardBranch = DashboardSnapshot["branches"][number];

export interface GroupedBranchItem {
  branch: DashboardBranch;
  rank: number;
}

export interface GroupTotals {
  open: number;
  tempClose: number;
  closed: number;
  unknown: number;
}

export interface BranchGroup {
  key: string;
  label: string;
  totals: GroupTotals;
  items: GroupedBranchItem[];
}

function branchValueFor(sortBy: SortMode, branch: DashboardBranch) {
  if (sortBy === "total") return branch.metrics.totalToday;
  if (sortBy === "unassigned") return branch.metrics.unassignedNow;
  return branch.metrics.lateNow;
}

export function compareBranches(a: DashboardBranch, b: DashboardBranch, sortBy: SortMode) {
  const primary = branchValueFor(sortBy, b) - branchValueFor(sortBy, a);
  if (primary !== 0) return primary;

  const pressure = b.metrics.lateNow + b.metrics.unassignedNow - (a.metrics.lateNow + a.metrics.unassignedNow);
  if (pressure !== 0) return pressure;

  const total = b.metrics.totalToday - a.metrics.totalToday;
  if (total !== 0) return total;

  return a.name.localeCompare(b.name);
}

export function matchesStatusFilter(branch: DashboardBranch, filter: StatusFilter) {
  if (filter === "all") return true;
  if (filter === "open") return branch.status === "OPEN";
  if (filter === "tempClose") return branch.status === "TEMP_CLOSE";
  if (filter === "closed") return branch.status === "CLOSED";
  return branch.status === "UNKNOWN";
}

export function matchesSearchQuery(branch: DashboardBranch, query: string) {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) return true;

  const candidates = [
    branch.name,
    branch.chainName,
    String(branch.ordersVendorId),
    branch.availabilityVendorId,
  ];

  return candidates.some((value) => String(value ?? "").toLowerCase().includes(normalizedQuery));
}

function emptyGroupTotals(): GroupTotals {
  return { open: 0, tempClose: 0, closed: 0, unknown: 0 };
}

export function buildGroupTotals(branches: DashboardBranch[]) {
  const totals = emptyGroupTotals();

  branches.forEach((branch) => {
    if (branch.status === "OPEN") totals.open += 1;
    else if (branch.status === "TEMP_CLOSE") totals.tempClose += 1;
    else if (branch.status === "CLOSED") totals.closed += 1;
    else totals.unknown += 1;
  });

  return totals;
}

export function buildGroupedBranches(input: {
  branches: DashboardBranch[];
  groupBy: GroupMode;
}) {
  const visibleBranchPool = input.branches;
  if (!visibleBranchPool.length) return [] as BranchGroup[];

  if (input.groupBy === "all") {
    return [
      {
        key: "all:branches",
        label: "All Branches",
        totals: buildGroupTotals(visibleBranchPool),
        items: visibleBranchPool.map((branch, index) => ({
          branch,
          rank: index + 1,
        })),
      },
    ];
  }

  if (input.groupBy === "status") {
    const statusGroups: Array<{ key: string; label: string; status: DashboardBranch["status"] }> = [
      { key: "status:temp-close", label: "Temporary Close", status: "TEMP_CLOSE" },
      { key: "status:open", label: "Open", status: "OPEN" },
      { key: "status:closed", label: "Closed", status: "CLOSED" },
      { key: "status:unknown", label: "Unknown", status: "UNKNOWN" },
    ];

    return statusGroups
      .map((entry) => {
        const branches = visibleBranchPool.filter((branch) => branch.status === entry.status);
        return {
          key: entry.key,
          label: entry.label,
          totals: buildGroupTotals(branches),
          items: branches.map((branch, index) => ({
            branch,
            rank: index + 1,
          })),
        };
      })
      .filter((group) => group.items.length > 0);
  }

  const groups: Array<{
    key: string;
    label: string;
    branches: DashboardBranch[];
  }> = [];
  const groupMap = new Map<string, (typeof groups)[number]>();

  visibleBranchPool.forEach((branch) => {
    const rawKey = branch.chainName?.trim() || "__no_chain__";
    const key = `chain:${rawKey}`;
    let group = groupMap.get(key);

    if (!group) {
      group = {
        key,
        label: branch.chainName?.trim() || "No Chain",
        branches: [],
      };
      groupMap.set(key, group);
      groups.push(group);
    }

    group.branches.push(branch);
  });

  return groups.map((group) => ({
    key: group.key,
    label: group.label,
    totals: buildGroupTotals(group.branches),
    items: group.branches.map((branch, index) => ({
      branch,
      rank: index + 1,
    })),
  }));
}

export function isGroupExpanded(expandedGroups: Record<string, boolean>, groupKey: string) {
  return expandedGroups[groupKey] ?? true;
}
