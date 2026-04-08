import type { BranchLiveOrder, BranchPickersSummary, OrdersMetrics, OrdersVendorId } from "../../types/models.js";

export const BASE = "https://shopper-management-api-live-me.deliveryhero.io";
export const ORDERS_API_SAFE_VENDOR_BATCH_LIMIT = 20;
export const ORDERS_AGG_MAX_PAGES = 200;
export const BRANCH_DETAIL_MAX_PAGES = 200;

export interface OrdersPreparationSummary {
  preparingNow: number;
  preparingPickersNow: number;
}

export interface OrdersAggregateResult {
  byVendor: Map<OrdersVendorId, OrdersMetrics>;
  preparingByVendor: Map<OrdersVendorId, OrdersPreparationSummary>;
  fetchedAt: string;
}

export interface VendorOrdersDetailResult {
  metrics: OrdersMetrics;
  fetchedAt: string;
  unassignedOrders: BranchLiveOrder[];
  preparingOrders: BranchLiveOrder[];
  readyToPickupOrders: BranchLiveOrder[];
  pickers: BranchPickersSummary;
}

export type OrdersMode = "fullday" | "incremental";

export interface DetailCacheEntry {
  expiresAtMs: number;
  value: VendorOrdersDetailResult;
}

export function initMetrics(): OrdersMetrics {
  return {
    totalToday: 0,
    cancelledToday: 0,
    doneToday: 0,
    activeNow: 0,
    preparingNow: 0,
    lateNow: 0,
    unassignedNow: 0,
    readyNow: 0,
  };
}

export function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}
