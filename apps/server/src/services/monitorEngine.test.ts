import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockGetSettings,
  mockListBranches,
  mockListResolvedBranches,
  mockGetRuntime,
  mockSetRuntime,
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
    mockFetchAvailabilities.mockReset();
    mockSetAvailability.mockReset();
    mockLog.mockReset();
    mockRecordMonitorCloseAction.mockReset();
    mockDecide.mockReset();
    mockDecide.mockReturnValue({ type: "NOOP" });
    mockListResolvedBranches.mockImplementation((...args) => mockListBranches(...args));
  });

  it("rebuilds missing monitor close metadata from the tracked closure window instead of stale lastActionAt", () => {
    mockGetSettings.mockReturnValue({
      ordersToken: "",
      availabilityToken: "",
      globalEntityId: "HF_EG",
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
        globalEntityId: "",
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
    engine.availabilityByVendor = new Map([
      [
        "av-1",
        {
          platformKey: "test",
          changeable: true,
          availabilityState: "CLOSED_UNTIL",
          platformRestaurantId: "av-1",
          globalEntityId: "HF_EG",
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
      unassignedThreshold: 5,
      source: "global",
    });
  });

  it("includes current in-preparation order and picker counts in the branch snapshot", () => {
    mockGetSettings.mockReturnValue({
      ordersToken: "",
      availabilityToken: "",
      globalEntityId: "HF_EG",
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
        globalEntityId: "",
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
          globalEntityId: "HF_EG",
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
      globalEntityId: "HF_EG",
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
        globalEntityId: "",
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
          globalEntityId: "HF_EG",
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
      globalEntityId: "HF_EG",
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
        globalEntityId: "",
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
          globalEntityId: "HF_EG",
          closedUntil: "2026-03-08T13:54:53.000Z",
          modifiedBy: "log_vendor_monitor",
        },
      ],
    ]);

    const branch = engine.getSnapshot().branches[0];

    expect(branch.status).toBe("TEMP_CLOSE");
    expect(branch.closureSource).toBe("EXTERNAL");
    expect(branch.closedByUpuse).toBe(false);
    expect(branch.closeReason).toBeUndefined();
  });

  it("derives external temporary-close start time from the first observed external close", () => {
    mockGetSettings.mockReturnValue({
      ordersToken: "",
      availabilityToken: "",
      globalEntityId: "HF_EG",
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
        globalEntityId: "",
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
          globalEntityId: "HF_EG",
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
      unassignedThreshold: 5,
      source: "global",
    });
  });
});

describe("monitorEngine.stop", () => {
  beforeEach(() => {
    mockGetSettings.mockReset();
    mockListBranches.mockReset();
    mockGetRuntime.mockReset();
    mockSetRuntime.mockReset();
    mockFetchAvailabilities.mockReset();
    mockSetAvailability.mockReset();
    mockLog.mockReset();
    mockRecordMonitorCloseAction.mockReset();
    mockDecide.mockReset();
    mockDecide.mockReturnValue({ type: "NOOP" });
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
    }]]);
    engine.availabilityByVendor = new Map([["av-1", {
      platformKey: "test",
      changeable: true,
      availabilityState: "OPEN",
      platformRestaurantId: "av-1",
      globalEntityId: "HF_EG",
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
    mockGetRuntime.mockReset();
    mockSetRuntime.mockReset();
    mockFetchAvailabilities.mockReset();
    mockSetAvailability.mockReset();
    mockLog.mockReset();
    mockRecordMonitorCloseAction.mockReset();
    mockDecide.mockReset();
    mockDecide.mockReturnValue({ type: "NOOP" });
  });

  it("does not reconstruct a UPuse runtime from modifiedBy alone", async () => {
    mockGetSettings.mockReturnValue({
      ordersToken: "",
      availabilityToken: "",
      globalEntityId: "HF_EG",
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
        globalEntityId: "",
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
    engine.availabilityByVendor = new Map([
      [
        "av-5",
        {
          platformKey: "test",
          changeable: true,
          availabilityState: "CLOSED_UNTIL",
          platformRestaurantId: "av-5",
          globalEntityId: "HF_EG",
          closedUntil: "2026-03-08T13:54:53.000Z",
          modifiedBy: "log_vendor_monitor",
        },
      ],
    ]);

    await engine.reconcile("orders");

    expect(mockSetRuntime).not.toHaveBeenCalled();
  });

  it("does not log an unverified reopen time when the source has not confirmed the new close window yet", async () => {
    mockGetSettings.mockReturnValue({
      ordersToken: "",
      availabilityToken: "",
      globalEntityId: "HF_EG",
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
        globalEntityId: "",
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
    mockSetAvailability.mockResolvedValue({
      closedUntil: "2026-03-08T14:49:00.000Z",
    });
    mockFetchAvailabilities.mockResolvedValue([
      {
        platformKey: "test",
        changeable: true,
        availabilityState: "OPEN",
        platformRestaurantId: "av-8",
        globalEntityId: "HF_EG",
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
          globalEntityId: "HF_EG",
        },
      ],
    ]);

    await engine.reconcile("orders");

    expect(mockRecordMonitorCloseAction).toHaveBeenCalledWith(expect.objectContaining({
      note: undefined,
      closedUntil: "2026-03-08T14:49:00.000Z",
    }));
    expect(mockLog).toHaveBeenCalledWith(8, "INFO", "TEMP CLOSE — Unassigned=7");
  });

  it("clears stale tracked runtime when an external close replaces an old monitor window", () => {
    mockGetSettings.mockReturnValue({
      ordersToken: "",
      availabilityToken: "",
      globalEntityId: "HF_EG",
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
        globalEntityId: "",
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
          globalEntityId: "HF_EG",
          closedUntil: "2026-03-08T13:30:00.000Z",
          modifiedBy: "external_source",
        },
      ],
    ]);

    engine.syncExternalClosureState("2026-03-08T13:18:00.000Z");

    expect(mockSetRuntime).toHaveBeenCalledWith(6, {
      lastExternalCloseUntil: "2026-03-08T13:30:00.000Z",
      lastExternalCloseAt: "2026-03-08T13:18:00.000Z",
      lastUpuseCloseUntil: null,
      lastUpuseCloseReason: null,
      lastUpuseCloseAt: null,
      lastUpuseCloseEventId: null,
    });
  });
});
