import { describe, expect, it } from "vitest";
import { decide } from "./policyEngine.js";
import type { AvailabilityRecord, BranchMapping, OrdersMetrics, Settings } from "../types/models.js";

function baseSettings(): Settings {
  return {
    ordersToken: "",
    availabilityToken: "",
    globalEntityId: "HF_EG",
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

function baseBranch(): BranchMapping {
  return {
    id: 1,
    name: "Test Branch",
    chainName: "",
    ordersVendorId: 101,
    availabilityVendorId: "202",
    globalEntityId: "HF_EG",
    enabled: true,
    lateThresholdOverride: null,
    unassignedThresholdOverride: null,
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
    globalEntityId: "HF_EG",
  };
}

function tempCloseAvailability(params: Partial<AvailabilityRecord> = {}): AvailabilityRecord {
  return {
    platformKey: "test",
    changeable: true,
    availabilityState: "CLOSED_UNTIL",
    platformRestaurantId: "202",
    globalEntityId: "HF_EG",
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
});
