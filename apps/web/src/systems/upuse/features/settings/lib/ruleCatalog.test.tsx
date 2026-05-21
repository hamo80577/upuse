import { describe, expect, it } from "vitest";
import { buildRuleEditorDraft, countProfileRules, thresholdRuleCatalog } from "./ruleCatalog";

describe("threshold rule catalog", () => {
  it("includes an On Hold close/reopen rule", () => {
    const onHold = thresholdRuleCatalog.find((entry) => entry.id === "onHold");

    expect(onHold).toMatchObject({
      label: "On Hold Orders",
      shortLabel: "On Hold",
      supportsClose: true,
      supportsReopen: true,
    });
  });

  it("counts and drafts active On Hold thresholds", () => {
    expect(countProfileRules({
      lateThreshold: 0,
      unassignedThreshold: 0,
      readyThreshold: 0,
      onHoldThreshold: 4,
      capacityRuleEnabled: false,
      capacityPerHourEnabled: false,
      capacityPerHourLimit: null,
    })).toBe(1);

    expect(buildRuleEditorDraft({
      lateThreshold: 0,
      lateReopenThreshold: 0,
      unassignedThreshold: 0,
      unassignedReopenThreshold: 0,
      readyThreshold: 0,
      readyReopenThreshold: 0,
      readyMinAgeMinutes: 10,
      onHoldThreshold: 4,
      onHoldReopenThreshold: 1,
      capacityRuleEnabled: false,
      capacityPerHourEnabled: false,
      capacityPerHourLimit: null,
    })).toMatchObject({
      ready: { close: "0", reopen: "0", minAgeMinutes: "10" },
      onHold: { close: "4", reopen: "1" },
    });
  });
});
