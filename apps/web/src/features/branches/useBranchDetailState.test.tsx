import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BranchDetailResult, BranchSnapshot } from "../../api/types";

const mockApi = vi.hoisted(() => ({
  branchDetail: vi.fn(),
  branchPickers: vi.fn(),
  logs: vi.fn(),
  clearLogs: vi.fn(),
}));

vi.mock("../../api/client", () => ({
  api: mockApi,
}));

import { useBranchDetailState } from "./useBranchDetailState";

function createBranchSnapshot(overrides: Partial<BranchSnapshot> = {}): BranchSnapshot {
  return {
    branchId: 7,
    name: "Branch A",
    chainName: "Chain A",
    monitorEnabled: true,
    ordersVendorId: 101,
    availabilityVendorId: "201",
    status: "OPEN",
    statusColor: "green",
    thresholds: {
      lateThreshold: 5,
      unassignedThreshold: 5,
      source: "chain",
    },
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
    lastUpdatedAt: "2026-03-08T12:00:00.000Z",
    ...overrides,
  };
}

function createDetailResult(overrides: Partial<Extract<BranchDetailResult, { kind: "ok" }>> = {}): BranchDetailResult {
  const branch = overrides.branch ?? createBranchSnapshot();
  return {
    kind: "ok",
    branch,
    totals: branch.metrics,
    fetchedAt: "2026-03-08T12:01:00.000Z",
    cacheState: "fresh",
    unassignedOrders: [],
    preparingOrders: [],
    readyToPickupOrders: [],
    pickers: {
      todayCount: 0,
      activePreparingCount: 0,
      recentActiveCount: 0,
      items: [],
    },
    ...overrides,
  };
}

