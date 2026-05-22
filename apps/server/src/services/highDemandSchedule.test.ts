import { describe, expect, it } from "vitest";
import { TEST_GLOBAL_ENTITY_ID } from "../../../../test/globalEntityId";
import {
  HIGH_DEMAND_ADJUSTMENT_MINUTES,
  HIGH_DEMAND_DURATION_MINUTES,
  isHighDemandHourActive,
  normalizeHighDemandSchedule,
  resolveEffectiveHighDemandSchedule,
} from "./highDemandSchedule.js";
import type { BranchMapping, Settings } from "../types/models.js";

function settings(overrides: Partial<Settings> = {}): Settings {
  return {
    ordersToken: "",
    availabilityToken: "",
    globalEntityId: TEST_GLOBAL_ENTITY_ID,
    chainNames: ["Carrefour"],
    chains: [
      {
        name: "Carrefour",
        lateThreshold: 5,
        lateReopenThreshold: 0,
        unassignedThreshold: 5,
        unassignedReopenThreshold: 0,
        readyThreshold: 0,
        readyReopenThreshold: 0,
        readyMinAgeMinutes: 0,
        onHoldThreshold: 0,
        onHoldReopenThreshold: 0,
        capacityRuleEnabled: true,
        capacityPerHourEnabled: false,
        capacityPerHourLimit: null,
        highDemandSchedule: {
          enabled: true,
          hours: [15, 16],
        },
      },
    ],
    lateThreshold: 5,
    lateReopenThreshold: 0,
    unassignedThreshold: 5,
    unassignedReopenThreshold: 0,
    readyThreshold: 0,
    readyReopenThreshold: 0,
    readyMinAgeMinutes: 0,
    onHoldThreshold: 0,
    onHoldReopenThreshold: 0,
    tempCloseMinutes: 30,
    graceMinutes: 5,
    ordersRefreshSeconds: 30,
    availabilityRefreshSeconds: 15,
    maxVendorsPerOrdersRequest: 50,
    ...overrides,
  };
}

function branch(overrides: Partial<BranchMapping> = {}): BranchMapping {
  return {
    id: 7,
    name: "Carrefour Branch",
    chainName: "Carrefour",
    ordersVendorId: 111,
    availabilityVendorId: "222",
    enabled: true,
    catalogState: "available",
    lateThresholdOverride: null,
    lateReopenThresholdOverride: null,
    unassignedThresholdOverride: null,
    unassignedReopenThresholdOverride: null,
    readyThresholdOverride: null,
    readyReopenThresholdOverride: null,
    readyMinAgeMinutesOverride: null,
    onHoldThresholdOverride: null,
    onHoldReopenThresholdOverride: null,
    capacityRuleEnabledOverride: null,
    capacityPerHourEnabledOverride: null,
    capacityPerHourLimitOverride: null,
    highDemandScheduleOverride: null,
    ...overrides,
  };
}

describe("highDemandSchedule", () => {
  it("normalizes schedules with sorted unique hours and default inactive state", () => {
    expect(normalizeHighDemandSchedule(undefined)).toEqual({ enabled: false, hours: [] });
    expect(normalizeHighDemandSchedule({ enabled: true, hours: [16, 15, 15, 24, -1, 3.5, 0] })).toEqual({
      enabled: true,
      hours: [0, 15, 16],
    });
  });

  it("resolves branch overrides as replacements and null overrides as inherited chain schedules", () => {
    expect(resolveEffectiveHighDemandSchedule(branch(), settings())).toEqual({
      source: "chain",
      schedule: { enabled: true, hours: [15, 16] },
      override: null,
    });

    expect(resolveEffectiveHighDemandSchedule(branch({
      highDemandScheduleOverride: {
        enabled: false,
        hours: [],
      },
    }), settings())).toEqual({
      source: "branch",
      schedule: { enabled: false, hours: [] },
      override: { enabled: false, hours: [] },
    });

    expect(resolveEffectiveHighDemandSchedule(branch({
      highDemandScheduleOverride: {
        enabled: true,
        hours: [18],
      },
    }), settings())).toEqual({
      source: "branch",
      schedule: { enabled: true, hours: [18] },
      override: { enabled: true, hours: [18] },
    });
  });

  it("checks selected hours in Cairo time", () => {
    expect(isHighDemandHourActive({ enabled: true, hours: [15] }, "2026-05-22T12:30:00.000Z")).toBe(true);
    expect(isHighDemandHourActive({ enabled: true, hours: [15] }, "2026-05-22T13:00:00.000Z")).toBe(false);
    expect(isHighDemandHourActive({ enabled: false, hours: [15] }, "2026-05-22T12:30:00.000Z")).toBe(false);
  });

  it("uses the agreed VSS mutation constants", () => {
    expect(HIGH_DEMAND_DURATION_MINUTES).toBe(30);
    expect(HIGH_DEMAND_ADJUSTMENT_MINUTES).toBe(10);
  });
});
