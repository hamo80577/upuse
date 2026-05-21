import { describe, expect, it } from "vitest";
import type { BranchSnapshot } from "../../../api/types";
import { buildGroupedBranches, compareBranches, matchesPressureFilters, matchesSearchQuery, matchesStatusFilter } from "./dashboardGrouping";

function branch(overrides: Partial<BranchSnapshot>): BranchSnapshot {
  return {
    branchId: 1,
    name: "Branch A",
    chainName: "Chain One",
    monitorEnabled: true,
    ordersVendorId: 1001,
    availabilityVendorId: "2001",
    status: "OPEN" as const,
    statusColor: "green" as const,
    metrics: {
      totalToday: 100,
      cancelledToday: 0,
      doneToday: 90,
      activeNow: 10,
      lateNow: 1,
      unassignedNow: 2,
      readyNow: 0,
      onHoldNow: 0,
    },
    preparingNow: 8,
    preparingPickersNow: 4,
    ...overrides,
  };
}

describe("dashboardGrouping", () => {
  it("sorts by requested metric then pressure and name", () => {
    const branches = [
      branch({ branchId: 1, name: "B", metrics: { ...branch({}).metrics, totalToday: 20 } }),
      branch({ branchId: 2, name: "A", metrics: { ...branch({}).metrics, totalToday: 40 } }),
      branch({ branchId: 3, name: "C", metrics: { ...branch({}).metrics, totalToday: 40, lateNow: 5 } }),
    ];

    const sorted = [...branches].sort((a, b) => compareBranches(a, b, "total"));
    expect(sorted.map((item) => item.branchId)).toEqual([3, 2, 1]);
  });

  it("sorts by on-hold pressure before lower on-hold branches", () => {
    const branches = [
      branch({ branchId: 1, name: "A", metrics: { ...branch({}).metrics, onHoldNow: 1, totalToday: 20 } }),
      branch({ branchId: 2, name: "B", metrics: { ...branch({}).metrics, onHoldNow: 4, totalToday: 10 } }),
    ];

    const sorted = [...branches].sort((a, b) => compareBranches(a, b, "onHold"));
    expect(sorted.map((item) => item.branchId)).toEqual([2, 1]);
  });

  it("matches all selected pressure filters", () => {
    const item = branch({
      metrics: {
        ...branch({}).metrics,
        onHoldNow: 2,
        readyNow: 3,
        lateNow: 0,
      },
      preparingNow: 4,
    });

    expect(matchesPressureFilters(item, ["onHold", "ready", "inPrep"])).toBe(true);
    expect(matchesPressureFilters(item, ["onHold", "late"])).toBe(false);
  });

  it("applies status and search filters", () => {
    const item = branch({
      status: "TEMP_CLOSE",
      name: "Carrefour Alex",
      chainName: "Carrefour",
      ordersVendorId: 56742,
      availabilityVendorId: "612846",
    });

    expect(matchesStatusFilter(item, "tempClose")).toBe(true);
    expect(matchesStatusFilter(item, "open")).toBe(false);
    expect(matchesSearchQuery(item, "alex")).toBe(true);
    expect(matchesSearchQuery(item, "612846")).toBe(true);
    expect(matchesSearchQuery(item, "missing")).toBe(false);
  });

  it("groups by chain and keeps rank order", () => {
    const branches = [
      branch({ branchId: 1, chainName: "Chain A", name: "A1" }),
      branch({ branchId: 2, chainName: "Chain B", name: "B1" }),
      branch({ branchId: 3, chainName: "Chain A", name: "A2" }),
    ];

    const groups = buildGroupedBranches({
      branches,
      groupBy: "chain",
    });

    expect(groups).toHaveLength(2);
    expect(groups[0]?.label).toBe("Chain A");
    expect(groups[0]?.items.map((item) => item.rank)).toEqual([1, 2]);
  });
});
