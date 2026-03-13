import type { BranchDetailResult, BranchSnapshot } from "../../../api/types";

function toMillis(iso?: string) {
  if (!iso) return Number.NaN;
  const value = new Date(iso).getTime();
  return Number.isFinite(value) ? value : Number.NaN;
}

function detailBranchFromResult(detail: BranchDetailResult | null) {
  if (!detail || detail.kind === "branch_not_found") return null;
  return detail.branch;
}

function newerLiveBranch(detailBranch: BranchSnapshot, branchSnapshot: BranchSnapshot) {
  const detailUpdatedAtMs = toMillis(detailBranch.lastUpdatedAt);
  const snapshotUpdatedAtMs = toMillis(branchSnapshot.lastUpdatedAt);

  if (Number.isFinite(detailUpdatedAtMs) && Number.isFinite(snapshotUpdatedAtMs)) {
    return snapshotUpdatedAtMs > detailUpdatedAtMs ? branchSnapshot : detailBranch;
  }
  if (Number.isFinite(snapshotUpdatedAtMs)) {
    return branchSnapshot;
  }
  return detailBranch;
}

export function resolveDisplayedBranch(
  detail: BranchDetailResult | null,
  branchSnapshot?: BranchSnapshot | null,
) {
  if (detail?.kind === "branch_not_found") {
    return null;
  }

  const detailBranch = detailBranchFromResult(detail);
  if (!detailBranch) {
    return branchSnapshot ?? null;
  }

  if (!branchSnapshot || branchSnapshot.branchId !== detailBranch.branchId) {
    return detailBranch;
  }

  const liveBranch = newerLiveBranch(detailBranch, branchSnapshot);
  return {
    branchId: detailBranch.branchId,
    name: detailBranch.name,
    chainName: detailBranch.chainName,
    monitorEnabled: liveBranch.monitorEnabled ?? detailBranch.monitorEnabled ?? branchSnapshot.monitorEnabled,
    ordersVendorId: detailBranch.ordersVendorId,
    availabilityVendorId: detailBranch.availabilityVendorId,
    status: liveBranch.status,
    statusColor: liveBranch.statusColor,
    closedUntil: liveBranch.closedUntil,
    closeStartedAt: liveBranch.closeStartedAt,
    closedByUpuse: liveBranch.closedByUpuse,
    closureSource: liveBranch.closureSource,
    closeReason: liveBranch.closeReason,
    autoReopen: liveBranch.autoReopen,
    changeable: liveBranch.changeable,
    thresholds: liveBranch.thresholds ?? detailBranch.thresholds ?? branchSnapshot.thresholds,
    metrics: liveBranch.metrics,
    preparingNow: liveBranch.preparingNow,
    preparingPickersNow: liveBranch.preparingPickersNow,
    ordersDataState: liveBranch.ordersDataState ?? detailBranch.ordersDataState ?? branchSnapshot.ordersDataState ?? "warming",
    ordersLastSyncedAt: liveBranch.ordersLastSyncedAt ?? detailBranch.ordersLastSyncedAt ?? branchSnapshot.ordersLastSyncedAt,
    lastUpdatedAt: liveBranch.lastUpdatedAt ?? detailBranch.lastUpdatedAt ?? branchSnapshot.lastUpdatedAt,
  } satisfies BranchSnapshot;
}
