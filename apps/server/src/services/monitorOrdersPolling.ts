import type { AvailabilityRecord, OrdersVendorId, ResolvedBranchMapping } from "../types/models.js";

export interface OrdersPollingPlan {
  vendorIds: OrdersVendorId[];
  resetBranchIds: number[];
  captureBranchIds: number[];
}

export interface OrdersPollingRequest {
  globalEntityId: string;
  vendorIds: OrdersVendorId[];
}

export function createOrdersPollingPlan(params: {
  branches: ResolvedBranchMapping[];
  availabilityByVendor: ReadonlyMap<string, AvailabilityRecord>;
  closedSnapshotDayByBranch: ReadonlyMap<number, string>;
  cairoDayKey: string;
}): OrdersPollingPlan {
  void params.availabilityByVendor;
  void params.closedSnapshotDayByBranch;
  void params.cairoDayKey;

  const vendorIds = new Set<OrdersVendorId>();
  const resetBranchIds: number[] = [];
  const captureBranchIds: number[] = [];

  for (const branch of params.branches) {
    if (!branch.enabled) {
      resetBranchIds.push(branch.id);
      continue;
    }
    vendorIds.add(branch.ordersVendorId);
  }

  return {
    vendorIds: Array.from(vendorIds),
    resetBranchIds,
    captureBranchIds,
  };
}

export function createOrdersPollingRequests(params: {
  branches: ResolvedBranchMapping[];
  vendorIds: OrdersVendorId[];
}): OrdersPollingRequest[] {
  const selectedVendorIds = new Set(params.vendorIds);
  const vendorIdsByEntity = new Map<string, OrdersVendorId[]>();

  for (const branch of params.branches) {
    if (!selectedVendorIds.has(branch.ordersVendorId)) continue;
    const vendorIds = vendorIdsByEntity.get(branch.globalEntityId) ?? [];
    if (!vendorIds.includes(branch.ordersVendorId)) {
      vendorIds.push(branch.ordersVendorId);
    }
    vendorIdsByEntity.set(branch.globalEntityId, vendorIds);
  }

  return Array.from(vendorIdsByEntity.entries()).map(([globalEntityId, vendorIds]) => ({
    globalEntityId,
    vendorIds,
  }));
}
