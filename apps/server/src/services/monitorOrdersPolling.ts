import { FIXED_GLOBAL_ENTITY_ID } from "../config/constants.js";
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
  const resolvedVendorIds = Array.from(new Set(
    params.branches
      .filter((branch) => selectedVendorIds.has(branch.ordersVendorId))
      .map((branch) => branch.ordersVendorId),
  ));

  return resolvedVendorIds.length
    ? [{
      globalEntityId: FIXED_GLOBAL_ENTITY_ID,
      vendorIds: resolvedVendorIds,
    }]
    : [];
}
