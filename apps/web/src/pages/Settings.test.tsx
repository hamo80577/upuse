import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { TEST_GLOBAL_ENTITY_ID } from "../../../../test/globalEntityId";
import {
  UPUSE_MONITOR_MANAGE_CAPABILITY,
  UPUSE_SETTINGS_MANAGE_CAPABILITY,
  UPUSE_SETTINGS_TOKENS_MANAGE_CAPABILITY,
  UPUSE_SETTINGS_TOKENS_TEST_CAPABILITY,
  UPUSE_USERS_MANAGE_CAPABILITY,
} from "../systems/upuse/routes/capabilities";

const mockApi = vi.hoisted(() => ({
  dashboard: vi.fn(),
  getSettings: vi.fn(),
  listBranches: vi.fn(),
  startTokenTest: vi.fn(),
  getTokenTest: vi.fn(),
}));

const mockAuthState = vi.hoisted(() => ({
  value: null as any,
}));

vi.mock("../systems/upuse/api/client", () => ({
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

vi.mock("../systems/upuse/widgets/top-bar/ui/TopBar", () => ({
  TopBar: () => null,
}));

import { SettingsPage } from "./settings/ui/SettingsPage";

describe("SettingsPage", () => {
  beforeEach(() => {
    mockAuthState.value = {
      status: "authenticated",
      user: { name: "Test User" },
      systems: {
        upuse: {
          enabled: true,
          role: "user",
          roleLabel: "User",
          capabilities: [
            UPUSE_MONITOR_MANAGE_CAPABILITY,
            UPUSE_SETTINGS_MANAGE_CAPABILITY,
            UPUSE_SETTINGS_TOKENS_MANAGE_CAPABILITY,
            UPUSE_SETTINGS_TOKENS_TEST_CAPABILITY,
          ],
        },
        scano: {
          enabled: false,
          role: null,
          roleLabel: null,
          capabilities: [],
        },
      },
      hasSystemAccess: (systemId: string) => systemId === "upuse",
      hasSystemCapability: (systemId: string, capability: string) => (
        systemId === "upuse" && [
          UPUSE_USERS_MANAGE_CAPABILITY,
          UPUSE_MONITOR_MANAGE_CAPABILITY,
          UPUSE_SETTINGS_MANAGE_CAPABILITY,
          UPUSE_SETTINGS_TOKENS_MANAGE_CAPABILITY,
          UPUSE_SETTINGS_TOKENS_TEST_CAPABILITY,
        ].includes(capability)
      ),
      getSystemAccess: (systemId: string) => (
        systemId === "upuse"
          ? {
              enabled: true,
              role: "user",
              roleLabel: "User",
              capabilities: [
                UPUSE_MONITOR_MANAGE_CAPABILITY,
                UPUSE_SETTINGS_MANAGE_CAPABILITY,
                UPUSE_SETTINGS_TOKENS_MANAGE_CAPABILITY,
                UPUSE_SETTINGS_TOKENS_TEST_CAPABILITY,
              ],
            }
          : {
              enabled: false,
              role: null,
              roleLabel: null,
              capabilities: [],
            }
      ),
      logout: vi.fn(),
    };
    mockApi.dashboard.mockReset();
    mockApi.getSettings.mockReset();
    mockApi.listBranches.mockReset();
    mockApi.startTokenTest.mockReset();
    mockApi.getTokenTest.mockReset();
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
    mockApi.startTokenTest.mockResolvedValue({
      ok: true,
      jobId: "job-123",
      snapshot: {
        jobId: "job-123",
        status: "pending",
        createdAt: "2026-03-13T00:00:00.000Z",
        progress: {
          totalBranches: 0,
          processedBranches: 0,
          passedBranches: 0,
          failedBranches: 0,
          percent: 0,
        },
        availability: { configured: true, ok: false, status: null },
        orders: {
          configValid: false,
          ok: false,
          probe: { configured: false, ok: false, status: null },
          enabledBranchCount: 0,
          passedBranchCount: 0,
          failedBranchCount: 0,
          branches: [],
        },
      },
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
    expect(mockApi.listBranches).not.toHaveBeenCalled();
  });

  it("exposes token actions to non-admin roles that have token capabilities", async () => {
    mockAuthState.value = {
      status: "authenticated",
      user: { name: "Test User" },
      systems: {
        upuse: {
          enabled: true,
          role: "user",
          roleLabel: "User",
          capabilities: [
            UPUSE_MONITOR_MANAGE_CAPABILITY,
            UPUSE_SETTINGS_TOKENS_MANAGE_CAPABILITY,
            UPUSE_SETTINGS_TOKENS_TEST_CAPABILITY,
          ],
        },
        scano: {
          enabled: false,
          role: null,
          roleLabel: null,
          capabilities: [],
        },
      },
      hasSystemAccess: (systemId: string) => systemId === "upuse",
      hasSystemCapability: (systemId: string, capability: string) => (
        systemId === "upuse" && [
          UPUSE_USERS_MANAGE_CAPABILITY,
          UPUSE_MONITOR_MANAGE_CAPABILITY,
          UPUSE_SETTINGS_TOKENS_MANAGE_CAPABILITY,
          UPUSE_SETTINGS_TOKENS_TEST_CAPABILITY,
        ].includes(capability)
      ),
      getSystemAccess: (systemId: string) => (
        systemId === "upuse"
          ? {
              enabled: true,
              role: "user",
              roleLabel: "User",
              capabilities: [
                UPUSE_MONITOR_MANAGE_CAPABILITY,
                UPUSE_SETTINGS_TOKENS_MANAGE_CAPABILITY,
                UPUSE_SETTINGS_TOKENS_TEST_CAPABILITY,
              ],
            }
          : {
              enabled: false,
              role: null,
              roleLabel: null,
              capabilities: [],
            }
      ),
      logout: vi.fn(),
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

  it("tests the currently entered availability token without requiring a save first", async () => {
    render(
      <MemoryRouter>
        <SettingsPage />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(mockApi.getSettings).toHaveBeenCalled();
    });

    fireEvent.change(screen.getByLabelText("Availability API Token"), {
      target: { value: "  live-availability-token  " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Test Tokens" }));

    await waitFor(() => {
      expect(mockApi.startTokenTest).toHaveBeenCalledWith({
        availabilityToken: "live-availability-token",
      });
    });
  });
});
