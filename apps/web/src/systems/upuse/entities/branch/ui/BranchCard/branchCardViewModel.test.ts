import { describe, expect, it } from "vitest";
import type { BranchSnapshot } from "../../../../api/types";
import { statusMeta } from "./branchCardViewModel";

function createBranch(overrides: Partial<BranchSnapshot> = {}): BranchSnapshot {
  return {
    branchId: 7,
    name: "Branch A",
    chainName: "Chain A",
    monitorEnabled: true,
    ordersVendorId: 101,
    availabilityVendorId: "201",
    status: "TEMP_CLOSE",
    statusColor: "red",
    closedByUpuse: false,
    closureSource: "EXTERNAL",
    changeable: true,
    metrics: {
      totalToday: 0,
      cancelledToday: 0,
      doneToday: 0,
      activeNow: 0,
      lateNow: 0,
      unassignedNow: 0,
    },
    preparingNow: 0,
    preparingPickersNow: 0,
    ...overrides,
  };
}

describe("branchCardViewModel.statusMeta", () => {
  it("shows the raw source reason for issues closures without falling back to slot wording", () => {
    const meta = statusMeta(createBranch({
      status: "CLOSED",
      availabilityKind: "sourceIssue",
      sourceClosedReason: "TECHNICAL_PROBLEM",
    }));

    expect(meta.label).toBe("Closed");
    expect(meta.note).toBe("TECHNICAL_PROBLEM");
  });
});
