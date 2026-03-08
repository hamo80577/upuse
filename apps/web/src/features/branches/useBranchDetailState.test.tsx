import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

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
});
