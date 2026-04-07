import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";

const mockApi = vi.hoisted(() => ({
  dashboard: vi.fn(),
  getSettings: vi.fn(),
  listBranches: vi.fn(),
  listBranchSource: vi.fn(),
}));

vi.mock("../api/client", () => ({
  api: mockApi,
  describeApiError: (error: unknown, fallback = "Request failed") => (error instanceof Error ? error.message : fallback),
}));

vi.mock("../app/providers/AuthProvider", () => ({
  useAuth: () => ({
    canManageMonitor: true,
    canManageThresholds: true,
    canManageSettings: true,
    canManageTokens: true,
    canTestTokens: true,
    canManage: true,
  }),
}));

vi.mock("../app/providers/MonitorStatusProvider", () => ({
  useMonitorStatus: () => ({
    monitoring: { running: true, degraded: false },
    refreshStatus: vi.fn(),
    startMonitoring: vi.fn(),
    stopMonitoring: vi.fn(),
  }),
}));

vi.mock("../widgets/top-bar/ui/TopBar", () => ({
  TopBar: () => null,
}));

vi.mock("../features/settings/ChainThresholdManager", () => ({
  ChainThresholdManager: () => null,
}));

vi.mock("../features/settings/BranchThresholdOverrideManager", () => ({
  BranchThresholdOverrideManager: () => null,
}));

import { ThresholdsPage } from "./thresholds/ui/ThresholdsPage";

describe("ThresholdsPage", () => {
  beforeEach(() => {
    mockApi.dashboard.mockReset();
    mockApi.getSettings.mockReset();
    mockApi.listBranches.mockReset();
    mockApi.listBranchSource.mockReset();
    mockApi.getSettings.mockResolvedValue({
      globalEntityId: "TEST_ENTITY",
      ordersToken: "",
      availabilityToken: "",
      chainNames: ["Chain A"],
      chains: [{
        name: "Chain A",
        lateThreshold: 5,
        lateReopenThreshold: 1,
        unassignedThreshold: 5,
        unassignedReopenThreshold: 1,
        readyThreshold: 2,
        readyReopenThreshold: 1,
      }],
      lateThreshold: 5,
      lateReopenThreshold: 1,
      unassignedThreshold: 5,
      unassignedReopenThreshold: 1,
      readyThreshold: 2,
      readyReopenThreshold: 1,
      tempCloseMinutes: 30,
      graceMinutes: 5,
      ordersRefreshSeconds: 30,
      availabilityRefreshSeconds: 30,
      maxVendorsPerOrdersRequest: 50,
    });
    mockApi.listBranches.mockResolvedValue({ items: [] });
    mockApi.listBranchSource.mockResolvedValue({ items: [] });
  });

  it("loads threshold data without fetching the full dashboard snapshot", async () => {
    render(
      <MemoryRouter>
        <ThresholdsPage />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(mockApi.getSettings).toHaveBeenCalled();
      expect(mockApi.listBranches).toHaveBeenCalled();
      expect(mockApi.listBranchSource).toHaveBeenCalled();
    });

    expect(mockApi.dashboard).not.toHaveBeenCalled();
    expect(screen.queryByText("Add From Local Source")).not.toBeInTheDocument();
  });

  it("shows default thresholds only in the chains tab", async () => {
    render(
      <MemoryRouter>
        <ThresholdsPage />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByLabelText("Default Late Threshold")).toBeInTheDocument();
      expect(screen.getByLabelText("Default Late Reopen Threshold")).toBeInTheDocument();
      expect(screen.getByLabelText("Default Unassigned Threshold")).toBeInTheDocument();
      expect(screen.getByLabelText("Default Unassigned Reopen Threshold")).toBeInTheDocument();
      expect(screen.getByLabelText("Default Ready To Pickup Threshold")).toBeInTheDocument();
      expect(screen.getByLabelText("Default Ready To Pickup Reopen Threshold")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("tab", { name: "Overrides" }));

    expect(screen.queryByLabelText("Default Late Threshold")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Default Late Reopen Threshold")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Default Unassigned Threshold")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Default Unassigned Reopen Threshold")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Default Ready To Pickup Threshold")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Default Ready To Pickup Reopen Threshold")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save Defaults" })).not.toBeInTheDocument();
  });
});
