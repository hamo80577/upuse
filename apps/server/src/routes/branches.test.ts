import { beforeEach, describe, expect, it, vi } from "vitest";
import { TEST_GLOBAL_ENTITY_ID, TEST_GLOBAL_ENTITY_ID_VARIANT } from "../../../../test/globalEntityId";

const {
  mockAddBranch,
  mockDeleteBranch,
  mockGetBranchById,
  mockGetResolvedBranchById,
  mockListBranches,
  mockListVendorCatalog,
  mockFindVendorCatalogItemsInCsv,
  mockLookupWarehouseVendorByAvailabilityId,
  mockSetBranchMonitoringEnabled,
  mockSetBranchThresholdOverrides,
  mockUpsertVendorCatalogItem,
  mockGetSettings,
  mockGetMirrorBranchDetail,
  mockGetMirrorBranchPickers,
  mockLog,
} = vi.hoisted(() => ({
  mockAddBranch: vi.fn(),
  mockDeleteBranch: vi.fn(),
  mockGetBranchById: vi.fn(),
  mockGetResolvedBranchById: vi.fn(),
  mockListBranches: vi.fn(),
  mockListVendorCatalog: vi.fn(),
  mockFindVendorCatalogItemsInCsv: vi.fn(),
  mockLookupWarehouseVendorByAvailabilityId: vi.fn(),
  mockSetBranchMonitoringEnabled: vi.fn(),
  mockSetBranchThresholdOverrides: vi.fn(),
  mockUpsertVendorCatalogItem: vi.fn(),
  mockGetSettings: vi.fn(),
  mockGetMirrorBranchDetail: vi.fn(),
  mockGetMirrorBranchPickers: vi.fn(),
  mockLog: vi.fn(),
}));

vi.mock("../services/branchStore.js", () => ({
  addBranch: mockAddBranch,
  deleteBranch: mockDeleteBranch,
  getBranchById: mockGetBranchById,
  getResolvedBranchById: mockGetResolvedBranchById,
  listBranches: mockListBranches,
  setBranchMonitoringEnabled: mockSetBranchMonitoringEnabled,
  setBranchThresholdOverrides: mockSetBranchThresholdOverrides,
}));

vi.mock("../services/vendorCatalogStore.js", () => ({
  findVendorCatalogItemsInCsv: mockFindVendorCatalogItemsInCsv,
  listVendorCatalog: mockListVendorCatalog,
  upsertVendorCatalogItem: mockUpsertVendorCatalogItem,
}));

vi.mock("../services/orders/index.js", () => ({
  lookupWarehouseVendorByAvailabilityId: mockLookupWarehouseVendorByAvailabilityId,
}));

vi.mock("../services/settingsStore.js", () => ({
  getSettings: mockGetSettings,
}));

vi.mock("../services/ordersMirrorStore.js", () => ({
  getMirrorBranchDetail: mockGetMirrorBranchDetail,
  getMirrorBranchPickers: mockGetMirrorBranchPickers,
}));

vi.mock("../services/logger.js", () => ({
  log: mockLog,
}));

import {
  addBranchRoute,
  branchDetailRoute,
  branchPickersRoute,
  deleteBranchRoute,
  listBranchesRoute,
  listVendorSourceRoute,
  resolveVendorSourceRoute,
  updateBranchMonitoringRoute,
  updateBranchThresholdOverridesRoute,
} from "./branches.js";

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

function adminRequest(params: Record<string, string>, extra?: Record<string, unknown>) {
  return {
    params,
    authUser: {
      id: 1,
      role: "admin",
      upuseAccess: true,
      assignedChains: [],
    },
    ...extra,
  };
}

function branchMapping(overrides?: Record<string, unknown>) {
  return {
    id: 7,
    name: "Branch 1",
    chainName: "Chain A",
    ordersVendorId: 111,
    availabilityVendorId: "222",
    enabled: true,
    catalogState: "available",
    lateThresholdOverride: null,
    lateReopenThresholdOverride: null,
    unassignedThresholdOverride: null,
    unassignedReopenThresholdOverride: null,
    readyThresholdOverride: null,
    readyReopenThresholdOverride: null,
    onHoldThresholdOverride: null,
    onHoldReopenThresholdOverride: null,
    capacityRuleEnabledOverride: null,
    capacityPerHourEnabledOverride: null,
    capacityPerHourLimitOverride: null,
    ...overrides,
  };
}

