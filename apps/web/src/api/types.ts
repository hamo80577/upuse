export type CloseReason = "LATE" | "UNASSIGNED";

export interface ChainThreshold {
  name: string;
  lateThreshold: number;
  unassignedThreshold: number;
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

export interface BranchDetailSnapshot {
  branch: BranchSnapshot;
  totals: OrdersMetrics;
  fetchedAt: string;
  unassignedOrders: BranchLiveOrder[];
  preparingOrders: BranchLiveOrder[];
}

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
