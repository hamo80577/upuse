import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockAddBranch,
  mockUpdateBranch,
  mockDeleteBranch,
  mockGetBranchById,
  mockListBranches,
  mockResolveOrdersGlobalEntityId,
  mockGetSettings,
  mockFetchVendorOrdersDetail,
  mockLookupVendorName,
  mockLog,
} = vi.hoisted(() => ({
  mockAddBranch: vi.fn(),
  mockUpdateBranch: vi.fn(),
  mockDeleteBranch: vi.fn(),
  mockGetBranchById: vi.fn(),
  mockListBranches: vi.fn(),
  mockResolveOrdersGlobalEntityId: vi.fn((_branch: unknown, fallback: string) => fallback),
  mockGetSettings: vi.fn(),
  mockFetchVendorOrdersDetail: vi.fn(),
  mockLookupVendorName: vi.fn(),
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
  fetchVendorOrdersDetail: mockFetchVendorOrdersDetail,
  lookupVendorName: mockLookupVendorName,
}));

vi.mock("../services/logger.js", () => ({
  log: mockLog,
}));

import { addBranchRoute, updateBranchRoute } from "./branches.js";

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
    lastUpdatedAt: "2026-03-06T10:00:00.000Z",
    ...overrides,
  };
}

describe("branches routes unique-constraint handling", () => {
  beforeEach(() => {
    mockAddBranch.mockReset();
    mockUpdateBranch.mockReset();
    mockLookupVendorName.mockReset();
    mockGetSettings.mockReset();
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

describe("branchDetailRoute", () => {
  beforeEach(() => {
    mockGetBranchById.mockReset();
    mockFetchVendorOrdersDetail.mockReset();
    mockGetSettings.mockReset();
    mockResolveOrdersGlobalEntityId.mockReset();
    mockLog.mockReset();
    mockResolveOrdersGlobalEntityId.mockImplementation((_branch: unknown, fallback: string) => fallback);
    mockGetSettings.mockReturnValue({
      ordersToken: "orders-token",
      globalEntityId: "HF_EG",
      chains: [{ name: "Chain A", lateThreshold: 5, unassignedThreshold: 5 }],
      lateThreshold: 5,
      unassignedThreshold: 5,
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
    mockFetchVendorOrdersDetail.mockResolvedValue({
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
    });
    const { branchDetailRoute } = await import("./branches.js");
    const engine: any = {
      getSnapshot: () => ({ branches: [] }),
    };
    const req: any = { params: { id: "7" } };
    const res = createResponse();

    await branchDetailRoute(engine)(req, res);

    expect(mockFetchVendorOrdersDetail).toHaveBeenCalledWith({
      token: "orders-token",
      globalEntityId: "HF_EG",
      vendorId: 111,
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
      unassignedOrders: [{ id: "1", externalId: "ORD-1", status: "UNASSIGNED", isUnassigned: true, isLate: false }],
      preparingOrders: [{ id: "2", externalId: "ORD-2", status: "PREPARING", isUnassigned: false, isLate: true }],
      message: "Live availability snapshot is currently unavailable. Showing orders detail from the latest Orders API response.",
    });
  });

  it("returns live branch detail when snapshot data is present", async () => {
    mockGetBranchById.mockReturnValue(branchMapping());
    mockFetchVendorOrdersDetail.mockResolvedValue({
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
    });
    const { branchDetailRoute } = await import("./branches.js");
    const engine: any = {
      getSnapshot: () => ({ branches: [branchSnapshot()] }),
    };
    const req: any = { params: { id: "7" } };
    const res = createResponse();

    await branchDetailRoute(engine)(req, res);

    expect(mockFetchVendorOrdersDetail).toHaveBeenCalledWith({
      token: "orders-token",
      globalEntityId: "HF_EG",
      vendorId: 111,
    });
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({
      kind: "ok",
      branch: branchSnapshot(),
      totals: branchSnapshot().metrics,
      fetchedAt: "2026-03-06T10:05:00.000Z",
      unassignedOrders: [{ id: "1", externalId: "ORD-1", status: "UNASSIGNED", isUnassigned: true, isLate: false }],
      preparingOrders: [{ id: "2", externalId: "ORD-2", status: "PREPARING", isUnassigned: false, isLate: false }],
    });
  });

  it("uses the latest branch snapshot when the state changes while detail orders are loading", async () => {
    mockGetBranchById.mockReturnValue(branchMapping());
    const staleSnapshot = branchSnapshot({
      status: "TEMP_CLOSE",
      statusColor: "red",
      closedUntil: "2026-03-08T14:30:00.000Z",
    });
    const freshSnapshot = branchSnapshot({
      status: "TEMP_CLOSE",
      statusColor: "red",
      closedUntil: "2026-03-08T14:49:00.000Z",
    });
    let currentSnapshot = staleSnapshot;
    mockFetchVendorOrdersDetail.mockImplementation(async () => {
      currentSnapshot = freshSnapshot;
      return {
        metrics: branchSnapshot().metrics,
        fetchedAt: "2026-03-06T10:05:00.000Z",
        unassignedOrders: [],
        preparingOrders: [],
      };
    });
    const getSnapshot = vi.fn(() => ({ branches: [currentSnapshot] }));
    const { branchDetailRoute } = await import("./branches.js");
    const engine: any = { getSnapshot };
    const req: any = { params: { id: "7" } };
    const res = createResponse();

    await branchDetailRoute(engine)(req, res);

    expect(getSnapshot).toHaveBeenCalledTimes(1);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({
      kind: "ok",
      branch: freshSnapshot,
      totals: freshSnapshot.metrics,
      fetchedAt: "2026-03-06T10:05:00.000Z",
      unassignedOrders: [],
      preparingOrders: [],
    });
  });

  it("returns detail_fetch_failed when a live snapshot exists but orders detail cannot be loaded", async () => {
    mockGetBranchById.mockReturnValue(branchMapping());
    mockFetchVendorOrdersDetail.mockRejectedValue(new Error("Orders API request failed"));
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
      unassignedOrders: [],
      preparingOrders: [],
      message: "Live orders detail is temporarily unavailable. Orders API request failed",
    });
  });

  it("returns snapshot_unavailable when both the live snapshot and orders detail are unavailable", async () => {
    mockGetBranchById.mockReturnValue(branchMapping());
    mockFetchVendorOrdersDetail.mockRejectedValue(new Error("Orders API request failed"));
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
      unassignedOrders: [],
      preparingOrders: [],
      message: "Live availability snapshot is currently unavailable, and orders detail could not be loaded. Orders API request failed",
    });
  });

  it("returns a paused snapshot message when the branch is excluded from monitor", async () => {
    mockGetBranchById.mockReturnValue(branchMapping({ enabled: false }));
    mockFetchVendorOrdersDetail.mockResolvedValue({
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
      message: "This branch is paused in monitor. Showing the latest Orders API response only.",
      branch: {
        branchId: 7,
        monitorEnabled: false,
        status: "UNKNOWN",
      },
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
