import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockPrepare,
  mockListResolvedBranches,
  mockGetResolvedBranchById,
  mockGetGlobalEntityId,
  mockGetOrdersMirrorEntitySyncStatus,
  mockGetMirrorBranchPickers,
} = vi.hoisted(() => ({
  mockPrepare: vi.fn(),
  mockListResolvedBranches: vi.fn(() => []),
  mockGetResolvedBranchById: vi.fn(() => null),
  mockGetGlobalEntityId: vi.fn(() => "TB_EG"),
  mockGetOrdersMirrorEntitySyncStatus: vi.fn(() => ({
    dayKey: "2026-03-20",
    globalEntityId: "TB_EG",
    cacheState: "fresh",
    fetchedAt: "2026-03-20T12:00:00.000Z",
    lastSuccessfulSyncAt: "2026-03-20T12:00:00.000Z",
    consecutiveFailures: 0,
    lastErrorMessage: null,
    bootstrapCompleted: true,
  })),
  mockGetMirrorBranchPickers: vi.fn(() => ({
    pickers: {
      todayCount: 0,
      activePreparingCount: 0,
      recentActiveCount: 0,
      items: [],
    },
    cacheState: "fresh",
  })),
}));

vi.mock("../config/db.js", () => ({
  db: {
    prepare: mockPrepare,
  },
}));

vi.mock("./branchStore.js", () => ({
  listResolvedBranches: mockListResolvedBranches,
  getResolvedBranchById: mockGetResolvedBranchById,
}));

vi.mock("./settingsStore.js", () => ({
  getGlobalEntityId: mockGetGlobalEntityId,
  getSettings: vi.fn(() => ({
    ordersRefreshSeconds: 30,
  })),
}));

vi.mock("./ordersMirrorStore.js", () => ({
  getOrdersMirrorEntitySyncStatus: mockGetOrdersMirrorEntitySyncStatus,
  getMirrorBranchPickers: mockGetMirrorBranchPickers,
  extractCancellationOwner: (payload: unknown) => {
    const owner = (payload as { cancellation?: { owner?: unknown } } | null | undefined)?.cancellation?.owner;
    if (typeof owner !== "string") return null;
    const normalized = owner.trim().toUpperCase();
    return normalized.length ? normalized : null;
  },
  extractCancellationDetail: (payload: unknown) => {
    const cancellation = (payload as { cancellation?: Record<string, unknown> } | null | undefined)?.cancellation ?? {};
    return {
      owner: typeof cancellation.owner === "string" && cancellation.owner.trim().length ? cancellation.owner.trim().toUpperCase() : null,
      reason: typeof cancellation.reason === "string" && cancellation.reason.trim().length ? cancellation.reason.trim() : null,
      stage: typeof cancellation.stage === "string" && cancellation.stage.trim().length ? cancellation.stage.trim() : null,
      source: typeof cancellation.source === "string" && cancellation.source.trim().length ? cancellation.source.trim() : null,
      createdAt: typeof cancellation.createdAt === "string" && cancellation.createdAt.trim().length ? cancellation.createdAt.trim() : null,
      updatedAt: typeof cancellation.updatedAt === "string" && cancellation.updatedAt.trim().length ? cancellation.updatedAt.trim() : null,
    };
  },
  extractTransportType: (payload: unknown) => {
    const transportType = (payload as { transportType?: unknown } | null | undefined)?.transportType;
    if (typeof transportType !== "string") return null;
    const normalized = transportType.trim().toUpperCase();
    return normalized.length ? normalized : null;
  },
}));

import {
  buildPerformanceDataset,
  extractCancellationDetail,
  extractCancellationOwner,
  extractTransportType,
  getPerformanceBranchDetail,
  getPerformanceSummary,
  getPerformanceVendorDetail,
} from "./performanceStore.js";

