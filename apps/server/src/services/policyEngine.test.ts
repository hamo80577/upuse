import { describe, expect, it } from "vitest";
import { decide } from "./policyEngine.js";
import type { AvailabilityRecord, OrdersMetrics, ResolvedBranchMapping, Settings } from "../types/models.js";
import { TEST_GLOBAL_ENTITY_ID } from "../../../../test/globalEntityId";

function baseSettings(): Settings {
  return {
    ordersToken: "",
    availabilityToken: "",
    chainNames: [],
    chains: [],
    lateThreshold: 5,
    unassignedThreshold: 5,
    tempCloseMinutes: 30,
    graceMinutes: 5,
    ordersRefreshSeconds: 30,
    availabilityRefreshSeconds: 30,
    maxVendorsPerOrdersRequest: 50,
  };
}

function baseBranch(): ResolvedBranchMapping {
  return {
    id: 1,
    name: "Test Branch",
    chainName: "",
    ordersVendorId: 101,
    availabilityVendorId: "202",
    catalogState: "available",
    globalEntityId: TEST_GLOBAL_ENTITY_ID,
    enabled: true,
    lateThresholdOverride: null,
    unassignedThresholdOverride: null,
    capacityRuleEnabledOverride: null,
    capacityPerHourEnabledOverride: null,
    capacityPerHourLimitOverride: null,
  };
}

function baseMetrics(): OrdersMetrics {
  return {
    totalToday: 0,
    cancelledToday: 0,
    doneToday: 0,
    activeNow: 0,
    lateNow: 0,
    unassignedNow: 0,
  };
}

function openAvailability(): AvailabilityRecord {
  return {
    platformKey: "test",
    changeable: true,
    availabilityState: "OPEN",
    platformRestaurantId: "202",
  };
}

function unknownAvailability(): AvailabilityRecord {
  return {
    platformKey: "test",
    changeable: true,
    availabilityState: "UNKNOWN",
    platformRestaurantId: "202",
  };
}

function tempCloseAvailability(params: Partial<AvailabilityRecord> = {}): AvailabilityRecord {
  return {
    platformKey: "test",
    changeable: true,
    availabilityState: "CLOSED_UNTIL",
    platformRestaurantId: "202",
    closedUntil: "2026-03-03T10:30:00.000Z",
    modifiedBy: "log_vendor_monitor",
    ...params,
  };
}

