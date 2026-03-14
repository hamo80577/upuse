import { render, screen, waitFor } from "@testing-library/react";
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
      chains: [{ name: "Chain A", lateThreshold: 5, unassignedThreshold: 5 }],
      lateThreshold: 5,
      unassignedThreshold: 5,
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
});