function createBranch(overrides?: Partial<{
  id: number;
  name: string;
  chainName: string;
  ordersVendorId: number;
  availabilityVendorId: string;
  enabled: boolean;
  globalEntityId: string;
}>) {
  return {
    id: 1,
    name: "Branch A",
    chainName: "Chain A",
    ordersVendorId: 101,
    availabilityVendorId: "201",
    enabled: true,
    globalEntityId: "TB_EG",
    catalogState: "available" as const,
    lateThresholdOverride: null,
    unassignedThresholdOverride: null,
    capacityRuleEnabledOverride: null,
    ...overrides,
  };
}

function createMirrorRow(overrides?: Partial<{
  dayKey: string;
  globalEntityId: string;
  vendorId: number;
  vendorName: string | null;
  orderId: string;
  externalId: string;
  status: string;
  transportType: string | null;
  shopperId: number | null;
  shopperFirstName: string | null;
  isCompleted: number;
  isCancelled: number;
  isUnassigned: number;
  isActiveNow: number;
  customerFirstName: string | null;
  placedAt: string | null;
  pickupAt: string | null;
  lastSeenAt: string;
  cancellationOwner: string | null;
  cancellationReason: string | null;
  cancellationStage: string | null;
  cancellationSource: string | null;
  cancellationCreatedAt: string | null;
  cancellationUpdatedAt: string | null;
  cancellationOwnerLookupAt: string | null;
  cancellationOwnerLookupError: string | null;
}>) {
  return {
    dayKey: "2026-03-20",
    globalEntityId: "TB_EG",
    vendorId: 101,
    vendorName: "Branch A Vendor",
    orderId: "order-1",
    externalId: "1001",
    status: "PICKED_UP",
    transportType: "LOGISTICS_DELIVERY",
    shopperId: null,
    shopperFirstName: null,
    isCompleted: 1,
    isCancelled: 0,
    isUnassigned: 0,
    isActiveNow: 0,
    customerFirstName: "Nour",
    placedAt: "2026-03-20T09:00:00.000Z",
    pickupAt: "2026-03-20T09:15:00.000Z",
    lastSeenAt: "2026-03-20T09:16:00.000Z",
    cancellationOwner: null,
    cancellationReason: null,
    cancellationStage: null,
    cancellationSource: null,
    cancellationCreatedAt: null,
    cancellationUpdatedAt: null,
    cancellationOwnerLookupAt: null,
    cancellationOwnerLookupError: null,
    ...overrides,
  };
}

