export type AvailabilityState = "OPEN" | "CLOSED_UNTIL" | "CLOSED" | "CLOSED_TODAY" | "UNKNOWN";
export type OrdersVendorId = number;
export type AvailabilityVendorId = string;
export type AppUserRole = "admin" | "user";
export type ScanoRole = "team_lead" | "scanner";
export type ThresholdSource = "branch" | "chain" | "global";
export type BranchCatalogState = "available" | "missing";

export type CloseReason = "LATE" | "UNASSIGNED" | "READY_TO_PICKUP" | "CAPACITY" | "CAPACITY_HOUR";
export type MonitorIssueSource = "orders" | "availability";

export interface ChainThreshold {
  name: string;
  lateThreshold: number;
  lateReopenThreshold?: number;
  unassignedThreshold: number;
  unassignedReopenThreshold?: number;
  readyThreshold?: number;
  readyReopenThreshold?: number;
  capacityRuleEnabled?: boolean;
  capacityPerHourEnabled?: boolean;
  capacityPerHourLimit?: number | null;
}

export interface ThresholdProfile {
  lateThreshold: number;
  lateReopenThreshold?: number;
  unassignedThreshold: number;
  unassignedReopenThreshold?: number;
  readyThreshold?: number;
  readyReopenThreshold?: number;
  capacityRuleEnabled?: boolean;
  capacityPerHourEnabled?: boolean;
  capacityPerHourLimit?: number | null;
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
  lateReopenThreshold?: number;
  unassignedThreshold: number;
  unassignedReopenThreshold?: number;
  readyThreshold?: number;
  readyReopenThreshold?: number;

  tempCloseMinutes: number; // default 30
  graceMinutes: number; // default 5

  ordersRefreshSeconds: number; // default 30
  availabilityRefreshSeconds: number; // default 30

  maxVendorsPerOrdersRequest: number; // default 50
}