describe("policyEngine.decide", () => {
  it("closes on late threshold while branch is open", () => {
    const decision = decide({
      branch: baseBranch(),
      metrics: {
        ...baseMetrics(),
        lateNow: 5,
      },
      recentActivePickers: 0,
      recentActiveAvailable: true,
      availability: openAvailability(),
      nowUtcIso: "2026-03-03T10:00:00.000Z",
      settings: baseSettings(),
    });

    expect(decision).toEqual({ type: "CLOSE", reason: "LATE" });
  });

  it("closes on unassigned threshold while branch is open", () => {
    const decision = decide({
      branch: baseBranch(),
      metrics: {
        ...baseMetrics(),
        unassignedNow: 5,
      },
      recentActivePickers: 0,
      recentActiveAvailable: true,
      availability: openAvailability(),
      nowUtcIso: "2026-03-03T10:00:00.000Z",
      settings: baseSettings(),
    });

    expect(decision).toEqual({ type: "CLOSE", reason: "UNASSIGNED" });
  });

  it("reopens only when the original trigger clears", () => {
    const branch = baseBranch();
    const settings = baseSettings();

    const reopenUnassigned = decide({
      branch,
      metrics: {
        ...baseMetrics(),
        lateNow: 3,
        unassignedNow: 0,
      },
      recentActivePickers: 0,
      recentActiveAvailable: true,
      availability: tempCloseAvailability(),
      runtime: {
        lastUpuseCloseReason: "UNASSIGNED",
        lastUpuseCloseAt: "2026-03-03T10:00:00.000Z",
        lastUpuseCloseUntil: "2026-03-03T10:30:00.000Z",
        lastUpuseCloseEventId: 11,
      },
      nowUtcIso: "2026-03-03T10:05:00.000Z",
      settings,
    });

    const noReopenForLateOwnedClose = decide({
      branch,
      metrics: {
        ...baseMetrics(),
        lateNow: 2,
        unassignedNow: 0,
      },
      recentActivePickers: 0,
      recentActiveAvailable: true,
      availability: tempCloseAvailability(),
      runtime: {
        lastUpuseCloseReason: "LATE",
        lastUpuseCloseAt: "2026-03-03T10:00:00.000Z",
        lastUpuseCloseUntil: "2026-03-03T10:30:00.000Z",
        lastUpuseCloseEventId: 12,
      },
      nowUtcIso: "2026-03-03T10:05:00.000Z",
      settings,
    });

    expect(reopenUnassigned).toEqual({ type: "EARLY_OPEN", reason: "UNASSIGNED" });
    expect(noReopenForLateOwnedClose).toEqual({ type: "NOOP" });
  });

  it("respects external open grace behavior", () => {
    const branch = baseBranch();
    const settings = baseSettings();
    const duringGrace = decide({
      branch,
      metrics: {
        ...baseMetrics(),
        unassignedNow: 7,
      },
      recentActivePickers: 0,
      recentActiveAvailable: true,
      availability: openAvailability(),
      runtime: {
        lastUpuseCloseAt: "2026-03-03T10:00:00.000Z",
        lastUpuseCloseUntil: "2026-03-03T10:30:00.000Z",
        externalOpenDetectedAt: "2026-03-03T10:06:00.000Z",
        lastUpuseCloseEventId: 13,
      },
      nowUtcIso: "2026-03-03T10:08:00.000Z",
      settings,
    });

    const afterGrace = decide({
      branch,
      metrics: {
        ...baseMetrics(),
        unassignedNow: 7,
      },
      recentActivePickers: 0,
      recentActiveAvailable: true,
      availability: openAvailability(),
      runtime: {
        lastUpuseCloseAt: "2026-03-03T10:00:00.000Z",
        lastUpuseCloseUntil: "2026-03-03T10:30:00.000Z",
        externalOpenDetectedAt: "2026-03-03T10:01:00.000Z",
        lastUpuseCloseEventId: 14,
      },
      nowUtcIso: "2026-03-03T10:08:00.000Z",
      settings,
    });

    expect(duringGrace).toEqual({ type: "NOOP", note: "External open grace" });
    expect(afterGrace).toEqual({ type: "CLOSE", reason: "UNASSIGNED" });
  });

  it("prefers branch-specific threshold overrides over chain thresholds", () => {
    const decision = decide({
      branch: {
        ...baseBranch(),
        chainName: "Chain A",
        lateThresholdOverride: 7,
        unassignedThresholdOverride: 9,
      },
      metrics: {
        ...baseMetrics(),
        lateNow: 6,
        unassignedNow: 8,
      },
      recentActivePickers: 0,
      recentActiveAvailable: true,
      availability: openAvailability(),
      nowUtcIso: "2026-03-03T10:00:00.000Z",
      settings: {
        ...baseSettings(),
        chains: [{ name: "Chain A", lateThreshold: 3, unassignedThreshold: 4 }],
      },
    });

    expect(decision).toEqual({ type: "NOOP" });
  });

  it("ignores source propagation noise immediately after a monitor close", () => {
    const decision = decide({
      branch: baseBranch(),
      metrics: {
        ...baseMetrics(),
        unassignedNow: 8,
      },
      recentActivePickers: 0,
      recentActiveAvailable: true,
      availability: openAvailability(),
      runtime: {
        lastUpuseCloseAt: "2026-03-03T10:00:00.000Z",
        lastUpuseCloseUntil: "2026-03-03T10:30:00.000Z",
        lastUpuseCloseEventId: 15,
      },
      nowUtcIso: "2026-03-03T10:00:20.000Z",
      settings: baseSettings(),
    });

    expect(decision).toEqual({ type: "NOOP", note: "Waiting for close state propagation" });
  });

  it("ignores untrusted tracked runtime and evaluates the branch as open", () => {
    const decision = decide({
      branch: baseBranch(),
      metrics: {
        ...baseMetrics(),
        unassignedNow: 7,
      },
      recentActivePickers: 0,
      recentActiveAvailable: true,
      availability: openAvailability(),
      runtime: {
        lastUpuseCloseAt: "2026-03-03T10:00:00.000Z",
        lastUpuseCloseUntil: "2026-03-03T10:30:00.000Z",
        lastActionAt: "2026-03-03T08:15:00.000Z",
        lastUpuseCloseEventId: null,
      },
      nowUtcIso: "2026-03-03T10:08:00.000Z",
      settings: baseSettings(),
    });

    expect(decision).toEqual({ type: "CLOSE", reason: "UNASSIGNED" });
  });

  it("ignores stale tracked windows once the closure owner is external", () => {
    const tempCloseDecision = decide({
      branch: baseBranch(),
      metrics: {
        ...baseMetrics(),
        unassignedNow: 0,
      },
      recentActivePickers: 0,
      recentActiveAvailable: true,
      availability: tempCloseAvailability({
        closedUntil: "2026-03-03T13:30:00.000Z",
        modifiedBy: "external_source",
      }),
      runtime: {
        closureOwner: "EXTERNAL",
        lastUpuseCloseReason: "UNASSIGNED",
        lastUpuseCloseAt: "2026-03-03T10:00:00.000Z",
        lastUpuseCloseUntil: "2026-03-03T10:30:00.000Z",
        lastUpuseCloseEventId: 30,
      },
      nowUtcIso: "2026-03-03T10:08:00.000Z",
      settings: baseSettings(),
    });

    const openDecision = decide({
      branch: baseBranch(),
      metrics: {
        ...baseMetrics(),
        unassignedNow: 7,
      },
      recentActivePickers: 0,
      recentActiveAvailable: true,
      availability: openAvailability(),
      runtime: {
        closureOwner: "EXTERNAL",
        lastUpuseCloseAt: "2026-03-03T10:00:00.000Z",
        lastUpuseCloseUntil: "2026-03-03T10:30:00.000Z",
        lastUpuseCloseEventId: 31,
      },
      nowUtcIso: "2026-03-03T10:08:00.000Z",
      settings: baseSettings(),
    });

    expect(tempCloseDecision).toEqual({ type: "NOOP" });
    expect(openDecision).toEqual({ type: "CLOSE", reason: "UNASSIGNED" });
  });

  it("treats UNKNOWN upstream availability state as a safe no-op", () => {
    const decision = decide({
      branch: baseBranch(),
      metrics: {
        ...baseMetrics(),
        lateNow: 7,
        unassignedNow: 7,
      },
      recentActivePickers: 0,
      recentActiveAvailable: true,
      availability: unknownAvailability(),
      nowUtcIso: "2026-03-03T10:08:00.000Z",
      settings: baseSettings(),
    });

    expect(decision).toEqual({ type: "NOOP" });
  });

  it("closes on capacity when active orders exceed three times the recent-active picker count", () => {
    const decision = decide({
      branch: baseBranch(),
      metrics: {
        ...baseMetrics(),
        activeNow: 10,
      },
      recentActivePickers: 3,
      recentActiveAvailable: true,
      availability: openAvailability(),
      nowUtcIso: "2026-03-03T10:00:00.000Z",
      settings: baseSettings(),
    });

    expect(decision).toEqual({ type: "CLOSE", reason: "CAPACITY" });
  });

  it("ignores capacity when recent activity is unavailable", () => {
    const decision = decide({
      branch: baseBranch(),
      metrics: {
        ...baseMetrics(),
        activeNow: 7,
      },
      recentActivePickers: 3,
      recentActiveAvailable: false,
      availability: openAvailability(),
      nowUtcIso: "2026-03-03T10:00:00.000Z",
      settings: baseSettings(),
    });

    expect(decision).toEqual({ type: "NOOP" });
  });

  it("does not close on capacity when the recent-active picker count is zero", () => {
    const decision = decide({
      branch: baseBranch(),
      metrics: {
        ...baseMetrics(),
        activeNow: 1,
      },
      recentActivePickers: 0,
      recentActiveAvailable: true,
      availability: openAvailability(),
      nowUtcIso: "2026-03-03T10:00:00.000Z",
      settings: baseSettings(),
    });

    expect(decision).toEqual({ type: "NOOP" });
  });

  it("does not close on capacity when active orders only meet the cap", () => {
    const decision = decide({
      branch: baseBranch(),
      metrics: {
        ...baseMetrics(),
        activeNow: 9,
      },
      recentActivePickers: 3,
      recentActiveAvailable: true,
      availability: openAvailability(),
      nowUtcIso: "2026-03-03T10:00:00.000Z",
      settings: baseSettings(),
    });

    expect(decision).toEqual({ type: "NOOP" });
  });

  it("does not close on capacity when the chain disables the capacity rule", () => {
    const decision = decide({
      branch: {
        ...baseBranch(),
        chainName: "Chain A",
      },
      metrics: {
        ...baseMetrics(),
        activeNow: 10,
      },
      recentActivePickers: 3,
      recentActiveAvailable: true,
      availability: openAvailability(),
      nowUtcIso: "2026-03-03T10:00:00.000Z",
      settings: {
        ...baseSettings(),
        chains: [{ name: "Chain A", lateThreshold: 5, unassignedThreshold: 5, capacityRuleEnabled: false }],
      },
    });

    expect(decision).toEqual({ type: "NOOP" });
  });

  it("does not close on capacity when the branch override disables the capacity rule", () => {
    const decision = decide({
      branch: {
        ...baseBranch(),
        chainName: "Chain A",
        capacityRuleEnabledOverride: false,
      },
      metrics: {
        ...baseMetrics(),
        activeNow: 10,
      },
      recentActivePickers: 3,
      recentActiveAvailable: true,
      availability: openAvailability(),
      nowUtcIso: "2026-03-03T10:00:00.000Z",
      settings: {
        ...baseSettings(),
        chains: [{ name: "Chain A", lateThreshold: 5, unassignedThreshold: 5, capacityRuleEnabled: true }],
      },
    });

    expect(decision).toEqual({ type: "NOOP" });
  });

  it("keeps late and unassigned triggers ahead of capacity", () => {
    const decision = decide({
      branch: baseBranch(),
      metrics: {
        ...baseMetrics(),
        activeNow: 10,
        lateNow: 5,
      },
      recentActivePickers: 3,
      recentActiveAvailable: true,
      availability: openAvailability(),
      nowUtcIso: "2026-03-03T10:00:00.000Z",
      settings: baseSettings(),
    });

    expect(decision).toEqual({ type: "CLOSE", reason: "LATE" });
  });

  it("reopens capacity-owned closes when active orders drop to the picker count", () => {
    const decision = decide({
      branch: baseBranch(),
      metrics: {
        ...baseMetrics(),
        activeNow: 3,
      },
      recentActivePickers: 3,
      recentActiveAvailable: true,
      availability: tempCloseAvailability(),
      runtime: {
        lastUpuseCloseReason: "CAPACITY",
        lastUpuseCloseAt: "2026-03-03T10:00:00.000Z",
        lastUpuseCloseUntil: "2026-03-03T10:30:00.000Z",
        lastUpuseCloseEventId: 16,
      },
      nowUtcIso: "2026-03-03T10:05:00.000Z",
      settings: baseSettings(),
    });

    expect(decision).toEqual({ type: "EARLY_OPEN", reason: "CAPACITY" });
  });

  it("does not reopen capacity-owned closes when recent activity is unavailable", () => {
    const decision = decide({
      branch: baseBranch(),
      metrics: {
        ...baseMetrics(),
        activeNow: 5,
      },
      recentActivePickers: 0,
      recentActiveAvailable: false,
      availability: tempCloseAvailability(),
      runtime: {
        lastUpuseCloseReason: "CAPACITY",
        lastUpuseCloseAt: "2026-03-03T10:00:00.000Z",
        lastUpuseCloseUntil: "2026-03-03T10:30:00.000Z",
        lastUpuseCloseEventId: 18,
      },
      nowUtcIso: "2026-03-03T10:05:00.000Z",
      settings: baseSettings(),
    });

    expect(decision).toEqual({ type: "NOOP" });
  });

  it("reopens capacity-owned closes when the rule gets disabled", () => {
    const decision = decide({
      branch: {
        ...baseBranch(),
        chainName: "Chain A",
      },
      metrics: {
        ...baseMetrics(),
        activeNow: 5,
      },
      recentActivePickers: 3,
      recentActiveAvailable: true,
      availability: tempCloseAvailability(),
      runtime: {
        lastUpuseCloseReason: "CAPACITY",
        lastUpuseCloseAt: "2026-03-03T10:00:00.000Z",
        lastUpuseCloseUntil: "2026-03-03T10:30:00.000Z",
        lastUpuseCloseEventId: 19,
      },
      nowUtcIso: "2026-03-03T10:05:00.000Z",
      settings: {
        ...baseSettings(),
        chains: [{ name: "Chain A", lateThreshold: 5, unassignedThreshold: 5, capacityRuleEnabled: false }],
      },
    });

    expect(decision).toEqual({ type: "EARLY_OPEN", reason: "CAPACITY" });
  });

  it("reopens capacity-owned closes when the recent-active picker count drops below one", () => {
    const decision = decide({
      branch: baseBranch(),
      metrics: {
        ...baseMetrics(),
        activeNow: 5,
      },
      recentActivePickers: 0,
      recentActiveAvailable: true,
      availability: tempCloseAvailability(),
      runtime: {
        lastUpuseCloseReason: "CAPACITY",
        lastUpuseCloseAt: "2026-03-03T10:00:00.000Z",
        lastUpuseCloseUntil: "2026-03-03T10:30:00.000Z",
        lastUpuseCloseEventId: 22,
      },
      nowUtcIso: "2026-03-03T10:05:00.000Z",
      settings: baseSettings(),
    });

    expect(decision).toEqual({ type: "EARLY_OPEN", reason: "CAPACITY" });
  });

  it("re-applies capacity after external-open grace when overload remains", () => {
    const decision = decide({
      branch: baseBranch(),
      metrics: {
        ...baseMetrics(),
        activeNow: 10,
      },
      recentActivePickers: 3,
      recentActiveAvailable: true,
      availability: openAvailability(),
      runtime: {
        lastUpuseCloseAt: "2026-03-03T10:00:00.000Z",
        lastUpuseCloseUntil: "2026-03-03T10:30:00.000Z",
        externalOpenDetectedAt: "2026-03-03T10:01:00.000Z",
        lastUpuseCloseEventId: 17,
      },
      nowUtcIso: "2026-03-03T10:08:00.000Z",
      settings: baseSettings(),
    });

    expect(decision).toEqual({ type: "CLOSE", reason: "CAPACITY" });
  });

  it("closes on Capacity / Hour when the hourly threshold is reached", () => {
    const decision = decide({
      branch: {
        ...baseBranch(),
        chainName: "Chain A",
      },
      metrics: baseMetrics(),
      currentHourPlacedCount: 5,
      recentActivePickers: 3,
      recentActiveAvailable: true,
      availability: openAvailability(),
      nowUtcIso: "2026-03-03T10:17:00.000Z",
      settings: {
        ...baseSettings(),
        chains: [{
          name: "Chain A",
          lateThreshold: 5,
          unassignedThreshold: 5,
          capacityRuleEnabled: true,
          capacityPerHourEnabled: true,
          capacityPerHourLimit: 5,
        }],
      },
    });

    expect(decision).toEqual({ type: "CLOSE", reason: "CAPACITY_HOUR" });
  });

  it("does not early-open Capacity / Hour inside the same hour while the count is still above limit", () => {
    const decision = decide({
      branch: {
        ...baseBranch(),
        chainName: "Chain A",
      },
      metrics: baseMetrics(),
      currentHourPlacedCount: 5,
      recentActivePickers: 3,
      recentActiveAvailable: true,
      availability: tempCloseAvailability(),
      runtime: {
        lastUpuseCloseReason: "CAPACITY_HOUR",
        lastUpuseCloseAt: "2026-03-03T10:17:00.000Z",
        lastUpuseCloseUntil: "2026-03-03T10:47:00.000Z",
        lastUpuseCloseEventId: 20,
      },
      nowUtcIso: "2026-03-03T10:47:30.000Z",
      settings: {
        ...baseSettings(),
        chains: [{
          name: "Chain A",
          lateThreshold: 5,
          unassignedThreshold: 5,
          capacityRuleEnabled: true,
          capacityPerHourEnabled: true,
          capacityPerHourLimit: 5,
        }],
      },
    });

    expect(decision).toEqual({ type: "NOOP" });
  });

  it("early-opens Capacity / Hour after the hour rolls over and the count resets below limit", () => {
    const decision = decide({
      branch: {
        ...baseBranch(),
        chainName: "Chain A",
      },
      metrics: baseMetrics(),
      currentHourPlacedCount: 0,
      recentActivePickers: 3,
      recentActiveAvailable: true,
      availability: tempCloseAvailability({
        closedUntil: "2026-03-03T11:17:00.000Z",
      }),
      runtime: {
        lastUpuseCloseReason: "CAPACITY_HOUR",
        lastUpuseCloseAt: "2026-03-03T10:47:00.000Z",
        lastUpuseCloseUntil: "2026-03-03T11:17:00.000Z",
        lastUpuseCloseEventId: 21,
      },
      nowUtcIso: "2026-03-03T11:00:10.000Z",
      settings: {
        ...baseSettings(),
        chains: [{
          name: "Chain A",
          lateThreshold: 5,
          unassignedThreshold: 5,
          capacityRuleEnabled: true,
          capacityPerHourEnabled: true,
          capacityPerHourLimit: 5,
        }],
      },
    });

    expect(decision).toEqual({ type: "EARLY_OPEN", reason: "CAPACITY_HOUR" });
  });
});
