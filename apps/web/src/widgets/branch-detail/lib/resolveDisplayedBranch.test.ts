import { describe, expect, it } from "vitest";
import type { BranchDetailSnapshot, BranchSnapshot } from "../../../api/types";
import { resolveDisplayedBranch } from "./resolveDisplayedBranch";

function createSnapshot(overrides: Partial<BranchSnapshot> = {}): BranchSnapshot {
  return {
    branchId: 20,
    name: "Carrefour, Silo - 15 May",
    chainName: "Carrefour",
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
    lastUpdatedAt: "2026-03-08T12:37:11.000Z",
    ...overrides,
  };
}

function createDetail(branch: BranchSnapshot): BranchDetailSnapshot {
  return {
    snapshotAvailable: true,
    branch,
    totals: branch.metrics,
    fetchedAt: "2026-03-08T12:37:12.000Z",
    unassignedOrders: [],
    preparingOrders: [],
  };
}

describe("resolveDisplayedBranch", () => {
  it("prefers the freshly loaded branch detail over an older dashboard snapshot", () => {
    const staleSnapshot = createSnapshot();
    const freshDetailBranch = createSnapshot({
      closedUntil: "2026-03-08T13:04:00.000Z",
      closeStartedAt: "2026-03-08T12:34:00.000Z",
      lastUpdatedAt: "2026-03-08T12:44:05.000Z",
    });

    const result = resolveDisplayedBranch(createDetail(freshDetailBranch), staleSnapshot);

    expect(result).toBe(freshDetailBranch);
    expect(result?.closedUntil).toBe("2026-03-08T13:04:00.000Z");
    expect(result?.closeStartedAt).toBe("2026-03-08T12:34:00.000Z");
  });

  it("falls back to the dashboard snapshot before detail finishes loading", () => {
    const snapshot = createSnapshot({ status: "OPEN", statusColor: "green", closedUntil: undefined, closeStartedAt: undefined });

    expect(resolveDisplayedBranch(null, snapshot)).toBe(snapshot);
  });
});
