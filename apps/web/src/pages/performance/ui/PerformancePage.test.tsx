import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockPerformanceSummary,
  mockPerformanceVendorDetail,
  mockPerformancePreferences,
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
  mockPerformanceVendorDetail: vi.fn(),
  mockPerformancePreferences: vi.fn(),
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
    performanceVendorDetail: mockPerformanceVendorDetail,
    performancePreferences: mockPerformancePreferences,
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

describe("PerformancePage", () => {
  beforeEach(() => {
    mockPerformanceSummary.mockReset();
    mockPerformanceVendorDetail.mockReset();
    mockPerformancePreferences.mockReset();
    mockSavePerformanceCurrentPreferences.mockReset();
    mockCreatePerformanceGroup.mockReset();
    mockUpdatePerformanceGroup.mockReset();
    mockDeletePerformanceGroup.mockReset();
    mockCreatePerformanceView.mockReset();
    mockUpdatePerformanceView.mockReset();
    mockDeletePerformanceView.mockReset();
    mockStreamPerformance.mockReset();
    mockStreamPerformance.mockImplementation(() => new Promise<void>(() => {}));
    mockPerformanceVendorDetail.mockResolvedValue(baseVendorDetail);
    mockPerformancePreferences.mockResolvedValue(basePreferences);
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
      expect(mockSavePerformanceCurrentPreferences).toHaveBeenCalled();
    });
  }, TEST_TIMEOUT_MS);

  it("can apply a saved group quickly from the toolbar", async () => {
    mockPerformanceSummary.mockResolvedValue(baseSummary);

    render(<PerformancePage />);

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Nasr City" })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Open saved branch groups" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Nasr only" }));

    await waitFor(() => {
      expect(screen.getByText("Nasr only")).toBeInTheDocument();
      expect(screen.getByRole("heading", { name: "Nasr City" })).toBeInTheDocument();
      expect(screen.queryByRole("heading", { name: "Heliopolis" })).not.toBeInTheDocument();
      expect(mockSavePerformanceCurrentPreferences).toHaveBeenCalled();
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

  it("auto-refreshes every 60 seconds without breaking the initial render", async () => {
    vi.useFakeTimers();
    mockPerformanceSummary.mockResolvedValue(baseSummary);

    render(<PerformancePage />);

    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.getByText("TopBar")).toBeInTheDocument();
    expect(mockPerformanceSummary).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
      await Promise.resolve();
    });

    expect(mockPerformanceSummary).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("heading", { name: "Performance" })).toBeInTheDocument();
  }, TEST_TIMEOUT_MS);

  it("refreshes immediately when the live performance stream receives a sync event", async () => {
    let streamOptions: {
      onSync: (payload: unknown) => void;
    } | null = null;

    mockPerformanceSummary
      .mockResolvedValueOnce(baseSummary)
      .mockResolvedValueOnce({
        ...baseSummary,
        cards: {
          ...baseSummary.cards,
          totalOrders: 25,
        },
        branches: baseSummary.branches.map((branch) =>
          branch.vendorId === 112
            ? {
                ...branch,
                totalOrders: 15,
              }
            : branch,
        ),
      });
    mockPerformanceVendorDetail
      .mockResolvedValueOnce(baseVendorDetail)
      .mockResolvedValueOnce({
        ...baseVendorDetail,
        summary: {
          ...baseVendorDetail.summary,
          totalOrders: 15,
          totalCancelledOrders: 3,
        },
      });
    mockStreamPerformance.mockImplementation((options) => {
      streamOptions = options;
      return new Promise<void>(() => {});
    });

    render(<PerformancePage />);

    await waitFor(() => {
      expect(screen.getByText("22")).toBeInTheDocument();
    });

    expect(mockPerformanceSummary).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Open details for Heliopolis" }));

    await waitFor(() => {
      expect(mockPerformanceVendorDetail).toHaveBeenCalledTimes(1);
      expect(screen.getByRole("tab", { name: "Overview" })).toBeInTheDocument();
    });

    await act(async () => {
      streamOptions?.onSync({
        dayKey: "2026-03-20",
        globalEntityId: "TB_EG",
        cacheState: "fresh",
        fetchedAt: "2026-03-20T12:05:00.000Z",
        lastSuccessfulSyncAt: "2026-03-20T12:05:00.000Z",
        consecutiveFailures: 0,
        lastErrorMessage: null,
        bootstrapCompleted: true,
      });
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(mockPerformanceSummary).toHaveBeenCalledTimes(2);
      expect(mockPerformanceVendorDetail).toHaveBeenCalledTimes(2);
      expectSummaryTileValues("Total Orders", ["25"]);
      expect(screen.getAllByText("15").length).toBeGreaterThan(0);
    });
  }, TEST_TIMEOUT_MS);

  it("shows 10 branches per page and allows moving to the next page", async () => {
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

    expect(screen.getByRole("heading", { name: "Branch 10" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Branch 11" })).not.toBeInTheDocument();

    fireEvent.click(screen.getAllByRole("button", { name: "Go to page 2" })[0]!);

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Branch 11" })).toBeInTheDocument();
      expect(screen.getByRole("heading", { name: "Branch 12" })).toBeInTheDocument();
    });
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
});
