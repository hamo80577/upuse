import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockGetSettings,
  mockListBranches,
  mockGetRuntime,
  mockSetRuntime,
} = vi.hoisted(() => ({
  mockGetSettings: vi.fn(),
  mockListBranches: vi.fn(),
  mockGetRuntime: vi.fn(),
  mockSetRuntime: vi.fn(),
}));

vi.mock("./settingsStore.js", () => ({
  getSettings: mockGetSettings,
}));

vi.mock("./branchStore.js", () => ({
  listBranches: mockListBranches,
  getRuntime: mockGetRuntime,
  setRuntime: mockSetRuntime,
}));

vi.mock("./ordersClient.js", () => ({
  fetchOrdersAggregates: vi.fn(),
}));

vi.mock("./availabilityClient.js", () => ({
  fetchAvailabilities: vi.fn(),
  setAvailability: vi.fn(),
}));

vi.mock("./logger.js", () => ({
  log: vi.fn(),
}));

vi.mock("./actionReportStore.js", () => ({
  markCloseEventReopened: vi.fn(),
  recordMonitorCloseAction: vi.fn(),
}));

vi.mock("./monitorOrdersPolling.js", () => ({
  createOrdersPollingPlan: vi.fn(),
  createOrdersPollingRequests: vi.fn(),
  resolveOrdersGlobalEntityId: vi.fn((_branch: unknown, fallbackGlobalEntityId: string) => fallbackGlobalEntityId),
}));

vi.mock("./policyEngine.js", () => ({
  decide: vi.fn(() => ({ type: "NOOP" })),
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

describe("monitorEngine.getSnapshot", () => {
  beforeEach(() => {
    mockGetSettings.mockReset();
    mockListBranches.mockReset();
    mockGetRuntime.mockReset();
    mockSetRuntime.mockReset();
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
  });

  it("uses external close start timestamp for externally owned temporary closures", () => {
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
      lastExternalCloseAt: "2026-03-04T13:00:00.000Z",
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
    expect(branch.closeStartedAt).toBe("2026-03-04T13:00:00.000Z");
  });
});
