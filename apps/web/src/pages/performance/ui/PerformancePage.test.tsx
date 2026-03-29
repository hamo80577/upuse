import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockPerformanceSummary,
  mockPerformanceTrend,
  mockPerformanceVendorDetail,
  mockPerformancePreferences,
  mockListBranchSource,
  mockSavePerformanceCurrentPreferences,
  mockCreatePerformanceGroup,
  mockUpdatePerformanceGroup,
  mockDeletePerformanceGroup,
  mockCreatePerformanceView,
  mockUpdatePerformanceView,
  mockDeletePerformanceView,
  mockStreamPerformance,
} = vi.hoisted(() => ({
  mockPerformanceSummary: vi.fn(),
  mockPerformanceTrend: vi.fn(),
  mockPerformanceVendorDetail: vi.fn(),
  mockPerformancePreferences: vi.fn(),
  mockListBranchSource: vi.fn(),
  mockSavePerformanceCurrentPreferences: vi.fn(),
  mockCreatePerformanceGroup: vi.fn(),
  mockUpdatePerformanceGroup: vi.fn(),
  mockDeletePerformanceGroup: vi.fn(),
  mockCreatePerformanceView: vi.fn(),
  mockUpdatePerformanceView: vi.fn(),
  mockDeletePerformanceView: vi.fn(),
  mockStreamPerformance: vi.fn(),
}));

vi.mock("../../../api/client", () => ({
  api: {
    performanceSummary: mockPerformanceSummary,
    performanceTrend: mockPerformanceTrend,
    performanceVendorDetail: mockPerformanceVendorDetail,
    performancePreferences: mockPerformancePreferences,
    listBranchSource: mockListBranchSource,
    savePerformanceCurrentPreferences: mockSavePerformanceCurrentPreferences,
    createPerformanceGroup: mockCreatePerformanceGroup,
    updatePerformanceGroup: mockUpdatePerformanceGroup,
    deletePerformanceGroup: mockDeletePerformanceGroup,
    createPerformanceView: mockCreatePerformanceView,
    updatePerformanceView: mockUpdatePerformanceView,
    deletePerformanceView: mockDeletePerformanceView,
    streamPerformance: mockStreamPerformance,
  },
  describeApiError: (error: unknown, fallback = "Request failed") =>
    error instanceof Error ? error.message : fallback,
}));

vi.mock("../../../app/providers/AuthProvider", () => ({
  useAuth: () => ({
    canManageMonitor: true,
  }),
}));

vi.mock("../../../app/providers/MonitorStatusProvider", () => ({
  useMonitorStatus: () => ({
    monitoring: {
      running: false,
      degraded: false,
    },
    startMonitoring: vi.fn(),
    stopMonitoring: vi.fn(),
  }),
}));

vi.mock("../../../widgets/top-bar/ui/TopBar", () => ({
  TopBar: () => <div>TopBar</div>,
}));

vi.mock("motion/react", () => ({
  AnimatePresence: ({ children }: { children?: ReactNode }) => <>{children}</>,
  LayoutGroup: ({ children }: { children?: ReactNode }) => <>{children}</>,
  motion: {
    div: ({
      children,
      initial: _initial,
      animate: _animate,
      exit: _exit,
      transition: _transition,
      ...props
    }: Record<string, unknown> & {
      children?: ReactNode;
      initial?: unknown;
      animate?: unknown;
      exit?: unknown;
      transition?: unknown;
    }) => <div {...(props as Record<string, unknown>)}>{children}</div>,
    span: ({
      children,
      layoutId: _layoutId,
      transition: _transition,
      ...props
    }: Record<string, unknown> & {
      children?: ReactNode;
      layoutId?: string;
      transition?: unknown;
    }) => <span {...(props as Record<string, unknown>)}>{children}</span>,
  },
  useReducedMotion: () => false,
}));

vi.mock("echarts-for-react", () => ({
  default: (props: {
    option?: { xAxis?: { data?: string[] } };
    onEvents?: Record<string, (event: unknown) => void>;
    onMouseEnter?: () => void;
  }) => (
    <div
      data-testid="performance-trend-chart"
      onMouseEnter={props.onMouseEnter}
      onMouseLeave={() => props.onEvents?.globalout?.({})}
    >
      {(props.option?.xAxis?.data ?? []).map((label, index) => (
        <button
          key={label}
          type="button"
          onMouseEnter={() => props.onEvents?.updateAxisPointer?.({ axesInfo: [{ value: index }] })}
          onClick={() => props.onEvents?.click?.({ dataIndex: index, name: label })}
        >
          bucket-{label}
        </button>
      ))}
    </div>
  ),
}));

vi.mock("echarts-for-react/lib/core", () => ({
  default: (props: {
    option?: { xAxis?: { data?: string[] } };
    onEvents?: Record<string, (event: unknown) => void>;
    onMouseEnter?: () => void;
  }) => (
    <div
      data-testid="performance-trend-chart"
      onMouseEnter={props.onMouseEnter}
      onMouseLeave={() => props.onEvents?.globalout?.({})}
    >
      {(props.option?.xAxis?.data ?? []).map((label, index) => (
        <button
          key={label}
          type="button"
          onMouseEnter={() => props.onEvents?.updateAxisPointer?.({ axesInfo: [{ value: index }] })}
          onClick={() => props.onEvents?.click?.({ dataIndex: index, name: label })}
        >
          bucket-{label}
        </button>
      ))}
    </div>
  ),
}));

import { PerformancePage } from "./PerformancePage";

const TEST_TIMEOUT_MS = 15_000;