export interface ScanoSettings {
  catalogBaseUrl: string;
  catalogToken: string;
  updatedAt: string;
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
  lateReopenThresholdOverride?: number | null;
  unassignedThresholdOverride?: number | null;
  unassignedReopenThresholdOverride?: number | null;
  readyThresholdOverride?: number | null;
  readyReopenThresholdOverride?: number | null;
  capacityRuleEnabledOverride?: boolean | null;
  capacityPerHourEnabledOverride?: boolean | null;
  capacityPerHourLimitOverride?: number | null;
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
  activeNow: number; // isCompleted = false OR status READY_FOR_PICKUP
  preparingNow?: number; // isCompleted = false
  lateNow: number; // isCompleted = false and non-ready and now > pickupAt
  unassignedNow: number; // isCompleted = false and non-ready and (status UNASSIGNED or shopper null)
  readyNow?: number; // status READY_FOR_PICKUP
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
  preparingNow: number;
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
  preparingNow: number;
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
    preparingNow: number;
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
  readyToPickupOrders: BranchLiveOrder[];
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
  upuseAccess: boolean;
  isPrimaryAdmin: boolean;
  scanoMemberId?: number;
  scanoRole?: ScanoRole;
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

export interface ScanoCatalogPage<TItem> {
  items: TItem[];
  pageIndex: number;
  totalPages: number;
  totalRecords: number;
}

export interface ScanoChainOption {
  id: number;
  active: boolean;
  name: string;
  globalId: string;
  type: string;
}

export interface ScanoBranchOption {
  id: number;
  globalId: string;
  name: string;
  chainId: number;
  chainName: string;
  globalEntityId: string;
  countryCode: string;
  additionalRemoteId: string;
}

export interface ScanoTeamMember {
  id: number;
  name: string;
  linkedUserId: number;
  linkedUserName: string;
  linkedUserEmail: string;
  role: ScanoRole;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export type ScanoTaskStatus = "pending" | "in_progress" | "awaiting_review" | "completed";
export type ScanoTaskId = string;
export type ScanoScanSource = "manual" | "scanner" | "camera";
export type ScanoYesNoFlag = "yes" | "no";
export type ScanoTaskScanOutcome = "matched_external" | "matched_master" | "manual_only" | "duplicate_blocked";
export type ScanoTaskProductSource = "vendor" | "chain" | "master" | "manual";

export interface ScanoTaskAssignee {
  id: number;
  name: string;
  linkedUserId: number;
}

export interface ScanoTaskPermissions {
  canEdit: boolean;
  canStart: boolean;
  canManageAssignees: boolean;
  canComplete: boolean;
  canDownloadReviewPackage: boolean;
  canConfirmReviewExport: boolean;
}

export interface ScanoTaskProgress {
  startedCount: number;
  endedCount: number;
  totalCount: number;
}

export interface ScanoTaskViewerState {
  hasStarted: boolean;
  hasEnded: boolean;
  canEnter: boolean;
  canEnd: boolean;
  canResume: boolean;
}

export interface ScanoTaskParticipantState {
  id: number;
  name: string;
  linkedUserId: number;
  startedAt: string | null;
  lastEnteredAt: string | null;
  endedAt: string | null;
}

export interface ScanoTaskCounters {
  scannedProductsCount: number;
  vendorCount: number;
  vendorEditedCount: number;
  chainCount: number;
  chainEditedCount: number;
  masterCount: number;
  manualCount: number;
}

export interface ScanoTaskScanItem {
  id: number;
  barcode: string;
  source: ScanoScanSource;
  outcome: ScanoTaskScanOutcome;
  scannedAt: string;
  taskProductId: string | null;
  scannedBy: {
    id: number;
    name: string;
    linkedUserId: number;
  };
}

export interface ScanoExternalProductSearchResult {
  id: string;
  barcode: string;
  barcodes?: string[];
  itemNameEn: string | null;
  itemNameAr: string | null;
  image: string | null;
}

export interface ScanoExternalProductDetail {
  id: string;
  sku: string | null;
  price: string | null;
  barcode: string;
  barcodes: string[];
  itemNameEn: string | null;
  itemNameAr: string | null;
  images: string[];
}

export interface ScanoProductAssignmentCheck {
  chain: ScanoYesNoFlag;
  vendor: ScanoYesNoFlag;
  sku: string | null;
  price: string | null;
}

export interface ScanoRunnerMasterIndexItem {
  barcode: string;
  sku: string | null;
  price: string | null;
  itemNameEn: string | null;
  itemNameAr: string | null;
  image: string | null;
}

export interface ScanoRunnerBootstrapResponse {
  runnerToken: string;
  confirmedBarcodes: string[];
  confirmedProducts: ScanoTaskProduct[];
  masterIndex: ScanoRunnerMasterIndexItem[];
}

export interface ScanoRunnerSearchInput {
  runnerToken: string;
  barcode: string;
}

export interface ScanoRunnerHydrateInput {
  runnerToken: string;
  productId: string;
}

export interface ScanoRunnerExternalSearchMatch {
  kind: "match";
  item: ScanoExternalProductSearchResult;
}

export interface ScanoRunnerExternalSearchMultiple {
  kind: "multiple";
  items: ScanoExternalProductSearchResult[];
}

export interface ScanoRunnerExternalSearchMiss {
  kind: "miss";
}

export type ScanoRunnerExternalSearchResponse =
  | ScanoRunnerExternalSearchMatch
  | ScanoRunnerExternalSearchMultiple
  | ScanoRunnerExternalSearchMiss;

export interface ScanoRunnerAssignmentResponse extends ScanoProductAssignmentCheck {}

export interface ScanoTaskProductDraft {
  externalProductId: string | null;
  barcode: string;
  barcodes: string[];
  sku: string | null;
  price: string | null;
  itemNameEn: string | null;
  itemNameAr: string | null;
  previewImageUrl: string | null;
  chain: ScanoYesNoFlag;
  vendor: ScanoYesNoFlag;
  masterfile: ScanoYesNoFlag;
  new: ScanoYesNoFlag;
  sourceType: ScanoTaskProductSource;
  images: string[];
  warning: string | null;
}

export interface ScanoTaskProductImage {
  id: string;
  fileName: string;
  url: string;
}

export interface ScanoTaskProductSnapshot {
  externalProductId: string | null;
  barcode: string;
  barcodes: string[];
  sku: string;
  price: string | null;
  itemNameEn: string;
  itemNameAr: string | null;
  previewImageUrl: string | null;
  chain: ScanoYesNoFlag;
  vendor: ScanoYesNoFlag;
  masterfile: ScanoYesNoFlag;
  new: ScanoYesNoFlag;
}

export interface ScanoTaskProductSourceMeta {
  sourceType: ScanoTaskProductSource;
  chain: ScanoYesNoFlag;
  vendor: ScanoYesNoFlag;
  masterfile: ScanoYesNoFlag;
  new: ScanoYesNoFlag;
}

export interface ScanoTaskProductEditLog {
  id: number;
  editedAt: string;
  editedBy: {
    id: number;
    name: string;
    linkedUserId: number;
  };
  before: ScanoTaskProductSnapshot;
  after: ScanoTaskProductSnapshot;
}

export interface ScanoTaskProduct {
  id: string;
  sourceType: ScanoTaskProductSource;
  externalProductId: string | null;
  barcode: string;
  barcodes: string[];
  sku: string;
  price: string | null;
  itemNameEn: string;
  itemNameAr: string | null;
  previewImageUrl: string | null;
  chain: ScanoYesNoFlag;
  vendor: ScanoYesNoFlag;
  masterfile: ScanoYesNoFlag;
  new: ScanoYesNoFlag;
  edited: boolean;
  images: ScanoTaskProductImage[];
  edits: ScanoTaskProductEditLog[];
  createdBy: {
    id: number;
    name: string;
    linkedUserId: number;
  };
  confirmedAt: string;
  updatedAt: string;
  canEdit: boolean;
}

export type ScanoTaskProductListSourceFilter = "all" | ScanoTaskProductSource;

export interface ScanoTaskExport {
  id: string;
  fileName: string;
  createdAt: string;
  confirmedDownloadAt: string | null;
  imagesPurgedAt: string | null;
  canDownload: boolean;
  requiresConfirmation: boolean;
}

export interface ResolveScanoTaskScanInput {
  barcode: string;
  source: ScanoScanSource;
  selectedExternalProductId?: string | null;
}

export interface SaveScanoTaskProductInput {
  externalProductId: string | null;
  barcode: string;
  barcodes: string[];
  sku: string;
  price: string | null;
  itemNameEn: string;
  itemNameAr: string | null;
  sourceMeta: ScanoTaskProductSourceMeta;
  imageUrls?: string[];
  existingImageIds?: string[];
}

export interface ScanoTaskScanResolveSelection {
  kind: "selection";
  items: ScanoExternalProductSearchResult[];
}

export interface ScanoTaskScanResolveDraft {
  kind: "draft";
  draft: ScanoTaskProductDraft;
  rawScan: ScanoTaskScanItem;
  task: ScanoTaskListItem;
  counters: ScanoTaskCounters;
}

export interface ScanoTaskScanResolveDuplicate {
  kind: "duplicate";
  message: string;
  existingProduct: ScanoTaskProduct;
  existingScannerName: string;
  existingScannedAt: string;
  rawScan: ScanoTaskScanItem;
  task: ScanoTaskListItem;
  counters: ScanoTaskCounters;
}

export type ScanoTaskScanResolveResponse =
  | ScanoTaskScanResolveSelection
  | ScanoTaskScanResolveDraft
  | ScanoTaskScanResolveDuplicate;

export interface ScanoTaskBranchInput {
  id: number;
  globalId: string;
  name: string;
  globalEntityId: string;
  countryCode: string;
  additionalRemoteId: string;
}

export interface CreateScanoTaskInput {
  chainId: number;
  chainName: string;
  branch: ScanoTaskBranchInput;
  assigneeIds: number[];
  scheduledAt: string;
}

export interface UpdateScanoTaskInput extends CreateScanoTaskInput {}

export interface UpdateScanoTaskAssigneesInput {
  assigneeIds: number[];
}

export interface CreateScanoTaskScanInput {
  barcode: string;
  source: ScanoScanSource;
}

export interface ScanoTaskListItem {
  id: ScanoTaskId;
  chainId: number;
  chainName: string;
  branchId: number;
  branchGlobalId: string;
  branchName: string;
  globalEntityId: string;
  countryCode: string;
  additionalRemoteId: string;
  scheduledAt: string;
  status: ScanoTaskStatus;
  assignees: ScanoTaskAssignee[];
  progress: ScanoTaskProgress;
  counters: ScanoTaskCounters;
  viewerState: ScanoTaskViewerState;
  permissions: ScanoTaskPermissions;
  latestExport: ScanoTaskExport | null;
}

export interface ScanoTaskDetail extends ScanoTaskListItem {
  participants: ScanoTaskParticipantState[];
}

export type ScanoTaskSummaryPatch = Pick<
  ScanoTaskListItem,
  "status" | "progress" | "counters" | "viewerState" | "permissions" | "latestExport"
>;

export interface ScanoPaginationMeta {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface ScanoTaskProductsPageResponse extends ScanoPaginationMeta {
  items: ScanoTaskProduct[];
}

export interface ScanoTaskScansPageResponse extends ScanoPaginationMeta {
  items: ScanoTaskScanItem[];
}

export type ScanoMasterProductField =
  | "barcode"
  | "sku"
  | "price"
  | "itemNameEn"
  | "itemNameAr"
  | "image";

export interface ScanoMasterProductMapping {
  barcode: string | null;
  sku: string | null;
  price: string | null;
  itemNameEn: string | null;
  itemNameAr: string | null;
  image: string | null;
}

export interface ScanoMasterProductListItem {
  chainId: number;
  chainName: string;
  productCount: number;
  updatedAt: string;
}

export interface ScanoMasterProductRowExample {
  rowNumber: number;
  sku: string | null;
  barcode: string | null;
  price: string | null;
  itemNameEn: string | null;
  itemNameAr: string | null;
  image: string | null;
}

export interface ScanoMasterProductPreviewResponse {
  headers: string[];
  sampleRows: Array<Record<string, string>>;
  suggestedMapping: ScanoMasterProductMapping;
}

export interface ScanoMasterProductDetail extends ScanoMasterProductListItem {
  mapping: ScanoMasterProductMapping;
  exampleRows: ScanoMasterProductRowExample[];
}
