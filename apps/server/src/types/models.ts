export type AvailabilityState = "OPEN" | "CLOSED_UNTIL" | "CLOSED";

export type OrdersVendorId = number;
export type AvailabilityVendorId = string;
export type AppUserRole = "admin" | "user";
export type ThresholdSource = "branch" | "chain" | "global";
export type BranchCatalogState = "available" | "missing";

export type CloseReason = "LATE" | "UNASSIGNED";
export type MonitorIssueSource = "orders" | "availability";

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
  source: MonitorIssueSource;
  message: string;
  at: string;
  statusCode?: number;
}

export type OrdersDataState = "fresh" | "stale" | "warming";
export type OrdersSyncMode = "mirror";
export type OrdersSyncState = "warming" | "healthy" | "degraded";

export interface Settings {
  ordersToken: string;
  availabilityToken: string;
  chainNames: string[];
  chains: ChainThreshold[];

  lateThreshold: number;
  unassignedThreshold: number;

  tempCloseMinutes: number; // default 30
  graceMinutes: number; // default 5

  ordersRefreshSeconds: number; // default 30
  availabilityRefreshSeconds: number; // default 30

  maxVendorsPerOrdersRequest: number; // default 50
}

export interface BranchMapping {
  id: number;
  name: string | null;
  chainName: string;
  ordersVendorId: OrdersVendorId | null;
  availabilityVendorId: AvailabilityVendorId;
  enabled: boolean;
  catalogState: BranchCatalogState;
  lateThresholdOverride?: number | null;
  unassignedThresholdOverride?: number | null;
}

export interface ResolvedBranchMapping extends Omit<BranchMapping, "name" | "ordersVendorId" | "catalogState"> {
  name: string;
  ordersVendorId: OrdersVendorId;
  globalEntityId: string;
  catalogState: "available";
}

export interface LocalVendorCatalogItem {
  availabilityVendorId: AvailabilityVendorId;
  ordersVendorId: OrdersVendorId;
  name: string;
  alreadyAdded: boolean;
  branchId: number | null;
  chainName: string | null;
  enabled: boolean | null;
}

export interface OrdersMetrics {
  totalToday: number;
  cancelledToday: number;
  doneToday: number; // isCompleted = true
  activeNow: number; // isCompleted = false
  lateNow: number; // activeNow and now > pickupAt
  unassignedNow: number; // activeNow and (status UNASSIGNED or shopper null)
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

export interface AvailabilityRecord {
  platformKey: string;
  changeable: boolean;
  availabilityState: AvailabilityState;
  platformRestaurantId: string;
  currentSlotEndAt?: string;
  globalEntityId: string;
  closedUntil?: string;
  closedReason?: string;
  modifiedBy?: string;
  preptimeAdjustment?: {
    adjustmentMinutes: number;
    interval: { startTime: string; endTime: string };
  };
}

export interface BranchSnapshot {
  branchId: number;
  name: string;
  chainName: string;
  monitorEnabled: boolean;

  ordersVendorId: OrdersVendorId;
  availabilityVendorId: AvailabilityVendorId;

  status: "OPEN" | "TEMP_CLOSE" | "CLOSED" | "UNKNOWN";
  statusColor: "green" | "red" | "orange" | "grey";

  closedUntil?: string; // ISO string (UTC)
  closeStartedAt?: string; // ISO string (UTC)
  closedByUpuse?: boolean;
  closureSource?: "UPUSE" | "EXTERNAL";
  closeReason?: CloseReason;
  autoReopen?: boolean;

  changeable?: boolean;
  thresholds?: ThresholdProfile;

  metrics: OrdersMetrics;
  preparingNow: number;
  preparingPickersNow: number;
  ordersDataState?: OrdersDataState;
  ordersLastSyncedAt?: string;

  lastUpdatedAt?: string; // ISO
}

export interface DashboardSnapshot {
  monitoring: {
    running: boolean;
    lastOrdersFetchAt?: string;
    lastAvailabilityFetchAt?: string;
    lastHealthyAt?: string;
    degraded?: boolean;
    ordersSync?: {
      mode: OrdersSyncMode;
      state: OrdersSyncState;
      lastSuccessfulSyncAt?: string;
      staleBranchCount: number;
      consecutiveSourceFailures: number;
    };
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

export interface TokenTestResult {
  configured: boolean;
  ok: boolean;
  status: number | null;
  message?: string;
}

export interface OrdersTokenBranchTestResult {
  branchId: number;
  name: string;
  ordersVendorId: OrdersVendorId;
  ok: boolean;
  status: number | null;
  message?: string;
  sampleVendorName?: string | null;
}

export type SettingsTokenTestJobStatus = "pending" | "running" | "completed" | "failed";

export interface SettingsTokenTestSnapshot {
  jobId: string;
  status: SettingsTokenTestJobStatus;
  createdAt: string;
  startedAt?: string | null;
  completedAt?: string | null;
  progress: {
    totalBranches: number;
    processedBranches: number;
    passedBranches: number;
    failedBranches: number;
    percent: number;
  };
  availability: TokenTestResult;
  orders: {
    configValid: boolean;
    configMessage?: string;
    ok: boolean;
    probe?: TokenTestResult;
    enabledBranchCount: number;
    passedBranchCount: number;
    failedBranchCount: number;
    branches: OrdersTokenBranchTestResult[];
  };
}

export interface SettingsTokenTestStartResponse {
  ok: true;
  jobId: string;
  snapshot: SettingsTokenTestSnapshot;
}

export interface AppUser {
  id: number;
  email: string;
  name: string;
  role: AppUserRole;
  active: boolean;
  createdAt: string;
}

export interface AuthSession {
  token: string;
  userId: number;
  expiresAt: string;
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
