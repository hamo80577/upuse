import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { TEST_GLOBAL_ENTITY_ID } from "../../../../test/globalEntityId";

const mockApi = vi.hoisted(() => ({
  dashboard: vi.fn(),
  getSettings: vi.fn(),
  listBranches: vi.fn(),
}));

const mockAuthState = vi.hoisted(() => ({
    value: {
      canManageMonitor: true,
      canManageThresholds: true,
      canManageSettings: true,
      canManageTokens: true,
      canTestTokens: true,
    canManage: true,
  },
}));

vi.mock("../api/client", () => ({
  api: mockApi,
  describeApiError: (error: unknown, fallback = "Request failed") => (error instanceof Error ? error.message : fallback),
}));

vi.mock("../app/providers/AuthProvider", () => ({
  useAuth: () => mockAuthState.value,
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

import { SettingsPage } from "./settings/ui/SettingsPage";

describe("SettingsPage", () => {
  beforeEach(() => {
    mockAuthState.value = {
      canManageMonitor: true,
      canManageThresholds: true,
      canManageSettings: true,
      canManageTokens: true,
      canTestTokens: true,
      canManage: true,
    };
    mockApi.dashboard.mockReset();
    mockApi.getSettings.mockReset();
    mockApi.listBranches.mockReset();
    mockApi.getSettings.mockResolvedValue({
      globalEntityId: TEST_GLOBAL_ENTITY_ID,
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
  });

  it("loads settings without fetching the full dashboard snapshot", async () => {
    render(
      <MemoryRouter>
        <SettingsPage />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(mockApi.getSettings).toHaveBeenCalled();
    });

    expect(mockApi.dashboard).not.toHaveBeenCalled();
    expect(mockApi.listBranches).not.toHaveBeenCalled();
  });

  it("exposes token actions to non-admin roles that have token capabilities", async () => {
    mockAuthState.value = {
      canManageMonitor: true,
      canManageThresholds: true,
      canManageSettings: false,
      canManageTokens: true,
      canTestTokens: true,
      canManage: false,
    };

    render(
      <MemoryRouter>
        <SettingsPage />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(mockApi.getSettings).toHaveBeenCalled();
    });

    expect(screen.getByLabelText("Orders API Token")).toBeInTheDocument();
    expect(screen.getByLabelText("Availability API Token")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Test Tokens" })).toBeInTheDocument();
    expect(screen.queryByText("Token management and token tests are not available for this role.")).not.toBeInTheDocument();
  });
});
