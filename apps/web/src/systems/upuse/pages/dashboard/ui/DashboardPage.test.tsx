import { act, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DashboardSnapshot } from "../../../api/types";
import {
  UPUSE_FULL_WORKSPACE_CAPABILITY,
  UPUSE_MONITOR_MANAGE_CAPABILITY,
  UPUSE_MONITOR_ORDERS_REFRESH_CAPABILITY,
} from "../../../routes/capabilities";

const mockBranchDetail = vi.hoisted(() => vi.fn());
const mockUseDashboardPageState = vi.hoisted(() => vi.fn());
const mockOpsTrack = vi.hoisted(() => vi.fn());
const mockNavigate = vi.hoisted(() => vi.fn());
const mockUpuseCapabilities = vi.hoisted(() => new Set<string>());

vi.mock("../../../api/client", () => ({
  api: {
    branchDetail: mockBranchDetail,
  },
}));

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

vi.mock("../../../app/providers/AuthProvider", () => ({
  useAuth: () => ({
    hasSystemCapability: (systemId: string, capability: string) => (
      systemId === "upuse" && mockUpuseCapabilities.has(capability)
    ),
  }),
}));

vi.mock("../lib/useDashboardPageState", () => ({
  useDashboardPageState: mockUseDashboardPageState,
}));

vi.mock("../../../../ops/telemetry/opsTelemetryClient", () => ({
  opsTelemetry: {
    track: mockOpsTrack,
  },
}));

vi.mock("../../../widgets/top-bar/ui/TopBar", () => ({
  TopBar: () => <div>TopBar</div>,
}));

vi.mock("../../../widgets/operations-summary/ui/OperationsSummaryCard", () => ({
  OperationsSummaryCard: (props: { canOpenReport?: boolean }) => (
    <div>
      Summary
      {props.canOpenReport ? <button type="button">Download report</button> : null}
    </div>
  ),
}));

vi.mock("../../../features/dashboard/DashboardToolbarControls", () => ({
  DashboardToolbarControls: () => <div>Toolbar</div>,
}));

vi.mock("../../../features/dashboard/ChainGroupsSection", () => ({
  ChainGroupsSection: () => <div>Groups</div>,
}));

vi.mock("../../../widgets/branch-detail/ui/BranchDetailDialog", () => ({
  BranchDetailDialog: () => null,
}));

vi.mock("../../../features/reports/ui/ReportDownloadDialog", () => ({
  ReportDownloadDialog: () => null,
}));

import { DashboardPage } from "./DashboardPage";

const baseSnapshot: DashboardSnapshot = {
    monitoring: {
      running: true,
      lastOrdersFetchAt: "2026-03-10T12:00:00.000Z",
      lastAvailabilityFetchAt: "2026-03-10T12:00:00.000Z",
      lastHealthyAt: "2026-03-10T12:00:00.000Z",
    degraded: false,
      ordersSync: {
        mode: "mirror",
        state: "healthy",
        lastSuccessfulSyncAt: "2026-03-10T12:00:00.000Z",
        staleBranchCount: 0,
        consecutiveSourceFailures: 0,
      },
      availabilitySync: {
        state: "healthy",
        cadenceSeconds: 15,
        lastAttemptAt: "2026-03-10T12:00:00.000Z",
        lastSuccessfulSyncAt: "2026-03-10T12:00:00.000Z",
        consecutiveFailures: 0,
      },
      errors: {},
    },
  totals: {
    branchesMonitored: 1,
    open: 1,
    tempClose: 0,
    closed: 0,
    unknown: 0,
    ordersToday: 10,
    cancelledToday: 1,
    doneToday: 6,
    activeNow: 4,
    lateNow: 0,
    unassignedNow: 1,
  },
  branches: [
    {
      branchId: 7,
      name: "Branch A",
      chainName: "Chain A",
      monitorEnabled: true,
      ordersVendorId: 101,
      availabilityVendorId: "201",
      status: "OPEN",
      statusColor: "green",
      ordersDataState: "fresh",
      metrics: {
        totalToday: 10,
        cancelledToday: 1,
        doneToday: 6,
        activeNow: 4,
        lateNow: 0,
        unassignedNow: 1,
      },
      preparingNow: 3,
      preparingPickersNow: 2,
      lastUpdatedAt: "2026-03-10T12:00:00.000Z",
    },
  ],
};

