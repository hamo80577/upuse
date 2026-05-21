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
});
