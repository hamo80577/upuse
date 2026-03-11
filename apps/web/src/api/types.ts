export type CloseReason = "LATE" | "UNASSIGNED";
export type AppUserRole = "admin" | "user";
export type ThresholdSource = "branch" | "chain" | "global";

export interface ChainThreshold {
  name: string;
  lateThreshold: number;
  unassignedThreshold: number;
}

export interface ThresholdProfile {
  lateThreshold: number;
  unassignedThreshold: number;
  source: ThresholdSource;
}

export interface MonitorSourceError {
  source: "orders" | "availability";
  message: string;
  at: string;
  statusCode?: number;
}

export interface OrdersMetrics {
  totalToday: number;
  cancelledToday: number;
  doneToday: number;
  activeNow: number;
  lateNow: number;
  unassignedNow: number;
}

export interface BranchLiveOrder {
  id: string;
  externalId: string;
  status: string;
  placedAt?: string;
  pickupAt?: string;
  customerFirstName?: string;
  shopperId?: number;
  shopperFirstName?: string;
  isUnassigned: boolean;
  isLate: boolean;
}

export interface BranchPickerSummaryItem {
  shopperId: number;
  shopperFirstName: string;
  ordersToday: number;
  firstPickupAt: string | null;
  lastPickupAt: string | null;
  activeLastHour: boolean;
}

export interface BranchPickersSummary {
  todayCount: number;
  activePreparingCount: number;
  lastHourCount: number;
  items: BranchPickerSummaryItem[];
}

export interface BranchSnapshot {
  branchId: number;
  name: string;
  chainName: string;
  monitorEnabled: boolean;

  ordersVendorId: number;
  availabilityVendorId: string;

  status: "OPEN" | "TEMP_CLOSE" | "CLOSED" | "UNKNOWN";
  statusColor: "green" | "red" | "orange" | "grey";

  closedUntil?: string;
  closeStartedAt?: string;
  closedByUpuse?: boolean;
  closureSource?: "UPUSE" | "EXTERNAL";
  closeReason?: CloseReason;
  autoReopen?: boolean;
  changeable?: boolean;
  thresholds?: ThresholdProfile;

  metrics: OrdersMetrics;
  preparingNow: number;
  preparingPickersNow: number;
  lastUpdatedAt?: string;
}

export interface BranchMappingItem {
  id: number;
  name: string;
  chainName: string;
  ordersVendorId: number;
  availabilityVendorId: string;
  globalEntityId: string;
  enabled: boolean;
  lateThresholdOverride?: number | null;
  unassignedThresholdOverride?: number | null;
}

export type BranchCatalogResolveStatus = "resolved" | "unresolved" | "error";
export type BranchCatalogSyncState = "fresh" | "syncing" | "stale" | "error";

export interface BranchCatalogItem {
  availabilityVendorId: string;
  ordersVendorId: number | null;
  name: string | null;
  globalEntityId: string;
  availabilityState: "OPEN" | "CLOSED_UNTIL" | "CLOSED";
  changeable: boolean;
  presentInSource: boolean;
  resolveStatus: BranchCatalogResolveStatus;
  lastSeenAt: string | null;
  resolvedAt: string | null;
  lastError: string | null;
  alreadyAdded: boolean;
  branchId: number | null;
  chainName: string | null;
  enabled: boolean | null;
}

export interface BranchCatalogResponse {
  items: BranchCatalogItem[];
  syncState: BranchCatalogSyncState;
  lastSyncedAt: string | null;
  lastError: string | null;
}

export interface DashboardSnapshot {
  monitoring: {
    running: boolean;
    lastOrdersFetchAt?: string;
    lastAvailabilityFetchAt?: string;
    lastHealthyAt?: string;
    degraded?: boolean;
    errors?: {
      orders?: MonitorSourceError;
      availability?: MonitorSourceError;
    };
  };
  totals: {
    branchesMonitored: number;
    open: number;
    tempClose: number;
    closed: number;
    unknown: number;

    ordersToday: number;
    cancelledToday: number;
    doneToday: number;
    activeNow: number;
    lateNow: number;
    unassignedNow: number;
  };
  branches: BranchSnapshot[];
}

export type BranchDetailCacheState = "fresh" | "warming" | "stale";

interface BranchDetailBase {
  branch: BranchSnapshot;
  totals: OrdersMetrics;
  fetchedAt: string | null;
  cacheState: BranchDetailCacheState;
  unassignedOrders: BranchLiveOrder[];
  preparingOrders: BranchLiveOrder[];
  pickers: BranchPickersSummary;
}

export interface BranchDetailOk extends BranchDetailBase {
  kind: "ok";
  fetchedAt: string;
}

export interface BranchDetailSnapshotUnavailable extends BranchDetailBase {
  kind: "snapshot_unavailable";
  message: string;
}

export interface BranchDetailFetchFailed extends BranchDetailBase {
  kind: "detail_fetch_failed";
  fetchedAt: null;
  message: string;
}

export interface BranchDetailNotFound {
  kind: "branch_not_found";
  branchId: number;
  message: string;
}

export type BranchDetailResult =
  | BranchDetailOk
  | BranchDetailSnapshotUnavailable
  | BranchDetailFetchFailed
  | BranchDetailNotFound;

export type DashboardLiveConnectionState = "connecting" | "live" | "fallback" | "disconnected";

export interface SettingsMasked {
  ordersToken: string;
  availabilityToken: string;
  globalEntityId: string;
  chainNames: string[];
  chains: ChainThreshold[];

  lateThreshold: number;
  unassignedThreshold: number;

  tempCloseMinutes: number;
  graceMinutes: number;

  ordersRefreshSeconds: number;
  availabilityRefreshSeconds: number;

  maxVendorsPerOrdersRequest: number;
}

export interface TokenTestResult {
  configured: boolean;
  ok: boolean;
  status: number | null;
  message?: string;
}

export interface OrdersTokenBranchTestResult {
  branchId: number;
  name: string;
  ordersVendorId: number;
  globalEntityId: string;
  ok: boolean;
  status: number | null;
  message?: string;
  sampleVendorName?: string | null;
}

export interface SettingsTokenTestResponse {
  availability: TokenTestResult;
  orders: {
    configValid: boolean;
    configMessage?: string;
    ok: boolean;
    enabledBranchCount: number;
    passedBranchCount: number;
    failedBranchCount: number;
    branches: OrdersTokenBranchTestResult[];
  };
}

export type LookupVendorNameSource = "branch_mapping" | "recent_orders" | "none";
export type LookupVendorNameCheckedSource = "branch_mapping" | "recent_orders";

export interface LookupVendorNameResponse {
  ok: boolean;
  name: string | null;
  source: LookupVendorNameSource;
  resolvedGlobalEntityId: string;
  checkedSources: LookupVendorNameCheckedSource[];
  note: string;
}

export interface AppUser {
  id: number;
  email: string;
  name: string;
  role: AppUserRole;
  active: boolean;
  createdAt: string;
}

export interface LoginResponse {
  ok: true;
  user: AppUser;
}

export interface AuthMeResponse {
  ok: true;
  user: AppUser;
}

export interface AuthUsersResponse {
  ok: true;
  items: AppUser[];
}
