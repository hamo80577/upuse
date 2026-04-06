import { describe, expect, it } from "vitest";
import type { BranchSnapshot } from "../../../api/types";
import { closeReasonMeta, statusPanelMeta } from "./statusMeta";

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

describe("statusPanelMeta", () => {
  it("describes external issues closures without a reopen timer", () => {
    const meta = statusPanelMeta(createBranch({ sourceClosedReason: "TECHNICAL_PROBLEM" }));

    expect(meta.title).toBe("Source Temporary Close");
    expect(meta.caption).toContain("Issues");
    expect(meta.caption).toContain("no reopen time");
    expect(meta.showTimer).toBe(false);
    expect(meta.footerCaption).toContain("manually");
  });

  it("labels capacity closures distinctly in the trigger badge", () => {
    expect(closeReasonMeta("CAPACITY")).toEqual(expect.objectContaining({
      label: "Capacity Trigger",
    }));
  });

  it("labels Capacity / Hour closures distinctly in the trigger badge", () => {
    expect(closeReasonMeta("CAPACITY_HOUR")).toEqual(expect.objectContaining({
      label: "Capacity / Hour Trigger",
    }));
  });
});