describe("performanceStore", () => {
  beforeEach(() => {
    mockPrepare.mockReset();
    mockListResolvedBranches.mockReset();
    mockGetResolvedBranchById.mockReset();
    mockGetGlobalEntityId.mockReset();
    mockGetOrdersMirrorEntitySyncStatus.mockReset();
    mockGetMirrorBranchPickers.mockReset();
    mockGetGlobalEntityId.mockReturnValue("TB_EG");
    mockGetOrdersMirrorEntitySyncStatus.mockReturnValue({
      dayKey: "2026-03-20",
      globalEntityId: "TB_EG",
      cacheState: "fresh",
      fetchedAt: "2026-03-20T12:00:00.000Z",
      lastSuccessfulSyncAt: "2026-03-20T12:00:00.000Z",
      consecutiveFailures: 0,
      lastErrorMessage: null,
      bootstrapCompleted: true,
    });
    mockGetMirrorBranchPickers.mockReturnValue({
      pickers: {
        todayCount: 0,
        activePreparingCount: 0,
        recentActiveCount: 0,
        items: [],
      },
      cacheState: "fresh",
    });
    mockPrepare.mockImplementation(() => ({
      all: vi.fn(() => []),
    }));
    mockListResolvedBranches.mockReturnValue([]);
    mockGetResolvedBranchById.mockReturnValue(null);
  });

  it("extracts cancellation owner from order detail payload", () => {
    expect(extractCancellationOwner({ cancellation: { owner: " vendor " } })).toBe("VENDOR");
    expect(extractCancellationOwner({ cancellation: { owner: "" } })).toBeNull();
    expect(extractCancellationOwner({})).toBeNull();
  });

  it("extracts cancellation detail from order detail payload", () => {
    expect(extractCancellationDetail({
      cancellation: {
        owner: " customer ",
        reason: " FRAUD_PRANK ",
        stage: " PREPARATION ",
        source: " CONTACT_CENTER ",
        createdAt: "2026-03-20T15:38:57.071Z",
        updatedAt: "2026-03-20T15:38:57.071Z",
      },
    })).toEqual({
      owner: "CUSTOMER",
      reason: "FRAUD_PRANK",
      stage: "PREPARATION",
      source: "CONTACT_CENTER",
      createdAt: "2026-03-20T15:38:57.071Z",
      updatedAt: "2026-03-20T15:38:57.071Z",
    });
  });

  it("extracts transport type from order payload", () => {
    expect(extractTransportType({ transportType: " logistics_delivery " })).toBe("LOGISTICS_DELIVERY");
    expect(extractTransportType({ transportType: "" })).toBeNull();
    expect(extractTransportType({})).toBeNull();
  });

  it("treats branches with shopper activity as logistics when transport type is still missing", () => {
    const dataset = buildPerformanceDataset({
      dayKey: "2026-03-20",
      globalEntityId: "TB_EG",
      branches: [],
      rows: [
        createMirrorRow({
          vendorId: 600,
          vendorName: "Shopper Signal Branch",
          transportType: null,
          shopperId: 100,
          shopperFirstName: "Khaled",
          isCompleted: 0,
          isActiveNow: 1,
          status: "STARTED",
        }),
      ],
    });

    expect(dataset.summary.branches[0]).toMatchObject({
      vendorId: 600,
      deliveryMode: "logistics",
      lfrApplicable: true,
      lfr: 0,
    });
  });

  it("excludes ready-to-pickup orders from late counts and late flags", () => {
    const dataset = buildPerformanceDataset({
      dayKey: "2026-03-20",
      globalEntityId: "TB_EG",
      branches: [],
      rows: [
        createMirrorRow({
          vendorId: 700,
          vendorName: "Ready Branch",
          orderId: "ready-1",
          externalId: "7001",
          status: "READY_FOR_PICKUP",
          transportType: "LOGISTICS_DELIVERY",
          isCompleted: 0,
          isActiveNow: 1,
          pickupAt: "2026-03-20T08:15:00.000Z",
          lastSeenAt: "2026-03-20T08:20:00.000Z",
        }),
      ],
    });

    expect(dataset.summary.cards.lateNow).toBe(0);
    expect(dataset.summary.branches[0]).toMatchObject({
      vendorId: 700,
      lateNow: 0,
      readyToPickupOrders: 1,
    });
    expect(dataset.vendorDetailsById.get(700)?.summary.lateNow).toBe(0);
    expect(dataset.vendorDetailsById.get(700)?.readyToPickupOrders).toEqual([
      expect.objectContaining({
        id: "ready-1",
        isLate: false,
      }),
    ]);
  });

  it("aggregates mapped branches and unmapped vendors separately", () => {
    const branchA = createBranch();
    const branchB = createBranch({
      id: 2,
      name: "Branch B",
      ordersVendorId: 102,
      availabilityVendorId: "202",
    });

    const dataset = buildPerformanceDataset({
      dayKey: "2026-03-20",
      globalEntityId: "TB_EG",
      fetchedAt: "2026-03-20T12:00:00.000Z",
      cacheState: "fresh",
      branches: [branchA, branchB],
      statusColorByBranchId: new Map([[1, "red"], [2, "green"]]),
      rows: [
        createMirrorRow({
          vendorId: 101,
          status: "CANCELLED",
          transportType: "LOGISTICS_DELIVERY",
          isCancelled: 1,
          isCompleted: 1,
          cancellationOwner: "VENDOR",
          cancellationReason: "FRAUD_PRANK",
          cancellationStage: "PREPARATION",
          cancellationSource: "CONTACT_CENTER",
          cancellationCreatedAt: "2026-03-20T10:19:00.000Z",
          cancellationUpdatedAt: "2026-03-20T10:20:00.000Z",
          cancellationOwnerLookupAt: "2026-03-20T10:20:00.000Z",
        }),
        createMirrorRow({
          vendorId: 101,
          orderId: "a-2",
          externalId: "1002",
          status: "STARTED",
          transportType: "LOGISTICS_DELIVERY",
          isCompleted: 0,
          isActiveNow: 1,
        }),
        createMirrorRow({
          vendorId: 101,
          orderId: "a-3",
          externalId: "1003",
          status: "CANCELLED",
          transportType: "LOGISTICS_DELIVERY",
          isCancelled: 1,
          isCompleted: 1,
          cancellationOwner: "TRANSPORT",
          cancellationReason: "NO_RIDER",
          cancellationCreatedAt: "2026-03-20T10:29:00.000Z",
          cancellationOwnerLookupAt: "2026-03-20T10:30:00.000Z",
        }),
        createMirrorRow({
          vendorId: 102,
          vendorName: "Branch B Vendor",
          orderId: "b-1",
          externalId: "2001",
          status: "CANCELLED",
          transportType: "LOGISTICS_DELIVERY",
          isCancelled: 1,
          isCompleted: 1,
          cancellationOwner: null,
          cancellationOwnerLookupAt: "2026-03-20T09:25:00.000Z",
          cancellationOwnerLookupError: "HTTP 401: expired token",
        }),
        createMirrorRow({
          vendorId: 999,
          vendorName: "Unmapped Vendor",
          orderId: "u-1",
          externalId: "9001",
          status: "CANCELLED",
          transportType: "VENDOR_DELIVERY",
          isCancelled: 1,
          isCompleted: 1,
          cancellationOwner: "VENDOR",
          cancellationReason: "OUT_OF_STOCK",
          cancellationCreatedAt: "2026-03-20T12:09:00.000Z",
          cancellationOwnerLookupAt: "2026-03-20T12:10:00.000Z",
        }),
      ],
    });

    expect(dataset.summary.cards.branchCount).toBe(3);
    expect(dataset.summary.cards.totalOrders).toBe(5);
    expect(dataset.summary.cards.totalCancelledOrders).toBe(4);
    expect(dataset.summary.cards.activeOrders).toBe(1);
    expect(dataset.summary.cards.lateNow).toBe(1);
    expect(dataset.summary.cards.onHoldOrders).toBe(0);
    expect(dataset.summary.cards.unassignedOrders).toBe(0);
    expect(dataset.summary.cards.inPrepOrders).toBe(1);
    expect(dataset.summary.cards.readyToPickupOrders).toBe(0);
    expect(dataset.summary.cards.vendorOwnerCancelledCount).toBe(2);
    expect(dataset.summary.cards.transportOwnerCancelledCount).toBe(1);
    expect(dataset.summary.cards.vfr).toBeCloseTo(40);
    expect(dataset.summary.cards.lfr).toBeCloseTo(20);
    expect(dataset.summary.cards.vlfr).toBeCloseTo(60);
    expect(dataset.summary.cacheState).toBe("fresh");
    expect(dataset.summary.fetchedAt).toBe("2026-03-20T12:00:00.000Z");
    expect(dataset.summary.branches.map((branch) => branch.name)).toEqual([
      "Branch A Vendor",
      "Branch B Vendor",
      "Unmapped Vendor",
    ]);
    expect(dataset.summary.branches.map((branch) => branch.vendorId)).toEqual([101, 102, 999]);
    expect(dataset.summary.branches[0]).toMatchObject({
      activeOrders: 1,
      lateNow: 1,
      inPrepOrders: 1,
      onHoldOrders: 0,
      unassignedOrders: 0,
      readyToPickupOrders: 0,
      deliveryMode: "logistics",
      lfrApplicable: true,
    });
    expect(dataset.summary.branches[2]).toMatchObject({
      deliveryMode: "self",
      lfrApplicable: false,
      lfr: 0,
    });
    expect(dataset.summary.branches[2]?.vlfr).toBeCloseTo(dataset.summary.branches[2]?.vfr ?? 0);

    expect(dataset.summary.chains).toHaveLength(1);
    expect(dataset.summary.chains[0]?.branches.map((branch) => branch.name)).toEqual(["Branch A", "Branch B"]);
    expect(dataset.summary.unmappedVendors).toEqual([
      expect.objectContaining({
        kind: "unmapped_vendor",
        vendorId: 999,
        vendorName: "Unmapped Vendor",
        vendorOwnerCancelledCount: 1,
      }),
    ]);

    expect(dataset.branchDetailsById.get(1)).toMatchObject({
      kind: "mapped_branch",
      summary: {
        totalOrders: 3,
        totalCancelledOrders: 2,
        activeOrders: 1,
        lateNow: 1,
        vendorOwnerCancelledCount: 1,
        transportOwnerCancelledCount: 1,
        customerOwnerCancelledCount: 0,
        unknownOwnerCancelledCount: 0,
        lfr: expect.any(Number),
        vlfr: expect.any(Number),
      },
      cancelledOrders: [
        expect.objectContaining({
          cancellationOwner: "TRANSPORT",
          cancellationReason: "NO_RIDER",
        }),
        expect.objectContaining({
          cancellationOwner: "VENDOR",
          cancellationReason: "FRAUD_PRANK",
        }),
      ],
      inPrepOrders: [
        expect.objectContaining({
          id: "a-2",
          shopperFirstName: undefined,
          isLate: true,
        }),
      ],
    });
    expect(dataset.vendorDetailsById.get(999)).toMatchObject({
      kind: "vendor",
      vendor: {
        vendorId: 999,
        vendorName: "Unmapped Vendor",
      },
      mappedBranch: null,
      summary: {
        totalOrders: 1,
        vendorOwnerCancelledCount: 1,
        totalCancelledOrders: 1,
      },
    });
  });

  it("returns performance summary for all resolved branches and exposes unmapped vendors", async () => {
    const disabledBranch = createBranch({
      id: 9,
      name: "Disabled Branch",
      chainName: "Chain Z",
      ordersVendorId: 909,
      availabilityVendorId: "9090",
      enabled: false,
    });

    mockListResolvedBranches.mockReturnValue([disabledBranch]);
    mockPrepare.mockImplementation(() => ({
      all: vi.fn(() => [
        createMirrorRow({
          vendorId: 909,
          vendorName: "Disabled Branch Vendor",
          orderId: "disabled-1",
          externalId: "9001",
          transportType: "LOGISTICS_DELIVERY",
        }),
        createMirrorRow({
          vendorId: 777,
          vendorName: "Unmapped Ops Vendor",
          orderId: "unmapped-1",
          externalId: "7701",
          status: "CANCELLED",
          transportType: "VENDOR_DELIVERY",
          isCancelled: 1,
          cancellationOwner: "VENDOR",
          cancellationOwnerLookupAt: "2026-03-20T12:20:00.000Z",
        }),
      ]),
    }));

    const summary = await getPerformanceSummary(new Map([[9, "orange"]]));

    expect(summary.cards.branchCount).toBe(2);
    expect(summary.cards.totalOrders).toBe(2);
    expect(summary.cards.totalCancelledOrders).toBe(1);
    expect(summary.cards.activeOrders).toBe(0);
    expect(summary.cards.lateNow).toBe(0);
    expect(summary.cards.onHoldOrders).toBe(0);
    expect(summary.cards.unassignedOrders).toBe(0);
    expect(summary.cards.inPrepOrders).toBe(0);
    expect(summary.cards.readyToPickupOrders).toBe(0);
    expect(summary.branches).toEqual([
      expect.objectContaining({
        vendorId: 909,
        name: "Disabled Branch Vendor",
        deliveryMode: "logistics",
      }),
      expect.objectContaining({
        vendorId: 777,
        name: "Unmapped Ops Vendor",
        deliveryMode: "self",
      }),
    ]);
    expect(summary.chains[0]?.branches[0]).toMatchObject({
      branchId: 9,
      name: "Disabled Branch",
      statusColor: "orange",
    });
    expect(summary.unmappedVendors[0]).toMatchObject({
      vendorId: 777,
      vendorName: "Unmapped Ops Vendor",
    });
  });

  it("returns mapped branch and unmapped vendor details from the mirror", async () => {
    const branch = createBranch({
      id: 11,
      name: "Branch Eleven",
      chainName: "Chain Q",
      ordersVendorId: 110,
      availabilityVendorId: "1110",
    });

    mockListResolvedBranches.mockReturnValue([branch]);
    mockGetResolvedBranchById.mockReturnValue(branch);
    mockGetMirrorBranchPickers.mockReturnValue({
      pickers: {
        todayCount: 1,
        activePreparingCount: 0,
        recentActiveCount: 1,
        items: [
          {
            shopperId: 902,
            shopperFirstName: "Mahmoud",
            ordersToday: 1,
            firstPickupAt: "2026-03-20T12:05:00.000Z",
            lastPickupAt: "2026-03-20T12:05:00.000Z",
            recentlyActive: true,
          },
        ],
      },
      cacheState: "fresh",
    });
    mockPrepare.mockImplementation(() => ({
      all: vi.fn(() => [
        createMirrorRow({
          vendorId: 110,
          vendorName: "Branch Eleven Vendor",
          orderId: "branch-1",
          externalId: "1101",
          status: "CANCELLED",
          transportType: "LOGISTICS_DELIVERY",
          isCancelled: 1,
          cancellationOwner: "VENDOR",
          cancellationReason: "FRAUD_PRANK",
          cancellationStage: "PREPARATION",
          cancellationSource: "CONTACT_CENTER",
          cancellationCreatedAt: "2026-03-20T12:18:00.000Z",
          cancellationOwnerLookupAt: "2026-03-20T12:20:00.000Z",
        }),
        createMirrorRow({
          vendorId: 991,
          vendorName: "Loose Vendor",
          orderId: "loose-1",
          externalId: "9911",
          status: "CANCELLED",
          transportType: "VENDOR_DELIVERY",
          isCancelled: 1,
          cancellationOwner: null,
          cancellationReason: null,
          cancellationCreatedAt: null,
          cancellationOwnerLookupAt: "2026-03-20T12:22:00.000Z",
          cancellationOwnerLookupError: "HTTP 401: expired token",
        }),
      ]),
    }));

    const branchDetail = await getPerformanceBranchDetail(11, new Map([[11, "green"]]));
    const vendorDetail = await getPerformanceVendorDetail(991);

    expect(branchDetail).toMatchObject({
      kind: "mapped_branch",
      branch: {
        branchId: 11,
        name: "Branch Eleven",
      },
      summary: {
        totalOrders: 1,
        totalCancelledOrders: 1,
        lateNow: 0,
        vendorOwnerCancelledCount: 1,
        customerOwnerCancelledCount: 0,
      },
      pickers: {
        todayCount: 1,
      },
      onHoldOrders: [],
      unassignedOrders: [],
      inPrepOrders: [],
      readyToPickupOrders: [],
      cancelledOrders: [
        expect.objectContaining({
          cancellationReason: "FRAUD_PRANK",
          cancellationStage: "PREPARATION",
          cancellationSource: "CONTACT_CENTER",
        }),
      ],
    });

    expect(vendorDetail).toMatchObject({
      kind: "vendor",
      vendor: {
        vendorId: 991,
        vendorName: "Loose Vendor",
      },
      mappedBranch: null,
      summary: {
        totalOrders: 1,
        vendorOwnerCancelledCount: 0,
        totalCancelledOrders: 1,
        lateNow: 0,
        unknownOwnerCancelledCount: 1,
      },
      pickers: {
        todayCount: 1,
      },
      onHoldOrders: [],
      unassignedOrders: [],
      inPrepOrders: [],
      readyToPickupOrders: [],
    });
  });
});
