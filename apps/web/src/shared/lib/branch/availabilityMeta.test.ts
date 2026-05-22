import { describe, expect, it } from "vitest";
import type { BranchSnapshot } from "../../../api/types";
import { availabilityNote, availabilitySubtypeChip } from "./availabilityMeta";

function branch(overrides: Partial<BranchSnapshot> = {}): BranchSnapshot {
  return {
    branchId: 7,
    name: "Branch A",
    chainName: "Chain A",
    monitorEnabled: true,
    ordersVendorId: 101,
    availabilityVendorId: "201",
    status: "OPEN",
    statusColor: "green",
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

describe("availabilityMeta", () => {
  it("renders UPuse-owned high demand with the UPuse blue treatment", () => {
    const chip = availabilitySubtypeChip(branch({
      vssGroup: "highDemand",
      highDemandSource: "UPUSE",
    }));

    expect(chip?.label).toBe("highDemand");
    expect(chip?.sx).toEqual(expect.objectContaining({
      color: "#1d4ed8",
    }));
    expect(availabilityNote(branch({
      vssGroup: "highDemand",
      highDemandSource: "UPUSE",
    }))).toContain("UPuse scheduled highDemand");
  });

  it("keeps external high demand on the existing amber treatment", () => {
    const chip = availabilitySubtypeChip(branch({
      vssGroup: "highDemand",
      highDemandSource: "EXTERNAL",
    }));

    expect(chip?.sx).toEqual(expect.objectContaining({
      color: "#92400e",
    }));
  });
});
