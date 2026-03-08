import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockApi = vi.hoisted(() => ({
  branchDetail: vi.fn(),
  logs: vi.fn(),
  clearLogs: vi.fn(),
}));

vi.mock("../../api/client", () => ({
  api: mockApi,
}));

import { useBranchDetailState } from "./useBranchDetailState";

const unavailableDetail = {
  snapshotAvailable: false as const,
  branch: {
    branchId: 7,
    name: "Branch A",
    chainName: "Chain A",
    ordersVendorId: 101,
    availabilityVendorId: "201",
    status: "UNKNOWN" as const,
    statusColor: "grey" as const,
    thresholds: {
      lateThreshold: 5,
      unassignedThreshold: 5,
      source: "chain" as const,
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
};

describe("useBranchDetailState", () => {
  beforeEach(() => {
    mockApi.branchDetail.mockReset();
    mockApi.logs.mockReset();
    mockApi.clearLogs.mockReset();
    mockApi.branchDetail.mockResolvedValue(unavailableDetail);
    mockApi.logs.mockResolvedValue({
      dayKey: null,
      dayLabel: null,
      items: [],
      hasMore: false,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("treats a missing live snapshot as loaded detail instead of a hard error", async () => {
    const { result, unmount } = renderHook(() => useBranchDetailState({
      branchId: 7,
      branchSnapshot: null,
      open: true,
    }));

    await waitFor(() => {
      expect(result.current.detail?.snapshotAvailable).toBe(false);
    });

    expect(result.current.error).toBeNull();
    expect(result.current.loading).toBe(false);
    expect(result.current.detail).toEqual(unavailableDetail);

    unmount();
  });

  it("polls the latest log page while the branch detail dialog stays open", async () => {
    vi.useFakeTimers();
    mockApi.logs
      .mockResolvedValueOnce({
        dayKey: "2026-03-08",
        dayLabel: "Sun, 08 Mar 2026",
        items: [{ ts: "2026-03-08T12:00:00.000Z", level: "INFO", message: "OPEN — recovered to zero" }],
        hasMore: false,
      })
      .mockResolvedValue({
        dayKey: "2026-03-08",
        dayLabel: "Sun, 08 Mar 2026",
        items: [
          { ts: "2026-03-08T12:10:00.000Z", level: "INFO", message: "TEMP CLOSE — Unassigned=7 until 15:40" },
          { ts: "2026-03-08T12:00:00.000Z", level: "INFO", message: "OPEN — recovered to zero" },
        ],
        hasMore: false,
      });

    const { result } = renderHook(() => useBranchDetailState({
      branchId: 7,
      branchSnapshot: null,
      open: true,
    }));

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(mockApi.logs).toHaveBeenCalledTimes(1);

    await act(async () => {
      vi.advanceTimersByTime(10_000);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mockApi.logs).toHaveBeenCalledTimes(2);
    expect(result.current.logDays[0]?.items).toHaveLength(2);
  });
});
