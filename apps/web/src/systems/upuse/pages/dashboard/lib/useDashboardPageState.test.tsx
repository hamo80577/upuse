import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DashboardSnapshot } from "../../../api/types";

const mockMonitorRefreshOrders = vi.hoisted(() => vi.fn());
const mockStartMonitoring = vi.hoisted(() => vi.fn());
const mockStopMonitoring = vi.hoisted(() => vi.fn());
const mockAttemptSyncRecovery = vi.hoisted(() => vi.fn());
const mockUseDashboardLiveSync = vi.hoisted(() => vi.fn());

vi.mock("../../../api/client", () => ({
  api: {
    monitorRefreshOrders: mockMonitorRefreshOrders,
  },
  describeApiError: (error: unknown, fallback = "Request failed") => (error instanceof Error ? error.message : fallback),
}));

vi.mock("../../../app/providers/MonitorStatusProvider", () => ({
  useMonitorStatus: () => ({
    startMonitoring: mockStartMonitoring,
    stopMonitoring: mockStopMonitoring,
  }),
}));

vi.mock("../../../features/dashboard/useDashboardLiveSync", () => ({
  useDashboardLiveSync: mockUseDashboardLiveSync,
}));

import { useDashboardPageState } from "./useDashboardPageState";

const baseSnapshot: DashboardSnapshot = {
  monitoring: {
    running: true,
    lastOrdersFetchAt: "2026-03-06T10:00:00.000Z",
    lastAvailabilityFetchAt: "2026-03-06T10:00:00.000Z",
    lastHealthyAt: "2026-03-06T10:00:00.000Z",
    degraded: false,
    errors: {},
  },
  totals: {
    branchesMonitored: 1,
    open: 1,
    tempClose: 0,
    closed: 0,
    unknown: 0,
    ordersToday: 8,
    cancelledToday: 1,
    doneToday: 3,
    activeNow: 4,
    lateNow: 0,
    unassignedNow: 1,
  },
  branches: [
    {
      branchId: 7,
      name: "Branch A",
      chainName: "Chain A",
      monitorEnabled: true,
      ordersVendorId: 101,
      availabilityVendorId: "201",
      status: "OPEN",
      statusColor: "green",
      metrics: {
        totalToday: 8,
        cancelledToday: 1,
        doneToday: 3,
        activeNow: 4,
        lateNow: 0,
        unassignedNow: 1,
      },
      preparingNow: 3,
      preparingPickersNow: 2,
      lastUpdatedAt: "2026-03-06T10:00:00.000Z",
    },
  ],
};

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

