import type { ReactNode } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";

const mockApi = vi.hoisted(() => ({
  dashboard: vi.fn(),
  getSettings: vi.fn(),
  listBranches: vi.fn(),
  listBranchSource: vi.fn(),
}));

const authState = vi.hoisted(() => ({
  canManageMonitor: true,
  canManageThresholds: true,
}));

vi.mock("motion/react", () => ({
  AnimatePresence: ({ children }: { children?: ReactNode }) => <>{children}</>,
  motion: {
    div: ({
      children,
      initial: _initial,
      animate: _animate,
      exit: _exit,
      transition: _transition,
      ...props
    }: {
      children?: ReactNode;
      initial?: unknown;
      animate?: unknown;
      exit?: unknown;
      transition?: unknown;
    }) => <div {...props}>{children}</div>,
  },
  useReducedMotion: () => true,
}));

vi.mock("../api/client", () => ({
  api: mockApi,
  describeApiError: (error: unknown, fallback = "Request failed") => (error instanceof Error ? error.message : fallback),
}));

vi.mock("../app/providers/AuthProvider", () => ({
  useAuth: () => ({
    ...authState,
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
  ChainThresholdManager: (props: any) => (
    <div data-testid="chains-studio">
      <div>{props.readOnly ? "chains-read-only" : "chains-editable"}</div>
      <div>Selected Chain: {props.selectedChainName ?? "none"}</div>
      <button type="button" onClick={() => props.onOpenOverrides("Chain A")}>
        Jump To Chain A Overrides
      </button>
    </div>
  ),
}));

vi.mock("../features/settings/BranchThresholdOverrideManager", () => ({
  BranchThresholdOverrideManager: (props: any) => (
    <div data-testid="overrides-studio">
      <div>{props.readOnly ? "overrides-read-only" : "overrides-editable"}</div>
      <div>Active Chain Filter: {props.chainFilter}</div>
    </div>
  ),
}));

import { ThresholdsPage } from "./thresholds/ui/ThresholdsPage";

describe("ThresholdsPage", () => {
  beforeEach(() => {
    authState.canManageMonitor = true;
    authState.canManageThresholds = true;
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
    mockApi.listBranches.mockResolvedValue({
      items: [{
        id: 1,
        name: "Branch A",
        chainName: "Chain A",
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
      }],
    });
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
    expect(screen.getByText("Rule Control Studio")).toBeInTheDocument();
    expect(screen.getByTestId("chains-studio")).toBeInTheDocument();
  });

  it("hands a selected chain into overrides mode while keeping the filter", async () => {
    render(
      <MemoryRouter>
        <ThresholdsPage />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("chains-studio")).toBeInTheDocument();
      expect(screen.getByText("Selected Chain: Chain A")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Jump To Chain A Overrides" }));

    await waitFor(() => {
      expect(screen.getByTestId("overrides-studio")).toBeInTheDocument();
      expect(screen.getByText("Active Chain Filter: Chain A")).toBeInTheDocument();
    });
  });

  it("passes read-only mode through to the studios when thresholds cannot be managed", async () => {
    authState.canManageThresholds = false;

    render(
      <MemoryRouter>
        <ThresholdsPage />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText("chains-read-only")).toBeInTheDocument();
    });

    expect(screen.getByText("You can review thresholds, but editing actions are disabled for your role.")).toBeInTheDocument();
  });
});