const baseSummary = {
  scope: {
    dayKey: "2026-03-20",
    timezone: "Africa/Cairo",
    startUtcIso: "2026-03-19T22:00:00.000Z",
    endUtcIso: "2026-03-20T21:59:59.999Z",
  },
  cards: {
    branchCount: 2,
    totalOrders: 22,
    totalCancelledOrders: 3,
    activeOrders: 10,
    lateNow: 2,
    onHoldOrders: 4,
    unassignedOrders: 3,
    inPrepOrders: 8,
    readyToPickupOrders: 5,
    vfr: 9.09,
    lfr: 4.55,
    vlfr: 13.64,
    vendorOwnerCancelledCount: 2,
    transportOwnerCancelledCount: 1,
  },
  statusCounts: [
    { status: "ON_HOLD", count: 4 },
    { status: "UNASSIGNED", count: 3 },
    { status: "STARTED", count: 10 },
    { status: "READY_FOR_PICKUP", count: 5 },
  ],
  ownerCoverage: {
    totalCancelledOrders: 3,
    resolvedOwnerCount: 3,
    unresolvedOwnerCount: 0,
    vendorOwnerCancelledCount: 2,
    transportOwnerCancelledCount: 1,
    lookupErrorCount: 0,
    coverageRatio: 1,
    warning: null,
  },
  branches: [
    {
      vendorId: 111,
      name: "Nasr City",
      statusColor: "red" as const,
      totalOrders: 10,
      activeOrders: 4,
      lateNow: 2,
      onHoldOrders: 3,
      unassignedOrders: 1,
      inPrepOrders: 4,
      readyToPickupOrders: 2,
      deliveryMode: "logistics" as const,
      lfrApplicable: true,
      vendorOwnerCancelledCount: 2,
      transportOwnerCancelledCount: 1,
      vfr: 20,
      lfr: 10,
      vlfr: 30,
      statusCounts: [
        { status: "ON_HOLD", count: 3 },
        { status: "UNASSIGNED", count: 1 },
        { status: "STARTED", count: 4 },
        { status: "READY_FOR_PICKUP", count: 2 },
      ],
      ownerCoverage: {
        totalCancelledOrders: 3,
        resolvedOwnerCount: 3,
        unresolvedOwnerCount: 0,
        vendorOwnerCancelledCount: 2,
        transportOwnerCancelledCount: 1,
        lookupErrorCount: 0,
        coverageRatio: 1,
        warning: null,
      },
    },
    {
      vendorId: 112,
      name: "Heliopolis",
      statusColor: "green" as const,
      totalOrders: 12,
      activeOrders: 6,
      lateNow: 0,
      onHoldOrders: 1,
      unassignedOrders: 2,
      inPrepOrders: 4,
      readyToPickupOrders: 3,
      deliveryMode: "self" as const,
      lfrApplicable: false,
      vendorOwnerCancelledCount: 0,
      transportOwnerCancelledCount: 0,
      vfr: 0,
      lfr: 0,
      vlfr: 0,
      statusCounts: [
        { status: "ON_HOLD", count: 1 },
        { status: "UNASSIGNED", count: 2 },
        { status: "STARTED", count: 6 },
        { status: "READY_FOR_PICKUP", count: 3 },
      ],
      ownerCoverage: {
        totalCancelledOrders: 0,
        resolvedOwnerCount: 0,
        unresolvedOwnerCount: 0,
        vendorOwnerCancelledCount: 0,
        transportOwnerCancelledCount: 0,
        lookupErrorCount: 0,
        coverageRatio: 1,
        warning: null,
      },
    },
  ],
  chains: [
    {
      chainName: "Carrefour",
      branchCount: 1,
      totalOrders: 10,
      vendorOwnerCancelledCount: 2,
      transportOwnerCancelledCount: 1,
      vfr: 20,
      lfr: 10,
      vlfr: 30,
      ownerCoverage: {
        totalCancelledOrders: 3,
        resolvedOwnerCount: 3,
        unresolvedOwnerCount: 0,
        vendorOwnerCancelledCount: 2,
        transportOwnerCancelledCount: 1,
        lookupErrorCount: 0,
        coverageRatio: 1,
        warning: null,
      },
      branches: [
        {
          kind: "mapped_branch" as const,
          branchId: 7,
          name: "Nasr City",
          chainName: "Carrefour",
          ordersVendorId: 111,
          availabilityVendorId: "222",
          statusColor: "red" as const,
          totalOrders: 10,
          vendorOwnerCancelledCount: 2,
          transportOwnerCancelledCount: 1,
          vfr: 20,
          lfr: 10,
          vlfr: 30,
          statusCounts: [
            { status: "ON_HOLD", count: 3 },
            { status: "UNASSIGNED", count: 1 },
            { status: "STARTED", count: 4 },
            { status: "READY_FOR_PICKUP", count: 2 },
          ],
          ownerCoverage: {
            totalCancelledOrders: 3,
            resolvedOwnerCount: 3,
            unresolvedOwnerCount: 0,
            vendorOwnerCancelledCount: 2,
            transportOwnerCancelledCount: 1,
            lookupErrorCount: 0,
            coverageRatio: 1,
            warning: null,
          },
        },
      ],
    },
    {
      chainName: "Spinneys",
      branchCount: 1,
      totalOrders: 12,
      vendorOwnerCancelledCount: 0,
      transportOwnerCancelledCount: 0,
      vfr: 0,
      lfr: 0,
      vlfr: 0,
      ownerCoverage: {
        totalCancelledOrders: 0,
        resolvedOwnerCount: 0,
        unresolvedOwnerCount: 0,
        vendorOwnerCancelledCount: 0,
        transportOwnerCancelledCount: 0,
        lookupErrorCount: 0,
        coverageRatio: 1,
        warning: null,
      },
      branches: [
        {
          kind: "mapped_branch" as const,
          branchId: 8,
          name: "Heliopolis",
          chainName: "Spinneys",
          ordersVendorId: 112,
          availabilityVendorId: "223",
          statusColor: "green" as const,
          totalOrders: 12,
          vendorOwnerCancelledCount: 0,
          transportOwnerCancelledCount: 0,
          vfr: 0,
          lfr: 0,
          vlfr: 0,
          statusCounts: [
            { status: "ON_HOLD", count: 1 },
            { status: "UNASSIGNED", count: 2 },
            { status: "STARTED", count: 6 },
            { status: "READY_FOR_PICKUP", count: 3 },
          ],
          ownerCoverage: {
            totalCancelledOrders: 0,
            resolvedOwnerCount: 0,
            unresolvedOwnerCount: 0,
            vendorOwnerCancelledCount: 0,
            transportOwnerCancelledCount: 0,
            lookupErrorCount: 0,
            coverageRatio: 1,
            warning: null,
          },
        },
      ],
    },
  ],
  unmappedVendors: [],
  fetchedAt: "2026-03-20T12:00:00.000Z",
  cacheState: "fresh" as const,
};

const baseTrend = {
  scope: baseSummary.scope,
  fetchedAt: "2026-03-20T12:05:00.000Z",
  cacheState: "fresh" as const,
  resolutionMinutes: 60 as const,
  startMinute: 480,
  endMinute: 660,
  buckets: [
    {
      bucketStartUtcIso: "2026-03-20T06:00:00.000Z",
      bucketEndUtcIso: "2026-03-20T07:00:00.000Z",
      label: "08:00",
      ordersCount: 8,
      vendorCancelledCount: 1,
      transportCancelledCount: 0,
      vfr: 12.5,
      lfr: 0,
      vlfr: 12.5,
    },
    {
      bucketStartUtcIso: "2026-03-20T07:00:00.000Z",
      bucketEndUtcIso: "2026-03-20T08:00:00.000Z",
      label: "09:00",
      ordersCount: 10,
      vendorCancelledCount: 1,
      transportCancelledCount: 1,
      vfr: 10,
      lfr: 10,
      vlfr: 20,
    },
    {
      bucketStartUtcIso: "2026-03-20T08:00:00.000Z",
      bucketEndUtcIso: "2026-03-20T09:00:00.000Z",
      label: "10:00",
      ordersCount: 4,
      vendorCancelledCount: 0,
      transportCancelledCount: 0,
      vfr: 0,
      lfr: 0,
      vlfr: 0,
    },
  ],
};

