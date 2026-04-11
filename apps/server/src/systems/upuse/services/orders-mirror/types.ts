import type {
  BranchLiveOrder,
  BranchPickersSummary,
  OrdersMetrics,
  OrdersVendorId,
} from "../../../../types/models.js";

export const BOOTSTRAP_SYNC_PAGE_SIZE = 500;
export const ACTIVE_SYNC_PAGE_SIZE = 500;
export const HISTORY_SYNC_PAGE_SIZE = 500;
export const HISTORY_OVERLAP_MS = 10 * 60 * 1000;
export const PICKER_RECENT_ACTIVE_WINDOW_MS = 60 * 60 * 1000;

export type BranchDetailCacheState = "fresh" | "warming" | "stale";
export type MirrorSyncPhase = "bootstrap" | "active" | "history" | "repair";

export interface OrdersMirrorRow {
  dayKey: string;
  globalEntityId: string;
  vendorId: number;
  vendorName: string | null;
  orderId: string;
  externalId: string;
  status: string;
  transportType: string | null;
  isCompleted: number;
  isCancelled: number;
  isUnassigned: number;
  placedAt: string | null;
  pickupAt: string | null;
  customerFirstName: string | null;
  shopperId: number | null;
  shopperFirstName: string | null;
  isActiveNow: number;
  lastSeenAt: string;
  lastActiveSeenAt: string | null;
  cancellationOwner: string | null;
  cancellationOwnerLookupAt: string | null;
  cancellationOwnerLookupError: string | null;
}

export interface OrdersEntitySyncStateRow {
  dayKey: string;
  globalEntityId: string;
  lastBootstrapSyncAt: string | null;
  lastActiveSyncAt: string | null;
  lastHistorySyncAt: string | null;
  lastFullHistorySweepAt: string | null;
  lastSuccessfulSyncAt: string | null;
  lastHistoryCursorAt: string | null;
  consecutiveFailures: number;
  lastErrorAt: string | null;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  staleSince: string | null;
  bootstrapCompletedAt: string | null;
}

export interface MirrorOrdersDetail {
  metrics: OrdersMetrics;
  fetchedAt: string | null;
  snapshotVersion: string | null;
  staleAgeSeconds: number | null;
  unassignedOrders: BranchLiveOrder[];
  preparingOrders: BranchLiveOrder[];
  readyToPickupOrders: BranchLiveOrder[];
  pickers: BranchPickersSummary;
  cacheState: BranchDetailCacheState;
}

export interface NormalizedMirrorOrder {
  dayKey: string;
  globalEntityId: string;
  vendorId: number;
  vendorName: string | null;
  orderId: string;
  externalId: string;
  status: string;
  transportType: string | null;
  isCompleted: number;
  isCancelled: number;
  isUnassigned: number;
  placedAt: string | null;
  pickupAt: string | null;
  customerFirstName: string | null;
  shopperId: number | null;
  shopperFirstName: string | null;
  isActiveNow: number;
  lastSeenAt: string;
  lastActiveSeenAt: string | null;
}

export interface MirrorOrderFallbacks {
  vendorId?: number | null;
  vendorName?: string | null;
  orderId?: string | null;
  externalId?: string | null;
}

export interface OrdersFetchResult {
  items: any[];
  fetchedAt: string;
}

export interface EntitySyncError {
  statusCode?: number;
  code?: string;
  message: string;
}

export interface EntitySyncBaseResult {
  dayKey: string;
  globalEntityId: string;
  success: boolean;
  fetchedAt: string | null;
  cacheState: BranchDetailCacheState;
  consecutiveFailures: number;
  error?: EntitySyncError;
}

export interface OwnerLookupCandidate {
  dayKey: string;
  globalEntityId: string;
  vendorId: number;
  orderId: string;
}

export interface TransportTypeLookupCandidate {
  dayKey: string;
  globalEntityId: string;
  vendorId: number;
  orderId: string;
}

export interface DroppedActiveOrderCandidate {
  dayKey: string;
  globalEntityId: string;
  vendorId: number;
  vendorName: string | null;
  orderId: string;
  externalId: string;
}

export interface OrdersMirrorEntitySyncStatus {
  dayKey: string;
  globalEntityId: string;
  cacheState: BranchDetailCacheState;
  fetchedAt: string | null;
  lastSuccessfulSyncAt: string | null;
  consecutiveFailures: number;
  lastErrorMessage: string | null;
  bootstrapCompleted: boolean;
}

export interface OrdersMirrorVendorSyncStatus {
  vendorId: OrdersVendorId;
  cacheState: BranchDetailCacheState;
  fetchedAt: string | null;
  consecutiveFailures: number;
}

export interface OrdersMirrorSyncSummary {
  dayKey: string;
  totalVendors: number;
  successfulVendors: number;
  failedVendors: number;
  updatedVendors: number;
  staleVendorCount: number;
  lastSuccessfulSyncAt: string | null;
  errors: Array<{
    vendorIds: OrdersVendorId[];
    statusCode?: number;
    message: string;
  }>;
  statusesByVendor: Map<OrdersVendorId, OrdersMirrorVendorSyncStatus>;
}
