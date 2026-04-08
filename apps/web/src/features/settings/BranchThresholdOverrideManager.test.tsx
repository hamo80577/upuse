import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BranchThresholdOverrideManager } from "./BranchThresholdOverrideManager";

const desktopMatchMedia = vi.fn().mockImplementation(() => ({
  matches: false,
  media: "",
  onchange: null,
  addListener: vi.fn(),
  removeListener: vi.fn(),
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
  dispatchEvent: vi.fn(),
}));

afterEach(() => {
  window.matchMedia = desktopMatchMedia as any;
});

describe("BranchThresholdOverrideManager", () => {
  it("opens a branch popup when a branch card is selected, even with a null chain name", async () => {
    window.matchMedia = desktopMatchMedia as any;

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
        chainFilter="all"
        onChainFilterChange={vi.fn()}
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

    await waitFor(() => {
      expect(screen.getAllByText("Branch A").length).toBeGreaterThan(0);
      expect(screen.getAllByText(/No Chain/i).length).toBeGreaterThan(0);
      expect(screen.getByText("Late Orders")).toBeInTheDocument();
    });

    fireEvent.click(screen.getAllByText("Branch A")[0]);

    await waitFor(() => {
      expect(screen.getByTestId("branch-details-dialog")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Edit Override" })).toBeInTheDocument();
    });
  });

  it("keeps matching branches visible when the chain filter casing or spaces differ", async () => {
    window.matchMedia = desktopMatchMedia as any;

    render(
      <BranchThresholdOverrideManager
        branches={[
          {
            id: 10,
            name: "Branch D",
            chainName: "Chain A",
            ordersVendorId: 1004,
            availabilityVendorId: "2005",
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
        chains={[{
          name: "Chain A",
          lateThreshold: 5,
          lateReopenThreshold: 1,
          unassignedThreshold: 7,
          unassignedReopenThreshold: 2,
          readyThreshold: 3,
          readyReopenThreshold: 1,
          capacityRuleEnabled: true,
          capacityPerHourEnabled: false,
          capacityPerHourLimit: null,
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
        chainFilter="  chain a  "
        onChainFilterChange={vi.fn()}
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

    await waitFor(() => {
      expect(screen.getAllByText("Branch D").length).toBeGreaterThan(0);
      expect(screen.getByText("Late Orders")).toBeInTheDocument();
    });

    expect(screen.queryByText("No branches match the current filters.")).not.toBeInTheDocument();
  });

  it("shows the override drawer fields for the selected branch", async () => {
    window.matchMedia = desktopMatchMedia as any;

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
        chainFilter="all"
        onChainFilterChange={vi.fn()}
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

    await waitFor(() => {
      expect(screen.getByTestId("branch-override-sheet")).toBeInTheDocument();
    });

    expect(screen.getByLabelText("Late Reopen Threshold Override")).toHaveValue(2);
    expect(screen.getByLabelText("Unassigned Reopen Threshold Override")).toHaveValue(3);
    expect(screen.getByLabelText("Ready Threshold Override")).toHaveValue(4);
    expect(screen.getByLabelText("Ready Reopen Threshold Override")).toHaveValue(1);
    expect(screen.getByText("Edit Override")).toBeInTheDocument();
  });

  it("uses a bottom sheet on mobile", async () => {
    window.matchMedia = vi.fn().mockImplementation(() => ({
      matches: true,
      media: "",
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })) as any;

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
            lateThresholdOverride: 6,
            lateReopenThresholdOverride: 2,
            unassignedThresholdOverride: 7,
            unassignedReopenThresholdOverride: 3,
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
          lateReopenThreshold: 1,
          unassignedThreshold: 7,
          unassignedReopenThreshold: 2,
          readyThreshold: 0,
          readyReopenThreshold: 0,
          capacityRuleEnabled: true,
          capacityPerHourEnabled: false,
          capacityPerHourLimit: null,
        }]}
        globalThresholds={{
          lateThreshold: 5,
          lateReopenThreshold: 1,
          unassignedThreshold: 7,
          unassignedReopenThreshold: 2,
          readyThreshold: 0,
          readyReopenThreshold: 0,
          capacityRuleEnabled: true,
          capacityPerHourEnabled: false,
          capacityPerHourLimit: null,
        }}
        chainFilter="all"
        onChainFilterChange={vi.fn()}
        editingBranchId={9}
        branchEditor={{
          lateThreshold: "6",
          lateReopenThreshold: "2",
          unassignedThreshold: "7",
          unassignedReopenThreshold: "3",
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

    await waitFor(() => {
      expect(screen.getByTestId("branch-override-sheet")).toHaveAttribute("data-anchor", "bottom");
    });
  });
});
