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
            capacityPerHourEnabledOverride: null,
            capacityPerHourLimitOverride: null,
          },
        ]}
        chains={[]}
        globalThresholds={{
          lateThreshold: 5,
          unassignedThreshold: 7,
          capacityRuleEnabled: true,
          capacityPerHourEnabled: false,
          capacityPerHourLimit: null,
        }}
        editingBranchId={null}
        branchEditor={{
          lateThreshold: "",
          unassignedThreshold: "",
          capacityRuleEnabled: true,
          capacityPerHourEnabled: false,
          capacityPerHourLimit: "",
        }}
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
            capacityPerHourEnabledOverride: true,
            capacityPerHourLimitOverride: 5,
          },
        ]}
        chains={[{
          name: "Chain A",
          lateThreshold: 5,
          unassignedThreshold: 7,
          capacityRuleEnabled: true,
          capacityPerHourEnabled: true,
          capacityPerHourLimit: 5,
        }]}
        globalThresholds={{
          lateThreshold: 5,
          unassignedThreshold: 7,
          capacityRuleEnabled: true,
          capacityPerHourEnabled: false,
          capacityPerHourLimit: null,
        }}
        editingBranchId={8}
        branchEditor={{
          lateThreshold: "",
          unassignedThreshold: "",
          capacityRuleEnabled: false,
          capacityPerHourEnabled: true,
          capacityPerHourLimit: "5",
        }}
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
    expect(screen.getByLabelText("Enable Capacity / Hour")).toBeChecked();
    expect(screen.getByDisplayValue("5")).toBeInTheDocument();
  });
});