describe("useBranchDetailState", () => {
  const flushEffects = async () => {
    await Promise.resolve();
    await Promise.resolve();
  };

  beforeEach(() => {
    mockApi.branchDetail.mockReset();
    mockApi.branchPickers.mockReset();
    mockApi.logs.mockReset();
    mockApi.clearLogs.mockReset();
    mockApi.branchDetail.mockResolvedValue(createDetailResult());
    mockApi.branchPickers.mockResolvedValue({
      todayCount: 2,
      activePreparingCount: 1,
      recentActiveCount: 1,
      items: [],
    });
    mockApi.logs.mockResolvedValue({
      dayKey: "2026-03-08",
      dayLabel: "Sun, 08 Mar 2026",
      items: [],
      hasMore: false,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("fetches detail once on open, lazy-loads tabs on demand, and refreshes from snapshot changes instead of a timer", async () => {
    vi.useFakeTimers();

    const { result, rerender } = renderHook(
      (props: { loadPickers?: boolean; loadLogs?: boolean; branchSnapshot: BranchSnapshot }) => useBranchDetailState({
        branchId: 7,
        branchSnapshot: props.branchSnapshot,
        open: true,
        loadPickers: props.loadPickers,
        loadLogs: props.loadLogs,
      }),
      {
        initialProps: {
          loadPickers: false,
          loadLogs: false,
          branchSnapshot: createBranchSnapshot(),
        },
      },
    );

    await act(async () => {
      await flushEffects();
    });

    expect(result.current.detail?.kind).toBe("ok");
    expect(mockApi.branchDetail).toHaveBeenCalledTimes(1);
    expect(mockApi.branchPickers).not.toHaveBeenCalled();
    expect(mockApi.logs).not.toHaveBeenCalled();

    rerender({ loadPickers: true, loadLogs: false, branchSnapshot: createBranchSnapshot() });

    await act(async () => {
      await flushEffects();
    });

    expect(mockApi.branchPickers).toHaveBeenCalledTimes(1);
    expect(mockApi.logs).not.toHaveBeenCalled();

    rerender({ loadPickers: true, loadLogs: true, branchSnapshot: createBranchSnapshot() });

    await act(async () => {
      await flushEffects();
    });

    expect(mockApi.logs).toHaveBeenCalledTimes(1);

    await act(async () => {
      vi.advanceTimersByTime(10_000);
      await flushEffects();
    });

    expect(mockApi.branchDetail).toHaveBeenCalledTimes(1);
    expect(mockApi.branchPickers).toHaveBeenCalledTimes(1);
    expect(mockApi.logs).toHaveBeenCalledTimes(1);

    await act(async () => {
      vi.advanceTimersByTime(50_000);
      await flushEffects();
    });

    expect(mockApi.branchDetail).toHaveBeenCalledTimes(1);
    expect(mockApi.logs).toHaveBeenCalledTimes(1);

    rerender({
      loadPickers: true,
      loadLogs: true,
      branchSnapshot: createBranchSnapshot({
        lastUpdatedAt: "2026-03-08T12:05:00.000Z",
      }),
    });

    await act(async () => {
      await flushEffects();
    });

    expect(mockApi.branchDetail).toHaveBeenCalledTimes(2);
    expect(mockApi.branchPickers).toHaveBeenCalledTimes(2);
    expect(mockApi.logs).toHaveBeenCalledTimes(1);
  });

  it("manual refresh bypasses cache and refreshes detail plus the lazy-loaded tabs that were opened", async () => {
    vi.useFakeTimers();
    mockApi.branchDetail
      .mockResolvedValueOnce(createDetailResult({ fetchedAt: "2026-03-08T12:01:00.000Z" }))
      .mockResolvedValueOnce(createDetailResult({ fetchedAt: "2026-03-08T12:02:00.000Z" }));
    mockApi.branchPickers
      .mockResolvedValueOnce({
        todayCount: 2,
        activePreparingCount: 1,
        recentActiveCount: 1,
        items: [],
      })
      .mockResolvedValueOnce({
        todayCount: 3,
        activePreparingCount: 2,
        recentActiveCount: 1,
        items: [],
      });
    mockApi.logs
      .mockResolvedValueOnce({
        dayKey: "2026-03-08",
        dayLabel: "Sun, 08 Mar 2026",
        items: [{ ts: "2026-03-08T12:00:00.000Z", level: "INFO", message: "OPEN — recovered to zero" }],
        hasMore: false,
      })
      .mockResolvedValueOnce({
        dayKey: "2026-03-08",
        dayLabel: "Sun, 08 Mar 2026",
        items: [
          { ts: "2026-03-08T12:03:00.000Z", level: "INFO", message: "TEMP CLOSE — Unassigned=7 until 15:40" },
          { ts: "2026-03-08T12:00:00.000Z", level: "INFO", message: "OPEN — recovered to zero" },
        ],
        hasMore: false,
      });

    const { result } = renderHook(() => useBranchDetailState({
      branchId: 7,
      branchSnapshot: createBranchSnapshot(),
      open: true,
      loadPickers: true,
      loadLogs: true,
    }));

    await act(async () => {
      await flushEffects();
    });

    await act(async () => {
      result.current.refreshDetail();
      await flushEffects();
    });

    expect(mockApi.branchDetail).toHaveBeenCalledTimes(2);
    expect(mockApi.branchPickers).toHaveBeenCalledTimes(2);
    expect(mockApi.logs).toHaveBeenCalledTimes(2);
    expect(result.current.detail?.kind).toBe("ok");
    if (result.current.detail?.kind !== "ok") {
      throw new Error("expected an ok detail result");
    }
    expect(result.current.detail.fetchedAt).toBe("2026-03-08T12:02:00.000Z");
  });

  it("refreshes latest logs only when the branch status signature changes after the log tab has been opened", async () => {
    vi.useFakeTimers();
    const initialSnapshot = createBranchSnapshot();
    const { rerender } = renderHook(
      (props: { branchSnapshot: BranchSnapshot }) => useBranchDetailState({
        branchId: 7,
        branchSnapshot: props.branchSnapshot,
        open: true,
        loadLogs: true,
      }),
      {
        initialProps: {
          branchSnapshot: initialSnapshot,
        },
      },
    );

    await act(async () => {
      await flushEffects();
    });

    expect(mockApi.logs).toHaveBeenCalledTimes(1);
    rerender({
      branchSnapshot: createBranchSnapshot({
        metrics: {
          totalToday: 9,
          cancelledToday: 1,
          doneToday: 3,
          activeNow: 5,
          lateNow: 0,
          unassignedNow: 2,
        },
        lastUpdatedAt: "2026-03-08T12:05:00.000Z",
      }),
    });

    await act(async () => {
      await flushEffects();
    });

    expect(mockApi.logs).toHaveBeenCalledTimes(1);

    rerender({
      branchSnapshot: createBranchSnapshot({
        status: "TEMP_CLOSE",
        statusColor: "red",
        closedUntil: "2026-03-08T12:45:00.000Z",
        closeReason: "UNASSIGNED",
        closureSource: "UPUSE",
        closedByUpuse: true,
        autoReopen: true,
        lastUpdatedAt: "2026-03-08T12:06:00.000Z",
      }),
    });

    await act(async () => {
      await flushEffects();
    });

    expect(mockApi.logs).toHaveBeenCalledTimes(2);
  });

  it("treats snapshot_unavailable as a loaded non-fatal detail state", async () => {
    mockApi.branchDetail.mockResolvedValue({
      kind: "snapshot_unavailable",
      branch: createBranchSnapshot({
        status: "UNKNOWN",
        statusColor: "grey",
        metrics: {
          totalToday: 0,
          cancelledToday: 0,
          doneToday: 0,
          activeNow: 0,
          lateNow: 0,
          unassignedNow: 0,
        },
      }),
      totals: {
        totalToday: 0,
        cancelledToday: 0,
        doneToday: 0,
        activeNow: 0,
        lateNow: 0,
        unassignedNow: 0,
      },
      fetchedAt: null,
      cacheState: "warming",
      unassignedOrders: [],
      preparingOrders: [],
      readyToPickupOrders: [],
      pickers: {
        todayCount: 0,
        activePreparingCount: 0,
        recentActiveCount: 0,
        items: [],
      },
      message: "Live availability snapshot is currently unavailable, and orders detail could not be loaded.",
    } satisfies BranchDetailResult);

    const { result } = renderHook(() => useBranchDetailState({
      branchId: 7,
      branchSnapshot: null,
      open: true,
      loadLogs: false,
      loadPickers: false,
    }));

    await act(async () => {
      await flushEffects();
    });

    expect(result.current.detail?.kind).toBe("snapshot_unavailable");
    expect(result.current.error).toBeNull();
    expect(result.current.loading).toBe(false);
  });
});
