import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { BranchThresholdOverrideManager } from "./BranchThresholdOverrideManager";

describe("BranchThresholdOverrideManager", () => {
  it("stays operational when a branch arrives with a null chain name", () => {
    render(
      <BranchThresholdOverrideManager
        branches={[
          {
            id: 7,
            name: "Branch A",
            chainName: null as any,
            ordersVendorId: 1001,
            availabilityVendorId: "2002",
            globalEntityId: "HF_EG",
            enabled: true,
            lateThresholdOverride: null,
            unassignedThresholdOverride: null,
          },
        ]}
        chains={[]}
        globalThresholds={{ lateThreshold: 5, unassignedThreshold: 7 }}
        editingBranchId={null}
        branchEditor={{ lateThreshold: "", unassignedThreshold: "" }}
        savingBranchId={null}
        onEditBranch={vi.fn()}
        onChangeEditor={vi.fn()}
        onSaveBranch={vi.fn()}
        onClearBranchOverride={vi.fn()}
        onCancelEdit={vi.fn()}
      />,
    );

    expect(screen.getByText("No Chain")).toBeInTheDocument();

    fireEvent.click(screen.getByText("No Chain"));

    expect(screen.getByText("Branch A")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Set Custom Thresholds" })).toBeInTheDocument();
  });
});
