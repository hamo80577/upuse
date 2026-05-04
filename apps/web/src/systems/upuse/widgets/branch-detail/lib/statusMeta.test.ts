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
  it("describes source issues closures without a reopen timer", () => {
    const meta = statusPanelMeta(createBranch({
      status: "CLOSED",
      availabilityKind: "sourceIssue",
      sourceClosedReason: "TECHNICAL_PROBLEM",
    }));

    expect(meta.title).toBe("Closed from Source");
    expect(meta.caption).toBe("TECHNICAL_PROBLEM");
    expect(meta.showTimer).toBe(false);
    expect(meta.footerCaption).toContain("issues");
  });

  it("keeps highDemand branches open while exposing the raw subtype", () => {
    const meta = statusPanelMeta(createBranch({
      status: "OPEN",
      availabilityKind: "highDemand",
      preptimeAdjustment: {
        adjustmentMinutes: 15,
        interval: {
          startTime: "18:00",
          endTime: "21:00",
        },
      },
    }));

    expect(meta.title).toBe("Live and Open");
    expect(meta.caption).toContain("highDemand");
    expect(meta.caption).toContain("+15 min");
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

  it("labels Ready To Pickup closures distinctly in the trigger badge", () => {
    expect(closeReasonMeta("READY_TO_PICKUP")).toEqual(expect.objectContaining({
      label: "Ready To Pickup Trigger",
    }));
  });
});
