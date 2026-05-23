import { describe, expect, it, vi } from "vitest";

const { mockPrepare } = vi.hoisted(() => ({
  mockPrepare: vi.fn(),
}));

vi.mock("../config/db.js", () => ({
  db: {
    prepare: mockPrepare,
  },
}));

import { buildActionEventsCsv, listTodayMonitorOperationCountsByBranch } from "./actionReportStore.js";

describe("actionReportStore CSV sanitization", () => {
  it("prefixes formula-like values to prevent CSV injection", () => {
    mockPrepare.mockReset();
    mockPrepare.mockReturnValue({
      all: () => [
        {
          branchName: "=HYPERLINK(\"http://evil\")",
          chainName: "Chain A",
          ordersVendorId: 123,
          availabilityVendorId: "456",
          ts: "2026-03-05T10:00:00.000Z",
          reason: "LATE",
          note: "@malicious-note",
          closedUntil: "2026-03-05T10:30:00.000Z",
          reopenedAt: "2026-03-05T10:40:00.000Z",
          reopenMode: "MONITOR_RECOVERED",
          totalToday: 10,
          cancelledToday: 1,
          doneToday: 6,
          activeNow: 3,
          lateNow: 2,
          unassignedNow: 1,
          onHoldNow: 0,
        },
      ],
    });

    const report = buildActionEventsCsv({
      preset: "day",
      day: "2026-03-05",
    });

    expect(report.csv).toContain(`"'=HYPERLINK(""http://evil"")"`);
    expect(report.csv).toContain(`"'@malicious-note"`);
  });

  it("groups today's monitor operation counts by branch", () => {
    mockPrepare.mockReset();
    mockPrepare.mockReturnValue({
      all: () => [
        { branchId: 1, actionType: "TEMP_CLOSE", count: 2 },
        { branchId: 1, actionType: "HIGH_DEMAND", count: 3 },
        { branchId: 2, actionType: "HIGH_DEMAND", count: 1 },
      ],
    });

    const counts = listTodayMonitorOperationCountsByBranch([1, 2]);

    expect(counts.get(1)).toEqual({ upuseTempClose: 2, upuseHighDemand: 3 });
    expect(counts.get(2)).toEqual({ upuseTempClose: 0, upuseHighDemand: 1 });
  });
});
