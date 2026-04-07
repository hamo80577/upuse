import { beforeEach, describe, expect, it, vi } from "vitest";
import { TEST_GLOBAL_ENTITY_ID, TEST_GLOBAL_ENTITY_ID_VARIANT } from "../../../../test/globalEntityId";

const {
  mockGetSettings,
  mockListBranches,
  mockListResolvedBranches,
  mockGetRuntime,
  mockSetRuntime,
  mockGetMirrorBranchDetail,
  mockGetCurrentHourPlacedCountByVendor,
  mockSyncOrdersMirror,
  mockFetchAvailabilities,
  mockSetAvailability,
  mockLog,
  mockRecordMonitorCloseAction,
  mockDecide,
} = vi.hoisted(() => ({
  mockGetSettings: vi.fn(),
  mockListBranches: vi.fn(),
  mockListResolvedBranches: vi.fn(),
  mockGetRuntime: vi.fn(),
  mockSetRuntime: vi.fn(),
  mockGetMirrorBranchDetail: vi.fn(),
  mockGetCurrentHourPlacedCountByVendor: vi.fn(() => new Map()),
  mockSyncOrdersMirror: vi.fn(),
  mockFetchAvailabilities: vi.fn(),
  mockSetAvailability: vi.fn(),
  mockLog: vi.fn(),
  mockRecordMonitorCloseAction: vi.fn(),
  mockDecide: vi.fn(() => ({ type: "NOOP" })),
}));

vi.mock("./settingsStore.js", () => ({
  getSettings: mockGetSettings,
}));

vi.mock("./branchStore.js", () => ({
  listBranches: mockListBranches,
  listResolvedBranches: mockListResolvedBranches,
  getRuntime: mockGetRuntime,
  setRuntime: mockSetRuntime,
}));

vi.mock("./ordersClient.js", () => ({
  fetchOrdersAggregates: vi.fn(),
}));

vi.mock("./availabilityClient.js", () => ({
  fetchAvailabilities: mockFetchAvailabilities,
  setAvailability: mockSetAvailability,
}));

vi.mock("./logger.js", () => ({
  log: mockLog,
}));

vi.mock("./actionReportStore.js", () => ({
  markCloseEventReopened: vi.fn(),
  recordMonitorCloseAction: mockRecordMonitorCloseAction,
}));

vi.mock("./monitorOrdersPolling.js", () => ({
  createOrdersPollingPlan: vi.fn(),
  createOrdersPollingRequests: vi.fn(),
}));

vi.mock("./ordersMirrorStore.js", () => ({
  getMirrorBranchDetail: mockGetMirrorBranchDetail,
  getCurrentHourPlacedCountByVendor: mockGetCurrentHourPlacedCountByVendor,
  syncOrdersMirror: mockSyncOrdersMirror,
}));

vi.mock("./policyEngine.js", () => ({
  decide: mockDecide,
}));

vi.mock("../utils/mutex.js", () => ({
  Mutex: class {
    async runExclusive<T>(fn: () => Promise<T> | T) {
      return await fn();
    }
  },
}));

vi.mock("../utils/time.js", () => ({
  nowUtcIso: vi.fn(() => "2026-03-04T12:45:30.000Z"),
}));

import { MonitorEngine } from "./monitorEngine.js";

describe("monitorEngine.getErrorDetail", () => {
  it("summarizes cloudflare html pages instead of returning raw markup", () => {
    const engine = new MonitorEngine() as any;

    const detail = engine.getErrorDetail({
      response: {
        status: 530,
        data: "<!doctype html><html><head><title>Cloudflare Tunnel error | upuse.org | Cloudflare</title></head><body>offline</body></html>",
      },
    });

    expect(detail).toEqual({
      statusCode: 530,
      detail: "Cloudflare tunnel error",
    });
  });

  it("extracts a compact title from generic html error pages", () => {
    const engine = new MonitorEngine() as any;

    const detail = engine.getErrorDetail({
      response: {
        status: 502,
        data: "<!doctype html><html><head><title>502 Bad Gateway</title></head><body>bad gateway</body></html>",
      },
    });

    expect(detail).toEqual({
      statusCode: 502,
      detail: "HTML error page: 502 Bad Gateway",
    });
  });
});

