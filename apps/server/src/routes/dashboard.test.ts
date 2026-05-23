import { describe, expect, it, vi } from "vitest";
import type { AppUser, DashboardSnapshot } from "../types/models.js";
import { dashboardRoute } from "./dashboard.js";

function createResponse() {
  const res: any = {
    body: undefined as unknown,
    json: vi.fn((body: unknown) => {
      res.body = body;
      return res;
    }),
  };
  return res;
}

function createUser(overrides?: Partial<AppUser>): AppUser {
  return {
    id: 7,
    email: "tracker@example.com",
    name: "Tracker",
    role: "tracker",
    active: true,
    createdAt: "2026-03-10T12:00:00.000Z",
    upuseAccess: true,
    isPrimaryAdmin: false,
    assignedChains: ["Chain A"],
    ...overrides,
  };
}

function createSnapshot(): DashboardSnapshot {
  return {
    monitoring: {
      running: true,
      degraded: false,
      ordersSync: {
        mode: "mirror",
        state: "healthy",
        cadenceSeconds: 30,
        lastSuccessfulSyncAt: "2026-03-10T12:00:00.000Z",
        staleBranchCount: 1,
        consecutiveSourceFailures: 0,
      },
      availabilitySync: {
        state: "healthy",
        cadenceSeconds: 15,
        lastAttemptAt: "2026-03-10T12:00:00.000Z",
        lastSuccessfulSyncAt: "2026-03-10T12:00:00.000Z",
        consecutiveFailures: 0,
      },
    },
    totals: {
      branchesMonitored: 2,
      open: 1,
      tempClose: 1,
      closed: 0,
      unknown: 0,
      ordersToday: 15,
      cancelledToday: 2,
      doneToday: 8,
      activeNow: 5,
      lateNow: 2,
      unassignedNow: 2,
      onHoldNow: 1,
      upuseTempCloseToday: 7,
      upuseHighDemandToday: 5,
    },
    branches: [
      {
        branchId: 1,
        name: "Branch A",
        chainName: "Chain A",
        monitorEnabled: true,
        ordersVendorId: 101,
        availabilityVendorId: "201",
        status: "OPEN",
        statusColor: "green",
        metrics: {
          totalToday: 10,
          cancelledToday: 1,
          doneToday: 6,
          activeNow: 4,
          lateNow: 1,
          unassignedNow: 1,
          onHoldNow: 1,
        },
        operationsToday: {
          upuseTempClose: 2,
          upuseHighDemand: 1,
        },
        preparingNow: 3,
        preparingPickersNow: 2,
        ordersDataState: "fresh",
      },
      {
        branchId: 2,
        name: "Branch B",
        chainName: "Chain B",
        monitorEnabled: true,
        ordersVendorId: 102,
        availabilityVendorId: "202",
        status: "TEMP_CLOSE",
        statusColor: "orange",
        metrics: {
          totalToday: 5,
          cancelledToday: 1,
          doneToday: 2,
          activeNow: 1,
          lateNow: 1,
          unassignedNow: 1,
          onHoldNow: 0,
        },
        operationsToday: {
          upuseTempClose: 5,
          upuseHighDemand: 4,
        },
        preparingNow: 1,
        preparingPickersNow: 1,
        ordersDataState: "stale",
      },
    ],
  };
}

describe("dashboardRoute", () => {
  it("filters tracker snapshots to assigned chains and recomputes totals", () => {
    const engine = { getSnapshot: () => createSnapshot() };
    const req = { authUser: createUser({ assignedChains: [" chain a "] }) };
    const res = createResponse();

    dashboardRoute(engine as any)(req as any, res as any);

    expect(res.body.branches.map((branch: { chainName: string }) => branch.chainName)).toEqual(["Chain A"]);
    expect(res.body.totals).toMatchObject({
      branchesMonitored: 1,
      open: 1,
      tempClose: 0,
      ordersToday: 10,
      cancelledToday: 1,
      doneToday: 6,
      activeNow: 4,
      lateNow: 1,
      unassignedNow: 1,
      onHoldNow: 1,
      upuseTempCloseToday: 2,
      upuseHighDemandToday: 1,
    });
    expect(res.body.monitoring.ordersSync.staleBranchCount).toBe(0);
  });

  it("returns an empty dashboard snapshot for trackers without assigned chains", () => {
    const engine = { getSnapshot: () => createSnapshot() };
    const req = { authUser: createUser({ assignedChains: [] }) };
    const res = createResponse();

    dashboardRoute(engine as any)(req as any, res as any);

    expect(res.body.branches).toEqual([]);
    expect(res.body.totals).toMatchObject({
      branchesMonitored: 0,
      open: 0,
      tempClose: 0,
      ordersToday: 0,
      cancelledToday: 0,
      doneToday: 0,
      activeNow: 0,
      lateNow: 0,
      unassignedNow: 0,
      onHoldNow: 0,
      upuseTempCloseToday: 0,
      upuseHighDemandToday: 0,
    });
  });
});
