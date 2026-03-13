export type CloseReason = "LATE" | "UNASSIGNED";
export type AppUserRole = "admin" | "user";
export type ThresholdSource = "branch" | "chain" | "global";
export type BranchCatalogState = "available" | "missing";

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

export type OrdersDataState = "fresh" | "stale" | "warming";
export type OrdersSyncMode = "mirror";
export type OrdersSyncState = "warming" | "healthy" | "degraded";
export type HealthReadinessState = "ready" | "idle" | "warming" | "degraded";

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
  ordersDataState?: OrdersDataState;
  ordersLastSyncedAt?: string;
  lastUpdatedAt?: string;
}

export interface BranchMappingItem {
  id: number;
  name: string | null;
  chainName: string;
  ordersVendorId: number | null;
  availabilityVendorId: string;
  enabled: boolean;
  catalogState: BranchCatalogState;
  lateThresholdOverride?: number | null;
  unassignedThresholdOverride?: number | null;
}

export interface LocalVendorCatalogItem {
  availabilityVendorId: string;
  ordersVendorId: number;
  name: string;
  alreadyAdded: boolean;
  branchId: number | null;
  chainName: string | null;
  enabled: boolean | null;
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

export type DashboardLiveConnectionState = "connecting" | "live" | "fallback" | "disconnected";

export interface SettingsMasked {
  globalEntityId: string;
  ordersToken: string;
  availabilityToken: string;
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

export interface HealthStatusResponse {
  ok: boolean;
  name: string;
  live: boolean;
  ready: boolean;
  readiness: {
    state: HealthReadinessState;
    message: string;
  };
  monitorRunning: boolean;
  monitorDegraded: boolean;
  lastSnapshotAt: string | null;
  lastErrorAt: string | null;
  ordersSync: {
    mode: OrdersSyncMode;
    state: OrdersSyncState;
    lastSuccessfulSyncAt?: string;
    staleBranchCount: number;
    consecutiveSourceFailures: number;
  };
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
