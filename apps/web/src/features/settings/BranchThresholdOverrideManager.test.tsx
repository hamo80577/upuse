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
            enabled: true,
            catalogState: "available",
            lateThresholdOverride: null,
            unassignedThresholdOverride: null,
            capacityRuleEnabledOverride: null,
          },
        ]}
        chains={[]}
        globalThresholds={{ lateThreshold: 5, unassignedThreshold: 7, capacityRuleEnabled: true }}
        editingBranchId={null}
        branchEditor={{ lateThreshold: "", unassignedThreshold: "", capacityRuleEnabled: true }}
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

  it("shows the capacity checkbox in the branch editor", () => {
    render(
      <BranchThresholdOverrideManager
        branches={[
          {
            id: 8,
            name: "Branch B",
            chainName: "Chain A",
            ordersVendorId: 1002,
            availabilityVendorId: "2003",
            enabled: true,
            catalogState: "available",
            lateThresholdOverride: null,
            unassignedThresholdOverride: null,
            capacityRuleEnabledOverride: false,
          },
        ]}
        chains={[{ name: "Chain A", lateThreshold: 5, unassignedThreshold: 7, capacityRuleEnabled: true }]}
        globalThresholds={{ lateThreshold: 5, unassignedThreshold: 7, capacityRuleEnabled: true }}
        editingBranchId={8}
        branchEditor={{ lateThreshold: "", unassignedThreshold: "", capacityRuleEnabled: false }}
        savingBranchId={null}
        onEditBranch={vi.fn()}
        onChangeEditor={vi.fn()}
        onSaveBranch={vi.fn()}
        onClearBranchOverride={vi.fn()}
        onCancelEdit={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByText("Chain A"));
    expect(screen.getByLabelText("Enable Capacity Rule")).not.toBeChecked();
  });
});