describe("useDashboardPageState", () => {
  const setSnap = vi.fn();

  beforeEach(() => {
    mockMonitorRefreshOrders.mockReset();
    mockStartMonitoring.mockReset();
    mockStopMonitoring.mockReset();
    mockAttemptSyncRecovery.mockReset();
    mockUseDashboardLiveSync.mockReset();
    setSnap.mockReset();
    mockAttemptSyncRecovery.mockResolvedValue({ ok: true, manual: true, message: undefined });

    mockUseDashboardLiveSync.mockReturnValue({
      snap: baseSnapshot,
      setSnap,
      connectionState: "live",
      latestMonitoringUpdateAt: baseSnapshot.monitoring.lastHealthyAt,
      syncAgeMs: 0,
      staleThresholdMs: 60000,
      isSyncStale: false,
      syncRecovering: false,
      syncError: null,
      attemptSyncRecovery: mockAttemptSyncRecovery,
    });
  });

  it("uses the server start snapshot without firing duplicate refresh requests", async () => {
    mockStartMonitoring.mockResolvedValue({
      ok: true,
      running: true,
      snapshot: baseSnapshot,
    });

    const { result } = renderHook(() => useDashboardPageState());

    await act(async () => {
      await result.current.onStart();
    });

    expect(mockStartMonitoring).toHaveBeenCalledTimes(1);
    expect(setSnap).toHaveBeenCalledWith(baseSnapshot);
    expect(mockMonitorRefreshOrders).not.toHaveBeenCalled();
  });

  it("opens branch detail without triggering a global orders refresh", () => {
    const { result } = renderHook(() => useDashboardPageState());

    act(() => {
      result.current.openBranchDetail(7);
    });

    expect(result.current.detailBranchId).toBe(7);
    expect(mockMonitorRefreshOrders).not.toHaveBeenCalled();
  });

  it("uses the orders refresh snapshot directly without a duplicate recovery request", async () => {
    const refreshedSnapshot: DashboardSnapshot = {
      ...baseSnapshot,
      monitoring: {
        ...baseSnapshot.monitoring,
        lastOrdersFetchAt: "2026-03-06T10:05:00.000Z",
      },
    };
    mockMonitorRefreshOrders.mockResolvedValue({
      ok: true,
      running: true,
      inProgress: true,
      message: "Orders refresh started in background",
      snapshot: refreshedSnapshot,
    });

    const { result } = renderHook(() => useDashboardPageState());

    await act(async () => {
      result.current.onRefreshNowWithLoading();
    });

    await waitFor(() => {
      expect(setSnap).toHaveBeenCalledWith(refreshedSnapshot);
      expect(result.current.toast).toEqual({
        type: "success",
        msg: "Orders refresh started in background",
      });
    });

    expect(mockMonitorRefreshOrders).toHaveBeenCalledTimes(1);
    expect(mockAttemptSyncRecovery).not.toHaveBeenCalled();
  });

  it("falls back to sync recovery only when the orders refresh request fails", async () => {
    mockMonitorRefreshOrders.mockRejectedValue(new Error("Orders API down"));

    const { result } = renderHook(() => useDashboardPageState());

    await act(async () => {
      result.current.onRefreshNowWithLoading();
    });

    await waitFor(() => {
      expect(mockAttemptSyncRecovery).toHaveBeenCalledWith(true);
      expect(result.current.toast).toEqual({
        type: "error",
        msg: "Orders API down",
      });
    });
  });

  it("keeps the original refresh failure visible even if recovery also fails", async () => {
    mockMonitorRefreshOrders.mockRejectedValue(new Error("Orders API down"));
    mockAttemptSyncRecovery.mockRejectedValue(new Error("Recovery failed"));

    const { result } = renderHook(() => useDashboardPageState());

    await act(async () => {
      result.current.onRefreshNowWithLoading();
    });

    await waitFor(() => {
      expect(mockAttemptSyncRecovery).toHaveBeenCalledWith(true);
      expect(result.current.toast).toEqual({
        type: "error",
        msg: "Orders API down",
      });
    });
  });

  it("ignores stale refresh responses when a newer refresh finishes later", async () => {
    const firstRefresh = createDeferred<{
      ok: boolean;
      running: boolean;
      message?: string;
      snapshot: DashboardSnapshot;
    }>();
    const secondSnapshot: DashboardSnapshot = {
      ...baseSnapshot,
      monitoring: {
        ...baseSnapshot.monitoring,
        lastOrdersFetchAt: "2026-03-06T10:10:00.000Z",
      },
    };
    const secondRefresh = createDeferred<{
      ok: boolean;
      running: boolean;
      message?: string;
      snapshot: DashboardSnapshot;
    }>();

    mockMonitorRefreshOrders
      .mockImplementationOnce(() => firstRefresh.promise)
      .mockImplementationOnce(() => secondRefresh.promise);

    const { result } = renderHook(() => useDashboardPageState());

    act(() => {
      result.current.onRefreshNowWithLoading();
      result.current.onRefreshNowWithLoading();
    });

    await act(async () => {
      secondRefresh.resolve({
        ok: true,
        running: true,
        snapshot: secondSnapshot,
      });
      await secondRefresh.promise;
    });

    await waitFor(() => {
      expect(setSnap).toHaveBeenCalledTimes(1);
      expect(setSnap).toHaveBeenCalledWith(secondSnapshot);
    });

    await act(async () => {
      firstRefresh.resolve({
        ok: true,
        running: true,
        snapshot: baseSnapshot,
      });
      await firstRefresh.promise;
    });

    expect(setSnap).toHaveBeenCalledTimes(1);
    expect(setSnap).toHaveBeenLastCalledWith(secondSnapshot);
  });
});
