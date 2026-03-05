import type { AvailabilityRecord, BranchMapping, OrdersVendorId } from "../types/models.js";

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
  branches: BranchMapping[];
  availabilityByVendor: ReadonlyMap<string, AvailabilityRecord>;
  closedSnapshotDayByBranch: ReadonlyMap<number, string>;
  cairoDayKey: string;
}): OrdersPollingPlan {
  const vendorIds = new Set<OrdersVendorId>();
  const resetBranchIds: number[] = [];
  const captureBranchIds: number[] = [];

  for (const branch of params.branches) {
    if (!branch.enabled) {
      resetBranchIds.push(branch.id);
      continue;
    }

    const availability = params.availabilityByVendor.get(branch.availabilityVendorId);
    if (availability?.availabilityState === "CLOSED") {
      if (params.closedSnapshotDayByBranch.get(branch.id) !== params.cairoDayKey) {
        vendorIds.add(branch.ordersVendorId);
        captureBranchIds.push(branch.id);
      }
      continue;
    }

    resetBranchIds.push(branch.id);
    vendorIds.add(branch.ordersVendorId);
  }

  return {
    vendorIds: Array.from(vendorIds),
    resetBranchIds,
    captureBranchIds,
  };
}

export function resolveOrdersGlobalEntityId(
  branch: Pick<BranchMapping, "globalEntityId">,
  fallbackGlobalEntityId: string,
) {
  const branchEntityId = branch.globalEntityId?.trim();
  return branchEntityId && branchEntityId.length ? branchEntityId : fallbackGlobalEntityId;
}

export function createOrdersPollingRequests(params: {
  branches: BranchMapping[];
  vendorIds: OrdersVendorId[];
  fallbackGlobalEntityId: string;
}): OrdersPollingRequest[] {
  const selectedVendorIds = new Set(params.vendorIds);
  const requestsByEntityId = new Map<string, OrdersPollingRequest>();

  for (const branch of params.branches) {
    if (!selectedVendorIds.has(branch.ordersVendorId)) continue;

    const globalEntityId = resolveOrdersGlobalEntityId(branch, params.fallbackGlobalEntityId);
    let request = requestsByEntityId.get(globalEntityId);
    if (!request) {
      request = { globalEntityId, vendorIds: [] };
      requestsByEntityId.set(globalEntityId, request);
    }

    request.vendorIds.push(branch.ordersVendorId);
  }

  return Array.from(requestsByEntityId.values());
}
