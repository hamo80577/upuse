import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { BranchSnapshot } from "../../../api/types";
import { BranchStateTicker } from "./BranchStateTicker";

function branch(overrides: Partial<BranchSnapshot>): Pick<BranchSnapshot, "branchId" | "name" | "status" | "availabilityKind" | "vssGroup" | "closedByUpuse" | "closureSource"> {
  return {
    branchId: 1,
    name: "Branch A",
    status: "OPEN",
    availabilityKind: "open",
    ...overrides,
  };
}

describe("BranchStateTicker", () => {
  it("shows UNKNOWN branches in the ticker popover", () => {
    render(
      <BranchStateTicker
        branches={[
          branch({ branchId: 1, name: "Open Branch", status: "OPEN" }),
          branch({ branchId: 2, name: "Unknown Branch", status: "UNKNOWN" }),
        ]}
      />,
    );

    fireEvent.click(screen.getByRole("button"));

    expect(screen.getAllByText("Unknown").length).toBeGreaterThan(0);
    expect(screen.getByText("Unknown Branch")).toBeInTheDocument();
  });

  it("shows raw subtype chips in the ticker popover", () => {
    render(
      <BranchStateTicker
        branches={[
          branch({ branchId: 1, name: "Source Issue", status: "CLOSED", availabilityKind: "sourceIssue", vssGroup: "issues" }),
          branch({ branchId: 2, name: "Busy Branch", status: "OPEN", availabilityKind: "highDemand", vssGroup: "highDemand" }),
        ]}
      />,
    );

    fireEvent.click(screen.getByRole("button"));

    expect(screen.getByText("issues")).toBeInTheDocument();
    expect(screen.getByText("highDemand")).toBeInTheDocument();
  });
});
