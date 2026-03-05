import { describe, expect, it } from "vitest";
import { getLatestMonitoringUpdateAt, getStaleThresholdMs, getSyncAgeMs, isSyncStale } from "./syncFreshness";

describe("syncFreshness helpers", () => {
  it("computes stale threshold in milliseconds", () => {
    expect(
      getStaleThresholdMs({
        ordersRefreshSeconds: 30,
        availabilityRefreshSeconds: 45,
      }),
    ).toBe(45_000);
  });

  it("picks latest monitoring timestamp", () => {
    const latest = getLatestMonitoringUpdateAt({
      lastOrdersFetchAt: "2026-03-05T10:00:00.000Z",
      lastAvailabilityFetchAt: "2026-03-05T10:00:05.000Z",
      lastHealthyAt: "2026-03-05T09:59:59.000Z",
    });
    expect(latest).toBe("2026-03-05T10:00:05.000Z");
  });

  it("marks sync stale only when running and age exceeds threshold", () => {
    const ageMs = getSyncAgeMs({
      latestMonitoringUpdateAt: "2026-03-05T10:00:00.000Z",
      syncClockMs: new Date("2026-03-05T10:00:31.000Z").getTime(),
    });
    expect(ageMs).toBe(31_000);
    expect(
      isSyncStale({
        running: true,
        latestMonitoringUpdateAt: "2026-03-05T10:00:00.000Z",
        syncAgeMs: ageMs,
        staleThresholdMs: 30_000,
      }),
    ).toBe(true);
    expect(
      isSyncStale({
        running: false,
        latestMonitoringUpdateAt: "2026-03-05T10:00:00.000Z",
        syncAgeMs: ageMs,
        staleThresholdMs: 30_000,
      }),
    ).toBe(false);
  });
});
