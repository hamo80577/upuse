import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DashboardSnapshot } from "../../api/types";

const mockApi = vi.hoisted(() => ({
  dashboard: vi.fn(),
  getSettings: vi.fn(),
  monitorStatus: vi.fn(),
  streamDashboard: vi.fn(),
}));

const mockApplyMonitoring = vi.hoisted(() => vi.fn());

vi.mock("../../api/client", () => ({
  api: mockApi,
  describeApiError: (error: unknown, fallback = "Request failed") => (error instanceof Error ? error.message : fallback),
}));

vi.mock("../../app/providers/MonitorStatusProvider", () => ({
  useMonitorStatus: () => ({
    applyMonitoring: mockApplyMonitoring,
  }),
}));

import { useDashboardLiveSync } from "./useDashboardLiveSync";

function createSnapshot(overrides?: Partial<DashboardSnapshot>): DashboardSnapshot {
  const nowIso = new Date(Date.now()).toISOString();

  return {
    monitoring: {
      running: true,
      lastOrdersFetchAt: nowIso,
      lastAvailabilityFetchAt: nowIso,
      lastHealthyAt: nowIso,
      degraded: false,
      errors: {},
      ...overrides?.monitoring,
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
      ...overrides?.totals,
    },
    branches: overrides?.branches ?? [],
  };
}

describe("useDashboardLiveSync", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-06T10:00:00.000Z"));
    mockApi.dashboard.mockReset();
    mockApi.getSettings.mockReset();
    mockApi.monitorStatus.mockReset();
    mockApi.streamDashboard.mockReset();
    mockApplyMonitoring.mockReset();
    mockApi.getSettings.mockResolvedValue({
      ordersRefreshSeconds: 30,
      availabilityRefreshSeconds: 30,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const flushEffects = async () => {
    await act(async () => {
      await Promise.resolve();
    });
  };

  it("applies snapshots from the live stream without polling the dashboard", async () => {
    const baseSnapshot = createSnapshot();
    mockApi.streamDashboard.mockImplementation(({ onOpen, onSnapshot }: any) => {
      onOpen?.();
      onSnapshot(baseSnapshot);
      return new Promise<void>(() => {});
    });

    const { result } = renderHook(() => useDashboardLiveSync());

    await flushEffects();

    expect(result.current.connectionState).toBe("live");
    expect(result.current.snap.monitoring.lastHealthyAt).toBe(baseSnapshot.monitoring.lastHealthyAt);

    expect(mockApi.dashboard).not.toHaveBeenCalled();
    expect(mockApplyMonitoring).toHaveBeenCalledWith(baseSnapshot.monitoring);
  });

  it("falls back to an empty snapshot when the stream payload is malformed", async () => {
    mockApi.streamDashboard.mockImplementation(({ onOpen, onSnapshot }: any) => {
      onOpen?.();
      onSnapshot(undefined);
      return new Promise<void>(() => {});
    });

    const { result } = renderHook(() => useDashboardLiveSync());

    await flushEffects();

    expect(result.current.connectionState).toBe("live");
    expect(result.current.snap).toEqual({
      monitoring: { running: false },
      totals: {
        branchesMonitored: 0,
        open: 0,
        tempClose: 0,
        closed: 0,
        unknown: 0,
        ordersToday: 0,
        cancelledToday: 0,
        doneToday: 0,
        activeNow: 0,
        lateNow: 0,
        unassignedNow: 0,
      },
      branches: [],
    });
    expect(mockApplyMonitoring).toHaveBeenCalledWith({ running: false });
  });

  it("switches to fallback polling when the stream closes", async () => {
    const baseSnapshot = createSnapshot();
    let closeStream!: () => void;
    mockApi.streamDashboard
      .mockImplementationOnce(({ onOpen, onSnapshot }: any) => {
        onOpen?.();
        onSnapshot(baseSnapshot);
        return new Promise<void>((resolve) => {
          closeStream = resolve;
        });
      })
      .mockImplementationOnce(() => new Promise<void>(() => {}));
    mockApi.dashboard.mockResolvedValue({
      ...baseSnapshot,
      monitoring: {
        ...baseSnapshot.monitoring,
        lastHealthyAt: "2026-03-06T10:15:00.000Z",
      },
    });

    const { result } = renderHook(() => useDashboardLiveSync());

    await flushEffects();

    expect(result.current.connectionState).toBe("live");

    await act(async () => {
      closeStream();
      await Promise.resolve();
    });

    expect(result.current.connectionState).toBe("fallback");

    await act(async () => {
      vi.advanceTimersByTime(1000);
      await Promise.resolve();
    });

    expect(mockApi.streamDashboard).toHaveBeenCalledTimes(2);

    await act(async () => {
      vi.advanceTimersByTime(15000);
      await Promise.resolve();
    });

    expect(mockApi.dashboard).toHaveBeenCalledTimes(1);
    expect(result.current.connectionState).toBe("fallback");
  });

  it("stops fallback polling once the stream reconnects", async () => {
    const baseSnapshot = createSnapshot();
    let closeStream!: () => void;
    mockApi.streamDashboard
      .mockImplementationOnce(({ onOpen, onSnapshot }: any) => {
        onOpen?.();
        onSnapshot(baseSnapshot);
        return new Promise<void>((resolve) => {
          closeStream = resolve;
        });
      })
      .mockImplementationOnce(({ onOpen, onSnapshot }: any) => {
        onOpen?.();
        onSnapshot({
          ...baseSnapshot,
          monitoring: {
            ...baseSnapshot.monitoring,
            lastHealthyAt: "2026-03-06T10:20:00.000Z",
          },
        });
        return new Promise<void>(() => {});
      });

    const { result } = renderHook(() => useDashboardLiveSync());

    await flushEffects();

    expect(result.current.connectionState).toBe("live");

    await act(async () => {
      closeStream();
      await Promise.resolve();
    });

    expect(result.current.connectionState).toBe("fallback");

    await act(async () => {
      vi.advanceTimersByTime(1000);
      await Promise.resolve();
    });

    expect(result.current.connectionState).toBe("live");

    await act(async () => {
      vi.advanceTimersByTime(30000);
      await Promise.resolve();
    });

    expect(mockApi.dashboard).not.toHaveBeenCalled();
  });
});