describe("monitorEngine.getSnapshot", () => {
  beforeEach(() => {
    mockGetSettings.mockReset();
    mockListBranches.mockReset();
    mockListResolvedBranches.mockReset();
    mockGetRuntime.mockReset();
    mockSetRuntime.mockReset();
    mockGetMirrorBranchDetail.mockReset();
    mockGetCurrentHourPlacedCountByVendor.mockReset();
    mockSyncOrdersMirror.mockReset();
    mockFetchAvailabilities.mockReset();
    mockSetAvailability.mockReset();
    mockLog.mockReset();
    mockRecordMonitorCloseAction.mockReset();
    mockDecide.mockReset();
    mockDecide.mockReturnValue({ type: "NOOP" });
    mockListResolvedBranches.mockImplementation((...args) => mockListBranches(...args));
    mockGetMirrorBranchDetail.mockReturnValue({
      metrics: {
        totalToday: 0,
        cancelledToday: 0,
        doneToday: 0,
        activeNow: 0,
        lateNow: 0,
        unassignedNow: 0,
        readyNow: 0,
      },
      fetchedAt: null,
      unassignedOrders: [],
      preparingOrders: [],
      pickers: {
        todayCount: 0,
        activePreparingCount: 0,
        recentActiveCount: 0,
        items: [],
      },
      cacheState: "warming",
    });
    mockGetCurrentHourPlacedCountByVendor.mockReturnValue(new Map());
    mockSyncOrdersMirror.mockResolvedValue({
      dayKey: "2026-03-04",
      totalVendors: 0,
      successfulVendors: 0,
      failedVendors: 0,
      updatedVendors: 0,
      staleVendorCount: 0,
      lastSuccessfulSyncAt: null,
      errors: [],
      statusesByVendor: new Map(),
    });
  });

  it("rebuilds missing monitor close metadata from the tracked closure window instead of stale lastActionAt", () => {
    mockGetSettings.mockReturnValue({
      ordersToken: "",
      availabilityToken: "",
      globalEntityId: TEST_GLOBAL_ENTITY_ID,
      chainNames: [],
      chains: [],
      lateThreshold: 4,
      unassignedThreshold: 5,
      tempCloseMinutes: 30,
      graceMinutes: 5,
      ordersRefreshSeconds: 30,
      availabilityRefreshSeconds: 30,
      maxVendorsPerOrdersRequest: 50,
    });

    mockListBranches.mockReturnValue([
      {
        id: 1,
        name: "Branch 1",
        chainName: "",
        ordersVendorId: 101,
        availabilityVendorId: "av-1",
        globalEntityId: TEST_GLOBAL_ENTITY_ID,
        enabled: true,
      },
    ]);

    mockGetRuntime.mockReturnValue({
      branchId: 1,
      lastUpuseCloseUntil: "2026-03-04T13:16:59.000Z",
      lastUpuseCloseReason: null,
      lastUpuseCloseAt: null,
      lastUpuseCloseEventId: 42,
      lastExternalCloseUntil: null,
      lastExternalCloseAt: null,
      externalOpenDetectedAt: null,
      lastActionAt: "2026-03-03T14:48:24.286Z",
    });

    const engine = new MonitorEngine() as any;
    engine.ordersFresh = true;
    engine.ordersByVendor = new Map([
      [
        101,
        {
          totalToday: 12,
          cancelledToday: 1,
          doneToday: 3,
          activeNow: 8,
          lateNow: 0,
          unassignedNow: 7,
        },
      ],
    ]);
    engine.preparationByVendor = new Map([
      [
        101,
        {
          preparingNow: 8,
          preparingPickersNow: 3,
          recentActivePickers: 3,
        },
      ],
    ]);
    engine.availabilityByVendor = new Map([
      [
        "av-1",
        {
          platformKey: "test",
          changeable: true,
          availabilityState: "CLOSED_UNTIL",
          platformRestaurantId: "av-1",
          globalEntityId: TEST_GLOBAL_ENTITY_ID,
          closedUntil: "2026-03-04T13:16:59.000Z",
          modifiedBy: "log_vendor_monitor",
        },
      ],
    ]);

    const branch = engine.getSnapshot().branches[0];

    expect(branch.status).toBe("TEMP_CLOSE");
    expect(branch.closureSource).toBe("UPUSE");
    expect(branch.closeReason).toBe("UNASSIGNED");
    expect(branch.closeStartedAt).toBe("2026-03-04T12:46:59.000Z");
    expect(branch.closeStartedAt).not.toBe("2026-03-03T14:48:24.286Z");
    expect(branch.thresholds).toEqual({
      lateThreshold: 4,
      lateReopenThreshold: 0,
      unassignedThreshold: 5,
      unassignedReopenThreshold: 0,
      readyThreshold: 0,
      readyReopenThreshold: 0,
      capacityRuleEnabled: true,
      capacityPerHourEnabled: false,
      capacityPerHourLimit: null,
      source: "global",
    });
  });

  it("infers capacity as the monitor close reason from the tracked window when runtime reason is missing", () => {
    mockGetSettings.mockReturnValue({
      ordersToken: "",
      availabilityToken: "",
      globalEntityId: TEST_GLOBAL_ENTITY_ID,
      chainNames: [],
      chains: [],
      lateThreshold: 4,
      unassignedThreshold: 5,
      tempCloseMinutes: 30,
      graceMinutes: 5,
      ordersRefreshSeconds: 30,
      availabilityRefreshSeconds: 30,
      maxVendorsPerOrdersRequest: 50,
    });

    mockListBranches.mockReturnValue([
      {
        id: 2,
        name: "Branch 2",
        chainName: "",
        ordersVendorId: 202,
        availabilityVendorId: "av-2",
        globalEntityId: TEST_GLOBAL_ENTITY_ID,
        enabled: true,
      },
    ]);

    mockGetRuntime.mockReturnValue({
      branchId: 2,
      lastUpuseCloseUntil: "2026-03-04T13:16:59.000Z",
      lastUpuseCloseReason: null,
      lastUpuseCloseAt: null,
      lastUpuseCloseEventId: 52,
      lastExternalCloseUntil: null,
      lastExternalCloseAt: null,
      externalOpenDetectedAt: null,
      lastActionAt: "2026-03-03T14:48:24.286Z",
    });

    const engine = new MonitorEngine() as any;
    engine.ordersFresh = true;
    engine.ordersByVendor = new Map([
      [
        202,
        {
          totalToday: 12,
          cancelledToday: 1,
          doneToday: 3,
          activeNow: 10,
          lateNow: 0,
          unassignedNow: 0,
        },
      ],
    ]);
    engine.preparationByVendor = new Map([
      [
        202,
        {
          preparingNow: 10,
          preparingPickersNow: 3,
          recentActivePickers: 3,
        },
      ],
    ]);
    engine.availabilityByVendor = new Map([
      [
        "av-2",
        {
          platformKey: "test",
          changeable: true,
          availabilityState: "CLOSED_UNTIL",
          platformRestaurantId: "av-2",
          globalEntityId: TEST_GLOBAL_ENTITY_ID,
          closedUntil: "2026-03-04T13:16:59.000Z",
          modifiedBy: "log_vendor_monitor",
        },
      ],
    ]);

    const branch = engine.getSnapshot().branches[0];

    expect(branch.closeReason).toBe("CAPACITY");
  });

  it("infers Capacity / Hour as the monitor close reason from the tracked window when the hourly limit is reached", () => {
    mockGetSettings.mockReturnValue({
      ordersToken: "",
      availabilityToken: "",
      globalEntityId: TEST_GLOBAL_ENTITY_ID,
      chainNames: ["Chain A"],
      chains: [{
        name: "Chain A",
        lateThreshold: 4,
        unassignedThreshold: 5,
        capacityRuleEnabled: true,
        capacityPerHourEnabled: true,
        capacityPerHourLimit: 5,
      }],
      lateThreshold: 4,
      unassignedThreshold: 5,
      tempCloseMinutes: 30,
      graceMinutes: 5,
      ordersRefreshSeconds: 30,
      availabilityRefreshSeconds: 30,
      maxVendorsPerOrdersRequest: 50,
    });

    mockListBranches.mockReturnValue([
      {
        id: 21,
        name: "Branch 21",
        chainName: "Chain A",
        ordersVendorId: 2121,
        availabilityVendorId: "av-21",
        globalEntityId: TEST_GLOBAL_ENTITY_ID,
        enabled: true,
      },
    ]);

    mockGetRuntime.mockReturnValue({
      branchId: 21,
      lastUpuseCloseUntil: "2026-03-04T13:16:59.000Z",
      lastUpuseCloseReason: null,
      lastUpuseCloseAt: null,
      lastUpuseCloseEventId: 63,
      lastExternalCloseUntil: null,
      lastExternalCloseAt: null,
      externalOpenDetectedAt: null,
      lastActionAt: "2026-03-03T14:48:24.286Z",
    });

    const engine = new MonitorEngine() as any;
    engine.ordersFresh = true;
    engine.ordersByVendor = new Map([
      [
        2121,
        {
          totalToday: 12,
          cancelledToday: 1,
          doneToday: 3,
          activeNow: 3,
          lateNow: 0,
          unassignedNow: 0,
        },
      ],
    ]);
    engine.preparationByVendor = new Map([
      [
        2121,
        {
          preparingNow: 3,
          preparingPickersNow: 3,
          recentActivePickers: 3,
        },
      ],
    ]);
    engine.currentHourPlacedByVendor = new Map([[2121, 5]]);
    engine.availabilityByVendor = new Map([
      [
        "av-21",
        {
          platformKey: "test",
          changeable: true,
          availabilityState: "CLOSED_UNTIL",
          platformRestaurantId: "av-21",
          globalEntityId: TEST_GLOBAL_ENTITY_ID,
          closedUntil: "2026-03-04T13:16:59.000Z",
          modifiedBy: "log_vendor_monitor",
        },
      ],
    ]);

    const branch = engine.getSnapshot().branches[0];

    expect(branch.closeReason).toBe("CAPACITY_HOUR");
    expect(branch.thresholds).toEqual({
      lateThreshold: 4,
      lateReopenThreshold: 0,
      unassignedThreshold: 5,
      unassignedReopenThreshold: 0,
      readyThreshold: 0,
      readyReopenThreshold: 0,
      capacityRuleEnabled: true,
      capacityPerHourEnabled: true,
      capacityPerHourLimit: 5,
      source: "chain",
    });
  });

  it("does not infer capacity when recent activity is unavailable", () => {
    mockGetSettings.mockReturnValue({
      ordersToken: "",
      availabilityToken: "",
      globalEntityId: TEST_GLOBAL_ENTITY_ID,
      chainNames: [],
      chains: [],
      lateThreshold: 4,
      unassignedThreshold: 5,
      tempCloseMinutes: 30,
      graceMinutes: 5,
      ordersRefreshSeconds: 30,
      availabilityRefreshSeconds: 30,
      maxVendorsPerOrdersRequest: 50,
    });

    mockListBranches.mockReturnValue([
      {
        id: 3,
        name: "Branch 3",
        chainName: "",
        ordersVendorId: 303,
        availabilityVendorId: "av-3",
        globalEntityId: TEST_GLOBAL_ENTITY_ID,
        enabled: true,
      },
    ]);

    mockGetRuntime.mockReturnValue({
      branchId: 3,
      lastUpuseCloseUntil: "2026-03-04T13:16:59.000Z",
      lastUpuseCloseReason: null,
      lastUpuseCloseAt: null,
      lastUpuseCloseEventId: 53,
      lastExternalCloseUntil: null,
      lastExternalCloseAt: null,
      externalOpenDetectedAt: null,
      lastActionAt: "2026-03-03T14:48:24.286Z",
    });

    const engine = new MonitorEngine() as any;
    engine.ordersFresh = true;
    engine.ordersByVendor = new Map([
      [
        303,
        {
          totalToday: 12,
          cancelledToday: 1,
          doneToday: 3,
          activeNow: 10,
          lateNow: 0,
          unassignedNow: 0,
        },
      ],
    ]);
    engine.preparationByVendor = new Map([
      [
        303,
        {
          preparingNow: 10,
          preparingPickersNow: 0,
          recentActivePickers: 0,
          recentActiveAvailable: false,
        },
      ],
    ]);
    engine.availabilityByVendor = new Map([
      [
        "av-3",
        {
          platformKey: "test",
          changeable: true,
          availabilityState: "CLOSED_UNTIL",
          platformRestaurantId: "av-3",
          globalEntityId: TEST_GLOBAL_ENTITY_ID,
          closedUntil: "2026-03-04T13:16:59.000Z",
          modifiedBy: "log_vendor_monitor",
        },
      ],
    ]);

    const branch = engine.getSnapshot().branches[0];

    expect(branch.closeReason).toBeUndefined();
  });

  it("does not infer capacity when the recent-active picker count is zero", () => {
    mockGetSettings.mockReturnValue({
      ordersToken: "",
      availabilityToken: "",
      globalEntityId: TEST_GLOBAL_ENTITY_ID,
      chainNames: [],
      chains: [],
      lateThreshold: 4,
      unassignedThreshold: 5,
      tempCloseMinutes: 30,
      graceMinutes: 5,
      ordersRefreshSeconds: 30,
      availabilityRefreshSeconds: 30,
      maxVendorsPerOrdersRequest: 50,
    });

    mockListBranches.mockReturnValue([
      {
        id: 31,
        name: "Branch 31",
        chainName: "",
        ordersVendorId: 3131,
        availabilityVendorId: "av-31",
        globalEntityId: TEST_GLOBAL_ENTITY_ID,
        enabled: true,
      },
    ]);

    mockGetRuntime.mockReturnValue({
      branchId: 31,
      lastUpuseCloseUntil: "2026-03-04T13:16:59.000Z",
      lastUpuseCloseReason: null,
      lastUpuseCloseAt: null,
      lastUpuseCloseEventId: 61,
      lastExternalCloseUntil: null,
      lastExternalCloseAt: null,
      externalOpenDetectedAt: null,
      lastActionAt: "2026-03-03T14:48:24.286Z",
    });

    const engine = new MonitorEngine() as any;
    engine.ordersFresh = true;
    engine.ordersByVendor = new Map([
      [
        3131,
        {
          totalToday: 12,
          cancelledToday: 1,
          doneToday: 3,
          activeNow: 10,
          lateNow: 0,
          unassignedNow: 0,
        },
      ],
    ]);
    engine.preparationByVendor = new Map([
      [
        3131,
        {
          preparingNow: 10,
          preparingPickersNow: 0,
          recentActivePickers: 0,
          recentActiveAvailable: true,
        },
      ],
    ]);
    engine.availabilityByVendor = new Map([
      [
        "av-31",
        {
          platformKey: "test",
          changeable: true,
          availabilityState: "CLOSED_UNTIL",
          platformRestaurantId: "av-31",
          globalEntityId: TEST_GLOBAL_ENTITY_ID,
          closedUntil: "2026-03-04T13:16:59.000Z",
          modifiedBy: "log_vendor_monitor",
        },
      ],
    ]);

    const branch = engine.getSnapshot().branches[0];

    expect(branch.closeReason).toBeUndefined();
  });

  it("does not infer capacity when the chain disables the capacity rule", () => {
    mockGetSettings.mockReturnValue({
      ordersToken: "",
      availabilityToken: "",
      globalEntityId: TEST_GLOBAL_ENTITY_ID,
      chainNames: ["Chain A"],
      chains: [{ name: "Chain A", lateThreshold: 4, unassignedThreshold: 5, capacityRuleEnabled: false }],
      lateThreshold: 4,
      unassignedThreshold: 5,
      tempCloseMinutes: 30,
      graceMinutes: 5,
      ordersRefreshSeconds: 30,
      availabilityRefreshSeconds: 30,
      maxVendorsPerOrdersRequest: 50,
    });

    mockListBranches.mockReturnValue([
      {
        id: 4,
        name: "Branch 4",
        chainName: "Chain A",
        ordersVendorId: 404,
        availabilityVendorId: "av-4",
        globalEntityId: TEST_GLOBAL_ENTITY_ID,
        enabled: true,
      },
    ]);

    mockGetRuntime.mockReturnValue({
      branchId: 4,
      lastUpuseCloseUntil: "2026-03-04T13:16:59.000Z",
      lastUpuseCloseReason: null,
      lastUpuseCloseAt: null,
      lastUpuseCloseEventId: 54,
      lastExternalCloseUntil: null,
      lastExternalCloseAt: null,
      externalOpenDetectedAt: null,
      lastActionAt: "2026-03-03T14:48:24.286Z",
    });

    const engine = new MonitorEngine() as any;
    engine.ordersFresh = true;
    engine.ordersByVendor = new Map([
      [
        404,
        {
          totalToday: 12,
          cancelledToday: 1,
          doneToday: 3,
          activeNow: 10,
          lateNow: 0,
          unassignedNow: 0,
        },
      ],
    ]);
    engine.preparationByVendor = new Map([
      [
        404,
        {
          preparingNow: 10,
          preparingPickersNow: 3,
          recentActivePickers: 3,
        },
      ],
    ]);
    engine.availabilityByVendor = new Map([
      [
        "av-4",
        {
          platformKey: "test",
          changeable: true,
          availabilityState: "CLOSED_UNTIL",
          platformRestaurantId: "av-4",
          globalEntityId: TEST_GLOBAL_ENTITY_ID,
          closedUntil: "2026-03-04T13:16:59.000Z",
          modifiedBy: "log_vendor_monitor",
        },
      ],
    ]);

    const branch = engine.getSnapshot().branches[0];

    expect(branch.closeReason).toBeUndefined();
    expect(branch.thresholds).toEqual({
      lateThreshold: 4,
      lateReopenThreshold: 0,
      unassignedThreshold: 5,
      unassignedReopenThreshold: 0,
      readyThreshold: 0,
      readyReopenThreshold: 0,
      capacityRuleEnabled: false,
      capacityPerHourEnabled: false,
      capacityPerHourLimit: null,
      source: "chain",
    });
  });

  it("infers ready to pickup as the monitor close reason from the tracked window when the ready threshold is reached", () => {
    mockGetSettings.mockReturnValue({
      ordersToken: "",
      availabilityToken: "",
      globalEntityId: TEST_GLOBAL_ENTITY_ID,
      chainNames: [],
      chains: [],
      lateThreshold: 4,
      unassignedThreshold: 5,
      readyThreshold: 3,
      tempCloseMinutes: 30,
      graceMinutes: 5,
      ordersRefreshSeconds: 30,
      availabilityRefreshSeconds: 30,
      maxVendorsPerOrdersRequest: 50,
    });

    mockListBranches.mockReturnValue([
      {
        id: 41,
        name: "Branch 41",
        chainName: "",
        ordersVendorId: 4141,
        availabilityVendorId: "av-41",
        globalEntityId: TEST_GLOBAL_ENTITY_ID,
        enabled: true,
      },
    ]);

    mockGetRuntime.mockReturnValue({
      branchId: 41,
      lastUpuseCloseUntil: "2026-03-04T13:16:59.000Z",
      lastUpuseCloseReason: null,
      lastUpuseCloseAt: null,
      lastUpuseCloseEventId: 71,
      lastExternalCloseUntil: null,
      lastExternalCloseAt: null,
      externalOpenDetectedAt: null,
      lastActionAt: "2026-03-03T14:48:24.286Z",
    });

    const engine = new MonitorEngine() as any;
    engine.ordersFresh = true;
    engine.ordersByVendor = new Map([
      [
        4141,
        {
          totalToday: 12,
          cancelledToday: 1,
          doneToday: 3,
          activeNow: 3,
          lateNow: 0,
          unassignedNow: 0,
          readyNow: 3,
        },
      ],
    ]);
    engine.preparationByVendor = new Map([
      [
        4141,
        {
          preparingNow: 3,
          preparingPickersNow: 1,
          recentActivePickers: 1,
          recentActiveAvailable: true,
        },
      ],
    ]);
    engine.availabilityByVendor = new Map([
      [
        "av-41",
        {
          platformKey: "test",
          changeable: true,
          availabilityState: "CLOSED_UNTIL",
          platformRestaurantId: "av-41",
          globalEntityId: TEST_GLOBAL_ENTITY_ID,
          closedUntil: "2026-03-04T13:16:59.000Z",
          modifiedBy: "log_vendor_monitor",
        },
      ],
    ]);

    const branch = engine.getSnapshot().branches[0];

    expect(branch.closeReason).toBe("READY_TO_PICKUP");
    expect(branch.thresholds).toEqual({
      lateThreshold: 4,
      lateReopenThreshold: 0,
      unassignedThreshold: 5,
      unassignedReopenThreshold: 0,
      readyThreshold: 3,
      readyReopenThreshold: 0,
      capacityRuleEnabled: true,
      capacityPerHourEnabled: false,
      capacityPerHourLimit: null,
      source: "global",
    });
  });

  it("includes current in-preparation order and picker counts in the branch snapshot", () => {
    mockGetSettings.mockReturnValue({
      ordersToken: "",
      availabilityToken: "",
      globalEntityId: TEST_GLOBAL_ENTITY_ID,
      chainNames: [],
      chains: [],
      lateThreshold: 4,
      unassignedThreshold: 5,
      tempCloseMinutes: 30,
      graceMinutes: 5,
      ordersRefreshSeconds: 30,
      availabilityRefreshSeconds: 30,
      maxVendorsPerOrdersRequest: 50,
    });

    mockListBranches.mockReturnValue([
      {
        id: 11,
        name: "Branch 11",
        chainName: "",
        ordersVendorId: 111,
        availabilityVendorId: "av-11",
        globalEntityId: TEST_GLOBAL_ENTITY_ID,
        enabled: true,
      },
    ]);

    mockGetRuntime.mockReturnValue(undefined);

    const engine = new MonitorEngine() as any;
    engine.ordersFresh = true;
    engine.ordersByVendor = new Map([
      [
        111,
        {
          totalToday: 15,
          cancelledToday: 2,
          doneToday: 6,
          activeNow: 7,
          lateNow: 1,
          unassignedNow: 2,
        },
      ],
    ]);
    engine.preparationByVendor = new Map([
      [
        111,
        {
          preparingNow: 5,
          preparingPickersNow: 3,
          recentActivePickers: 3,
        },
      ],
    ]);
    engine.availabilityByVendor = new Map([
      [
        "av-11",
        {
          platformKey: "test",
          changeable: true,
          availabilityState: "OPEN",
          platformRestaurantId: "av-11",
          globalEntityId: TEST_GLOBAL_ENTITY_ID,
        },
      ],
    ]);

    const branch = engine.getSnapshot().branches[0];

    expect(branch.preparingNow).toBe(5);
    expect(branch.preparingPickersNow).toBe(3);
  });

  it("keeps the last queue and picker counts visible when orders data is stale", () => {
    mockGetSettings.mockReturnValue({
      ordersToken: "",
      availabilityToken: "",
      globalEntityId: TEST_GLOBAL_ENTITY_ID,
      chainNames: [],
      chains: [],
      lateThreshold: 4,
      unassignedThreshold: 5,
      tempCloseMinutes: 30,
      graceMinutes: 5,
      ordersRefreshSeconds: 20,
      availabilityRefreshSeconds: 11,
      maxVendorsPerOrdersRequest: 50,
    });

    mockListBranches.mockReturnValue([
      {
        id: 11,
        name: "Branch 11",
        chainName: "",
        ordersVendorId: 111,
        availabilityVendorId: "av-11",
        globalEntityId: TEST_GLOBAL_ENTITY_ID,
        enabled: true,
      },
    ]);

    mockGetRuntime.mockReturnValue(undefined);

    const engine = new MonitorEngine() as any;
    engine.ordersFresh = false;
    engine.errors = {
      orders: {
        source: "orders",
        message: "Orders API request failed",
        at: "2026-03-04T12:45:30.000Z",
      },
    };
    engine.ordersByVendor = new Map([
      [
        111,
        {
          totalToday: 15,
          cancelledToday: 2,
          doneToday: 6,
          activeNow: 7,
          lateNow: 1,
          unassignedNow: 2,
        },
      ],
    ]);
    engine.preparationByVendor = new Map([
      [
        111,
        {
          preparingNow: 5,
          preparingPickersNow: 3,
          recentActivePickers: 3,
        },
      ],
    ]);
    engine.availabilityByVendor = new Map([
      [
        "av-11",
        {
          platformKey: "test",
          changeable: true,
          availabilityState: "OPEN",
          platformRestaurantId: "av-11",
          globalEntityId: TEST_GLOBAL_ENTITY_ID,
        },
      ],
    ]);
    engine.lastOrdersFetchAt = "2026-03-04T12:40:00.000Z";

    const branch = engine.getSnapshot().branches[0];

    expect(branch.metrics.activeNow).toBe(7);
    expect(branch.metrics.lateNow).toBe(1);
    expect(branch.metrics.unassignedNow).toBe(2);
    expect(branch.preparingNow).toBe(5);
    expect(branch.preparingPickersNow).toBe(3);
  });

  it("treats a temp close as external when the runtime cannot prove UPuse initiated it", () => {
    mockGetSettings.mockReturnValue({
      ordersToken: "",
      availabilityToken: "",
      globalEntityId: TEST_GLOBAL_ENTITY_ID,
      chainNames: [],
      chains: [],
      lateThreshold: 4,
      unassignedThreshold: 5,
      tempCloseMinutes: 30,
      graceMinutes: 5,
      ordersRefreshSeconds: 20,
      availabilityRefreshSeconds: 11,
      maxVendorsPerOrdersRequest: 50,
    });

    mockListBranches.mockReturnValue([
      {
        id: 3,
        name: "Branch 3",
        chainName: "",
        ordersVendorId: 303,
        availabilityVendorId: "av-3",
        globalEntityId: TEST_GLOBAL_ENTITY_ID,
        enabled: true,
      },
    ]);

    mockGetRuntime.mockReturnValue({
      branchId: 3,
      lastUpuseCloseUntil: "2026-03-08T13:54:53.000Z",
      lastUpuseCloseReason: null,
      lastUpuseCloseAt: "2026-03-08T13:17:19.000Z",
      lastUpuseCloseEventId: null,
      lastExternalCloseUntil: null,
      lastExternalCloseAt: null,
      externalOpenDetectedAt: null,
      lastActionAt: "2026-03-08T11:50:34.414Z",
    });

    const engine = new MonitorEngine() as any;
    engine.ordersFresh = true;
    engine.ordersByVendor = new Map([
      [
        303,
        {
          totalToday: 144,
          cancelledToday: 2,
          doneToday: 131,
          activeNow: 13,
          lateNow: 1,
          unassignedNow: 7,
        },
      ],
    ]);
    engine.availabilityByVendor = new Map([
      [
        "av-3",
        {
          platformKey: "test",
          changeable: true,
          availabilityState: "CLOSED_UNTIL",
          platformRestaurantId: "av-3",
          globalEntityId: TEST_GLOBAL_ENTITY_ID,
          closedUntil: "2026-03-08T13:54:53.000Z",
          closedReason: "TECHNICAL_PROBLEM",
          modifiedBy: "log_vendor_monitor",
        },
      ],
    ]);

    const branch = engine.getSnapshot().branches[0];

    expect(branch.status).toBe("TEMP_CLOSE");
    expect(branch.closureSource).toBe("EXTERNAL");
    expect(branch.closedByUpuse).toBe(false);
    expect(branch.closeReason).toBeUndefined();
    expect(branch.sourceClosedReason).toBe("TECHNICAL_PROBLEM");
  });

  it("derives external temporary-close start time from the first observed external close", () => {
    mockGetSettings.mockReturnValue({
      ordersToken: "",
      availabilityToken: "",
      globalEntityId: TEST_GLOBAL_ENTITY_ID,
      chainNames: [],
      chains: [],
      lateThreshold: 4,
      unassignedThreshold: 5,
      tempCloseMinutes: 30,
      graceMinutes: 5,
      ordersRefreshSeconds: 30,
      availabilityRefreshSeconds: 30,
      maxVendorsPerOrdersRequest: 50,
    });

    mockListBranches.mockReturnValue([
      {
        id: 2,
        name: "Branch 2",
        chainName: "",
        ordersVendorId: 202,
        availabilityVendorId: "av-2",
        globalEntityId: TEST_GLOBAL_ENTITY_ID,
        enabled: true,
      },
    ]);

    mockGetRuntime.mockReturnValue({
      branchId: 2,
      lastUpuseCloseUntil: null,
      lastUpuseCloseReason: null,
      lastUpuseCloseAt: null,
      lastExternalCloseUntil: "2026-03-04T13:30:00.000Z",
      lastExternalCloseAt: "2026-03-04T13:18:00.000Z",
      externalOpenDetectedAt: null,
      lastActionAt: null,
    });

    const engine = new MonitorEngine() as any;
    engine.ordersFresh = true;
    engine.ordersByVendor = new Map([
      [
        202,
        {
          totalToday: 6,
          cancelledToday: 1,
          doneToday: 2,
          activeNow: 3,
          lateNow: 0,
          unassignedNow: 1,
        },
      ],
    ]);
    engine.availabilityByVendor = new Map([
      [
        "av-2",
        {
          platformKey: "test",
          changeable: true,
          availabilityState: "CLOSED_UNTIL",
          platformRestaurantId: "av-2",
          globalEntityId: TEST_GLOBAL_ENTITY_ID,
          closedUntil: "2026-03-04T13:30:00.000Z",
          modifiedBy: "external_source",
        },
      ],
    ]);

    const branch = engine.getSnapshot().branches[0];

    expect(branch.status).toBe("TEMP_CLOSE");
    expect(branch.closureSource).toBe("EXTERNAL");
    expect(branch.closeStartedAt).toBe("2026-03-04T13:18:00.000Z");
    expect(branch.thresholds).toEqual({
      lateThreshold: 4,
      lateReopenThreshold: 0,
      unassignedThreshold: 5,
      unassignedReopenThreshold: 0,
      readyThreshold: 0,
      readyReopenThreshold: 0,
      capacityRuleEnabled: true,
      capacityPerHourEnabled: false,
      capacityPerHourLimit: null,
      source: "global",
    });
  });

  it("counts UNKNOWN availability records in snapshot totals", () => {
    mockGetSettings.mockReturnValue({
      ordersToken: "",
      availabilityToken: "",
      globalEntityId: TEST_GLOBAL_ENTITY_ID,
      chainNames: [],
      chains: [],
      lateThreshold: 4,
      unassignedThreshold: 5,
      tempCloseMinutes: 30,
      graceMinutes: 5,
      ordersRefreshSeconds: 30,
      availabilityRefreshSeconds: 30,
      maxVendorsPerOrdersRequest: 50,
    });

    mockListBranches.mockReturnValue([
      {
        id: 14,
        name: "Branch 14",
        chainName: "",
        ordersVendorId: 1414,
        availabilityVendorId: "av-14",
        globalEntityId: TEST_GLOBAL_ENTITY_ID,
        enabled: true,
      },
    ]);

    mockGetRuntime.mockReturnValue(undefined);

    const engine = new MonitorEngine() as any;
    engine.ordersFresh = true;
    engine.ordersByVendor = new Map([
      [
        1414,
        {
          totalToday: 4,
          cancelledToday: 0,
          doneToday: 2,
          activeNow: 1,
          lateNow: 0,
          unassignedNow: 0,
        },
      ],
    ]);
    engine.availabilityByVendor = new Map([
      [
        "av-14",
        {
          platformKey: "test",
          changeable: true,
          availabilityState: "UNKNOWN",
          platformRestaurantId: "av-14",
          globalEntityId: TEST_GLOBAL_ENTITY_ID,
        },
      ],
    ]);

    const snapshot = engine.getSnapshot();

    expect(snapshot.branches[0]?.status).toBe("UNKNOWN");
    expect(snapshot.totals.unknown).toBe(1);
  });
});

