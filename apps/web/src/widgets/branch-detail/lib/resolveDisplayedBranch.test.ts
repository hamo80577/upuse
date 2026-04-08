import { describe, expect, it } from "vitest";
import type { BranchDetailResult, BranchSnapshot } from "../../../api/types";
import { resolveDisplayedBranch } from "./resolveDisplayedBranch";

function createSnapshot(overrides: Partial<BranchSnapshot> = {}): BranchSnapshot {
  return {
    branchId: 20,
    name: "Carrefour, Silo - 15 May",
    chainName: "Carrefour",
    monitorEnabled: true,
    ordersVendorId: 54458,
    availabilityVendorId: "747593",
    status: "TEMP_CLOSE",
    statusColor: "red",
    closedUntil: "2026-03-08T12:51:00.000Z",
    closeStartedAt: "2026-03-08T12:21:00.000Z",
    closedByUpuse: true,
    closureSource: "UPUSE",
    closeReason: "UNASSIGNED",
    autoReopen: true,
    changeable: true,
    thresholds: {
      lateThreshold: 3,
      unassignedThreshold: 5,
      source: "chain",
    },
    metrics: {
      totalToday: 11,
      cancelledToday: 0,
      doneToday: 10,
      activeNow: 1,
      lateNow: 0,
      unassignedNow: 1,
    },
    preparingNow: 0,
    preparingPickersNow: 0,
    lastUpdatedAt: "2026-03-08T12:37:11.000Z",
    ...overrides,
  };
}

function createDetail(branch: BranchSnapshot): BranchDetailResult {
  return {
    kind: "ok",
    branch,
    totals: branch.metrics,
    fetchedAt: "2026-03-08T12:37:12.000Z",
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
  };
}

describe("resolveDisplayedBranch", () => {
  it("prefers the loaded detail when it is fresher than the dashboard snapshot", () => {
    const staleSnapshot = createSnapshot();
    const freshDetailBranch = createSnapshot({
      closedUntil: "2026-03-08T13:04:00.000Z",
      closeStartedAt: "2026-03-08T12:34:00.000Z",
      lastUpdatedAt: "2026-03-08T12:44:05.000Z",
    });

    const result = resolveDisplayedBranch(createDetail(freshDetailBranch), staleSnapshot);

    expect(result?.name).toBe("Carrefour, Silo - 15 May");
    expect(result?.closedUntil).toBe("2026-03-08T13:04:00.000Z");
    expect(result?.closeStartedAt).toBe("2026-03-08T12:34:00.000Z");
  });

  it("prefers newer live state from the dashboard snapshot while keeping stable detail identity", () => {
    const detailBranch = createSnapshot({
      name: "Loaded Detail Name",
      closedUntil: "2026-03-08T13:04:00.000Z",
      lastUpdatedAt: "2026-03-08T12:44:05.000Z",
    });
    const freshSnapshot = createSnapshot({
      name: "Dashboard Name",
      closedUntil: "2026-03-08T13:19:00.000Z",
      closeStartedAt: "2026-03-08T12:49:00.000Z",
      status: "TEMP_CLOSE",
      sourceClosedReason: "TECHNICAL_PROBLEM",
      lastUpdatedAt: "2026-03-08T12:50:00.000Z",
    });

    const result = resolveDisplayedBranch(createDetail(detailBranch), freshSnapshot);

    expect(result?.name).toBe("Loaded Detail Name");
    expect(result?.closedUntil).toBe("2026-03-08T13:19:00.000Z");
    expect(result?.closeStartedAt).toBe("2026-03-08T12:49:00.000Z");
    expect(result?.sourceClosedReason).toBe("TECHNICAL_PROBLEM");
  });

  it("returns null when the branch was deleted after the dialog opened", () => {
    const result = resolveDisplayedBranch({
      kind: "branch_not_found",
      branchId: 20,
      message: "Branch not found",
    }, createSnapshot());

    expect(result).toBeNull();
  });

  it("falls back to the dashboard snapshot before detail finishes loading", () => {
    const snapshot = createSnapshot({ status: "OPEN", statusColor: "green", closedUntil: undefined, closeStartedAt: undefined });

    expect(resolveDisplayedBranch(null, snapshot)).toBe(snapshot);
  });
});
