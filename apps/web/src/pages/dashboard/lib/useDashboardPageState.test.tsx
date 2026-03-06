import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DashboardSnapshot } from "../../../api/types";

const mockMonitorRefreshOrders = vi.hoisted(() => vi.fn());
const mockStartMonitoring = vi.hoisted(() => vi.fn());
const mockStopMonitoring = vi.hoisted(() => vi.fn());
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
      lastUpdatedAt: "2026-03-06T10:00:00.000Z",
    },
  ],
};

describe("useDashboardPageState", () => {
  const setSnap = vi.fn();

  beforeEach(() => {
    mockMonitorRefreshOrders.mockReset();
    mockStartMonitoring.mockReset();
    mockStopMonitoring.mockReset();
    mockUseDashboardLiveSync.mockReset();
    setSnap.mockReset();

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
      attemptSyncRecovery: vi.fn(),
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
});
