import { act, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DashboardSnapshot } from "../../../api/types";

const mockBranchDetail = vi.hoisted(() => vi.fn());
const mockUseDashboardPageState = vi.hoisted(() => vi.fn());

vi.mock("../../../api/client", () => ({
  api: {
    branchDetail: mockBranchDetail,
  },
}));

vi.mock("../../../app/providers/AuthProvider", () => ({
  useAuth: () => ({
    canManageMonitor: true,
    canRefreshOrdersNow: true,
  }),
}));

vi.mock("../lib/useDashboardPageState", () => ({
  useDashboardPageState: mockUseDashboardPageState,
}));

vi.mock("../../../widgets/top-bar/ui/TopBar", () => ({
  TopBar: () => <div>TopBar</div>,
}));

vi.mock("../../../widgets/operations-summary/ui/OperationsSummaryCard", () => ({
  OperationsSummaryCard: () => <div>Summary</div>,
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
              message: "Orders API request failed (HTTP 530): Cloudflare tunnel error",
              at: "2026-03-10T12:05:00.000Z",
              statusCode: 530,
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

    expect(screen.getByText("Orders feed unavailable")).toBeInTheDocument();
    expect(screen.getByText("Cloudflare tunnel is temporarily unavailable.")).toBeInTheDocument();
    expect(screen.getByText("Stop Monitor")).toBeInTheDocument();
    expect(screen.queryByText("Orders API request failed (HTTP 530): Cloudflare tunnel error")).not.toBeInTheDocument();
  });
});
