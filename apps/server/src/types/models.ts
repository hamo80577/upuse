export type AvailabilityState = "OPEN" | "CLOSED_UNTIL" | "CLOSED" | "CLOSED_TODAY" | "UNKNOWN";
export type OrdersVendorId = number;
export type AvailabilityVendorId = string;
export type AppUserRole = "admin" | "user";
export type ThresholdSource = "branch" | "chain" | "global";
export type BranchCatalogState = "available" | "missing";

export type CloseReason = "LATE" | "UNASSIGNED" | "CAPACITY";
export type MonitorIssueSource = "orders" | "availability";

export interface ChainThreshold {
  name: string;
  lateThreshold: number;
  unassignedThreshold: number;
  capacityRuleEnabled?: boolean;
}

export interface ThresholdProfile {
  lateThreshold: number;
  unassignedThreshold: number;
  capacityRuleEnabled?: boolean;
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
  globalEntityId: string;
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
  capacityRuleEnabledOverride?: boolean | null;
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
  recentlyActive: boolean;
}

export interface BranchPickersSummary {
  todayCount: number;
  activePreparingCount: number;
  recentActiveCount: number;
  items: BranchPickerSummaryItem[];
}

export interface AvailabilityRecord {
  platformKey: string;
  changeable: boolean;
  availabilityState: AvailabilityState;
  platformRestaurantId: string;
  currentSlotEndAt?: string;
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
  sourceClosedReason?: string;
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

export interface PerformanceStatusCount {
  status: string;
  count: number;
}

export interface PerformanceOwnerCoverage {
  totalCancelledOrders: number;
  resolvedOwnerCount: number;
  unresolvedOwnerCount: number;
  vendorOwnerCancelledCount: number;
  transportOwnerCancelledCount: number;
  lookupErrorCount: number;
  coverageRatio: number;
  warning: string | null;
}

export interface PerformanceBranchCard {
  kind: "mapped_branch";
  branchId: number;
  name: string;
  chainName: string;
  ordersVendorId: OrdersVendorId;
  availabilityVendorId: AvailabilityVendorId;
  statusColor: BranchSnapshot["statusColor"];
  totalOrders: number;
  vendorOwnerCancelledCount: number;
  transportOwnerCancelledCount: number;
  vfr: number;
  lfr: number;
  vlfr: number;
  statusCounts: PerformanceStatusCount[];
  ownerCoverage: PerformanceOwnerCoverage;
}

export interface PerformanceUnmappedVendorCard {
  kind: "unmapped_vendor";
  vendorId: OrdersVendorId;
  vendorName: string;
  globalEntityId: string;
  statusColor: BranchSnapshot["statusColor"];
  totalOrders: number;
  vendorOwnerCancelledCount: number;
  transportOwnerCancelledCount: number;
  vfr: number;
  lfr: number;
  vlfr: number;
  statusCounts: PerformanceStatusCount[];
  ownerCoverage: PerformanceOwnerCoverage;
}

export interface PerformanceEntityBranchCard {
  vendorId: OrdersVendorId;
  name: string;
  statusColor: BranchSnapshot["statusColor"];
  totalOrders: number;
  activeOrders: number;
  lateNow: number;
  onHoldOrders: number;
  unassignedOrders: number;
  inPrepOrders: number;
  readyToPickupOrders: number;
  deliveryMode: "logistics" | "self" | "mixed" | "unknown";
  lfrApplicable: boolean;
  vendorOwnerCancelledCount: number;
  transportOwnerCancelledCount: number;
  vfr: number;
  lfr: number;
  vlfr: number;
  statusCounts: PerformanceStatusCount[];
  ownerCoverage: PerformanceOwnerCoverage;
}

export interface PerformanceChainGroup {
  chainName: string;
  branchCount: number;
  totalOrders: number;
  vendorOwnerCancelledCount: number;
  transportOwnerCancelledCount: number;
  vfr: number;
  lfr: number;
  vlfr: number;
  ownerCoverage: PerformanceOwnerCoverage;
  branches: PerformanceBranchCard[];
}

export interface PerformanceCancelledOrderItem {
  orderId: string;
  externalId: string;
  status: string;
  customerFirstName: string | null;
  placedAt: string | null;
  pickupAt: string | null;
  cancellationOwner: string | null;
  cancellationReason: string | null;
  cancellationStage: string | null;
  cancellationSource: string | null;
  cancellationCreatedAt: string | null;
  cancellationUpdatedAt: string | null;
  cancellationOwnerLookupAt: string | null;
  cancellationOwnerLookupError: string | null;
}

export interface PerformanceMappedBranchReference {
  branchId: number;
  name: string;
  chainName: string;
  availabilityVendorId: AvailabilityVendorId;
}

export interface PerformanceDetailSummary {
  totalOrders: number;
  totalCancelledOrders: number;
  activeOrders: number;
  lateNow: number;
  onHoldOrders: number;
  unassignedOrders: number;
  inPrepOrders: number;
  readyToPickupOrders: number;
  vendorOwnerCancelledCount: number;
  transportOwnerCancelledCount: number;
  customerOwnerCancelledCount: number;
  unknownOwnerCancelledCount: number;
  vfr: number;
  lfr: number;
  vlfr: number;
  deliveryMode: PerformanceEntityBranchCard["deliveryMode"];
  lfrApplicable: boolean;
}

export interface PerformanceSummaryResponse {
  scope: {
    dayKey: string;
    timezone: string;
    startUtcIso: string;
    endUtcIso: string;
  };
  cards: {
    branchCount: number;
    totalOrders: number;
    totalCancelledOrders: number;
    activeOrders: number;
    lateNow: number;
    onHoldOrders: number;
    unassignedOrders: number;
    inPrepOrders: number;
    readyToPickupOrders: number;
    vfr: number;
    lfr: number;
    vlfr: number;
    vendorOwnerCancelledCount: number;
    transportOwnerCancelledCount: number;
  };
  branches: PerformanceEntityBranchCard[];
  statusCounts: PerformanceStatusCount[];
  ownerCoverage: PerformanceOwnerCoverage;
  chains: PerformanceChainGroup[];
  unmappedVendors: PerformanceUnmappedVendorCard[];
  fetchedAt: string | null;
  cacheState: BranchDetailCacheState;
}

export type PerformanceTrendResolutionMinutes = 15 | 30 | 60;

export interface PerformanceTrendBucket {
  bucketStartUtcIso: string;
  bucketEndUtcIso: string;
  label: string;
  ordersCount: number;
  vendorCancelledCount: number;
  transportCancelledCount: number;
  vfr: number;
  lfr: number;
  vlfr: number;
}

export interface PerformanceTrendResponse {
  scope: PerformanceSummaryResponse["scope"];
  fetchedAt: string | null;
  cacheState: BranchDetailCacheState;
  resolutionMinutes: PerformanceTrendResolutionMinutes;
  startMinute: number;
  endMinute: number;
  buckets: PerformanceTrendBucket[];
}

export type PerformanceDeliveryTypeFilter = "logistics" | "vendor_delivery";
export type PerformanceBranchFilter = "vendor" | "transport" | "late" | "on_hold" | "unassigned" | "in_prep" | "ready";
export type PerformanceNumericSortKey = "orders" | "vfr" | "lfr" | "vlfr" | "active" | "late" | "on_hold" | "unassigned" | "in_prep" | "ready";

export interface PerformancePreferencesState {
  searchQuery: string;
  selectedVendorIds: number[];
  selectedDeliveryTypes: PerformanceDeliveryTypeFilter[];
  selectedBranchFilters: PerformanceBranchFilter[];
  selectedSortKeys: PerformanceNumericSortKey[];
  nameSortEnabled: boolean;
  activeGroupId: number | null;
  activeViewId: number | null;
}

export interface PerformanceSavedGroup {
  id: number;
  name: string;
  vendorIds: number[];
  createdAt: string;
  updatedAt: string;
}

export interface PerformanceSavedView {
  id: number;
  name: string;
  state: Omit<PerformancePreferencesState, "activeGroupId" | "activeViewId">;
  createdAt: string;
  updatedAt: string;
}

export interface PerformancePreferencesResponse {
  current: PerformancePreferencesState;
  groups: PerformanceSavedGroup[];
  views: PerformanceSavedView[];
}

export interface PerformanceBranchDetailResponse {
  kind: "mapped_branch";
  branch: Pick<PerformanceBranchCard, "branchId" | "name" | "chainName" | "ordersVendorId" | "availabilityVendorId" | "statusColor">;
  summary: PerformanceDetailSummary;
  statusCounts: PerformanceStatusCount[];
  ownerCoverage: PerformanceOwnerCoverage;
  onHoldOrders: BranchLiveOrder[];
  unassignedOrders: BranchLiveOrder[];
  inPrepOrders: BranchLiveOrder[];
  readyToPickupOrders: BranchLiveOrder[];
  cancelledOrders: PerformanceCancelledOrderItem[];
  vendorOwnerCancelledOrders: PerformanceCancelledOrderItem[];
  unknownOwnerCancelledOrders: PerformanceCancelledOrderItem[];
  pickers: BranchPickersSummary;
  fetchedAt: string | null;
  cacheState: BranchDetailCacheState;
}

export interface PerformanceVendorDetailResponse {
  kind: "vendor";
  vendor: Pick<PerformanceUnmappedVendorCard, "vendorId" | "vendorName" | "globalEntityId" | "statusColor">;
  mappedBranch: PerformanceMappedBranchReference | null;
  summary: PerformanceDetailSummary;
  statusCounts: PerformanceStatusCount[];
  ownerCoverage: PerformanceOwnerCoverage;
  onHoldOrders: BranchLiveOrder[];
  unassignedOrders: BranchLiveOrder[];
  inPrepOrders: BranchLiveOrder[];
  readyToPickupOrders: BranchLiveOrder[];
  cancelledOrders: PerformanceCancelledOrderItem[];
  vendorOwnerCancelledOrders: PerformanceCancelledOrderItem[];
  unknownOwnerCancelledOrders: PerformanceCancelledOrderItem[];
  pickers: BranchPickersSummary;
  fetchedAt: string | null;
  cacheState: BranchDetailCacheState;
}

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
