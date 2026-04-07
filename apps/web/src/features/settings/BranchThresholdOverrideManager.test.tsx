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
            lateReopenThresholdOverride: null,
            unassignedThresholdOverride: null,
            unassignedReopenThresholdOverride: null,
            readyThresholdOverride: null,
            readyReopenThresholdOverride: null,
            capacityRuleEnabledOverride: null,
            capacityPerHourEnabledOverride: null,
            capacityPerHourLimitOverride: null,
          },
        ]}
        chains={[]}
        globalThresholds={{
          lateThreshold: 5,
          lateReopenThreshold: 1,
          unassignedThreshold: 7,
          unassignedReopenThreshold: 2,
          readyThreshold: 2,
          readyReopenThreshold: 1,
          capacityRuleEnabled: true,
          capacityPerHourEnabled: false,
          capacityPerHourLimit: null,
        }}
        editingBranchId={null}
        branchEditor={{
          lateThreshold: "",
          lateReopenThreshold: "",
          unassignedThreshold: "",
          unassignedReopenThreshold: "",
          readyThreshold: "",
          readyReopenThreshold: "",
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
            lateReopenThresholdOverride: 2,
            unassignedThresholdOverride: null,
            unassignedReopenThresholdOverride: 3,
            readyThresholdOverride: 4,
            readyReopenThresholdOverride: 1,
            capacityRuleEnabledOverride: false,
            capacityPerHourEnabledOverride: true,
            capacityPerHourLimitOverride: 5,
          },
        ]}
        chains={[{
          name: "Chain A",
          lateThreshold: 5,
          lateReopenThreshold: 1,
          unassignedThreshold: 7,
          unassignedReopenThreshold: 2,
          readyThreshold: 3,
          readyReopenThreshold: 1,
          capacityRuleEnabled: true,
          capacityPerHourEnabled: true,
          capacityPerHourLimit: 5,
        }]}
        globalThresholds={{
          lateThreshold: 5,
          lateReopenThreshold: 1,
          unassignedThreshold: 7,
          unassignedReopenThreshold: 2,
          readyThreshold: 2,
          readyReopenThreshold: 1,
          capacityRuleEnabled: true,
          capacityPerHourEnabled: false,
          capacityPerHourLimit: null,
        }}
        editingBranchId={8}
        branchEditor={{
          lateThreshold: "",
          lateReopenThreshold: "2",
          unassignedThreshold: "",
          unassignedReopenThreshold: "3",
          readyThreshold: "4",
          readyReopenThreshold: "1",
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
    expect(screen.getByLabelText("Late Reopen Threshold Override")).toHaveValue(2);
    expect(screen.getByLabelText("Unassigned Reopen Threshold Override")).toHaveValue(3);
    expect(screen.getByLabelText("Ready To Pickup Threshold Override")).toHaveValue(4);
    expect(screen.getByLabelText("Ready To Pickup Reopen Threshold Override")).toHaveValue(1);
    expect(screen.getByLabelText("Enable Capacity Rule")).not.toBeChecked();
    expect(screen.getByLabelText("Enable Capacity / Hour")).toBeChecked();
    expect(screen.getByDisplayValue("5")).toBeInTheDocument();
  });

  it("treats reopen-only overrides as custom effective branch thresholds", () => {
    render(
      <BranchThresholdOverrideManager
        branches={[
          {
            id: 9,
            name: "Branch C",
            chainName: "Chain B",
            ordersVendorId: 1003,
            availabilityVendorId: "2004",
            enabled: true,
            catalogState: "available",
            lateThresholdOverride: null,
            lateReopenThresholdOverride: 2,
            unassignedThresholdOverride: null,
            unassignedReopenThresholdOverride: null,
            readyThresholdOverride: null,
            readyReopenThresholdOverride: null,
            capacityRuleEnabledOverride: null,
            capacityPerHourEnabledOverride: null,
            capacityPerHourLimitOverride: null,
          },
        ]}
        chains={[{
          name: "Chain B",
          lateThreshold: 5,
          lateReopenThreshold: 0,
          unassignedThreshold: 7,
          unassignedReopenThreshold: 0,
          readyThreshold: 0,
          readyReopenThreshold: 0,
          capacityRuleEnabled: true,
          capacityPerHourEnabled: false,
          capacityPerHourLimit: null,
        }]}
        globalThresholds={{
          lateThreshold: 9,
          lateReopenThreshold: 0,
          unassignedThreshold: 9,
          unassignedReopenThreshold: 0,
          readyThreshold: 0,
          readyReopenThreshold: 0,
          capacityRuleEnabled: true,
          capacityPerHourEnabled: false,
          capacityPerHourLimit: null,
        }}
        editingBranchId={null}
        branchEditor={{
          lateThreshold: "",
          lateReopenThreshold: "",
          unassignedThreshold: "",
          unassignedReopenThreshold: "",
          readyThreshold: "",
          readyReopenThreshold: "",
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

    fireEvent.click(screen.getByText("Chain B"));

    expect(screen.getByText(/Custom • Orders 1003 • Availability 2004/i)).toBeInTheDocument();
    expect(screen.getByText("Late 5 -> 2")).toBeInTheDocument();
    expect(screen.getByText("Edit Custom Thresholds")).toBeInTheDocument();
  });
});
