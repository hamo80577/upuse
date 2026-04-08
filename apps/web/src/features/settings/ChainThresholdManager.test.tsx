import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ChainThresholdManager } from "./ChainThresholdManager";

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

describe("ChainThresholdManager", () => {
  it("opens a chain popup when a chain card is pressed while keeping the global defaults pinned", async () => {
    window.matchMedia = desktopMatchMedia as any;

    render(
      <ChainThresholdManager
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
          unassignedThreshold: 5,
          unassignedReopenThreshold: 1,
          readyThreshold: 2,
          readyReopenThreshold: 1,
        }}
        selectedChainName="Chain A"
        editingChainIndex={null}
        chainEditor={{
          name: "",
          lateThreshold: "5",
          lateReopenThreshold: "1",
          unassignedThreshold: "7",
          unassignedReopenThreshold: "2",
          readyThreshold: "3",
          readyReopenThreshold: "1",
          capacityRuleEnabled: true,
          capacityPerHourEnabled: true,
          capacityPerHourLimit: "5",
        }}
        chainEditorOpen={false}
        defaultEditor={{
          lateThreshold: "5",
          lateReopenThreshold: "1",
          unassignedThreshold: "5",
          unassignedReopenThreshold: "1",
          readyThreshold: "2",
          readyReopenThreshold: "1",
        }}
        defaultEditorOpen={false}
        onSelectChain={vi.fn()}
        onChangeDefaultEditor={vi.fn()}
        onOpenDefaults={vi.fn()}
        onCloseDefaults={vi.fn()}
        onSaveDefaults={vi.fn()}
        onChangeEditor={vi.fn()}
        onOpenNewChain={vi.fn()}
        onEditChain={vi.fn()}
        onRemoveChain={vi.fn()}
        onSaveChain={vi.fn()}
        onCancelEdit={vi.fn()}
        onOpenOverrides={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("Global Defaults")).toBeInTheDocument();
      expect(screen.getAllByText("Chain A").length).toBeGreaterThan(0);
    });

    fireEvent.click(screen.getAllByText("Chain A")[0]);

    await waitFor(() => {
      expect(screen.getByTestId("chain-details-dialog")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Edit Chain" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Branch Overrides" })).toBeInTheDocument();
    });
  });

  it("shows the chain editor side sheet when editing is open", async () => {
    window.matchMedia = desktopMatchMedia as any;

    render(
      <ChainThresholdManager
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
          unassignedThreshold: 5,
          unassignedReopenThreshold: 1,
          readyThreshold: 2,
          readyReopenThreshold: 1,
        }}
        selectedChainName="Chain A"
        editingChainIndex={0}
        chainEditor={{
          name: "Chain A",
          lateThreshold: "5",
          lateReopenThreshold: "1",
          unassignedThreshold: "7",
          unassignedReopenThreshold: "2",
          readyThreshold: "3",
          readyReopenThreshold: "1",
          capacityRuleEnabled: true,
          capacityPerHourEnabled: false,
          capacityPerHourLimit: "",
        }}
        chainEditorOpen
        defaultEditor={{
          lateThreshold: "5",
          lateReopenThreshold: "1",
          unassignedThreshold: "5",
          unassignedReopenThreshold: "1",
          readyThreshold: "2",
          readyReopenThreshold: "1",
        }}
        defaultEditorOpen={false}
        onSelectChain={vi.fn()}
        onChangeDefaultEditor={vi.fn()}
        onOpenDefaults={vi.fn()}
        onCloseDefaults={vi.fn()}
        onSaveDefaults={vi.fn()}
        onChangeEditor={vi.fn()}
        onOpenNewChain={vi.fn()}
        onEditChain={vi.fn()}
        onRemoveChain={vi.fn()}
        onSaveChain={vi.fn()}
        onCancelEdit={vi.fn()}
        onOpenOverrides={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId("chain-threshold-sheet")).toBeInTheDocument();
    });

    expect(screen.getByLabelText("Chain Name")).toHaveValue("Chain A");
    expect(screen.getByLabelText("Late Reopen Threshold")).toHaveValue(1);
    expect(screen.getByText("Edit Chain Workspace")).toBeInTheDocument();
  });
});
