import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockAddBranch,
  mockUpdateBranch,
  mockDeleteBranch,
  mockGetBranchById,
  mockListBranches,
  mockResolveOrdersGlobalEntityId,
  mockGetSettings,
  mockGetMirrorBranchDetail,
  mockGetMirrorBranchPickers,
  mockLookupVendorName,
  mockGetBranchCatalogResponse,
  mockRefreshBranchCatalogNow,
  mockGetResolvedCatalogBranchForAdd,
  mockLog,
} = vi.hoisted(() => ({
  mockAddBranch: vi.fn(),
  mockUpdateBranch: vi.fn(),
  mockDeleteBranch: vi.fn(),
  mockGetBranchById: vi.fn(),
  mockListBranches: vi.fn(),
  mockResolveOrdersGlobalEntityId: vi.fn((_branch: unknown, fallback: string) => fallback),
  mockGetSettings: vi.fn(),
  mockGetMirrorBranchDetail: vi.fn(),
  mockGetMirrorBranchPickers: vi.fn(),
  mockLookupVendorName: vi.fn(),
  mockGetBranchCatalogResponse: vi.fn(),
  mockRefreshBranchCatalogNow: vi.fn(),
  mockGetResolvedCatalogBranchForAdd: vi.fn(),
  mockLog: vi.fn(),
}));

vi.mock("../services/branchStore.js", () => ({
  addBranch: mockAddBranch,
  updateBranch: mockUpdateBranch,
  deleteBranch: mockDeleteBranch,
  getBranchById: mockGetBranchById,
  listBranches: mockListBranches,
}));

vi.mock("../services/monitorOrdersPolling.js", () => ({
  resolveOrdersGlobalEntityId: mockResolveOrdersGlobalEntityId,
}));

vi.mock("../services/settingsStore.js", () => ({
  getSettings: mockGetSettings,
}));

vi.mock("../services/ordersClient.js", () => ({
  lookupVendorName: mockLookupVendorName,
}));

vi.mock("../services/ordersMirrorStore.js", () => ({
  getMirrorBranchDetail: mockGetMirrorBranchDetail,
  getMirrorBranchPickers: mockGetMirrorBranchPickers,
}));

vi.mock("../services/branchCatalogService.js", () => ({
  getBranchCatalogResponse: mockGetBranchCatalogResponse,
  refreshBranchCatalogNow: mockRefreshBranchCatalogNow,
  getResolvedCatalogBranchForAdd: mockGetResolvedCatalogBranchForAdd,
}));

vi.mock("../services/logger.js", () => ({
  log: mockLog,
}));

import { addBranchRoute, branchCatalogRoute, refreshBranchCatalogRoute, updateBranchRoute } from "./branches.js";

function createResponse() {
  const res: any = {
    statusCode: 200,
    body: undefined as unknown,
  };
  res.status = vi.fn((statusCode: number) => {
    res.statusCode = statusCode;
    return res;
  });
  res.json = vi.fn((body: unknown) => {
    res.body = body;
    return res;
  });
  return res;
}

function validBranchBody() {
  return {
    name: "Branch 1",
    chainName: "Chain A",
    ordersVendorId: 111,
    availabilityVendorId: "222",
    globalEntityId: "HF_EG",
    enabled: true,
  };
}

function branchMapping(overrides?: Partial<ReturnType<typeof validBranchBody> & { id: number }>) {
  return {
    id: 7,
    name: "Branch 1",
    chainName: "Chain A",
    ordersVendorId: 111,
    availabilityVendorId: "222",
    globalEntityId: "HF_EG",
    enabled: true,
    lateThresholdOverride: null,
    unassignedThresholdOverride: null,
    ...overrides,
  };
}

function branchSnapshot(overrides?: Record<string, unknown>) {
  return {
    branchId: 7,
    name: "Branch 1",
    chainName: "Chain A",
    monitorEnabled: true,
    ordersVendorId: 111,
    availabilityVendorId: "222",
    status: "OPEN",
    statusColor: "green",
    thresholds: {
      lateThreshold: 5,
      unassignedThreshold: 5,
      source: "chain",
    },
    metrics: {
      totalToday: 6,
      cancelledToday: 1,
      doneToday: 2,
      activeNow: 3,
      lateNow: 0,
      unassignedNow: 1,
    },
    preparingNow: 2,
    preparingPickersNow: 1,
    lastUpdatedAt: "2026-03-06T10:00:00.000Z",
    ...overrides,
  };
}

