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
    mockResolveOrdersGlobalEntityId.mockImplementation((_branch: unknown, fallback: string) => fallback);
    mockGetSettings.mockReturnValue({
      ordersToken: "orders-token",
      globalEntityId: "HF_EG",
      chains: [{ name: "Chain A", lateThreshold: 5, unassignedThreshold: 5 }],
      lateThreshold: 5,
      unassignedThreshold: 5,
    });
  });

  it("returns 404 only when the persisted branch mapping is missing", async () => {
    mockGetBranchById.mockReturnValue(null);
    const { branchDetailRoute } = await import("./branches.js");
    const engine: any = {
      getSnapshot: () => ({ branches: [] }),
    };
    const req: any = { params: { id: "7" } };
    const res = createResponse();

    await branchDetailRoute(engine)(req, res);

    expect(res.statusCode).toBe(404);
    expect(res.body).toEqual({ ok: false, message: "Branch not found" });
  });

  it("returns a fallback payload when the branch exists but its live snapshot is unavailable", async () => {
    mockGetBranchById.mockReturnValue(branchMapping());
    const { branchDetailRoute } = await import("./branches.js");
    const engine: any = {
      getSnapshot: () => ({ branches: [] }),
    };
    const req: any = { params: { id: "7" } };
    const res = createResponse();

    await branchDetailRoute(engine)(req, res);

    expect(mockFetchVendorOrdersDetail).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({
      snapshotAvailable: false,
      branch: {
        branchId: 7,
        name: "Branch 1",
        chainName: "Chain A",
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
      message: "This branch exists, but its live snapshot is currently unavailable.",
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
      snapshotAvailable: true,
      branch: branchSnapshot(),
      totals: branchSnapshot().metrics,
      fetchedAt: "2026-03-06T10:05:00.000Z",
      unassignedOrders: [{ id: "1", externalId: "ORD-1", status: "UNASSIGNED", isUnassigned: true, isLate: false }],
      preparingOrders: [{ id: "2", externalId: "ORD-2", status: "PREPARING", isUnassigned: false, isLate: false }],
    });
  });

  it("uses the latest branch snapshot when the state changes while detail orders are loading", async () => {
    mockGetBranchById.mockReturnValue(branchMapping());
    mockFetchVendorOrdersDetail.mockResolvedValue({
      metrics: branchSnapshot().metrics,
      fetchedAt: "2026-03-06T10:05:00.000Z",
      unassignedOrders: [],
      preparingOrders: [],
    });
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
    const getSnapshot = vi.fn()
      .mockReturnValueOnce({ branches: [staleSnapshot] })
      .mockReturnValueOnce({ branches: [freshSnapshot] });
    const { branchDetailRoute } = await import("./branches.js");
    const engine: any = { getSnapshot };
    const req: any = { params: { id: "7" } };
    const res = createResponse();

    await branchDetailRoute(engine)(req, res);

    expect(getSnapshot).toHaveBeenCalledTimes(2);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({
      snapshotAvailable: true,
      branch: freshSnapshot,
      totals: freshSnapshot.metrics,
      fetchedAt: "2026-03-06T10:05:00.000Z",
      unassignedOrders: [],
      preparingOrders: [],
    });
  });

  it("returns snapshot fallback instead of 502 when live order detail cannot be loaded", async () => {
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
      snapshotAvailable: false,
      branch: branchSnapshot({ status: "TEMP_CLOSE", statusColor: "red" }),
      totals: branchSnapshot({ status: "TEMP_CLOSE", statusColor: "red" }).metrics,
      fetchedAt: null,
      unassignedOrders: [],
      preparingOrders: [],
      message: "Live orders detail is temporarily unavailable. Orders API request failed",
    });
  });
});
