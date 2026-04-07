import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { BranchSnapshot } from "../../../../api/types";
import { BranchCardStatus } from "./BranchCardStatus";

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
    closedByUpuse: true,
    closureSource: "UPUSE",
    closeReason: "UNASSIGNED",
    closedUntil: "2026-03-18T12:30:00.000Z",
    closeStartedAt: "2026-03-18T11:30:00.000Z",
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

describe("BranchCardStatus", () => {
  it("shows the trigger label on the branch card while the detail card is closed", () => {
    render(
      <BranchCardStatus
        branch={createBranch()}
        nowMs={Date.parse("2026-03-18T12:00:00.000Z")}
        progressValue={50}
        canTrackProgress
        timerReached={false}
      />,
    );

    expect(screen.getByText("Temporary Close")).toBeInTheDocument();
    expect(screen.getByText("Unassigned Trigger")).toBeInTheDocument();
    expect(screen.getByText("Reopens at 14:30 • Duration progress 50%")).toBeInTheDocument();
  });

  it("does not render a trigger badge when the branch has no close reason", () => {
    render(
      <BranchCardStatus
        branch={createBranch({ closeReason: undefined })}
        nowMs={Date.parse("2026-03-18T12:00:00.000Z")}
        progressValue={50}
        canTrackProgress
        timerReached={false}
      />,
    );

    expect(screen.queryByText("Unassigned Trigger")).not.toBeInTheDocument();
  });

  it("shows the Capacity / Hour trigger label when the hourly rule closes the branch", () => {
    render(
      <BranchCardStatus
        branch={createBranch({ closeReason: "CAPACITY_HOUR" })}
        nowMs={Date.parse("2026-03-18T12:00:00.000Z")}
        progressValue={50}
        canTrackProgress
        timerReached={false}
      />,
    );

    expect(screen.getByText("Capacity / Hour Trigger")).toBeInTheDocument();
  });

  it("shows the Ready To Pickup trigger label when the ready rule closes the branch", () => {
    render(
      <BranchCardStatus
        branch={createBranch({ closeReason: "READY_TO_PICKUP" })}
        nowMs={Date.parse("2026-03-18T12:00:00.000Z")}
        progressValue={50}
        canTrackProgress
        timerReached={false}
      />,
    );

    expect(screen.getByText("Ready To Pickup Trigger")).toBeInTheDocument();
  });
});
