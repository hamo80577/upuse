import { render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";

const mockApi = vi.hoisted(() => ({
  dashboard: vi.fn(),
  getSettings: vi.fn(),
}));

vi.mock("../api/client", () => ({
  api: mockApi,
  clearStoredAdminKey: vi.fn(),
  describeApiError: (error: unknown, fallback = "Request failed") => (error instanceof Error ? error.message : fallback),
  getStoredAdminKey: vi.fn(() => ""),
  setStoredAdminKey: vi.fn(),
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

vi.mock("../features/settings/ChainThresholdManager", () => ({
  ChainThresholdManager: () => null,
}));

import { SettingsPage } from "./Settings";

describe("SettingsPage", () => {
  beforeEach(() => {
    mockApi.dashboard.mockReset();
    mockApi.getSettings.mockReset();
    mockApi.getSettings.mockResolvedValue({
      ordersToken: "",
      availabilityToken: "",
      globalEntityId: "HF_EG",
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
  });
});