describe("monitorEngine.stop", () => {
  beforeEach(() => {
    mockGetSettings.mockReset();
    mockListBranches.mockReset();
    mockListResolvedBranches.mockReset();
    mockGetRuntime.mockReset();
    mockSetRuntime.mockReset();
    mockGetCurrentHourPlacedCountByVendor.mockReset();
    mockFetchAvailabilities.mockReset();
    mockSetAvailability.mockReset();
    mockLog.mockReset();
    mockRecordMonitorCloseAction.mockReset();
    mockDecide.mockReset();
    mockDecide.mockReturnValue({ type: "NOOP" });
    mockGetCurrentHourPlacedCountByVendor.mockReturnValue(new Map());
    mockListResolvedBranches.mockImplementation((...args) => mockListBranches(...args));
  });

  it("clears live monitor caches and timing state back to standby", () => {
    mockListBranches.mockReturnValue([]);

    const engine = new MonitorEngine() as any;
    engine.running = true;
    engine.ordersFresh = true;
    engine.degraded = true;
    engine.errors = {
      orders: {
        source: "orders",
        message: "Orders API request failed",
        at: "2026-03-07T00:00:00.000Z",
      },
    };
    engine.ordersByVendor = new Map([[101, {
      totalToday: 10,
      cancelledToday: 1,
      doneToday: 3,
      activeNow: 6,
      lateNow: 2,
      unassignedNow: 1,
    }]]);
    engine.preparationByVendor = new Map([[101, {
      preparingNow: 4,
      preparingPickersNow: 2,
      recentActivePickers: 2,
    }]]);
    engine.currentHourPlacedByVendor = new Map([[101, 5]]);
    engine.availabilityByVendor = new Map([["av-1", {
      platformKey: "test",
      changeable: true,
      availabilityState: "OPEN",
      platformRestaurantId: "av-1",
      globalEntityId: TEST_GLOBAL_ENTITY_ID,
    }]]);
    engine.lastOrdersFetchAt = "2026-03-07T01:00:00.000Z";
    engine.lastAvailabilityFetchAt = "2026-03-07T01:00:10.000Z";
    engine.lastHealthyAt = "2026-03-07T01:00:10.000Z";
    engine.ordersDataStateByVendor = new Map([[101, "fresh"]]);
    engine.ordersLastSyncedAtByVendor = new Map([[101, "2026-03-07T01:00:00.000Z"]]);
    engine.ordersLastSuccessfulSyncAt = "2026-03-07T01:00:00.000Z";
    engine.staleOrdersBranchCount = 1;
    engine.consecutiveOrdersSourceFailures = 2;

    engine.stop();

    expect(engine.isRunning()).toBe(false);
    expect(engine.ordersFresh).toBe(false);
    expect(engine.degraded).toBe(false);
    expect(engine.errors).toEqual({});
    expect(engine.ordersByVendor.size).toBe(0);
    expect(engine.preparationByVendor.size).toBe(0);
    expect(engine.currentHourPlacedByVendor.size).toBe(0);
    expect(engine.availabilityByVendor.size).toBe(0);
    expect(engine.lastOrdersFetchAt).toBeUndefined();
    expect(engine.lastAvailabilityFetchAt).toBeUndefined();
    expect(engine.lastHealthyAt).toBeUndefined();
    expect(engine.ordersDataStateByVendor.size).toBe(0);
    expect(engine.ordersLastSyncedAtByVendor.size).toBe(0);
    expect(engine.ordersLastSuccessfulSyncAt).toBeUndefined();
    expect(engine.staleOrdersBranchCount).toBe(0);
    expect(engine.consecutiveOrdersSourceFailures).toBe(0);
  });
});

