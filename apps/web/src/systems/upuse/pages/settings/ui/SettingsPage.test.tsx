import { render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { UPUSE_SETTINGS_TOKENS_TEST_CAPABILITY } from "../../../routes/capabilities";

const mockApi = vi.hoisted(() => ({
  getSettings: vi.fn(),
}));
const mockOpsTrack = vi.hoisted(() => vi.fn());

vi.mock("../../../api/client", () => ({
  api: mockApi,
  describeApiError: (error: unknown, fallback = "Request failed") => (error instanceof Error ? error.message : fallback),
}));

vi.mock("../../../app/providers/AuthProvider", () => ({
  useAuth: () => ({
    hasSystemCapability: (_systemId: string, capability: string) => capability === UPUSE_SETTINGS_TOKENS_TEST_CAPABILITY,
  }),
}));

vi.mock("../../../app/providers/MonitorStatusProvider", () => ({
  useMonitorStatus: () => ({
    monitoring: { running: false, degraded: false },
    startMonitoring: vi.fn(),
    stopMonitoring: vi.fn(),
  }),
}));

vi.mock("../../../widgets/top-bar/ui/TopBar", () => ({
  TopBar: () => null,
}));

vi.mock("../../../../ops/telemetry/opsTelemetryClient", () => ({
  opsTelemetry: {
    track: mockOpsTrack,
  },
}));

import { SettingsPage } from "./SettingsPage";

describe("SettingsPage telemetry", () => {
  beforeEach(() => {
    mockApi.getSettings.mockReset();
    mockOpsTrack.mockReset();
    mockApi.getSettings.mockResolvedValue({
      globalEntityId: "test-entity",
      ordersToken: "",
      availabilityToken: "",
      chainNames: [],
      chains: [],
      lateThreshold: 5,
      unassignedThreshold: 5,
      tempCloseMinutes: 30,
      graceMinutes: 5,
      ordersRefreshSeconds: 30,
      availabilityRefreshSeconds: 30,
      maxVendorsPerOrdersRequest: 50,
    });
  });

  it("emits the settings opened telemetry event on mount", async () => {
    render(
      <MemoryRouter>
        <SettingsPage />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(mockApi.getSettings).toHaveBeenCalled();
    });
    expect(mockOpsTrack).toHaveBeenCalledWith("settings_opened");
  });
});
