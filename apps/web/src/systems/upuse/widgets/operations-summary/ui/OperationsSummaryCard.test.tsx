import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { OperationsSummaryCard } from "./OperationsSummaryCard";

describe("OperationsSummaryCard", () => {
  it("shows total on-hold orders in the live summary metrics", () => {
    render(
      <OperationsSummaryCard
        totals={{
          branchesMonitored: 3,
          open: 2,
          tempClose: 1,
          closed: 0,
          unknown: 0,
          ordersToday: 30,
          cancelledToday: 2,
          doneToday: 10,
          activeNow: 12,
          lateNow: 1,
          unassignedNow: 3,
          onHoldNow: 4,
          upuseTempCloseToday: 0,
          upuseHighDemandToday: 0,
        }}
        connectionState="live"
        syncGuard={{ stale: false, recovering: false, ageMs: 0, thresholdMs: 30_000 }}
        onRefreshNow={vi.fn()}
        onOpenReport={vi.fn()}
      />,
    );

    expect(screen.getByText("On Hold")).toBeInTheDocument();
    expect(screen.getByText("4")).toBeInTheDocument();
  });

  it("shows live UPuse operation counters scoped to today", () => {
    render(
      <OperationsSummaryCard
        totals={{
          branchesMonitored: 3,
          open: 2,
          tempClose: 1,
          closed: 0,
          unknown: 0,
          ordersToday: 30,
          cancelledToday: 2,
          doneToday: 10,
          activeNow: 12,
          lateNow: 1,
          unassignedNow: 3,
          onHoldNow: 4,
          upuseTempCloseToday: 7,
          upuseHighDemandToday: 5,
        }}
        connectionState="live"
        syncGuard={{ stale: false, recovering: false, ageMs: 0, thresholdMs: 30_000 }}
        onRefreshNow={vi.fn()}
        onOpenReport={vi.fn()}
      />,
    );

    expect(screen.getByText("UPuse Closes")).toBeInTheDocument();
    expect(screen.getByText("UPuse High Demand")).toBeInTheDocument();
    expect(screen.getByText("7")).toBeInTheDocument();
    expect(screen.getByText("5")).toBeInTheDocument();
    expect(screen.getAllByText("Since 00:00 Cairo")).toHaveLength(2);
  });
});