describe("monitorEngine.reconcile", () => {
  beforeEach(() => {
    mockGetSettings.mockReset();
    mockListBranches.mockReset();
    mockListResolvedBranches.mockReset();
    mockGetRuntime.mockReset();
    mockSetRuntime.mockReset();
    mockGetCurrentHourPlacedCountByVendor.mockReset();
    mockFetchAvailabilities.mockReset();
    mockSetAvailability.mockReset();
    mockLog.mockReset();
    mockRecordMonitorCloseAction.mockReset();
    mockDecide.mockReset();
    mockDecide.mockReturnValue({ type: "NOOP" });
    mockGetCurrentHourPlacedCountByVendor.mockReturnValue(new Map());
    mockListResolvedBranches.mockImplementation((...args) => mockListBranches(...args));
  });

  it("uses the branch-configured global entity and refreshes availability at most once before and once after a multi-branch action batch", async () => {
    mockGetSettings.mockReturnValue({
      ordersToken: "",
      availabilityToken: "",
      globalEntityId: TEST_GLOBAL_ENTITY_ID_VARIANT,
      chainNames: [],
      chains: [],
      lateThreshold: 4,
      unassignedThreshold: 5,
      tempCloseMinutes: 30,
      graceMinutes: 5,
      ordersRefreshSeconds: 20,
      availabilityRefreshSeconds: 11,
      maxVendorsPerOrdersRequest: 50,
    });
    mockListBranches.mockReturnValue([
      {
        id: 8,
        name: "Branch 8",
        chainName: "",
        ordersVendorId: 808,
        availabilityVendorId: "av-8",
        globalEntityId: TEST_GLOBAL_ENTITY_ID_VARIANT,
        enabled: true,
      },
      {
        id: 9,
        name: "Branch 9",
        chainName: "",
        ordersVendorId: 909,
        availabilityVendorId: "av-9",
        globalEntityId: TEST_GLOBAL_ENTITY_ID_VARIANT,
        enabled: true,
      },
    ]);

    mockGetRuntime.mockReturnValue({
      lastUpuseCloseUntil: null,
      lastUpuseCloseReason: null,
      lastUpuseCloseAt: null,
      lastUpuseCloseEventId: null,
      lastExternalCloseUntil: null,
      lastExternalCloseAt: null,
      externalOpenDetectedAt: null,
      lastActionAt: null,
    });
    mockDecide.mockReturnValue({ type: "CLOSE", reason: "UNASSIGNED" });
    mockSetAvailability.mockResolvedValue({});
    mockFetchAvailabilities
      .mockResolvedValueOnce([
        {
          platformKey: "test",
          changeable: true,
          availabilityState: "OPEN",
          platformRestaurantId: "av-8",
          globalEntityId: TEST_GLOBAL_ENTITY_ID_VARIANT,
        },
        {
          platformKey: "test",
          changeable: true,
          availabilityState: "OPEN",
          platformRestaurantId: "av-9",
          globalEntityId: TEST_GLOBAL_ENTITY_ID_VARIANT,
        },
      ])
      .mockResolvedValueOnce([
        {
          platformKey: "test",
          changeable: true,
          availabilityState: "CLOSED_UNTIL",
          platformRestaurantId: "av-8",
          globalEntityId: TEST_GLOBAL_ENTITY_ID_VARIANT,
          closedUntil: "2026-03-08T14:49:00.000Z",
        },
        {
          platformKey: "test",
          changeable: true,
          availabilityState: "CLOSED_UNTIL",
          platformRestaurantId: "av-9",
          globalEntityId: TEST_GLOBAL_ENTITY_ID_VARIANT,
          closedUntil: "2026-03-08T14:49:00.000Z",
        },
      ]);
    mockRecordMonitorCloseAction.mockReturnValue(81);

    const engine = new MonitorEngine() as any;
    engine.running = true;
    engine.ordersFresh = true;
    engine.ordersDataStateByVendor = new Map([
      [808, "fresh"],
      [909, "fresh"],
    ]);
    engine.ordersByVendor = new Map([
      [808, { totalToday: 20, cancelledToday: 1, doneToday: 11, activeNow: 8, lateNow: 0, unassignedNow: 7 }],
      [909, { totalToday: 12, cancelledToday: 0, doneToday: 4, activeNow: 8, lateNow: 0, unassignedNow: 6 }],
    ]);
    engine.availabilityByVendor = new Map([
      ["av-8", { platformKey: "test", changeable: true, availabilityState: "OPEN", platformRestaurantId: "av-8", globalEntityId: TEST_GLOBAL_ENTITY_ID_VARIANT }],
      ["av-9", { platformKey: "test", changeable: true, availabilityState: "OPEN", platformRestaurantId: "av-9", globalEntityId: TEST_GLOBAL_ENTITY_ID_VARIANT }],
    ]);

    await engine.reconcile("orders");

    expect(mockFetchAvailabilities).toHaveBeenNthCalledWith(1, "", {
      expectedVendorIds: ["av-8", "av-9"],
    });
    expect(mockFetchAvailabilities).toHaveBeenNthCalledWith(2, "", {
      expectedVendorIds: ["av-8", "av-9"],
    });
    expect(mockSetAvailability).toHaveBeenNthCalledWith(1, expect.objectContaining({
      globalEntityId: TEST_GLOBAL_ENTITY_ID_VARIANT,
      availabilityVendorId: "av-8",
    }));
    expect(mockSetAvailability).toHaveBeenNthCalledWith(2, expect.objectContaining({
      globalEntityId: TEST_GLOBAL_ENTITY_ID_VARIANT,
      availabilityVendorId: "av-9",
    }));
    expect(mockFetchAvailabilities).toHaveBeenCalledTimes(2);
  });

  it("passes enabled branch availability ids when fetching the live availability snapshot", async () => {
    mockGetSettings.mockReturnValue({
      ordersToken: "",
      availabilityToken: "availability-token",
      globalEntityId: TEST_GLOBAL_ENTITY_ID,
      chainNames: [],
      chains: [],
      lateThreshold: 4,
      unassignedThreshold: 5,
      tempCloseMinutes: 30,
      graceMinutes: 5,
      ordersRefreshSeconds: 20,
      availabilityRefreshSeconds: 11,
      maxVendorsPerOrdersRequest: 50,
    });
    mockListBranches.mockReturnValue([
      {
        id: 1,
        name: "Branch 1",
        chainName: "",
        ordersVendorId: 101,
        availabilityVendorId: "av-1",
        globalEntityId: TEST_GLOBAL_ENTITY_ID,
        enabled: true,
      },
      {
        id: 2,
        name: "Branch 2",
        chainName: "",
        ordersVendorId: 202,
        availabilityVendorId: "av-2",
        globalEntityId: TEST_GLOBAL_ENTITY_ID,
        enabled: true,
      },
    ]);
    mockGetRuntime.mockReturnValue(undefined);
    mockFetchAvailabilities.mockResolvedValue([
      {
        platformKey: "test",
        changeable: true,
        availabilityState: "OPEN",
        platformRestaurantId: "av-1",
      },
      {
        platformKey: "test",
        changeable: false,
        availabilityState: "OPEN",
        platformRestaurantId: "av-2",
      },
    ]);

    const engine = new MonitorEngine() as any;
    engine.running = true;

    await engine.runAvailabilityCycle();

    expect(mockFetchAvailabilities).toHaveBeenCalledWith("availability-token", {
      expectedVendorIds: ["av-1", "av-2"],
    });
  });

  it("does not schedule overlapping orders cycles while a previous run is still in flight", async () => {
    vi.useFakeTimers();
    try {
      mockGetSettings.mockReturnValue({
        ordersToken: "",
        availabilityToken: "",
        globalEntityId: TEST_GLOBAL_ENTITY_ID,
        chainNames: [],
        chains: [],
        lateThreshold: 4,
        unassignedThreshold: 5,
        tempCloseMinutes: 30,
        graceMinutes: 5,
        ordersRefreshSeconds: 30,
        availabilityRefreshSeconds: 12,
        maxVendorsPerOrdersRequest: 50,
      });

      let resolveOrders: (() => void) | null = null;
      const engine = new MonitorEngine() as any;
      engine.running = true;
      engine.lifecycleId = 1;
      engine.runOrdersCycle = vi.fn(() => new Promise<void>((resolve) => {
        resolveOrders = resolve;
      }));
      engine.runAvailabilityCycle = vi.fn(async () => {});

      engine.schedule(true, 1);
      await vi.runOnlyPendingTimersAsync();

      expect(engine.runOrdersCycle).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(120_000);
      expect(engine.runOrdersCycle).toHaveBeenCalledTimes(1);

      resolveOrders?.();
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(30_000);
      expect(engine.runOrdersCycle).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("coalesces overlapping orders triggers into a single queued rerun", async () => {
    const resolvers: Array<() => void> = [];
    const engine = new MonitorEngine() as any;
    engine.running = true;
    engine.lifecycleId = 1;
    engine.runOrdersCycle = vi.fn(() => new Promise<void>((resolve) => {
      resolvers.push(resolve);
    }));

    const first = engine.requestScheduledCycle("orders", 1);
    const second = engine.requestScheduledCycle("orders", 1);
    const third = engine.requestScheduledCycle("orders", 1);

    await Promise.resolve();
    expect(engine.runOrdersCycle).toHaveBeenCalledTimes(1);

    resolvers.shift()?.();
    await first;
    await Promise.resolve();
    expect(engine.runOrdersCycle).toHaveBeenCalledTimes(2);

    engine.running = false;
    resolvers.shift()?.();
    await Promise.all([second, third]);
    expect(engine.runOrdersCycle).toHaveBeenCalledTimes(2);
  });

  it("keeps forceOrdersSync on a queued rerun when refresh arrives during an in-flight cycle", async () => {
    const resolvers: Array<() => void> = [];
    const engine = new MonitorEngine() as any;
    engine.running = true;
    engine.lifecycleId = 1;
    engine.runOrdersCycle = vi.fn((_options?: unknown, _expectedLifecycleId?: number) => new Promise<void>((resolve) => {
      resolvers.push(resolve);
    }));

    const first = engine.requestScheduledCycle("orders", 1);
    const second = engine.requestScheduledCycle("orders", 1, { forceOrdersSync: true });

    await Promise.resolve();
    expect(engine.runOrdersCycle).toHaveBeenNthCalledWith(1, undefined, 1);

    resolvers.shift()?.();
    await first;
    await Promise.resolve();

    expect(engine.runOrdersCycle).toHaveBeenNthCalledWith(2, { forceOrdersSync: true }, 1);

    engine.running = false;
    resolvers.shift()?.();
    await second;
  });

  it("does not reconstruct a UPuse runtime from modifiedBy alone", async () => {
    mockGetSettings.mockReturnValue({
      ordersToken: "",
      availabilityToken: "",
      globalEntityId: TEST_GLOBAL_ENTITY_ID,
      chainNames: [],
      chains: [],
      lateThreshold: 4,
      unassignedThreshold: 5,
      tempCloseMinutes: 30,
      graceMinutes: 5,
      ordersRefreshSeconds: 20,
      availabilityRefreshSeconds: 11,
      maxVendorsPerOrdersRequest: 50,
    });

    mockListBranches.mockReturnValue([
      {
        id: 5,
        name: "Branch 5",
        chainName: "",
        ordersVendorId: 505,
        availabilityVendorId: "av-5",
        globalEntityId: TEST_GLOBAL_ENTITY_ID,
        enabled: true,
      },
    ]);

    mockGetRuntime.mockReturnValue({
      branchId: 5,
      lastUpuseCloseUntil: null,
      lastUpuseCloseReason: null,
      lastUpuseCloseAt: null,
      lastUpuseCloseEventId: null,
      lastExternalCloseUntil: null,
      lastExternalCloseAt: null,
      externalOpenDetectedAt: null,
      lastActionAt: null,
    });

    const engine = new MonitorEngine() as any;
    engine.running = true;
    engine.ordersFresh = true;
    engine.ordersDataStateByVendor = new Map([[505, "fresh"]]);
    engine.ordersByVendor = new Map([
      [
        505,
        {
          totalToday: 18,
          cancelledToday: 1,
          doneToday: 9,
          activeNow: 8,
          lateNow: 0,
          unassignedNow: 7,
        },
      ],
    ]);
    engine.preparationByVendor = new Map([
      [
        505,
        {
          preparingNow: 8,
          preparingPickersNow: 4,
          recentActivePickers: 4,
        },
      ],
    ]);
    engine.availabilityByVendor = new Map([
      [
        "av-5",
        {
          platformKey: "test",
          changeable: true,
          availabilityState: "CLOSED_UNTIL",
          platformRestaurantId: "av-5",
          globalEntityId: TEST_GLOBAL_ENTITY_ID,
          closedUntil: "2026-03-08T13:54:53.000Z",
          modifiedBy: "log_vendor_monitor",
        },
      ],
    ]);

    await engine.reconcile("orders");

    expect(mockSetRuntime).not.toHaveBeenCalled();
  });

  it("switches an active tracked temp close to EXTERNAL when the source reports a different close window", () => {
    mockGetSettings.mockReturnValue({
      ordersToken: "",
      availabilityToken: "",
      globalEntityId: TEST_GLOBAL_ENTITY_ID,
      chainNames: [],
      chains: [],
      lateThreshold: 4,
      unassignedThreshold: 5,
      tempCloseMinutes: 30,
      graceMinutes: 5,
      ordersRefreshSeconds: 20,
      availabilityRefreshSeconds: 11,
      maxVendorsPerOrdersRequest: 50,
    });

    mockListBranches.mockReturnValue([
      {
        id: 7,
        name: "Branch 7",
        chainName: "",
        ordersVendorId: 707,
        availabilityVendorId: "av-7",
        globalEntityId: TEST_GLOBAL_ENTITY_ID,
        enabled: true,
      },
    ]);

    let runtime: any = {
      branchId: 7,
      lastUpuseCloseUntil: "2026-03-08T10:30:00.000Z",
      lastUpuseCloseReason: "UNASSIGNED",
      lastUpuseCloseAt: "2026-03-08T10:00:00.000Z",
      lastUpuseCloseEventId: 71,
      lastExternalCloseUntil: null,
      lastExternalCloseAt: null,
      closureOwner: "UPUSE",
      closureObservedUntil: "2026-03-08T10:30:00.000Z",
      closureObservedAt: "2026-03-08T10:00:00.000Z",
      externalOpenDetectedAt: null,
      lastActionAt: "2026-03-08T10:00:00.000Z",
    };
    mockGetRuntime.mockImplementation(() => runtime);
    mockSetRuntime.mockImplementation((_branchId: number, patch: Record<string, unknown>) => {
      runtime = { ...runtime, ...patch };
      return runtime;
    });

    const engine = new MonitorEngine() as any;
    engine.ordersFresh = true;
    engine.ordersByVendor = new Map([
      [
        707,
        {
          totalToday: 11,
          cancelledToday: 1,
          doneToday: 4,
          activeNow: 6,
          lateNow: 0,
          unassignedNow: 3,
        },
      ],
    ]);
    engine.availabilityByVendor = new Map([
      [
        "av-7",
        {
          platformKey: "test",
          changeable: true,
          availabilityState: "CLOSED_UNTIL",
          platformRestaurantId: "av-7",
          globalEntityId: TEST_GLOBAL_ENTITY_ID,
          closedUntil: "2026-03-08T13:30:00.000Z",
          modifiedBy: "external_source",
        },
      ],
    ]);

    engine.syncExternalClosureState("2026-03-08T10:20:00.000Z");

    expect(mockSetRuntime).toHaveBeenCalledWith(7, expect.objectContaining({
      closureOwner: "EXTERNAL",
      closureObservedUntil: "2026-03-08T13:30:00.000Z",
      lastExternalCloseUntil: "2026-03-08T13:30:00.000Z",
    }));
    expect(runtime.lastUpuseCloseUntil).toBe("2026-03-08T10:30:00.000Z");

    const branch = engine.getSnapshot().branches[0];
    expect(branch.closureSource).toBe("EXTERNAL");
    expect(branch.closedByUpuse).toBe(false);
  });

  it("does not log an unverified reopen time when the source has not confirmed the new close window yet", async () => {
    mockGetSettings.mockReturnValue({
      ordersToken: "",
      availabilityToken: "",
      globalEntityId: TEST_GLOBAL_ENTITY_ID,
      chainNames: [],
      chains: [],
      lateThreshold: 4,
      unassignedThreshold: 5,
      tempCloseMinutes: 30,
      graceMinutes: 5,
      ordersRefreshSeconds: 20,
      availabilityRefreshSeconds: 11,
      maxVendorsPerOrdersRequest: 50,
    });
    mockListBranches.mockReturnValue([
      {
        id: 8,
        name: "Branch 8",
        chainName: "",
        ordersVendorId: 808,
        availabilityVendorId: "av-8",
        globalEntityId: TEST_GLOBAL_ENTITY_ID,
        enabled: true,
      },
    ]);

    let runtime: any = {
      branchId: 8,
      lastUpuseCloseUntil: null,
      lastUpuseCloseReason: null,
      lastUpuseCloseAt: null,
      lastUpuseCloseEventId: null,
      lastExternalCloseUntil: null,
      lastExternalCloseAt: null,
      externalOpenDetectedAt: null,
      lastActionAt: null,
    };
    mockGetRuntime.mockImplementation(() => runtime);
    mockSetRuntime.mockImplementation((_branchId: number, patch: Record<string, unknown>) => {
      runtime = { ...runtime, ...patch };
      return runtime;
    });
    mockDecide.mockReturnValue({ type: "CLOSE", reason: "UNASSIGNED" });
    mockSetAvailability.mockResolvedValue({});
    mockFetchAvailabilities.mockResolvedValue([
      {
        platformKey: "test",
        changeable: true,
        availabilityState: "OPEN",
        platformRestaurantId: "av-8",
        globalEntityId: TEST_GLOBAL_ENTITY_ID,
      },
    ]);
    mockRecordMonitorCloseAction.mockReturnValue(81);

    const engine = new MonitorEngine() as any;
    engine.running = true;
    engine.ordersFresh = true;
    engine.ordersDataStateByVendor = new Map([[808, "fresh"]]);
    engine.ordersByVendor = new Map([
      [
        808,
        {
          totalToday: 20,
          cancelledToday: 1,
          doneToday: 11,
          activeNow: 8,
          lateNow: 0,
          unassignedNow: 7,
        },
      ],
    ]);
    engine.availabilityByVendor = new Map([
      [
        "av-8",
        {
          platformKey: "test",
          changeable: true,
          availabilityState: "OPEN",
          platformRestaurantId: "av-8",
          globalEntityId: TEST_GLOBAL_ENTITY_ID,
        },
      ],
    ]);

    await engine.reconcile("orders");

    expect(mockRecordMonitorCloseAction).toHaveBeenCalledWith(expect.objectContaining({
      note: undefined,
      closedUntil: "2026-03-04T13:15:30.000Z",
    }));
    expect(mockLog).toHaveBeenCalledWith(8, "INFO", "TEMP CLOSE — Unassigned=7");
  });

  it("logs capacity closures with active orders, cap, and picker counts", async () => {
    mockGetSettings.mockReturnValue({
      ordersToken: "",
      availabilityToken: "",
      globalEntityId: TEST_GLOBAL_ENTITY_ID,
      chainNames: [],
      chains: [],
      lateThreshold: 4,
      unassignedThreshold: 5,
      tempCloseMinutes: 30,
      graceMinutes: 5,
      ordersRefreshSeconds: 20,
      availabilityRefreshSeconds: 11,
      maxVendorsPerOrdersRequest: 50,
    });
    mockListBranches.mockReturnValue([
      {
        id: 10,
        name: "Branch 10",
        chainName: "",
        ordersVendorId: 1010,
        availabilityVendorId: "av-10",
        globalEntityId: TEST_GLOBAL_ENTITY_ID,
        enabled: true,
      },
    ]);
    mockGetRuntime.mockReturnValue({
      branchId: 10,
      lastUpuseCloseUntil: null,
      lastUpuseCloseReason: null,
      lastUpuseCloseAt: null,
      lastUpuseCloseEventId: null,
      lastExternalCloseUntil: null,
      lastExternalCloseAt: null,
      externalOpenDetectedAt: null,
      lastActionAt: null,
    });
    mockDecide.mockReturnValue({ type: "CLOSE", reason: "CAPACITY" });
    mockSetAvailability.mockResolvedValue({});
    mockFetchAvailabilities.mockResolvedValue([
      {
        platformKey: "test",
        changeable: true,
        availabilityState: "OPEN",
        platformRestaurantId: "av-10",
        globalEntityId: TEST_GLOBAL_ENTITY_ID,
      },
    ]);
    mockRecordMonitorCloseAction.mockReturnValue(91);

    const engine = new MonitorEngine() as any;
    engine.running = true;
    engine.ordersFresh = true;
    engine.ordersDataStateByVendor = new Map([[1010, "fresh"]]);
    engine.ordersByVendor = new Map([
      [
        1010,
        {
          totalToday: 20,
          cancelledToday: 1,
          doneToday: 11,
          activeNow: 10,
          lateNow: 0,
          unassignedNow: 0,
        },
      ],
    ]);
    engine.preparationByVendor = new Map([
      [
        1010,
        {
          preparingNow: 10,
          preparingPickersNow: 3,
          recentActivePickers: 3,
        },
      ],
    ]);
    engine.availabilityByVendor = new Map([
      [
        "av-10",
        {
          platformKey: "test",
          changeable: true,
          availabilityState: "OPEN",
          platformRestaurantId: "av-10",
          globalEntityId: TEST_GLOBAL_ENTITY_ID,
        },
      ],
    ]);

    await engine.reconcile("orders");

    expect(mockSetRuntime).toHaveBeenCalledWith(10, expect.objectContaining({
      lastUpuseCloseReason: "CAPACITY",
    }));
    expect(mockLog).toHaveBeenCalledWith(10, "INFO", "TEMP CLOSE — Capacity active=10 cap=9 recentActivePickers=3");
  });

  it("passes recent-active picker counts into policy decisions", async () => {
    mockGetSettings.mockReturnValue({
      ordersToken: "",
      availabilityToken: "",
      globalEntityId: TEST_GLOBAL_ENTITY_ID,
      chainNames: [],
      chains: [],
      lateThreshold: 4,
      unassignedThreshold: 5,
      tempCloseMinutes: 30,
      graceMinutes: 5,
      ordersRefreshSeconds: 20,
      availabilityRefreshSeconds: 11,
      maxVendorsPerOrdersRequest: 50,
    });
    mockListBranches.mockReturnValue([
      {
        id: 12,
        name: "Branch 12",
        chainName: "",
        ordersVendorId: 1212,
        availabilityVendorId: "av-12",
        globalEntityId: TEST_GLOBAL_ENTITY_ID,
        enabled: true,
      },
    ]);
    mockGetRuntime.mockReturnValue({
      branchId: 12,
      lastUpuseCloseUntil: null,
      lastUpuseCloseReason: null,
      lastUpuseCloseAt: null,
      lastUpuseCloseEventId: null,
      lastExternalCloseUntil: null,
      lastExternalCloseAt: null,
      externalOpenDetectedAt: null,
      lastActionAt: null,
    });
    mockDecide.mockReturnValue({ type: "NOOP" });

    const engine = new MonitorEngine() as any;
    engine.running = true;
    engine.ordersFresh = true;
    engine.ordersDataStateByVendor = new Map([[1212, "fresh"]]);
    engine.currentHourPlacedByVendor = new Map([[1212, 5]]);
    engine.ordersByVendor = new Map([
      [
        1212,
        {
          totalToday: 4,
          cancelledToday: 0,
          doneToday: 0,
          activeNow: 4,
          lateNow: 0,
          unassignedNow: 0,
        },
      ],
    ]);
    engine.preparationByVendor = new Map([
      [
        1212,
        {
          preparingNow: 4,
          preparingPickersNow: 2,
          recentActivePickers: 2,
        },
      ],
    ]);
    engine.availabilityByVendor = new Map([
      [
        "av-12",
        {
          platformKey: "test",
          changeable: true,
          availabilityState: "OPEN",
          platformRestaurantId: "av-12",
          globalEntityId: TEST_GLOBAL_ENTITY_ID,
        },
      ],
    ]);

    await engine.reconcile("orders");

    expect(mockDecide).toHaveBeenCalledWith(expect.objectContaining({
      currentHourPlacedCount: 5,
      recentActivePickers: 2,
      recentActiveAvailable: true,
    }));
  });

  it("clears stale tracked runtime when an external close replaces an old monitor window", () => {
    mockGetSettings.mockReturnValue({
      ordersToken: "",
      availabilityToken: "",
      globalEntityId: TEST_GLOBAL_ENTITY_ID,
      chainNames: [],
      chains: [],
      lateThreshold: 4,
      unassignedThreshold: 5,
      tempCloseMinutes: 30,
      graceMinutes: 5,
      ordersRefreshSeconds: 20,
      availabilityRefreshSeconds: 11,
      maxVendorsPerOrdersRequest: 50,
    });

    mockListBranches.mockReturnValue([
      {
        id: 6,
        name: "Branch 6",
        chainName: "",
        ordersVendorId: 606,
        availabilityVendorId: "av-6",
        globalEntityId: TEST_GLOBAL_ENTITY_ID,
        enabled: true,
      },
    ]);

    mockGetRuntime.mockReturnValue({
      branchId: 6,
      lastUpuseCloseUntil: "2026-03-07T10:30:00.000Z",
      lastUpuseCloseReason: "UNASSIGNED",
      lastUpuseCloseAt: "2026-03-07T10:00:00.000Z",
      lastUpuseCloseEventId: 55,
      lastExternalCloseUntil: null,
      lastExternalCloseAt: null,
      externalOpenDetectedAt: null,
      lastActionAt: "2026-03-07T10:00:00.000Z",
    });
    mockSetRuntime.mockImplementation((_branchId: number, patch: Record<string, unknown>) => ({
      branchId: 6,
      lastUpuseCloseUntil: null,
      lastUpuseCloseReason: null,
      lastUpuseCloseAt: null,
      lastUpuseCloseEventId: null,
      lastExternalCloseUntil: "2026-03-08T13:30:00.000Z",
      lastExternalCloseAt: "2026-03-08T13:18:00.000Z",
      externalOpenDetectedAt: null,
      lastActionAt: "2026-03-07T10:00:00.000Z",
      ...patch,
    }));

    const engine = new MonitorEngine() as any;
    engine.ordersByVendor = new Map([
      [
        606,
        {
          totalToday: 9,
          cancelledToday: 1,
          doneToday: 2,
          activeNow: 6,
          lateNow: 0,
          unassignedNow: 2,
        },
      ],
    ]);
    engine.availabilityByVendor = new Map([
      [
        "av-6",
        {
          platformKey: "test",
          changeable: true,
          availabilityState: "CLOSED_UNTIL",
          platformRestaurantId: "av-6",
          globalEntityId: TEST_GLOBAL_ENTITY_ID,
          closedUntil: "2026-03-08T13:30:00.000Z",
          modifiedBy: "external_source",
        },
      ],
    ]);

    engine.syncExternalClosureState("2026-03-08T13:18:00.000Z");

    expect(mockSetRuntime).toHaveBeenCalledWith(6, expect.objectContaining({
      lastExternalCloseUntil: "2026-03-08T13:30:00.000Z",
      lastExternalCloseAt: "2026-03-08T13:18:00.000Z",
      closureOwner: "EXTERNAL",
      closureObservedUntil: "2026-03-08T13:30:00.000Z",
      closureObservedAt: "2026-03-08T13:18:00.000Z",
      lastUpuseCloseUntil: null,
      lastUpuseCloseReason: null,
      lastUpuseCloseAt: null,
      lastUpuseCloseEventId: null,
    }));
  });
});