function emptyPickers(overrides?: Record<string, unknown>) {
  return {
    todayCount: 0,
    activePreparingCount: 0,
    lastHourCount: 0,
    items: [],
    ...overrides,
  };
}

describe("branches routes unique-constraint handling", () => {
  beforeEach(() => {
    mockAddBranch.mockReset();
    mockUpdateBranch.mockReset();
    mockLookupVendorName.mockReset();
    mockGetSettings.mockReset();
    mockGetResolvedCatalogBranchForAdd.mockReset();
    mockGetBranchCatalogResponse.mockReset();
    mockRefreshBranchCatalogNow.mockReset();
    mockGetSettings.mockReturnValue({
      globalEntityId: "HF_EG",
      ordersRefreshSeconds: 30,
      chains: [{ name: "Chain A", lateThreshold: 5, unassignedThreshold: 5 }],
      lateThreshold: 5,
      unassignedThreshold: 5,
    });
  });

  it("returns 409 + field for duplicate availabilityVendorId on add", () => {
    mockAddBranch.mockImplementation(() => {
      const error: any = new Error("SqliteError: UNIQUE constraint failed: branches.availabilityVendorId");
      error.code = "SQLITE_CONSTRAINT_UNIQUE";
      throw error;
    });

    const req: any = { body: validBranchBody() };
    const res = createResponse();

    addBranchRoute(req, res);

    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.body).toEqual({
      ok: false,
      message: "Availability Vendor ID already exists",
      field: "availabilityVendorId",
    });
  });

  it("returns 409 + field for duplicate ordersVendorId on update", () => {
    mockUpdateBranch.mockImplementation(() => {
      const error: any = new Error("SqliteError: UNIQUE constraint failed: branches.ordersVendorId");
      error.code = "SQLITE_CONSTRAINT_UNIQUE";
      throw error;
    });

    const req: any = {
      params: { id: "7" },
      body: validBranchBody(),
    };
    const res = createResponse();

    updateBranchRoute(req, res);

    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.body).toEqual({
      ok: false,
      message: "Orders Vendor ID already exists",
      field: "ordersVendorId",
    });
  });

  it("adds a branch from the resolved source catalog without requiring manual IDs", () => {
    mockGetResolvedCatalogBranchForAdd.mockReturnValue({
      availabilityVendorId: "740921",
      ordersVendorId: 48664,
      name: "Carrefour, Zahraa El Maadi - El Me'arag El Ouloy",
      globalEntityId: "HF_EG",
      availabilityState: "OPEN",
      changeable: true,
      presentInSource: true,
      resolveStatus: "resolved",
      lastSeenAt: "2026-03-11T09:00:00.000Z",
      resolvedAt: "2026-03-11T09:00:00.000Z",
      lastError: null,
    });
    mockAddBranch.mockReturnValue(33);

    const req: any = {
      body: {
        availabilityVendorId: "740921",
        chainName: "Carrefour",
      },
    };
    const res = createResponse();

    addBranchRoute(req, res);

    expect(mockGetResolvedCatalogBranchForAdd).toHaveBeenCalledWith("HF_EG", "740921");
    expect(mockAddBranch).toHaveBeenCalledWith({
      name: "Carrefour, Zahraa El Maadi - El Me'arag El Ouloy",
      chainName: "Carrefour",
      ordersVendorId: 48664,
      availabilityVendorId: "740921",
      globalEntityId: "HF_EG",
      enabled: true,
      lateThresholdOverride: null,
      unassignedThresholdOverride: null,
    });
    expect(res.body).toEqual({ ok: true, id: 33 });
  });

  it("rejects adding a branch that is outside the current source catalog", () => {
    mockGetResolvedCatalogBranchForAdd.mockReturnValue({
      availabilityVendorId: "740921",
      ordersVendorId: 48664,
      name: "Carrefour, Zahraa El Maadi - El Me'arag El Ouloy",
      globalEntityId: "HF_EG",
      availabilityState: "OPEN",
      changeable: true,
      presentInSource: false,
      resolveStatus: "resolved",
      lastSeenAt: "2026-03-11T09:00:00.000Z",
      resolvedAt: "2026-03-11T09:00:00.000Z",
      lastError: null,
    });

    const req: any = {
      body: {
        availabilityVendorId: "740921",
        chainName: "Carrefour",
      },
    };
    const res = createResponse();

    addBranchRoute(req, res);

    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.body).toEqual({
      ok: false,
      message: "This branch is not available in the current source catalog.",
    });
  });
});

