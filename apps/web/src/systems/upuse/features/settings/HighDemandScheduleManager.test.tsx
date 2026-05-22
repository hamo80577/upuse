import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { BranchMappingItem, ChainThreshold } from "../../api/types";
import { HighDemandScheduleManager } from "./HighDemandScheduleManager";

function chain(overrides: Partial<ChainThreshold> = {}): ChainThreshold {
  return {
    name: "Chain A",
    lateThreshold: 5,
    lateReopenThreshold: 0,
    unassignedThreshold: 5,
    unassignedReopenThreshold: 0,
    readyThreshold: 0,
    readyReopenThreshold: 0,
    readyMinAgeMinutes: 0,
    onHoldThreshold: 0,
    onHoldReopenThreshold: 0,
    capacityRuleEnabled: true,
    capacityPerHourEnabled: false,
    capacityPerHourLimit: null,
    ...overrides,
  };
}

function branch(overrides: Partial<BranchMappingItem> = {}): BranchMappingItem {
  return {
    id: 7,
    name: "Branch A",
    chainName: "Chain A",
    ordersVendorId: 101,
    availabilityVendorId: "201",
    enabled: true,
    catalogState: "available",
    lateThresholdOverride: null,
    lateReopenThresholdOverride: null,
    unassignedThresholdOverride: null,
    unassignedReopenThresholdOverride: null,
    readyThresholdOverride: null,
    readyReopenThresholdOverride: null,
    readyMinAgeMinutesOverride: null,
    onHoldThresholdOverride: null,
    onHoldReopenThresholdOverride: null,
    capacityRuleEnabledOverride: null,
    capacityPerHourEnabledOverride: null,
    capacityPerHourLimitOverride: null,
    highDemandScheduleOverride: null,
    ...overrides,
  };
}

describe("HighDemandScheduleManager", () => {
  it("keeps chain schedules inactive by default and reveals the 24-hour grid when enabled", async () => {
    const user = userEvent.setup();

    render(
      <HighDemandScheduleManager
        chains={[chain()]}
        branches={[]}
        readOnly={false}
        onSaveChains={vi.fn()}
        onSaveBranchOverride={vi.fn()}
      />,
    );

    expect(screen.queryByRole("button", { name: /select 3 pm - 4 pm/i })).not.toBeInTheDocument();

    await user.click(screen.getByRole("checkbox", { name: /enable high demand schedule for chain a/i }));

    expect(screen.getByRole("button", { name: /select 3 pm - 4 pm/i })).toBeInTheDocument();
  });

  it("persists selected chain hours in the expected payload", async () => {
    const user = userEvent.setup();
    const onSaveChains = vi.fn().mockResolvedValue(undefined);

    render(
      <HighDemandScheduleManager
        chains={[chain()]}
        branches={[]}
        readOnly={false}
        onSaveChains={onSaveChains}
        onSaveBranchOverride={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("checkbox", { name: /enable high demand schedule for chain a/i }));
    await user.click(screen.getByRole("button", { name: /select 3 pm - 4 pm/i }));
    await user.click(screen.getByRole("button", { name: /select 4 pm - 5 pm/i }));
    await user.click(screen.getByRole("button", { name: /save chain/i }));

    await waitFor(() => {
      expect(onSaveChains).toHaveBeenCalledWith([
        expect.objectContaining({
          name: "Chain A",
          highDemandSchedule: {
            enabled: true,
            hours: [15, 16],
          },
        }),
      ]);
    });
  });

  it("saves branch high demand override modes as inherit, custom, and disabled", async () => {
    const user = userEvent.setup();
    const selectedBranch = branch();
    const onSaveBranchOverride = vi.fn().mockResolvedValue(undefined);

    render(
      <HighDemandScheduleManager
        chains={[chain({ highDemandSchedule: { enabled: true, hours: [15] } })]}
        branches={[selectedBranch]}
        readOnly={false}
        onSaveChains={vi.fn()}
        onSaveBranchOverride={onSaveBranchOverride}
      />,
    );

    await user.click(screen.getByRole("button", { name: /^custom$/i }));
    const branchGrid = screen.getByRole("group", { name: /custom high demand hours for branch a/i });
    await user.click(within(branchGrid).getByRole("button", { name: /select 6 pm - 7 pm/i }));
    await user.click(screen.getByRole("button", { name: /save branch/i }));

    await waitFor(() => {
      expect(onSaveBranchOverride).toHaveBeenLastCalledWith(selectedBranch, {
        enabled: true,
        hours: [18],
      });
    });

    await user.click(screen.getByRole("button", { name: /^disabled$/i }));
    await user.click(screen.getByRole("button", { name: /save branch/i }));

    await waitFor(() => {
      expect(onSaveBranchOverride).toHaveBeenLastCalledWith(selectedBranch, {
        enabled: false,
        hours: [],
      });
    });

    await user.click(screen.getByRole("button", { name: /^inherited$/i }));
    await user.click(screen.getByRole("button", { name: /save branch/i }));

    await waitFor(() => {
      expect(onSaveBranchOverride).toHaveBeenLastCalledWith(selectedBranch, null);
    });
  });
});
