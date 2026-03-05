export type AvailabilityState = "OPEN" | "CLOSED_UNTIL" | "CLOSED";

export type OrdersVendorId = number;
export type AvailabilityVendorId = string;

export type CloseReason = "LATE" | "UNASSIGNED";
export type MonitorIssueSource = "orders" | "availability";

export interface ChainThreshold {
  name: string;
  lateThreshold: number;
  unassignedThreshold: number;
}

export interface MonitorSourceError {
  source: MonitorIssueSource;
  message: string;
  at: string;
  statusCode?: number;
}

export interface Settings {
  ordersToken: string;
  availabilityToken: string;
  globalEntityId: string; // e.g., HF_EG
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
  name: string;
  chainName: string;
  ordersVendorId: OrdersVendorId;
  availabilityVendorId: AvailabilityVendorId;
  globalEntityId: string;
  enabled: boolean;
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
  shopperFirstName?: string;
  isUnassigned: boolean;
  isLate: boolean;
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

  metrics: OrdersMetrics;

  lastUpdatedAt?: string; // ISO
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