function resolvedBranch(overrides?: Record<string, unknown>) {
  return {
    ...branchMapping(),
    globalEntityId: TEST_GLOBAL_ENTITY_ID,
    catalogState: "available",
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
      lateReopenThreshold: 0,
      unassignedThreshold: 5,
      unassignedReopenThreshold: 0,
      readyThreshold: 0,
      readyReopenThreshold: 0,
      onHoldThreshold: 0,
      onHoldReopenThreshold: 0,
      capacityRuleEnabled: true,
      capacityPerHourEnabled: false,
      capacityPerHourLimit: null,
      source: "chain",
    },
    metrics: {
      totalToday: 6,
      cancelledToday: 1,
      doneToday: 2,
      activeNow: 3,
      lateNow: 0,
      unassignedNow: 1,
      readyNow: 0,
      onHoldNow: 0,
    },
    preparingNow: 1,
    preparingPickersNow: 1,
    lastUpdatedAt: "2026-03-06T10:00:00.000Z",
    ...overrides,
  };
}

function emptyPickers(overrides?: Record<string, unknown>) {
  return {
    todayCount: 0,
    activePreparingCount: 0,
    recentActiveCount: 0,
    items: [],
    ...overrides,
  };
}

describe("branches routes", () => {
  beforeEach(() => {
    mockAddBranch.mockReset();
    mockDeleteBranch.mockReset();
    mockGetBranchById.mockReset();
    mockGetResolvedBranchById.mockReset();
    mockListBranches.mockReset();
    mockListVendorCatalog.mockReset();
    mockFindVendorCatalogItemsInCsv.mockReset();
    mockLookupWarehouseVendorByAvailabilityId.mockReset();
    mockSetBranchMonitoringEnabled.mockReset();
    mockSetBranchThresholdOverrides.mockReset();
    mockUpsertVendorCatalogItem.mockReset();
    mockGetSettings.mockReset();
    mockGetMirrorBranchDetail.mockReset();
    mockGetMirrorBranchPickers.mockReset();
    mockLog.mockReset();

    mockGetSettings.mockReturnValue({
      globalEntityId: TEST_GLOBAL_ENTITY_ID,
      ordersToken: "orders-token",
      ordersRefreshSeconds: 30,
      chains: [{
        name: "Chain A",
        lateThreshold: 5,
        lateReopenThreshold: 0,
        unassignedThreshold: 5,
        unassignedReopenThreshold: 0,
        readyThreshold: 0,
        readyReopenThreshold: 0,
        onHoldThreshold: 0,
        onHoldReopenThreshold: 0,
        capacityRuleEnabled: true,
      }],
      lateThreshold: 5,
      lateReopenThreshold: 0,
      unassignedThreshold: 5,
      unassignedReopenThreshold: 0,
      readyThreshold: 0,
      readyReopenThreshold: 0,
      onHoldThreshold: 0,
      onHoldReopenThreshold: 0,
    });
    mockFindVendorCatalogItemsInCsv.mockReturnValue([]);
  });

  it("lists saved branches", () => {
    mockListBranches.mockReturnValue([branchMapping()]);
    const res = createResponse();

    listBranchesRoute({} as any, res);

    expect(res.body).toEqual({ items: [branchMapping()] });
  });

  it("lists local source catalog items", () => {
    mockListVendorCatalog.mockReturnValue([
      {
        availabilityVendorId: "740921",
        ordersVendorId: 48664,
        name: "Carrefour",
        alreadyAdded: false,
        branchId: null,
        chainName: null,
        enabled: null,
      },
    ]);
    const res = createResponse();

    listVendorSourceRoute({} as any, res);

    expect(res.body).toEqual({
      items: [
        {
          availabilityVendorId: "740921",
          ordersVendorId: 48664,
          name: "Carrefour",
          alreadyAdded: false,
          branchId: null,
          chainName: null,
          enabled: null,
        },
      ],
    });
  });

  it("resolves missing source catalog IDs through the Orders warehouses API", async () => {
    mockListVendorCatalog
      .mockReturnValueOnce([])
      .mockReturnValueOnce([])
      .mockReturnValueOnce([
        {
          availabilityVendorId: "709024",
          ordersVendorId: 23697,
          name: "Kheir Zaman",
          alreadyAdded: false,
          branchId: null,
          chainName: null,
          enabled: null,
        },
      ]);
    mockLookupWarehouseVendorByAvailabilityId.mockResolvedValue({
      availabilityVendorId: "709024",
      ordersVendorId: 23697,
      name: "Kheir Zaman",
      globalEntityId: TEST_GLOBAL_ENTITY_ID,
    });
    const res = createResponse();

    await resolveVendorSourceRoute({ body: { availabilityVendorIds: ["709024"] } } as any, res);

    expect(mockLookupWarehouseVendorByAvailabilityId).toHaveBeenCalledWith({
      token: "orders-token",
      globalEntityId: TEST_GLOBAL_ENTITY_ID,
      availabilityVendorId: "709024",
    });
    expect(mockUpsertVendorCatalogItem).toHaveBeenCalledWith({
      availabilityVendorId: "709024",
      ordersVendorId: 23697,
      name: "Kheir Zaman",
    });
    expect(res.body).toEqual({
      ok: true,
      items: [
        {
          availabilityVendorId: "709024",
          ordersVendorId: 23697,
          name: "Kheir Zaman",
          alreadyAdded: false,
          branchId: null,
          chainName: null,
          enabled: null,
        },
      ],
      notFoundAvailabilityVendorIds: [],
      resolveErrors: [],
    });
  });

  it("resolves missing source catalog IDs from vendors.csv before using live Orders lookup", async () => {
    mockListVendorCatalog
      .mockReturnValueOnce([])
      .mockReturnValueOnce([
        {
          availabilityVendorId: "718674",
          ordersVendorId: 33469,
          name: "Kheir Zaman, Kaabish K098",
          alreadyAdded: false,
          branchId: null,
          chainName: null,
          enabled: null,
        },
      ])
      .mockReturnValueOnce([
        {
          availabilityVendorId: "718674",
          ordersVendorId: 33469,
          name: "Kheir Zaman, Kaabish K098",
          alreadyAdded: false,
          branchId: null,
          chainName: null,
          enabled: null,
        },
      ]);
    mockFindVendorCatalogItemsInCsv.mockReturnValue([
      {
        availabilityVendorId: "718674",
        ordersVendorId: 33469,
        name: "Kheir Zaman, Kaabish K098",
      },
    ]);
    const res = createResponse();

    await resolveVendorSourceRoute({ body: { availabilityVendorIds: ["718674"] } } as any, res);

    expect(mockLookupWarehouseVendorByAvailabilityId).not.toHaveBeenCalled();
    expect(mockUpsertVendorCatalogItem).toHaveBeenCalledWith({
      availabilityVendorId: "718674",
      ordersVendorId: 33469,
      name: "Kheir Zaman, Kaabish K098",
    });
    expect(res.body).toEqual({
      ok: true,
      items: [
        {
          availabilityVendorId: "718674",
          ordersVendorId: 33469,
          name: "Kheir Zaman, Kaabish K098",
          alreadyAdded: false,
          branchId: null,
          chainName: null,
          enabled: null,
        },
      ],
      notFoundAvailabilityVendorIds: [],
      resolveErrors: [],
    });
  });

  it("reports source IDs that are not found in local or live Orders data", async () => {
    mockListVendorCatalog.mockReturnValue([]);
    mockLookupWarehouseVendorByAvailabilityId.mockResolvedValue(null);
    const res = createResponse();

    await resolveVendorSourceRoute({ body: { availabilityVendorIds: ["999999"] } } as any, res);

    expect(res.body).toEqual({
      ok: true,
      items: [],
      notFoundAvailabilityVendorIds: ["999999"],
      resolveErrors: [],
    });
  });

  it("keeps partial local results when live Orders lookup is unauthorized", async () => {
    mockListVendorCatalog
      .mockReturnValueOnce([
        {
          availabilityVendorId: "718674",
          ordersVendorId: 33469,
          name: "Kheir Zaman, Kaabish K098",
          alreadyAdded: false,
          branchId: null,
          chainName: null,
          enabled: null,
        },
      ])
      .mockReturnValueOnce([
        {
          availabilityVendorId: "718674",
          ordersVendorId: 33469,
          name: "Kheir Zaman, Kaabish K098",
          alreadyAdded: false,
          branchId: null,
          chainName: null,
          enabled: null,
        },
      ])
      .mockReturnValueOnce([
        {
          availabilityVendorId: "718674",
          ordersVendorId: 33469,
          name: "Kheir Zaman, Kaabish K098",
          alreadyAdded: false,
          branchId: null,
          chainName: null,
          enabled: null,
        },
      ]);
    const unauthorizedError: any = new Error("Request failed with status code 401");
    unauthorizedError.status = 401;
    mockLookupWarehouseVendorByAvailabilityId.mockRejectedValue(unauthorizedError);
    const res = createResponse();

    await resolveVendorSourceRoute({ body: { availabilityVendorIds: ["718674", "999999"] } } as any, res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({
      ok: true,
      items: [
        {
          availabilityVendorId: "718674",
          ordersVendorId: 33469,
          name: "Kheir Zaman, Kaabish K098",
          alreadyAdded: false,
          branchId: null,
          chainName: null,
          enabled: null,
        },
      ],
      notFoundAvailabilityVendorIds: ["999999"],
      resolveErrors: [
        {
          availabilityVendorId: "999999",
          message: "Request failed with status code 401",
          status: 401,
        },
      ],
    });
  });

  it("adds a branch using only availabilityVendorId and chainName", () => {
    mockAddBranch.mockReturnValue(33);
    const req: any = {
      body: {
        availabilityVendorId: "740921",
        chainName: "Carrefour",
      },
    };
    const res = createResponse();

    addBranchRoute(req, res);

    expect(mockAddBranch).toHaveBeenCalledWith({
      availabilityVendorId: "740921",
      chainName: "Carrefour",
      enabled: true,
    });
    expect(res.body).toEqual({ ok: true, id: 33 });
  });

  it("returns 409 when the branch does not exist in local vendor catalog", () => {
    mockAddBranch.mockImplementation(() => {
      throw new Error("Vendor catalog item not found");
    });
    const req: any = {
      body: {
        availabilityVendorId: "999999",
        chainName: "",
      },
    };
    const res = createResponse();

    addBranchRoute(req, res);

    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.body).toEqual({
      ok: false,
      message: "This branch is not available in the local vendor catalog.",
    });
  });

  it("returns 409 + field for duplicate availabilityVendorId on add", () => {
    mockAddBranch.mockImplementation(() => {
      const error: any = new Error("SqliteError: UNIQUE constraint failed: branches.availabilityVendorId");
      error.code = "SQLITE_CONSTRAINT_UNIQUE";
      throw error;
    });
    const req: any = { body: { availabilityVendorId: "222", chainName: "" } };
    const res = createResponse();

    addBranchRoute(req, res);

    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.body).toEqual({
      ok: false,
      message: "Availability Vendor ID already exists",
      field: "availabilityVendorId",
    });
  });

  it("updates branch threshold overrides through the narrow endpoint", () => {
    mockGetBranchById.mockReturnValue(branchMapping());
    mockSetBranchThresholdOverrides.mockReturnValue(branchMapping({
      lateThresholdOverride: 7,
      lateReopenThresholdOverride: 3,
      unassignedThresholdOverride: 9,
      unassignedReopenThresholdOverride: 4,
      readyThresholdOverride: 4,
      readyReopenThresholdOverride: 1,
      onHoldThresholdOverride: 3,
      onHoldReopenThresholdOverride: 1,
      capacityRuleEnabledOverride: false,
      capacityPerHourEnabledOverride: true,
      capacityPerHourLimitOverride: 5,
    }));
    const req: any = {
      params: { id: "7" },
      body: {
        lateThresholdOverride: 7,
        lateReopenThresholdOverride: 3,
        unassignedThresholdOverride: 9,
        unassignedReopenThresholdOverride: 4,
        readyThresholdOverride: 4,
        readyReopenThresholdOverride: 1,
        onHoldThresholdOverride: 3,
        onHoldReopenThresholdOverride: 1,
        capacityRuleEnabledOverride: false,
        capacityPerHourEnabledOverride: true,
        capacityPerHourLimitOverride: 5,
      },
    };
    const res = createResponse();

    updateBranchThresholdOverridesRoute(req, res);

    expect(mockSetBranchThresholdOverrides).toHaveBeenCalledWith(7, {
      lateThresholdOverride: 7,
      lateReopenThresholdOverride: 3,
      unassignedThresholdOverride: 9,
      unassignedReopenThresholdOverride: 4,
      readyThresholdOverride: 4,
      readyReopenThresholdOverride: 1,
      onHoldThresholdOverride: 3,
      onHoldReopenThresholdOverride: 1,
      capacityRuleEnabledOverride: false,
      capacityPerHourEnabledOverride: true,
      capacityPerHourLimitOverride: 5,
    });
    expect(res.body).toEqual({
      ok: true,
      item: branchMapping({
        lateThresholdOverride: 7,
        lateReopenThresholdOverride: 3,
        unassignedThresholdOverride: 9,
        unassignedReopenThresholdOverride: 4,
        readyThresholdOverride: 4,
        readyReopenThresholdOverride: 1,
        onHoldThresholdOverride: 3,
        onHoldReopenThresholdOverride: 1,
        capacityRuleEnabledOverride: false,
        capacityPerHourEnabledOverride: true,
        capacityPerHourLimitOverride: 5,
      }),
    });
  });

  it("rejects branch reopen overrides that exceed the effective close threshold", () => {
    mockGetBranchById.mockReturnValue(branchMapping());
    const req: any = {
      params: { id: "7" },
      body: {
        lateThresholdOverride: null,
        lateReopenThresholdOverride: 6,
        unassignedThresholdOverride: null,
        unassignedReopenThresholdOverride: null,
        readyThresholdOverride: null,
        readyReopenThresholdOverride: null,
        capacityRuleEnabledOverride: null,
        capacityPerHourEnabledOverride: null,
        capacityPerHourLimitOverride: null,
      },
    };
    const res = createResponse();

    updateBranchThresholdOverridesRoute(req, res);

    expect(mockSetBranchThresholdOverrides).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({
      ok: false,
      message: "Late reopen threshold cannot be greater than the close threshold.",
    });
  });

  it("rejects branch on-hold reopen overrides that exceed the effective close threshold", () => {
    mockGetBranchById.mockReturnValue(branchMapping());
    const req: any = {
      params: { id: "7" },
      body: {
        lateThresholdOverride: null,
        lateReopenThresholdOverride: null,
        unassignedThresholdOverride: null,
        unassignedReopenThresholdOverride: null,
        readyThresholdOverride: null,
        readyReopenThresholdOverride: null,
        onHoldThresholdOverride: 2,
        onHoldReopenThresholdOverride: 3,
        capacityRuleEnabledOverride: null,
        capacityPerHourEnabledOverride: null,
        capacityPerHourLimitOverride: null,
      },
    };
    const res = createResponse();

    updateBranchThresholdOverridesRoute(req, res);

    expect(mockSetBranchThresholdOverrides).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({
      ok: false,
      message: "On Hold reopen threshold cannot be greater than the close threshold.",
    });
  });

  it("returns branch_not_found when detail is requested for an unknown branch", async () => {
    mockGetBranchById.mockReturnValue(null);
    const res = createResponse();

    await branchDetailRoute({ getSnapshot: () => ({ branches: [] }) } as any)(adminRequest({ id: "7" }) as any, res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({
      kind: "branch_not_found",
      branchId: 7,
      message: "Branch not found",
    });
  });

  it("returns 409 for branch detail when catalog data is missing", async () => {
    mockGetBranchById.mockReturnValue(branchMapping({
      name: null,
      ordersVendorId: null,
      catalogState: "missing",
      enabled: false,
    }));
    mockGetResolvedBranchById.mockReturnValue(null);
    const res = createResponse();

    await branchDetailRoute({ getSnapshot: () => ({ branches: [] }) } as any)(adminRequest({ id: "7" }) as any, res);

    expect(res.statusCode).toBe(409);
    expect(res.body).toEqual({
      ok: false,
      branchId: 7,
      availabilityVendorId: "222",
      message: "Local vendor catalog data is unavailable for this branch.",
    });
  });

  it("returns live branch detail when snapshot and local cache are available", async () => {
    mockGetBranchById.mockReturnValue(branchMapping());
    mockGetResolvedBranchById.mockReturnValue(resolvedBranch({ globalEntityId: TEST_GLOBAL_ENTITY_ID_VARIANT }));
    mockGetMirrorBranchDetail.mockReturnValue({
      metrics: branchSnapshot().metrics,
      fetchedAt: "2026-03-06T10:05:00.000Z",
      unassignedOrders: [{ id: "1", externalId: "ORD-1", status: "UNASSIGNED", isUnassigned: true, isLate: false }],
      preparingOrders: [{ id: "2", externalId: "ORD-2", status: "PREPARING", isUnassigned: false, isLate: false }],
      readyToPickupOrders: [{ id: "3", externalId: "ORD-3", status: "READY_FOR_PICKUP", isUnassigned: false, isLate: false }],
      pickers: emptyPickers({ todayCount: 2, activePreparingCount: 1, recentActiveCount: 1 }),
      cacheState: "fresh",
    });
    const res = createResponse();

    await branchDetailRoute({ getSnapshot: () => ({ branches: [branchSnapshot()] }) } as any)(adminRequest({ id: "7" }) as any, res);

    expect(mockGetMirrorBranchDetail).toHaveBeenCalledWith({
      globalEntityId: TEST_GLOBAL_ENTITY_ID_VARIANT,
      vendorId: 111,
      ordersRefreshSeconds: 30,
      includePickerItems: true,
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
      readyToPickupOrders: [{ id: "3", externalId: "ORD-3", status: "READY_FOR_PICKUP", isUnassigned: false, isLate: false }],
      pickers: emptyPickers({ todayCount: 2, activePreparingCount: 1, recentActiveCount: 1 }),
    });
  });

  it("rejects tracker branch detail outside assigned UPuse chains", async () => {
    mockGetBranchById.mockReturnValue(branchMapping());
    mockGetResolvedBranchById.mockReturnValue(resolvedBranch());
    const res = createResponse();

    await branchDetailRoute({ getSnapshot: () => ({ branches: [branchSnapshot()] }) } as any)({
      params: { id: "7" },
      authUser: {
        id: 4,
        role: "tracker",
        upuseAccess: true,
        assignedChains: ["Chain B"],
      },
    } as any, res);

    expect(res.statusCode).toBe(403);
    expect(mockGetMirrorBranchDetail).not.toHaveBeenCalled();
    expect(res.body).toMatchObject({
      ok: false,
      code: "FORBIDDEN",
    });
  });

  it("returns 409 from branch pickers when catalog data is missing", async () => {
    mockGetBranchById.mockReturnValue(branchMapping({
      name: null,
      ordersVendorId: null,
      catalogState: "missing",
      enabled: false,
    }));
    mockGetResolvedBranchById.mockReturnValue(null);
    const res = createResponse();

    await branchPickersRoute()(adminRequest({ id: "7" }) as any, res);

    expect(res.statusCode).toBe(409);
    expect(res.body).toEqual({
      ok: false,
      branchId: 7,
      availabilityVendorId: "222",
      message: "Local vendor catalog data is unavailable for this branch.",
    });
  });

  it("derives snapshot-unavailable preparation counts from active minus ready orders", async () => {
    mockGetBranchById.mockReturnValue(branchMapping());
    mockGetResolvedBranchById.mockReturnValue(resolvedBranch({ globalEntityId: TEST_GLOBAL_ENTITY_ID_VARIANT }));
    mockGetMirrorBranchDetail.mockReturnValue({
      metrics: {
        ...branchSnapshot().metrics,
        activeNow: 4,
        readyNow: 1,
        unassignedNow: 1,
        onHoldNow: 1,
      },
      fetchedAt: "2026-03-06T10:05:00.000Z",
      onHoldOrders: [{ id: "4", externalId: "ORD-4", status: "ON_HOLD", isUnassigned: false, isLate: false }],
      unassignedOrders: [{ id: "1", externalId: "ORD-1", status: "UNASSIGNED", isUnassigned: true, isLate: false }],
      preparingOrders: [{ id: "2", externalId: "ORD-2", status: "PREPARING", isUnassigned: false, isLate: false }],
      readyToPickupOrders: [{ id: "3", externalId: "ORD-3", status: "READY_FOR_PICKUP", isUnassigned: false, isLate: false }],
      pickers: emptyPickers({ todayCount: 2, activePreparingCount: 1, recentActiveCount: 1 }),
      cacheState: "fresh",
    });
    const res = createResponse();

    await branchDetailRoute({ getSnapshot: () => ({ branches: [] }) } as any)(adminRequest({ id: "7" }) as any, res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({
      kind: "snapshot_unavailable",
      branch: expect.objectContaining({
        metrics: expect.objectContaining({
          activeNow: 4,
          readyNow: 1,
          onHoldNow: 1,
        }),
        preparingNow: 3,
      }),
      onHoldOrders: [{ id: "4", externalId: "ORD-4", status: "ON_HOLD", isUnassigned: false, isLate: false }],
      readyToPickupOrders: [{ id: "3", externalId: "ORD-3", status: "READY_FOR_PICKUP", isUnassigned: false, isLate: false }],
    });
  });

  it("returns 503 while the local picker cache is warming", async () => {
    mockGetBranchById.mockReturnValue(branchMapping());
    mockGetResolvedBranchById.mockReturnValue(resolvedBranch({ globalEntityId: TEST_GLOBAL_ENTITY_ID_VARIANT }));
    mockGetMirrorBranchPickers.mockReturnValue({
      cacheState: "warming",
      pickers: emptyPickers(),
    });
    const res = createResponse();

    await branchPickersRoute()(adminRequest({ id: "7" }) as any, res);

    expect(mockGetMirrorBranchPickers).toHaveBeenCalledWith({
      globalEntityId: TEST_GLOBAL_ENTITY_ID_VARIANT,
      vendorId: 111,
      ordersRefreshSeconds: 30,
    });
    expect(res.statusCode).toBe(503);
    expect(res.body).toEqual({
      ok: false,
      message: "Local picker cache is warming up",
    });
  });

  it("toggles monitor state for available branches", () => {
    mockGetBranchById.mockReturnValue(branchMapping());
    mockSetBranchMonitoringEnabled.mockReturnValue(branchMapping({ enabled: false }));
    const resetBranchTransientState = vi.fn();
    const req: any = { params: { id: "7" }, body: { enabled: false } };
    const res = createResponse();

    updateBranchMonitoringRoute({ resetBranchTransientState } as any)(req, res);

    expect(mockSetBranchMonitoringEnabled).toHaveBeenCalledWith(7, false);
    expect(resetBranchTransientState).toHaveBeenCalledWith(expect.objectContaining({ id: 7, enabled: false }));
    expect(mockLog).toHaveBeenCalledWith(7, "INFO", "Monitor paused for this branch. Live cycles will skip it until re-enabled.");
    expect(res.body).toEqual({
      ok: true,
      item: branchMapping({ enabled: false }),
    });
  });

  it("refuses enabling monitor for branches missing from local catalog", () => {
    mockGetBranchById.mockReturnValue(branchMapping({
      name: null,
      ordersVendorId: null,
      catalogState: "missing",
      enabled: false,
    }));
    const req: any = { params: { id: "7" }, body: { enabled: true } };
    const res = createResponse();

    updateBranchMonitoringRoute({ resetBranchTransientState: vi.fn() } as any)(req, res);

    expect(mockSetBranchMonitoringEnabled).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(409);
    expect(res.body).toEqual({
      ok: false,
      message: "Cannot enable monitor for a branch missing from the local vendor catalog.",
    });
  });

  it("deletes branches through the narrow delete route", () => {
    mockDeleteBranch.mockReturnValue(1);
    const res = createResponse();

    deleteBranchRoute({ params: { id: "7" } } as any, res);

    expect(mockDeleteBranch).toHaveBeenCalledWith(7);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });
});