describe("lookupVendorNameRoute", () => {
  beforeEach(() => {
    mockLookupVendorName.mockReset();
    mockGetSettings.mockReset();
    mockListBranches.mockReset();
    mockResolveOrdersGlobalEntityId.mockReset();
    mockResolveOrdersGlobalEntityId.mockImplementation((_branch: unknown, fallback: string) => fallback);
    mockGetSettings.mockReturnValue({
      ordersToken: "orders-token",
      globalEntityId: "HF_EG",
      chains: [{ name: "Chain A", lateThreshold: 5, unassignedThreshold: 5 }],
      lateThreshold: 5,
      unassignedThreshold: 5,
    });
    mockListBranches.mockReturnValue([]);
  });

  it("resolves the vendor name from a saved branch mapping before querying recent orders", async () => {
    mockListBranches.mockReturnValue([
      branchMapping({
        id: 1,
        name: "Saved Branch",
        ordersVendorId: 33,
      }),
    ]);
    const { lookupVendorNameRoute } = await import("./branches.js");
    const req: any = { query: { ordersVendorId: "33", globalEntityId: "" } };
    const res = createResponse();

    await lookupVendorNameRoute(req, res);

    expect(mockLookupVendorName).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({
      ok: true,
      name: "Saved Branch",
      source: "branch_mapping",
      resolvedGlobalEntityId: "HF_EG",
      checkedSources: ["branch_mapping"],
      note: "Name filled from the saved branch mapping for this vendor.",
    });
  });

  it("falls back to recent orders when branch mapping data is unavailable", async () => {
    mockLookupVendorName.mockResolvedValue("Orders Branch");
    const { lookupVendorNameRoute } = await import("./branches.js");
    const req: any = { query: { ordersVendorId: "33", globalEntityId: "" } };
    const res = createResponse();

    await lookupVendorNameRoute(req, res);

    expect(mockLookupVendorName).toHaveBeenCalledWith({
      token: "orders-token",
      globalEntityId: "HF_EG",
      ordersVendorId: 33,
    });
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({
      ok: true,
      name: "Orders Branch",
      source: "recent_orders",
      resolvedGlobalEntityId: "HF_EG",
      checkedSources: ["branch_mapping", "recent_orders"],
      note: "Name inferred from recent orders seen in the last 30 days.",
    });
  });

  it("returns an explicit unresolved result when neither mapping nor recent orders can infer a name", async () => {
    mockLookupVendorName.mockResolvedValue(null);
    const { lookupVendorNameRoute } = await import("./branches.js");
    const req: any = { query: { ordersVendorId: "33", globalEntityId: "" } };
    const res = createResponse();

    await lookupVendorNameRoute(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({
      ok: true,
      name: null,
      source: "none",
      resolvedGlobalEntityId: "HF_EG",
      checkedSources: ["branch_mapping", "recent_orders"],
      note: "Checked saved branch mappings and recent orders in the last 30 days. No name could be inferred for this vendor right now.",
    });
  });
});

describe("branch catalog routes", () => {
  beforeEach(() => {
    mockGetBranchCatalogResponse.mockReset();
    mockRefreshBranchCatalogNow.mockReset();
    mockGetSettings.mockReset();
    mockGetSettings.mockReturnValue({
      globalEntityId: "HF_EG",
      ordersRefreshSeconds: 30,
      chains: [],
      lateThreshold: 5,
      unassignedThreshold: 5,
    });
  });

  it("returns the joined branch catalog snapshot", () => {
    mockGetBranchCatalogResponse.mockReturnValue({
      items: [
        {
          availabilityVendorId: "740921",
          ordersVendorId: 48664,
          name: "Carrefour, Zahraa El Maadi - El Me'arag El Ouloy",
          globalEntityId: "HF_EG",
          availabilityState: "OPEN",
          changeable: true,
          presentInSource: true,
          resolveStatus: "resolved",
          lastSeenAt: "2026-03-11T09:00:00.000Z",
          resolvedAt: "2026-03-11T09:00:00.000Z",
          lastError: null,
          alreadyAdded: true,
          branchId: 7,
          chainName: "Carrefour",
          enabled: true,
        },
      ],
      syncState: "fresh",
      lastSyncedAt: "2026-03-11T09:00:00.000Z",
      lastError: null,
    });

    const res = createResponse();
    branchCatalogRoute({} as any, res);

    expect(mockGetBranchCatalogResponse).toHaveBeenCalledWith("HF_EG");
    expect(res.body.items[0]).toMatchObject({
      availabilityVendorId: "740921",
      ordersVendorId: 48664,
      alreadyAdded: true,
    });
  });

  it("force-refreshes the branch catalog", async () => {
    mockRefreshBranchCatalogNow.mockResolvedValue({
      items: [],
      syncState: "fresh",
      lastSyncedAt: "2026-03-11T09:10:00.000Z",
      lastError: null,
    });

    const res = createResponse();
    await refreshBranchCatalogRoute({} as any, res);

    expect(mockRefreshBranchCatalogNow).toHaveBeenCalledWith("HF_EG");
    expect(res.body).toEqual({
      items: [],
      syncState: "fresh",
      lastSyncedAt: "2026-03-11T09:10:00.000Z",
      lastError: null,
    });
  });
});

describe("branchDetailRoute", () => {
  beforeEach(() => {
    mockGetBranchById.mockReset();
    mockGetMirrorBranchDetail.mockReset();
    mockGetSettings.mockReset();
    mockResolveOrdersGlobalEntityId.mockReset();
    mockLog.mockReset();
    mockResolveOrdersGlobalEntityId.mockImplementation((_branch: unknown, fallback: string) => fallback);
    mockGetSettings.mockReturnValue({
      globalEntityId: "HF_EG",
      chains: [{ name: "Chain A", lateThreshold: 5, unassignedThreshold: 5 }],
      lateThreshold: 5,
      unassignedThreshold: 5,
      ordersRefreshSeconds: 30,
    });
  });

  it("returns a typed branch_not_found payload when the persisted branch mapping is missing", async () => {
    mockGetBranchById.mockReturnValue(null);
    const { branchDetailRoute } = await import("./branches.js");
    const engine: any = {
      getSnapshot: () => ({ branches: [] }),
    };
    const req: any = { params: { id: "7" } };
    const res = createResponse();

    await branchDetailRoute(engine)(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({
      kind: "branch_not_found",
      branchId: 7,
      message: "Branch not found",
    });
  });

  it("returns snapshot_unavailable with live orders when the branch exists but its live snapshot is unavailable", async () => {
    mockGetBranchById.mockReturnValue(branchMapping());
    mockGetMirrorBranchDetail.mockReturnValue({
      metrics: {
        totalToday: 12,
        cancelledToday: 1,
        doneToday: 6,
        activeNow: 5,
        lateNow: 1,
        unassignedNow: 2,
      },
      fetchedAt: "2026-03-06T10:07:00.000Z",
      unassignedOrders: [{ id: "1", externalId: "ORD-1", status: "UNASSIGNED", isUnassigned: true, isLate: false }],
      preparingOrders: [{ id: "2", externalId: "ORD-2", status: "PREPARING", isUnassigned: false, isLate: true }],
      pickers: emptyPickers({
        todayCount: 2,
        activePreparingCount: 1,
        lastHourCount: 1,
        items: [
          {
            shopperId: 90202,
            shopperFirstName: "Mohamed",
            ordersToday: 3,
            firstPickupAt: "2026-03-06T08:05:00.000Z",
            lastPickupAt: "2026-03-06T10:05:00.000Z",
            activeLastHour: true,
          },
        ],
      }),
      cacheState: "fresh",
    });
    const { branchDetailRoute } = await import("./branches.js");
    const engine: any = {
      getSnapshot: () => ({ branches: [] }),
    };
    const req: any = { params: { id: "7" } };
    const res = createResponse();

    await branchDetailRoute(engine)(req, res);

    expect(mockGetMirrorBranchDetail).toHaveBeenCalledWith({
      globalEntityId: "HF_EG",
      vendorId: 111,
      ordersRefreshSeconds: 30,
      includePickerItems: true,
    });
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({
      kind: "snapshot_unavailable",
      branch: {
        branchId: 7,
        name: "Branch 1",
        chainName: "Chain A",
        monitorEnabled: true,
        ordersVendorId: 111,
        availabilityVendorId: "222",
        status: "UNKNOWN",
        statusColor: "grey",
        thresholds: {
          lateThreshold: 5,
          unassignedThreshold: 5,
          source: "chain",
        },
        metrics: {
          totalToday: 12,
          cancelledToday: 1,
          doneToday: 6,
          activeNow: 5,
          lateNow: 1,
          unassignedNow: 2,
        },
        preparingNow: 1,
        preparingPickersNow: 1,
      },
      totals: {
        totalToday: 12,
        cancelledToday: 1,
        doneToday: 6,
        activeNow: 5,
        lateNow: 1,
        unassignedNow: 2,
      },
      fetchedAt: "2026-03-06T10:07:00.000Z",
      cacheState: "fresh",
      unassignedOrders: [{ id: "1", externalId: "ORD-1", status: "UNASSIGNED", isUnassigned: true, isLate: false }],
      preparingOrders: [{ id: "2", externalId: "ORD-2", status: "PREPARING", isUnassigned: false, isLate: true }],
      pickers: emptyPickers({
        todayCount: 2,
        activePreparingCount: 1,
        lastHourCount: 1,
        items: [
          {
            shopperId: 90202,
            shopperFirstName: "Mohamed",
            ordersToday: 3,
            firstPickupAt: "2026-03-06T08:05:00.000Z",
            lastPickupAt: "2026-03-06T10:05:00.000Z",
            activeLastHour: true,
          },
        ],
      }),
      message: "Live availability snapshot is currently unavailable. Showing branch detail from the local orders cache.",
    });
  });

  it("returns live branch detail when snapshot data is present", async () => {
    mockGetBranchById.mockReturnValue(branchMapping());
    mockGetMirrorBranchDetail.mockReturnValue({
      metrics: {
        totalToday: 6,
        cancelledToday: 1,
        doneToday: 2,
        activeNow: 3,
        lateNow: 0,
        unassignedNow: 1,
      },
      fetchedAt: "2026-03-06T10:05:00.000Z",
      unassignedOrders: [{ id: "1", externalId: "ORD-1", status: "UNASSIGNED", isUnassigned: true, isLate: false }],
      preparingOrders: [{ id: "2", externalId: "ORD-2", status: "PREPARING", isUnassigned: false, isLate: false }],
      pickers: emptyPickers({
        todayCount: 2,
        activePreparingCount: 1,
        lastHourCount: 1,
        items: [],
      }),
      cacheState: "fresh",
    });
    const { branchDetailRoute } = await import("./branches.js");
    const engine: any = {
      getSnapshot: () => ({ branches: [branchSnapshot()] }),
    };
    const req: any = { params: { id: "7" }, query: { includePickerItems: "0" } };
    const res = createResponse();

    await branchDetailRoute(engine)(req, res);

    expect(mockGetMirrorBranchDetail).toHaveBeenCalledWith({
      globalEntityId: "HF_EG",
      vendorId: 111,
      ordersRefreshSeconds: 30,
      includePickerItems: false,
    });
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({
      kind: "ok",
      branch: branchSnapshot(),
      totals: branchSnapshot().metrics,
      fetchedAt: "2026-03-06T10:05:00.000Z",
      cacheState: "fresh",
      unassignedOrders: [{ id: "1", externalId: "ORD-1", status: "UNASSIGNED", isUnassigned: true, isLate: false }],
      preparingOrders: [{ id: "2", externalId: "ORD-2", status: "PREPARING", isUnassigned: false, isLate: false }],
      pickers: emptyPickers({
        todayCount: 2,
        activePreparingCount: 1,
        lastHourCount: 1,
      }),
    });
  });

  it("returns detail_fetch_failed when a live snapshot exists but the local cache is still warming", async () => {
    mockGetBranchById.mockReturnValue(branchMapping());
    mockGetMirrorBranchDetail.mockReturnValue({
      metrics: {
        totalToday: 0,
        cancelledToday: 0,
        doneToday: 0,
        activeNow: 0,
        lateNow: 0,
        unassignedNow: 0,
      },
      fetchedAt: null,
      unassignedOrders: [],
      preparingOrders: [],
      pickers: emptyPickers(),
      cacheState: "warming",
    });
    const { branchDetailRoute } = await import("./branches.js");
    const engine: any = {
      getSnapshot: () => ({ branches: [branchSnapshot({ status: "TEMP_CLOSE", statusColor: "red" })] }),
    };
    const req: any = { params: { id: "7" } };
    const res = createResponse();

    await branchDetailRoute(engine)(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({
      kind: "detail_fetch_failed",
      branch: branchSnapshot({ status: "TEMP_CLOSE", statusColor: "red" }),
      totals: branchSnapshot({ status: "TEMP_CLOSE", statusColor: "red" }).metrics,
      fetchedAt: null,
      cacheState: "warming",
      unassignedOrders: [],
      preparingOrders: [],
      pickers: emptyPickers(),
      message: "Local orders cache is warming up. Showing the latest monitor snapshot until the branch detail cache is ready.",
    });
  });

  it("returns snapshot_unavailable when both the live snapshot and local cache are unavailable", async () => {
    mockGetBranchById.mockReturnValue(branchMapping());
    mockGetMirrorBranchDetail.mockReturnValue({
      metrics: {
        totalToday: 0,
        cancelledToday: 0,
        doneToday: 0,
        activeNow: 0,
        lateNow: 0,
        unassignedNow: 0,
      },
      fetchedAt: null,
      unassignedOrders: [],
      preparingOrders: [],
      pickers: emptyPickers(),
      cacheState: "warming",
    });
    const { branchDetailRoute } = await import("./branches.js");
    const engine: any = {
      getSnapshot: () => ({ branches: [] }),
    };
    const req: any = { params: { id: "7" } };
    const res = createResponse();

    await branchDetailRoute(engine)(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({
      kind: "snapshot_unavailable",
      branch: {
        branchId: 7,
        name: "Branch 1",
        chainName: "Chain A",
        monitorEnabled: true,
        ordersVendorId: 111,
        availabilityVendorId: "222",
        status: "UNKNOWN",
        statusColor: "grey",
        thresholds: {
          lateThreshold: 5,
          unassignedThreshold: 5,
          source: "chain",
        },
        metrics: {
          totalToday: 0,
          cancelledToday: 0,
          doneToday: 0,
          activeNow: 0,
          lateNow: 0,
          unassignedNow: 0,
        },
        preparingNow: 0,
        preparingPickersNow: 0,
      },
      totals: {
        totalToday: 0,
        cancelledToday: 0,
        doneToday: 0,
        activeNow: 0,
        lateNow: 0,
        unassignedNow: 0,
      },
      fetchedAt: null,
      cacheState: "warming",
      unassignedOrders: [],
      preparingOrders: [],
      pickers: emptyPickers(),
      message: "Local orders cache is warming up while the live snapshot is unavailable.",
    });
  });

  it("returns a paused snapshot message when the branch is excluded from monitor", async () => {
    mockGetBranchById.mockReturnValue(branchMapping({ enabled: false }));
    mockGetMirrorBranchDetail.mockReturnValue({
      metrics: {
        totalToday: 4,
        cancelledToday: 0,
        doneToday: 1,
        activeNow: 3,
        lateNow: 0,
        unassignedNow: 1,
      },
      fetchedAt: "2026-03-06T10:07:00.000Z",
      unassignedOrders: [],
      preparingOrders: [],
      pickers: emptyPickers(),
      cacheState: "fresh",
    });
    const { branchDetailRoute } = await import("./branches.js");
    const engine: any = {
      getSnapshot: () => ({ branches: [] }),
    };
    const req: any = { params: { id: "7" } };
    const res = createResponse();

    await branchDetailRoute(engine)(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({
      kind: "snapshot_unavailable",
      message: "This branch is paused in monitor. Showing the latest local orders cache only.",
      cacheState: "fresh",
      branch: {
        branchId: 7,
        monitorEnabled: false,
        status: "UNKNOWN",
      },
    });
  });
});

describe("branchPickersRoute", () => {
  beforeEach(() => {
    mockGetBranchById.mockReset();
    mockGetMirrorBranchPickers.mockReset();
    mockGetSettings.mockReset();
    mockResolveOrdersGlobalEntityId.mockReset();
    mockResolveOrdersGlobalEntityId.mockImplementation((_branch: unknown, fallback: string) => fallback);
    mockGetSettings.mockReturnValue({
      globalEntityId: "HF_EG",
      chains: [{ name: "Chain A", lateThreshold: 5, unassignedThreshold: 5 }],
      lateThreshold: 5,
      unassignedThreshold: 5,
      ordersRefreshSeconds: 30,
    });
  });

  it("returns picker summary only when the pickers tab is requested", async () => {
    mockGetBranchById.mockReturnValue(branchMapping());
    mockGetMirrorBranchPickers.mockReturnValue({
      cacheState: "fresh",
      pickers: emptyPickers({
        todayCount: 4,
        activePreparingCount: 2,
        lastHourCount: 1,
        items: [
          {
            shopperId: 90202,
            shopperFirstName: "Mohamed",
            ordersToday: 5,
            firstPickupAt: "2026-03-06T08:05:00.000Z",
            lastPickupAt: "2026-03-06T10:05:00.000Z",
            activeLastHour: true,
          },
        ],
      }),
    });
    const { branchPickersRoute } = await import("./branches.js");
    const req: any = { params: { id: "7" } };
    const res = createResponse();

    await branchPickersRoute()(req, res);

    expect(mockGetMirrorBranchPickers).toHaveBeenCalledWith({
      globalEntityId: "HF_EG",
      vendorId: 111,
      ordersRefreshSeconds: 30,
    });
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual(emptyPickers({
      todayCount: 4,
      activePreparingCount: 2,
      lastHourCount: 1,
      items: [
        {
          shopperId: 90202,
          shopperFirstName: "Mohamed",
          ordersToday: 5,
          firstPickupAt: "2026-03-06T08:05:00.000Z",
          lastPickupAt: "2026-03-06T10:05:00.000Z",
          activeLastHour: true,
        },
      ],
    }));
  });

  it("returns 503 while the local picker cache is still warming", async () => {
    mockGetBranchById.mockReturnValue(branchMapping());
    mockGetMirrorBranchPickers.mockReturnValue({
      cacheState: "warming",
      pickers: emptyPickers(),
    });
    const { branchPickersRoute } = await import("./branches.js");
    const req: any = { params: { id: "7" } };
    const res = createResponse();

    await branchPickersRoute()(req, res);

    expect(res.statusCode).toBe(503);
    expect(res.body).toEqual({
      ok: false,
      message: "Local picker cache is warming up",
    });
  });
});

describe("updateBranchMonitoringRoute", () => {
  beforeEach(() => {
    mockGetBranchById.mockReset();
    mockUpdateBranch.mockReset();
    mockLog.mockReset();
  });

  it("toggles a branch monitor state, resets transient engine state, and logs the action", async () => {
    mockGetBranchById.mockReturnValue(branchMapping());
    mockUpdateBranch.mockReturnValue({
      ...branchMapping(),
      enabled: false,
    });
    const resetBranchTransientState = vi.fn();
    const { updateBranchMonitoringRoute } = await import("./branches.js");
    const req: any = {
      params: { id: "7" },
      body: { enabled: false },
    };
    const res = createResponse();

    updateBranchMonitoringRoute({ resetBranchTransientState } as any)(req, res);

    expect(mockUpdateBranch).toHaveBeenCalledWith(7, { enabled: false });
    expect(resetBranchTransientState).toHaveBeenCalledWith(expect.objectContaining({
      id: 7,
      enabled: false,
    }));
    expect(mockLog).toHaveBeenCalledWith(
      7,
      "INFO",
      "Monitor paused for this branch. Live cycles will skip it until re-enabled.",
    );
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({
      ok: true,
      item: {
        ...branchMapping(),
        enabled: false,
      },
    });
  });

  it("returns the current item without updating when the monitor state is unchanged", async () => {
    mockGetBranchById.mockReturnValue(branchMapping({ enabled: true }));
    const { updateBranchMonitoringRoute } = await import("./branches.js");
    const req: any = {
      params: { id: "7" },
      body: { enabled: true },
    };
    const res = createResponse();

    updateBranchMonitoringRoute({ resetBranchTransientState: vi.fn() } as any)(req, res);

    expect(mockUpdateBranch).not.toHaveBeenCalled();
    expect(mockLog).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({
      ok: true,
      item: branchMapping({ enabled: true }),
    });
  });
});