const baseVendorDetail = {
  kind: "vendor" as const,
  vendor: {
    vendorId: 112,
    vendorName: "Heliopolis",
    globalEntityId: "TB_EG",
    statusColor: "green" as const,
  },
  mappedBranch: {
    branchId: 8,
    name: "Heliopolis Branch",
    chainName: "Spinneys",
    availabilityVendorId: "223",
  },
  summary: {
    totalOrders: 12,
    totalCancelledOrders: 2,
    activeOrders: 6,
    lateNow: 1,
    onHoldOrders: 1,
    unassignedOrders: 2,
    inPrepOrders: 4,
    readyToPickupOrders: 3,
    vendorOwnerCancelledCount: 0,
    transportOwnerCancelledCount: 0,
    customerOwnerCancelledCount: 1,
    unknownOwnerCancelledCount: 1,
    vfr: 0,
    lfr: 0,
    vlfr: 0,
    deliveryMode: "self" as const,
    lfrApplicable: false,
  },
  statusCounts: [
    { status: "ON_HOLD", count: 1 },
    { status: "UNASSIGNED", count: 2 },
  ],
  ownerCoverage: {
    totalCancelledOrders: 2,
    resolvedOwnerCount: 1,
    unresolvedOwnerCount: 1,
    vendorOwnerCancelledCount: 0,
    transportOwnerCancelledCount: 0,
    lookupErrorCount: 1,
    coverageRatio: 0.5,
    warning: "1 cancelled orders still have unresolved owners.",
  },
  onHoldOrders: [
    {
      id: "hold-1",
      externalId: "2101",
      status: "ON_HOLD",
      placedAt: "2026-03-20T12:00:00.000Z",
      pickupAt: "2026-03-20T12:20:00.000Z",
      customerFirstName: "Nada",
      shopperId: undefined,
      shopperFirstName: undefined,
      isUnassigned: false,
      isLate: false,
    },
  ],
  unassignedOrders: [
    {
      id: "unassigned-1",
      externalId: "2102",
      status: "UNASSIGNED",
      placedAt: "2026-03-20T12:05:00.000Z",
      pickupAt: "2026-03-20T12:25:00.000Z",
      customerFirstName: "Ali",
      shopperId: undefined,
      shopperFirstName: undefined,
      isUnassigned: true,
      isLate: false,
    },
  ],
  inPrepOrders: [
    {
      id: "prep-1",
      externalId: "2103",
      status: "STARTED",
      placedAt: "2026-03-20T12:10:00.000Z",
      pickupAt: "2026-03-20T12:30:00.000Z",
      customerFirstName: "Sara",
      shopperId: 8801,
      shopperFirstName: "Mohamed",
      isUnassigned: false,
      isLate: true,
    },
  ],
  readyToPickupOrders: [
    {
      id: "ready-1",
      externalId: "2104",
      status: "READY_FOR_PICKUP",
      placedAt: "2026-03-20T11:50:00.000Z",
      pickupAt: "2026-03-20T12:15:00.000Z",
      customerFirstName: "Mona",
      shopperId: 8802,
      shopperFirstName: "Youssef",
      isUnassigned: false,
      isLate: false,
    },
  ],
  cancelledOrders: [
    {
      orderId: "cancel-2",
      externalId: "2002",
      status: "CANCELLED",
      customerFirstName: "Nada",
      placedAt: "2026-03-20T12:00:00.000Z",
      pickupAt: "2026-03-20T12:20:00.000Z",
      cancellationOwner: "CUSTOMER",
      cancellationReason: "FRAUD_PRANK",
      cancellationStage: "PREPARATION",
      cancellationSource: "CONTACT_CENTER",
      cancellationCreatedAt: "2026-03-20T15:38:57.071Z",
      cancellationUpdatedAt: "2026-03-20T15:38:57.071Z",
      cancellationOwnerLookupAt: "2026-03-20T15:39:00.000Z",
      cancellationOwnerLookupError: null,
    },
    {
      orderId: "cancel-1",
      externalId: "2001",
      status: "CANCELLED",
      customerFirstName: "Ali",
      placedAt: "2026-03-20T11:00:00.000Z",
      pickupAt: "2026-03-20T11:20:00.000Z",
      cancellationOwner: null,
      cancellationReason: null,
      cancellationStage: null,
      cancellationSource: null,
      cancellationCreatedAt: null,
      cancellationUpdatedAt: null,
      cancellationOwnerLookupAt: "2026-03-20T15:39:00.000Z",
      cancellationOwnerLookupError: "HTTP 401: expired token",
    },
  ],
  vendorOwnerCancelledOrders: [],
  unknownOwnerCancelledOrders: [
    {
      orderId: "cancel-1",
      externalId: "2001",
      status: "CANCELLED",
      customerFirstName: "Ali",
      placedAt: "2026-03-20T11:00:00.000Z",
      pickupAt: "2026-03-20T11:20:00.000Z",
      cancellationOwner: null,
      cancellationReason: null,
      cancellationStage: null,
      cancellationSource: null,
      cancellationCreatedAt: null,
      cancellationUpdatedAt: null,
      cancellationOwnerLookupAt: "2026-03-20T15:39:00.000Z",
      cancellationOwnerLookupError: "HTTP 401: expired token",
    },
  ],
  pickers: {
    todayCount: 2,
    activePreparingCount: 1,
    recentActiveCount: 1,
    items: [
      {
        shopperId: 90202,
        shopperFirstName: "Mohamed",
        ordersToday: 2,
        firstPickupAt: "2026-03-20T12:05:00.000Z",
        lastPickupAt: "2026-03-20T13:05:00.000Z",
        recentlyActive: true,
      },
    ],
  },
  fetchedAt: "2026-03-20T12:00:00.000Z",
  cacheState: "fresh" as const,
};

const basePreferences = {
  current: {
    searchQuery: "",
    selectedVendorIds: [],
    selectedDeliveryTypes: [],
    selectedBranchFilters: [],
    selectedSortKeys: ["orders"],
    nameSortEnabled: false,
    activeGroupId: null,
    activeViewId: null,
  },
  groups: [
    {
      id: 1,
      name: "Nasr only",
      vendorIds: [111],
      createdAt: "2026-03-20T12:00:00.000Z",
      updatedAt: "2026-03-20T12:00:00.000Z",
    },
  ],
  views: [
    {
      id: 2,
      name: "Vendor watch",
      state: {
        searchQuery: "",
        selectedVendorIds: [],
        selectedDeliveryTypes: [],
        selectedBranchFilters: ["vendor"],
        selectedSortKeys: ["vfr"],
        nameSortEnabled: false,
      },
      createdAt: "2026-03-20T12:00:00.000Z",
      updatedAt: "2026-03-20T12:00:00.000Z",
    },
  ],
};

const baseSourceItems = [
  {
    availabilityVendorId: "222",
    ordersVendorId: 111,
    name: "Nasr City",
    alreadyAdded: true,
    branchId: 7,
    chainName: "Carrefour",
    enabled: true,
  },
  {
    availabilityVendorId: "223",
    ordersVendorId: 112,
    name: "Heliopolis",
    alreadyAdded: true,
    branchId: 8,
    chainName: "Spinneys",
    enabled: true,
  },
  {
    availabilityVendorId: "333A",
    ordersVendorId: 333,
    name: "Ghost Branch",
    alreadyAdded: false,
    branchId: null,
    chainName: null,
    enabled: null,
  },
];

