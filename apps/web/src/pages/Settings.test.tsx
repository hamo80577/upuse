import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";

const mockApi = vi.hoisted(() => ({
  dashboard: vi.fn(),
  getSettings: vi.fn(),
  listBranches: vi.fn(),
}));

const mockAuthState = vi.hoisted(() => ({
  value: {
    canManageMonitor: true,
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

vi.mock("../components/TopBar", () => ({
  TopBar: () => null,
}));

import { SettingsPage } from "./Settings";

describe("SettingsPage", () => {
  beforeEach(() => {
    mockAuthState.value = {
      canManageMonitor: true,
      canManageSettings: true,
      canManageTokens: true,
      canTestTokens: true,
      canManage: true,
    };
    mockApi.dashboard.mockReset();
    mockApi.getSettings.mockReset();
    mockApi.listBranches.mockReset();
    mockApi.getSettings.mockResolvedValue({
      globalEntityId: "HF_EG",
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

  it("does not expose token actions to restricted roles", async () => {
    mockAuthState.value = {
      canManageMonitor: true,
      canManageSettings: false,
      canManageTokens: false,
      canTestTokens: false,
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

    expect(screen.queryByLabelText("Orders API Token")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Availability API Token")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Test Tokens" })).not.toBeInTheDocument();
    expect(screen.getByText("Token management and token tests are restricted to admins.")).toBeInTheDocument();
  });
});