describe("DashboardPage", () => {
  beforeEach(() => {
    mockBranchDetail.mockReset();
    mockUseDashboardPageState.mockReset();
    mockOpsTrack.mockReset();
    mockNavigate.mockReset();
    mockUpuseCapabilities.clear();
    mockUpuseCapabilities.add(UPUSE_FULL_WORKSPACE_CAPABILITY);
    mockUpuseCapabilities.add(UPUSE_MONITOR_MANAGE_CAPABILITY);
    mockUpuseCapabilities.add(UPUSE_MONITOR_ORDERS_REFRESH_CAPABILITY);
    mockUseDashboardPageState.mockReturnValue({
      snap: baseSnapshot,
      connectionState: "live",
      latestMonitoringUpdateAt: baseSnapshot.monitoring.lastHealthyAt,
      syncAgeMs: 0,
      staleThresholdMs: 60_000,
      isSyncStale: false,
      syncRecovering: false,
      syncError: null,
      toast: null,
      setToast: vi.fn(),
      detailBranchId: null,
      selectedBranch: null,
      reportDialogOpen: false,
      setReportDialogOpen: vi.fn(),
      expandedGroups: {},
      screenLoading: null,
      onStart: vi.fn(),
      onStop: vi.fn(),
      onRefreshNowWithLoading: vi.fn(),
      openBranchDetail: vi.fn(),
      closeBranchDetail: vi.fn(),
      toggleGroup: vi.fn(),
    });
  });

  it("does not fetch branch detail while rendering outer branch cards", async () => {
    await act(async () => {
      render(<DashboardPage />);
      await Promise.resolve();
    });

    expect(mockBranchDetail).not.toHaveBeenCalled();
  });

  it("emits the dashboard opened telemetry event on mount", () => {
    render(<DashboardPage />);

    expect(mockOpsTrack).toHaveBeenCalledWith("dashboard_opened");
  });

  it("renders a polished sync issue banner for tunnel failures", () => {
    mockUseDashboardPageState.mockReturnValue({
      snap: baseSnapshot,
      connectionState: "disconnected",
      latestMonitoringUpdateAt: baseSnapshot.monitoring.lastHealthyAt,
      syncAgeMs: 0,
      staleThresholdMs: 60_000,
      isSyncStale: false,
      syncRecovering: false,
      syncError: "Cloudflare tunnel is temporarily unavailable. Please try again in a moment.",
      toast: null,
      setToast: vi.fn(),
      detailBranchId: null,
      selectedBranch: null,
      reportDialogOpen: false,
      setReportDialogOpen: vi.fn(),
      expandedGroups: {},
      screenLoading: null,
      onStart: vi.fn(),
      onStop: vi.fn(),
      onRefreshNowWithLoading: vi.fn(),
      openBranchDetail: vi.fn(),
      closeBranchDetail: vi.fn(),
      toggleGroup: vi.fn(),
    });

    render(<DashboardPage />);

    expect(screen.getByText("Dashboard tunnel unavailable")).toBeInTheDocument();
    expect(screen.getByText("Cloudflare tunnel is temporarily unavailable. Please try again in a moment.")).toBeInTheDocument();
  });

  it("renders a cleaned orders issue card instead of the raw monitor error string", () => {
    mockUseDashboardPageState.mockReturnValue({
      snap: {
        ...baseSnapshot,
        monitoring: {
          ...baseSnapshot.monitoring,
          degraded: true,
          ordersSync: {
            mode: "mirror",
            state: "degraded",
            lastSuccessfulSyncAt: "2026-03-10T12:00:00.000Z",
            staleBranchCount: 1,
            consecutiveSourceFailures: 2,
          },
          errors: {
            orders: {
              source: "orders",
              category: "tunnel",
              summary: "Orders tunnel unavailable",
              message: "Orders sync could not reach the upstream because a tunnel or edge page was returned instead of API data. Cloudflare tunnel error",
              actionHint: "Cached orders can stay visible for a while, but live counts will drift until the upstream route recovers.",
              at: "2026-03-10T12:05:00.000Z",
              statusCode: 530,
              retryable: true,
            },
          },
        },
      },
      connectionState: "live",
      latestMonitoringUpdateAt: baseSnapshot.monitoring.lastHealthyAt,
      syncAgeMs: 0,
      staleThresholdMs: 60_000,
      isSyncStale: false,
      syncRecovering: false,
      syncError: null,
      toast: null,
      setToast: vi.fn(),
      detailBranchId: null,
      selectedBranch: null,
      reportDialogOpen: false,
      setReportDialogOpen: vi.fn(),
      expandedGroups: {},
      screenLoading: null,
      onStart: vi.fn(),
      onStop: vi.fn(),
      onRefreshNowWithLoading: vi.fn(),
      openBranchDetail: vi.fn(),
      closeBranchDetail: vi.fn(),
      toggleGroup: vi.fn(),
    });

    render(<DashboardPage />);

    expect(screen.getByText("Orders tunnel unavailable")).toBeInTheDocument();
    expect(screen.getByText("Orders sync could not reach the upstream because a tunnel or edge page was returned instead of API data. Cloudflare tunnel error")).toBeInTheDocument();
    expect(screen.getByText("Stop Monitor")).toBeInTheDocument();
  });

  it("renders a token guidance banner for degraded availability auth issues", () => {
    mockUseDashboardPageState.mockReturnValue({
      snap: {
        ...baseSnapshot,
        monitoring: {
          ...baseSnapshot.monitoring,
          degraded: true,
          availabilitySync: {
            state: "degraded",
            cadenceSeconds: 15,
            lastAttemptAt: "2026-03-10T12:05:00.000Z",
            lastSuccessfulSyncAt: "2026-03-10T12:00:00.000Z",
            consecutiveFailures: 2,
            error: {
              source: "availability",
              category: "auth",
              summary: "Availability authentication failed",
              message: "VSS availability sync is blocked because the upstream rejected the current credentials.",
              actionHint: "Open Settings > Tokens to update or test the Availability API token.",
              at: "2026-03-10T12:05:00.000Z",
              statusCode: 401,
              retryable: false,
            },
          },
          errors: {},
        },
      },
      connectionState: "live",
      latestMonitoringUpdateAt: baseSnapshot.monitoring.lastHealthyAt,
      syncAgeMs: 0,
      staleThresholdMs: 60_000,
      isSyncStale: false,
      syncRecovering: false,
      syncError: null,
      toast: null,
      setToast: vi.fn(),
      detailBranchId: null,
      selectedBranch: null,
      reportDialogOpen: false,
      setReportDialogOpen: vi.fn(),
      expandedGroups: {},
      screenLoading: null,
      onStart: vi.fn(),
      onStop: vi.fn(),
      onRefreshNowWithLoading: vi.fn(),
      openBranchDetail: vi.fn(),
      closeBranchDetail: vi.fn(),
      toggleGroup: vi.fn(),
    });

    render(<DashboardPage />);

    expect(screen.getByText("Availability authentication failed")).toBeInTheDocument();
    expect(screen.getByText("VSS availability sync is blocked because the upstream rejected the current credentials.")).toBeInTheDocument();
    expect(screen.getByText("Open Tokens")).toBeInTheDocument();
  });

  it("hides report and settings actions when the user only has tracker dashboard access", () => {
    mockUpuseCapabilities.clear();
    mockUseDashboardPageState.mockReturnValue({
      snap: {
        ...baseSnapshot,
        monitoring: {
          ...baseSnapshot.monitoring,
          degraded: true,
          availabilitySync: {
            state: "degraded",
            cadenceSeconds: 15,
            lastAttemptAt: "2026-03-10T12:05:00.000Z",
            lastSuccessfulSyncAt: "2026-03-10T12:00:00.000Z",
            consecutiveFailures: 2,
            error: {
              source: "availability",
              category: "auth",
              summary: "Availability authentication failed",
              message: "VSS availability sync is blocked because the upstream rejected the current credentials.",
              actionHint: "Open Settings > Tokens to update or test the Availability API token.",
              at: "2026-03-10T12:05:00.000Z",
              statusCode: 401,
              retryable: false,
            },
          },
          errors: {},
        },
      },
      connectionState: "live",
      latestMonitoringUpdateAt: baseSnapshot.monitoring.lastHealthyAt,
      syncAgeMs: 0,
      staleThresholdMs: 60_000,
      isSyncStale: false,
      syncRecovering: false,
      syncError: null,
      toast: null,
      setToast: vi.fn(),
      detailBranchId: null,
      selectedBranch: null,
      reportDialogOpen: false,
      setReportDialogOpen: vi.fn(),
      expandedGroups: {},
      screenLoading: null,
      onStart: vi.fn(),
      onStop: vi.fn(),
      onRefreshNowWithLoading: vi.fn(),
      openBranchDetail: vi.fn(),
      closeBranchDetail: vi.fn(),
      toggleGroup: vi.fn(),
    });

    render(<DashboardPage />);

    expect(screen.getByText("Availability authentication failed")).toBeInTheDocument();
    expect(screen.queryByText("Open Tokens")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Download report" })).not.toBeInTheDocument();
  });
});