describe("PerformancePage", () => {
  beforeEach(() => {
    mockPerformanceSummary.mockReset();
    mockPerformanceTrend.mockReset();
    mockPerformanceVendorDetail.mockReset();
    mockPerformancePreferences.mockReset();
    mockListBranchSource.mockReset();
    mockSavePerformanceCurrentPreferences.mockReset();
    mockCreatePerformanceGroup.mockReset();
    mockUpdatePerformanceGroup.mockReset();
    mockDeletePerformanceGroup.mockReset();
    mockCreatePerformanceView.mockReset();
    mockUpdatePerformanceView.mockReset();
    mockDeletePerformanceView.mockReset();
    mockStreamPerformance.mockReset();
    mockStreamPerformance.mockImplementation(() => new Promise<void>(() => {}));
    mockPerformanceTrend.mockResolvedValue(baseTrend);
    mockPerformanceVendorDetail.mockResolvedValue(baseVendorDetail);
    mockPerformancePreferences.mockResolvedValue(basePreferences);
    mockListBranchSource.mockResolvedValue({ items: baseSourceItems });
    mockSavePerformanceCurrentPreferences.mockResolvedValue({
      ok: true,
      current: basePreferences.current,
    });
    mockCreatePerformanceGroup.mockImplementation(async (payload: { name: string; vendorIds: number[] }) => ({
      ok: true,
      group: {
        id: 99,
        createdAt: "2026-03-20T12:30:00.000Z",
        updatedAt: "2026-03-20T12:30:00.000Z",
        ...payload,
      },
    }));
    mockUpdatePerformanceGroup.mockImplementation(async (id: number, payload: { name?: string; vendorIds?: number[] }) => ({
      ok: true,
      group: {
        id,
        name: payload.name ?? "Updated group",
        vendorIds: payload.vendorIds ?? [111],
        createdAt: "2026-03-20T12:00:00.000Z",
        updatedAt: "2026-03-20T12:30:00.000Z",
      },
    }));
    mockDeletePerformanceGroup.mockResolvedValue({ ok: true });
    mockCreatePerformanceView.mockImplementation(async (payload: { name: string; state: unknown }) => ({
      ok: true,
      view: {
        id: 77,
        name: payload.name,
        state: payload.state,
        createdAt: "2026-03-20T12:30:00.000Z",
        updatedAt: "2026-03-20T12:30:00.000Z",
      },
    }));
    mockUpdatePerformanceView.mockImplementation(async (id: number, payload: { name?: string; state?: unknown }) => ({
      ok: true,
      view: {
        id,
        name: payload.name ?? "Updated view",
        state: payload.state ?? basePreferences.views[0].state,
        createdAt: "2026-03-20T12:00:00.000Z",
        updatedAt: "2026-03-20T12:30:00.000Z",
      },
    }));
    mockDeletePerformanceView.mockResolvedValue({ ok: true });
    vi.useRealTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function expectSummaryTileValues(label: string, expectedValues: string[]) {
    const tile = screen.getAllByText(label)[0]?.parentElement;
    expect(tile).not.toBeNull();
    for (const expectedValue of expectedValues) {
      expect(tile).toHaveTextContent(expectedValue);
    }
  }

  it("renders simple branch cards with Active, In Prep, and TMP", async () => {
    mockPerformanceSummary.mockResolvedValue(baseSummary);

    render(<PerformancePage />);

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Performance" })).toBeInTheDocument();
    });

    expect(screen.getByRole("heading", { name: "Nasr City" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Heliopolis" })).toBeInTheDocument();
    expect(screen.queryByText("2 branches")).not.toBeInTheDocument();
    expect(screen.getByText("Scope")).toBeInTheDocument();
    expect(screen.getByText("Cancellation")).toBeInTheDocument();
    expect(screen.getByText("Flow")).toBeInTheDocument();
    expectSummaryTileValues("Branches", ["2"]);
    expectSummaryTileValues("Total Orders", ["22"]);
    expectSummaryTileValues("Total Cancels", ["3"]);
    expectSummaryTileValues("VFR", ["2", "9.09%"]);
    expectSummaryTileValues("LFR", ["1", "4.55%"]);
    expectSummaryTileValues("V+L FR", ["3", "13.6%"]);
    expectSummaryTileValues("Late", ["2"]);
    expect(screen.getByLabelText("Search branches")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Toggle branch Nasr City" })).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByRole("button", { name: "Toggle branch Heliopolis" })).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByRole("button", { name: "Pick branches" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open saved branch groups" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Transport type" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Branch activity" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Filter branches" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sort branches" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open details for Heliopolis" })).toBeInTheDocument();
    const nasrHeader = screen.getByRole("button", { name: "Toggle branch Nasr City" });
    const headerVfr = within(nasrHeader).getAllByText("VFR")[0]?.parentElement;
    expect(headerVfr).not.toBeNull();
    expect(headerVfr).toHaveTextContent("20.0%");
    expect(headerVfr).not.toHaveTextContent("220.0%");
    expect(screen.getAllByText("Active").length).toBeGreaterThan(0);
    expect(screen.getAllByText("In Prep").length).toBeGreaterThan(0);
    expect(screen.getAllByText("VFR").length).toBeGreaterThan(0);
    expect(screen.getAllByText("LFR").length).toBeGreaterThan(0);
    expect(screen.getAllByText("V+L FR").length).toBeGreaterThan(0);
    expect(screen.queryByText("TMP")).not.toBeInTheDocument();
    expect(screen.getByText("Vendor ID 111")).toBeInTheDocument();
    expect(screen.queryByText("Carrefour")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Toggle branch Heliopolis" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Toggle branch Heliopolis" })).toHaveAttribute("aria-expanded", "true");
      expect(screen.getByText("TMP")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Open details for Heliopolis" }));

    await waitFor(() => {
      expect(mockPerformanceVendorDetail).toHaveBeenCalledWith(112, expect.any(Object));
      expect(screen.getByRole("tab", { name: "Overview" })).toBeInTheDocument();
      expect(screen.getByRole("tab", { name: "Cancellations" })).toBeInTheDocument();
      expect(screen.getByText("Mapped branch: Heliopolis Branch")).toBeInTheDocument();
    });

    expect(screen.getByRole("button", { name: "Toggle branch Heliopolis", hidden: true })).toHaveAttribute("aria-expanded", "true");
  }, TEST_TIMEOUT_MS);

  it("filters branches by search and natural delivery filters", async () => {
    mockPerformanceSummary.mockResolvedValue(baseSummary);

    render(<PerformancePage />);

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Nasr City" })).toBeInTheDocument();
    });

    expectSummaryTileValues("Branches", ["2"]);
    expectSummaryTileValues("Total Orders", ["22"]);

    fireEvent.change(screen.getByLabelText("Search branches"), {
      target: { value: "heliopolis" },
    });

    await waitFor(() => {
      expect(screen.queryByRole("heading", { name: "Nasr City" })).not.toBeInTheDocument();
      expect(screen.getByRole("heading", { name: "Heliopolis" })).toBeInTheDocument();
      expectSummaryTileValues("Branches", ["1"]);
      expectSummaryTileValues("Total Orders", ["12"]);
    });

    fireEvent.change(screen.getByLabelText("Search branches"), {
      target: { value: "" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Transport type" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Vendor Delivery" }));
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });

    await waitFor(() => {
      expect(screen.queryByRole("heading", { name: "Nasr City" })).not.toBeInTheDocument();
      expect(screen.getByRole("heading", { name: "Heliopolis" })).toBeInTheDocument();
      expectSummaryTileValues("Branches", ["1"]);
      expectSummaryTileValues("Total Orders", ["12"]);
      expect(screen.getByText("Vendor Delivery")).toBeInTheDocument();
    });
  }, TEST_TIMEOUT_MS);

  it("supports Has Late filtering and Most Late sorting", async () => {
    mockPerformanceSummary.mockResolvedValue(baseSummary);

    render(<PerformancePage />);

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Nasr City" })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Filter branches" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Has Late" }));
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Nasr City" })).toBeInTheDocument();
      expect(screen.queryByRole("heading", { name: "Heliopolis" })).not.toBeInTheDocument();
      expectSummaryTileValues("Late", ["2"]);
    });

    fireEvent.click(screen.getByRole("button", { name: "Sort branches" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Most Late" }));

    await waitFor(() => {
      const after = screen
        .getAllByRole("heading", { level: 2 })
        .map((node) => node.textContent);
      expect(after[0]).toBe("Nasr City");
    });
  }, TEST_TIMEOUT_MS);

  it("can select all visible search results from branches", async () => {
    mockPerformanceSummary.mockResolvedValue(baseSummary);

    render(<PerformancePage />);

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Nasr City" })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Pick branches" }));

    const branchesDialog = await screen.findByRole("dialog", { name: "Branches" });
    fireEvent.change(within(branchesDialog).getByLabelText("Search branches"), {
      target: { value: "Nasr" },
    });

    fireEvent.click(within(branchesDialog).getByRole("button", { name: "Select all results" }));
    fireEvent.click(within(branchesDialog).getByRole("button", { name: "Apply" }));

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Nasr City" })).toBeInTheDocument();
      expect(screen.queryByRole("heading", { name: "Heliopolis" })).not.toBeInTheDocument();
    });
  }, TEST_TIMEOUT_MS);

  it("can apply a saved group quickly from the toolbar", async () => {
    mockPerformanceSummary.mockResolvedValue(baseSummary);

    render(<PerformancePage />);

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Nasr City" })).toBeInTheDocument();
    });

    mockPerformanceTrend.mockClear();
    fireEvent.click(screen.getByRole("button", { name: "Open saved branch groups" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Nasr only" }));

    await waitFor(() => {
      expect(screen.getByText("Nasr only")).toBeInTheDocument();
      expect(screen.getByRole("heading", { name: "Nasr City" })).toBeInTheDocument();
      expect(screen.queryByRole("heading", { name: "Heliopolis" })).not.toBeInTheDocument();
      expect(mockSavePerformanceCurrentPreferences).toHaveBeenCalled();
    });

    expect(mockPerformanceTrend).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("tab", { name: "Show Trend panel" }));

    await waitFor(() => {
      expect(mockPerformanceTrend).toHaveBeenCalledWith(expect.objectContaining({
        vendorIds: [111],
      }), expect.any(Object));
    });
  }, TEST_TIMEOUT_MS);

  it("defaults to sorting by total orders and supports single-sort ordering", async () => {
    mockPerformanceSummary.mockResolvedValue(baseSummary);

    render(<PerformancePage />);

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Nasr City" })).toBeInTheDocument();
    });

    const before = screen
      .getAllByRole("heading", { level: 2 })
      .map((node) => node.textContent);
    expect(before.slice(0, 2)).toEqual(["Heliopolis", "Nasr City"]);

    fireEvent.click(screen.getByRole("button", { name: "Sort branches" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Highest VFR" }));

    await waitFor(() => {
      const after = screen
        .getAllByRole("heading", { level: 2 })
        .map((node) => node.textContent);
      expect(after.slice(0, 2)).toEqual(["Nasr City", "Heliopolis"]);
    });
  }, TEST_TIMEOUT_MS);

  it("does not overwrite saved performance preferences with defaults when the initial preferences fetch fails", async () => {
    mockPerformanceSummary.mockResolvedValue(baseSummary);
    mockPerformancePreferences.mockRejectedValue(new Error("Preferences API unavailable"));

    render(<PerformancePage />);

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Performance" })).toBeInTheDocument();
    });

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 700));
    });

    expect(mockSavePerformanceCurrentPreferences).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Pick branches" })).toBeEnabled();
  }, TEST_TIMEOUT_MS);

  it("does not auto-refresh performance data in the background", async () => {
    vi.useFakeTimers();
    mockPerformanceSummary.mockResolvedValue(baseSummary);

    render(<PerformancePage />);

    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.getByText("TopBar")).toBeInTheDocument();
    expect(mockPerformanceSummary).toHaveBeenCalledTimes(1);
    expect(mockStreamPerformance).toHaveBeenCalledTimes(1);
    expect(mockPerformanceTrend).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
      await Promise.resolve();
    });

    expect(mockPerformanceSummary).toHaveBeenCalledTimes(1);
    expect(mockStreamPerformance).toHaveBeenCalledTimes(1);
    expect(mockPerformanceTrend).not.toHaveBeenCalled();
    expect(screen.getByRole("heading", { name: "Performance" })).toBeInTheDocument();
  }, TEST_TIMEOUT_MS);

  it("subscribes to live performance summary updates without issuing extra summary requests", async () => {
    mockPerformanceSummary.mockResolvedValue(baseSummary);
    let streamOptions: { onSummary?: (summary: typeof baseSummary) => void } | null = null;
    mockStreamPerformance.mockImplementation((options: { onSummary?: (summary: typeof baseSummary) => void }) => {
      streamOptions = options;
      return new Promise<void>(() => {});
    });

    render(<PerformancePage />);

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Performance" })).toBeInTheDocument();
    });

    expect(mockPerformanceSummary).toHaveBeenCalledTimes(1);
    expect(mockStreamPerformance).toHaveBeenCalledTimes(1);

    act(() => {
      streamOptions?.onSummary?.({
        ...baseSummary,
        cards: {
          ...baseSummary.cards,
          branchCount: 1,
          totalOrders: 9,
        },
        branches: [
          {
            ...baseSummary.branches[0],
            name: "Dokki",
            totalOrders: 9,
          },
        ],
        fetchedAt: "2026-03-20T12:10:00.000Z",
      });
    });

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Dokki" })).toBeInTheDocument();
      expect(screen.queryByRole("heading", { name: "Heliopolis" })).not.toBeInTheDocument();
    });

    expect(mockPerformanceSummary).toHaveBeenCalledTimes(1);
  }, TEST_TIMEOUT_MS);

  it("shows 10 branches per page without refetching trend data when pagination changes", async () => {
    const manyBranches = Array.from({ length: 12 }, (_, index) => ({
      vendorId: 200 + index,
      name: `Branch ${index + 1}`,
      statusColor: "grey" as const,
      totalOrders: 20 - index,
      activeOrders: 10 - Math.floor(index / 2),
      lateNow: index % 3 === 0 ? 1 : 0,
      onHoldOrders: 0,
      unassignedOrders: 0,
      inPrepOrders: index + 1,
      readyToPickupOrders: 0,
      deliveryMode: "logistics" as const,
      lfrApplicable: true,
      vendorOwnerCancelledCount: index === 0 ? 1 : 0,
      transportOwnerCancelledCount: 0,
      vfr: index === 0 ? 5 : 0,
      lfr: 0,
      vlfr: index === 0 ? 5 : 0,
      statusCounts: [{ status: "STARTED", count: index + 1 }],
      ownerCoverage: {
        totalCancelledOrders: index === 0 ? 1 : 0,
        resolvedOwnerCount: index === 0 ? 1 : 0,
        unresolvedOwnerCount: 0,
        vendorOwnerCancelledCount: index === 0 ? 1 : 0,
        transportOwnerCancelledCount: 0,
        lookupErrorCount: 0,
        coverageRatio: 1,
        warning: null,
      },
    }));

    mockPerformanceSummary.mockResolvedValue({
      ...baseSummary,
      cards: {
        ...baseSummary.cards,
        branchCount: 12,
        totalOrders: 174,
      },
      branches: manyBranches,
    });

    render(<PerformancePage />);

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Branch 1" })).toBeInTheDocument();
    });

    expect(mockPerformanceTrend).not.toHaveBeenCalled();

    expect(screen.getByRole("heading", { name: "Branch 10" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Branch 11" })).not.toBeInTheDocument();

    mockPerformanceTrend.mockClear();

    fireEvent.click(screen.getAllByRole("button", { name: "Go to page 2" })[0]!);

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Branch 11" })).toBeInTheDocument();
      expect(screen.getByRole("heading", { name: "Branch 12" })).toBeInTheDocument();
    });
    expect(mockPerformanceTrend).not.toHaveBeenCalled();
  }, TEST_TIMEOUT_MS);

  it("restores saved preferences and can apply a saved group from branches", async () => {
    mockPerformanceSummary.mockResolvedValue(baseSummary);
    mockPerformancePreferences.mockResolvedValue({
      ...basePreferences,
      current: {
        ...basePreferences.current,
        selectedBranchFilters: ["vendor"],
      },
    });

    render(<PerformancePage />);

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Nasr City" })).toBeInTheDocument();
    });

    expect(screen.queryByRole("heading", { name: "Heliopolis" })).not.toBeInTheDocument();
    expect(screen.getByText("Has Vendor Cancels")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Pick branches" }));
    fireEvent.click(await screen.findByRole("button", { name: "Apply group Nasr only" }));

    await waitFor(() => {
      expect(screen.getByText("Nasr only")).toBeInTheDocument();
      expect(mockSavePerformanceCurrentPreferences).toHaveBeenCalled();
    });
  }, TEST_TIMEOUT_MS);

  it("loads trend data only after opening the trend panel and updates hover insights", async () => {
    mockPerformanceSummary.mockResolvedValue(baseSummary);

    render(<PerformancePage />);

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Performance" })).toBeInTheDocument();
    });

    expect(mockPerformanceTrend).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("tab", { name: "Show Trend panel" }));

    await waitFor(() => {
      expect(mockPerformanceTrend).toHaveBeenCalledTimes(1);
      expect(screen.getByTestId("performance-trend-chart")).toBeInTheDocument();
      expect(within(screen.getByTestId("trend-details-table")).getAllByText("All Candles").length).toBeGreaterThan(0);
      expect(screen.getByRole("button", { name: "bucket-09:00" })).toBeInTheDocument();
      expect(screen.queryByRole("radiogroup", { name: "Trend resolution" })).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Open trend edit menu" })).toBeInTheDocument();
    });

    const trendPayload = mockPerformanceTrend.mock.calls[0]?.[0];
    expect(trendPayload).toMatchObject({
      resolutionMinutes: 60,
      startMinute: 0,
      endMinute: 1440,
    });
    expect(trendPayload?.vendorIds).toBeUndefined();
    expect(trendPayload?.searchQuery).toBeUndefined();

    fireEvent.click(screen.getByRole("button", { name: "bucket-09:00" }));

    await waitFor(() => {
      const detailsTable = screen.getByTestId("trend-details-table");
      expect(within(detailsTable).getAllByText("Selected Candle")).toHaveLength(1);
      expect(within(detailsTable).getAllByText(/09:00:00 to 20 Mar, 10:00:00/).length).toBeGreaterThan(0);
      expect(within(detailsTable).getAllByText("10.0%")).toHaveLength(2);
      expect(within(detailsTable).getAllByText("20.0%").length).toBeGreaterThan(0);
      expect(within(detailsTable).getByText("2")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Open trend edit menu" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Adjust trend candles" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Adjust trend range" })).toBeInTheDocument();
      expect(screen.queryByRole("radiogroup", { name: "Trend resolution" })).not.toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Adjust trend candles" }));

    await waitFor(() => {
      expect(screen.getByRole("radiogroup", { name: "Trend resolution" })).toBeInTheDocument();
      expect(screen.getByTestId("trend-candles-submenu")).toHaveAttribute("data-popper-placement", "left-start");
    });

    fireEvent.click(screen.getByRole("button", { name: "Adjust trend range" }));

    await waitFor(() => {
      expect(screen.getByLabelText("Trend from time")).toBeInTheDocument();
      expect(screen.getByTestId("trend-range-submenu")).toHaveAttribute("data-popper-placement", "left-start");
    });
  }, TEST_TIMEOUT_MS);

  it("preserves the selected candle during trend refreshes", async () => {
    const refreshTrendDeferred: { resolve: (value: typeof baseTrend) => void } = {
      resolve: () => {
        throw new Error("Expected a pending refreshed trend resolver.");
      },
    };
    const refreshedTrendPromise = new Promise<typeof baseTrend>((resolve) => {
      refreshTrendDeferred.resolve = resolve;
    });

    mockPerformanceSummary
      .mockResolvedValueOnce(baseSummary)
      .mockResolvedValueOnce(baseSummary);
    mockPerformanceTrend
      .mockResolvedValueOnce(baseTrend)
      .mockImplementationOnce(() => refreshedTrendPromise);

    render(<PerformancePage />);

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Performance" })).toBeInTheDocument();
    });

    expect(mockPerformanceTrend).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("tab", { name: "Show Trend panel" }));

    await waitFor(() => {
      expect(mockPerformanceTrend).toHaveBeenCalledTimes(1);
      expect(screen.getByTestId("performance-trend-chart")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "bucket-09:00" })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "bucket-09:00" }));

    await waitFor(() => {
      const detailsTable = screen.getByTestId("trend-details-table");
      expect(within(detailsTable).getAllByText("Selected Candle")).toHaveLength(1);
      expect(within(detailsTable).getByText("10")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));

    await waitFor(() => {
      expect(mockPerformanceTrend).toHaveBeenCalledTimes(2);
      expect(screen.getByTestId("trend-chart-refresh-indicator")).toBeInTheDocument();
    });

    refreshTrendDeferred.resolve({
      ...baseTrend,
      fetchedAt: "2026-03-20T12:10:00.000Z",
      buckets: baseTrend.buckets.map((bucket) =>
        bucket.label === "09:00"
          ? {
              ...bucket,
              ordersCount: 17,
              vendorCancelledCount: 2,
              vfr: 11.76,
              vlfr: 21.76,
            }
          : bucket,
      ),
    });

    await waitFor(() => {
      const detailsTable = screen.getByTestId("trend-details-table");
      expect(within(detailsTable).getAllByText("Selected Candle")).toHaveLength(1);
      expect(within(detailsTable).getByText("17")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Show all candles" })).toBeInTheDocument();
      expect(screen.queryByTestId("trend-chart-refresh-indicator")).not.toBeInTheDocument();
    });
  }, TEST_TIMEOUT_MS);

  it("keeps hero panel switching manual without auto-rotation", async () => {
    mockPerformanceSummary.mockResolvedValue(baseSummary);
    vi.useFakeTimers();

    render(<PerformancePage />);

    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getByRole("tab", { name: "Show Summary panel" })).toHaveAttribute("aria-selected", "true");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(12_000);
    });

    expect(screen.getByRole("tab", { name: "Show Summary panel" })).toHaveAttribute("aria-selected", "true");
    expect(screen.queryByTestId("performance-trend-chart")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "Show Trend panel" }));

    expect(screen.getByRole("tab", { name: "Show Trend panel" })).toHaveAttribute("aria-selected", "true");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(12_000);
    });

    expect(screen.getByRole("tab", { name: "Show Trend panel" })).toHaveAttribute("aria-selected", "true");
  }, TEST_TIMEOUT_MS);

  it("shows clear filters and resets active selections back to default", async () => {
    mockPerformanceSummary.mockResolvedValue(baseSummary);

    render(<PerformancePage />);

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Nasr City" })).toBeInTheDocument();
    });

    fireEvent.change(screen.getByLabelText("Search branches"), {
      target: { value: "heliopolis" },
    });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Clear all filters" })).toBeInTheDocument();
      expect(screen.queryByRole("heading", { name: "Nasr City" })).not.toBeInTheDocument();
      expect(screen.getByRole("heading", { name: "Heliopolis" })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Clear all filters" }));

    await waitFor(() => {
      expect(screen.getByLabelText("Search branches")).toHaveValue("");
      expect(screen.getByRole("heading", { name: "Nasr City" })).toBeInTheDocument();
      expect(screen.getByRole("heading", { name: "Heliopolis" })).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Clear all filters" })).not.toBeInTheDocument();
    });
  }, TEST_TIMEOUT_MS);

  it("marks trend as stale on live summary updates without refetching it until requested", async () => {
    const liveSummary = {
      ...baseSummary,
      cards: {
        ...baseSummary.cards,
        totalOrders: 28,
      },
      fetchedAt: "2026-03-20T12:15:00.000Z",
    };
    let streamOptions: { onSummary?: (summary: typeof baseSummary) => void } | null = null;
    mockPerformanceSummary
      .mockResolvedValueOnce(baseSummary)
      .mockResolvedValueOnce(liveSummary);
    mockStreamPerformance.mockImplementation((options: { onSummary?: (summary: typeof baseSummary) => void }) => {
      streamOptions = options;
      return new Promise<void>(() => {});
    });
    mockPerformanceTrend
      .mockResolvedValueOnce(baseTrend)
      .mockResolvedValueOnce({
        ...baseTrend,
        fetchedAt: liveSummary.fetchedAt,
      });

    render(<PerformancePage />);

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Performance" })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("tab", { name: "Show Trend panel" }));

    await waitFor(() => {
      expect(mockPerformanceTrend).toHaveBeenCalledTimes(1);
    });

    mockPerformanceTrend.mockClear();

    act(() => {
      streamOptions?.onSummary?.(liveSummary);
    });

    await waitFor(() => {
      expect(screen.getByTestId("performance-trend-stale-indicator")).toBeInTheDocument();
    });
    expect(mockPerformanceTrend).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));

    await waitFor(() => {
      expect(mockPerformanceTrend).toHaveBeenCalledTimes(1);
      expect(screen.queryByTestId("performance-trend-stale-indicator")).not.toBeInTheDocument();
    });
  }, TEST_TIMEOUT_MS);

  it("reloads the trend when the interval or time window changes", async () => {
    mockPerformanceSummary.mockResolvedValue(baseSummary);

    render(<PerformancePage />);

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Performance" })).toBeInTheDocument();
    });

    expect(mockPerformanceTrend).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("tab", { name: "Show Trend panel" }));

    await waitFor(() => {
      expect(mockPerformanceTrend).toHaveBeenCalledTimes(1);
      expect(screen.getByTestId("performance-trend-chart")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Open trend edit menu" })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Open trend edit menu" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Adjust trend candles" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Adjust trend range" })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Adjust trend candles" }));

    await waitFor(() => {
      expect(screen.getByRole("radiogroup", { name: "Trend resolution" })).toBeInTheDocument();
      expect(screen.getByTestId("trend-candles-submenu")).toHaveAttribute("data-popper-placement", "left-start");
    });

    mockPerformanceTrend.mockClear();

    fireEvent.click(screen.getByRole("radio", { name: "30m" }));

    await waitFor(() => {
      expect(mockPerformanceTrend).toHaveBeenCalledWith(expect.objectContaining({
        resolutionMinutes: 30,
        startMinute: 0,
        endMinute: 1440,
      }), expect.any(Object));
    });

    fireEvent.click(screen.getByRole("button", { name: "Adjust trend range" }));

    await waitFor(() => {
      expect(screen.getByLabelText("Trend from time")).toBeInTheDocument();
      expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
      expect(screen.getByTestId("trend-range-submenu")).toHaveAttribute("data-popper-placement", "left-start");
    });

    const fromInput = screen.getByLabelText("Trend from time");
    fireEvent.focus(fromInput);
    fireEvent.change(fromInput, {
      target: { value: "9:00 AM" },
    });
    await waitFor(() => {
      expect(screen.getByRole("option", { name: "9:00 AM" })).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("option", { name: "9:00 AM" }));

    const toInput = screen.getByLabelText("Trend to time");
    fireEvent.focus(toInput);
    fireEvent.change(toInput, {
      target: { value: "10:30 AM" },
    });
    await waitFor(() => {
      expect(screen.getByRole("option", { name: "10:30 AM" })).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("option", { name: "10:30 AM" }));

    expect(screen.getByRole("button", { name: "Adjust trend range" })).toBeInTheDocument();
    expect(screen.getByLabelText("Trend from time")).toBeInTheDocument();
    expect(screen.getByLabelText("Trend to time")).toBeInTheDocument();

    await waitFor(() => {
      expect(mockPerformanceTrend).toHaveBeenLastCalledWith(expect.objectContaining({
        resolutionMinutes: 30,
        startMinute: 540,
        endMinute: 630,
      }), expect.any(Object));
    });
  }, TEST_TIMEOUT_MS);

  it("sends search scope to trend queries without expanding it into vendor ids", async () => {
    mockPerformanceSummary.mockResolvedValue(baseSummary);

    render(<PerformancePage />);

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Nasr City" })).toBeInTheDocument();
    });

    expect(mockPerformanceTrend).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText("Search branches"), {
      target: { value: "nasr" },
    });

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Nasr City" })).toBeInTheDocument();
      expect(screen.queryByRole("heading", { name: "Heliopolis" })).not.toBeInTheDocument();
    });

    expect(mockPerformanceTrend).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("tab", { name: "Show Trend panel" }));

    await waitFor(() => {
      expect(mockPerformanceTrend).toHaveBeenCalledTimes(1);
    });

    const trendPayload = mockPerformanceTrend.mock.calls[0]?.[0];
    expect(trendPayload).toMatchObject({
      resolutionMinutes: 60,
      startMinute: 0,
      endMinute: 1440,
      searchQuery: "nasr",
    });
    expect(trendPayload?.vendorIds).toBeUndefined();
  }, TEST_TIMEOUT_MS);

  it("creates a saved group from bulk orders ids and keeps no-order vendors visible in review", async () => {
    mockPerformanceSummary.mockResolvedValue(baseSummary);

    render(<PerformancePage />);

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Nasr City" })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Pick branches" }));

    const branchesDialog = await screen.findByRole("dialog", { name: "Branches" });
    fireEvent.click(within(branchesDialog).getByRole("button", { name: "Bulk Add" }));

    const bulkDialog = await screen.findByRole("dialog", { name: "Bulk Add Group" });
    fireEvent.change(within(bulkDialog).getByLabelText("Paste Orders IDs"), {
      target: { value: "111\n333\n777" },
    });
    expect(within(bulkDialog).getByText("3 vendors entered")).toBeInTheDocument();

    fireEvent.click(within(bulkDialog).getByRole("button", { name: "Review" }));

    await waitFor(() => {
      const reviewDialog = screen.getByRole("dialog", { name: "Review Vendors" });
      expect(within(reviewDialog).getByText("Nasr City")).toBeInTheDocument();
      expect(within(reviewDialog).getByText("Ghost Branch")).toBeInTheDocument();
      expect(within(reviewDialog).getAllByText("No Orders Yet").length).toBeGreaterThan(0);
      expect(within(reviewDialog).getByText(/1 branches have current orders and 2 will be added as No Orders Yet\./)).toBeInTheDocument();
    });

    fireEvent.click(within(screen.getByRole("dialog", { name: "Review Vendors" })).getByRole("button", { name: "Add" }));

    const nameDialog = await screen.findByRole("dialog", { name: "Name Group" });
    fireEvent.change(within(nameDialog).getByLabelText("Group name"), {
      target: { value: "Bulk Created" },
    });
    fireEvent.click(within(nameDialog).getByRole("button", { name: "Save Group" }));

    await waitFor(() => {
      expect(mockCreatePerformanceGroup).toHaveBeenCalledWith({
        name: "Bulk Created",
        vendorIds: [111, 333, 777],
      });
      const activeBranchesDialog = screen.getByRole("dialog", { name: "Branches" });
      expect(within(activeBranchesDialog).getByText("Bulk Created")).toBeInTheDocument();
      expect(within(activeBranchesDialog).queryByText("Active group: Bulk Created")).not.toBeInTheDocument();
    });
  }, TEST_TIMEOUT_MS);

  it("maps availability ids before saving a bulk group", async () => {
    mockPerformanceSummary.mockResolvedValue(baseSummary);

    render(<PerformancePage />);

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Nasr City" })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Pick branches" }));

    const branchesDialog = await screen.findByRole("dialog", { name: "Branches" });
    fireEvent.click(within(branchesDialog).getByRole("button", { name: "Bulk Add" }));

    const bulkDialog = await screen.findByRole("dialog", { name: "Bulk Add Group" });
    fireEvent.click(within(bulkDialog).getByRole("button", { name: "Availability ID" }));
    fireEvent.change(within(bulkDialog).getByLabelText("Paste Availability IDs"), {
      target: { value: "222\n333A\nmissing" },
    });

    fireEvent.click(within(bulkDialog).getByRole("button", { name: "Review" }));

    await waitFor(() => {
      const reviewDialog = screen.getByRole("dialog", { name: "Review Vendors" });
      expect(within(reviewDialog).getByText("Ghost Branch")).toBeInTheDocument();
      expect(within(reviewDialog).getByText("Availability ID 333A")).toBeInTheDocument();
      expect(within(reviewDialog).getByText(/1 mapped from availability IDs, 1 will be added as No Orders Yet, and 1 were not found\./)).toBeInTheDocument();
    });

    fireEvent.click(within(screen.getByRole("dialog", { name: "Review Vendors" })).getByRole("button", { name: "Add" }));

    const nameDialog = await screen.findByRole("dialog", { name: "Name Group" });
    fireEvent.change(within(nameDialog).getByLabelText("Group name"), {
      target: { value: "Availability Bulk" },
    });
    fireEvent.click(within(nameDialog).getByRole("button", { name: "Save Group" }));

    await waitFor(() => {
      expect(mockCreatePerformanceGroup).toHaveBeenCalledWith({
        name: "Availability Bulk",
        vendorIds: [111, 333],
      });
    });
  }, TEST_TIMEOUT_MS);

  it("filters active and inactive placeholder branches locally without affecting trend scope", async () => {
    const mixedGroup = {
      id: 5,
      name: "Mixed group",
      vendorIds: [111, 333],
      createdAt: "2026-03-20T12:00:00.000Z",
      updatedAt: "2026-03-20T12:00:00.000Z",
    };

    mockPerformanceSummary.mockResolvedValue(baseSummary);
    mockPerformancePreferences.mockResolvedValue({
      ...basePreferences,
      current: {
        ...basePreferences.current,
        activeGroupId: mixedGroup.id,
      },
      groups: [mixedGroup],
    });

    render(<PerformancePage />);

    await waitFor(() => {
      expect(screen.getByText("Mixed group")).toBeInTheDocument();
      expect(screen.getByRole("heading", { name: "Ghost Branch" })).toBeInTheDocument();
    });

    expectSummaryTileValues("Branches", ["2", "Active", "1", "Inactive", "1"]);

    fireEvent.click(screen.getByRole("button", { name: "Branch activity" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Active" }));

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Nasr City" })).toBeInTheDocument();
      expect(screen.queryByRole("heading", { name: "Ghost Branch" })).not.toBeInTheDocument();
    });

    expectSummaryTileValues("Branches", ["2", "Active", "1", "Inactive", "1"]);

    await act(async () => {
      await new Promise((resolve) => {
        setTimeout(resolve, 450);
      });
    });

    expect(mockSavePerformanceCurrentPreferences).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Branch activity" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Inactive" }));

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Ghost Branch" })).toBeInTheDocument();
      expect(screen.queryByRole("heading", { name: "Nasr City" })).not.toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Clear all filters" }));

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Nasr City" })).toBeInTheDocument();
      expect(screen.getByRole("heading", { name: "Heliopolis" })).toBeInTheDocument();
      expect(screen.queryByRole("heading", { name: "Ghost Branch" })).not.toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("tab", { name: "Show Trend panel" }));

    await waitFor(() => {
      expect(mockPerformanceTrend).toHaveBeenCalledTimes(1);
    });

    const trendPayload = mockPerformanceTrend.mock.calls[0]?.[0];
    expect(trendPayload).not.toHaveProperty("branchActivityFilter");
    expect(trendPayload?.vendorIds).toBeUndefined();
  }, TEST_TIMEOUT_MS);

  it("shows placeholder cards for saved groups until live orders arrive", async () => {
    const mixedGroup = {
      id: 5,
      name: "Mixed group",
      vendorIds: [111, 333],
      createdAt: "2026-03-20T12:00:00.000Z",
      updatedAt: "2026-03-20T12:00:00.000Z",
    };
    let streamOptions: { onSummary?: (summary: typeof baseSummary) => void } | null = null;

    mockPerformanceSummary.mockResolvedValue(baseSummary);
    mockPerformancePreferences.mockResolvedValue({
      ...basePreferences,
      current: {
        ...basePreferences.current,
        activeGroupId: mixedGroup.id,
      },
      groups: [mixedGroup],
    });
    mockStreamPerformance.mockImplementation((options: { onSummary?: (summary: typeof baseSummary) => void }) => {
      streamOptions = options;
      return new Promise<void>(() => {});
    });

    render(<PerformancePage />);

    await waitFor(() => {
      expect(screen.getByText("Mixed group")).toBeInTheDocument();
      expect(screen.getByRole("heading", { name: "Ghost Branch" })).toBeInTheDocument();
    });

    expect(screen.queryByRole("heading", { name: "Heliopolis" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Details unavailable for Ghost Branch" })).toBeDisabled();
    expect(screen.getByText("No Orders Yet")).toBeInTheDocument();

    const liveSummary = {
      ...baseSummary,
      cards: {
        ...baseSummary.cards,
        branchCount: 3,
        totalOrders: 31,
      },
      branches: [
        ...baseSummary.branches,
        {
          vendorId: 333,
          name: "Ghost Branch Live",
          statusColor: "green" as const,
          totalOrders: 9,
          activeOrders: 2,
          lateNow: 0,
          onHoldOrders: 0,
          unassignedOrders: 0,
          inPrepOrders: 2,
          readyToPickupOrders: 0,
          deliveryMode: "logistics" as const,
          lfrApplicable: true,
          vendorOwnerCancelledCount: 0,
          transportOwnerCancelledCount: 0,
          vfr: 0,
          lfr: 0,
          vlfr: 0,
          statusCounts: [{ status: "STARTED", count: 2 }],
          ownerCoverage: {
            totalCancelledOrders: 0,
            resolvedOwnerCount: 0,
            unresolvedOwnerCount: 0,
            vendorOwnerCancelledCount: 0,
            transportOwnerCancelledCount: 0,
            lookupErrorCount: 0,
            coverageRatio: 1,
            warning: null,
          },
        },
      ],
      fetchedAt: "2026-03-20T12:10:00.000Z",
    } as typeof baseSummary;

    act(() => {
      streamOptions?.onSummary?.(liveSummary);
    });

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Ghost Branch Live" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Open details for Ghost Branch Live" })).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Details unavailable for Ghost Branch" })).not.toBeInTheDocument();
    });
  }, TEST_TIMEOUT_MS);
});
