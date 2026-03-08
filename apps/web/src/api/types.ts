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
  shopperFirstName?: string;
  isUnassigned: boolean;
  isLate: boolean;
}

export interface BranchSnapshot {
  branchId: number;
  name: string;
  chainName: string;

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

export interface BranchDetailSnapshotAvailable {
  snapshotAvailable: true;
  branch: BranchSnapshot;
  totals: OrdersMetrics;
  fetchedAt: string;
  unassignedOrders: BranchLiveOrder[];
  preparingOrders: BranchLiveOrder[];
}

export interface BranchDetailSnapshotUnavailable {
  snapshotAvailable: false;
  branch: BranchSnapshot;
  totals: OrdersMetrics;
  fetchedAt: null;
  unassignedOrders: BranchLiveOrder[];
  preparingOrders: BranchLiveOrder[];
  message: string;
}

export type BranchDetailSnapshot = BranchDetailSnapshotAvailable | BranchDetailSnapshotUnavailable;

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
