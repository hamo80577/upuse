import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { BranchCardMetrics } from "./BranchCardMetrics";

describe("BranchCardMetrics", () => {
  it("shows in-preparation counts with the active picker total instead of cancelled", () => {
    render(
      <BranchCardMetrics
        metrics={{
          totalToday: 18,
          cancelledToday: 4,
          doneToday: 7,
          activeNow: 9,
          lateNow: 2,
          unassignedNow: 1,
        }}
        preparingNow={6}
        preparingPickersNow={3}
        pickerBadgeState="fresh"
      />,
    );

    expect(screen.getByText("In Prep")).toBeInTheDocument();
    expect(screen.getByText("3 pickers")).toBeInTheDocument();
    expect(screen.queryByText("Cancelled")).not.toBeInTheDocument();
  });

  it("shows a syncing badge instead of a fake picker count before the first orders snapshot arrives", () => {
    render(
      <BranchCardMetrics
        metrics={{
          totalToday: 18,
          cancelledToday: 4,
          doneToday: 7,
          activeNow: 9,
          lateNow: 2,
          unassignedNow: 1,
        }}
        preparingNow={0}
        preparingPickersNow={0}
        pickerBadgeState="syncing"
      />,
    );

    expect(screen.getByText("In Prep")).toBeInTheDocument();
    expect(screen.getByText("0")).toBeInTheDocument();
    expect(screen.getByText("Syncing")).toBeInTheDocument();
    expect(screen.queryByText("0 pickers")).not.toBeInTheDocument();
  });

  it("keeps the last picker count visible and marks it stale after an orders error", () => {
    render(
      <BranchCardMetrics
        metrics={{
          totalToday: 18,
          cancelledToday: 4,
          doneToday: 7,
          activeNow: 9,
          lateNow: 2,
          unassignedNow: 1,
        }}
        preparingNow={6}
        preparingPickersNow={3}
        pickerBadgeState="stale"
      />,
    );

    expect(screen.getByText("3 pickers stale")).toBeInTheDocument();
  });
});
