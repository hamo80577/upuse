import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BranchDetailResult, BranchSnapshot } from "../../../api/types";

const mockSetBranchMonitoring = vi.hoisted(() => vi.fn());
const mockRefreshDetail = vi.hoisted(() => vi.fn());
const mockLoadMoreLogs = vi.hoisted(() => vi.fn());
const mockClearLog = vi.hoisted(() => vi.fn());
const mockUseBranchDetailState = vi.hoisted(() => vi.fn());

vi.mock("../../../api/client", () => ({
  api: {
    setBranchMonitoring: mockSetBranchMonitoring,
  },
  describeApiError: (error: unknown, fallback = "Request failed") => (error instanceof Error ? error.message : fallback),
}));

vi.mock("../../../app/providers/AuthProvider", () => ({
  useAuth: () => ({
    canManage: true,
    canManageBranches: true,
  }),
}));

vi.mock("../../../features/branches/useBranchDetailState", () => ({
  useBranchDetailState: mockUseBranchDetailState,
}));

import { BranchDetailDialog } from "./BranchDetailDialog";

function createBranchSnapshot(overrides: Partial<BranchSnapshot> = {}): BranchSnapshot {
  return {
    branchId: 7,
    name: "Branch A",
    chainName: "Chain A",
    monitorEnabled: true,
    ordersVendorId: 101,
    availabilityVendorId: "201",
    status: "TEMP_CLOSE",
    statusColor: "red",
    closedUntil: "2026-03-08T14:30:00.000Z",
    closeStartedAt: "2026-03-08T14:00:00.000Z",
    closedByUpuse: true,
    closureSource: "UPUSE",
    closeReason: "UNASSIGNED",
    autoReopen: true,
    changeable: true,
    thresholds: {
      lateThreshold: 5,
      unassignedThreshold: 7,
      source: "chain",
    },
    metrics: {
      totalToday: 8,
      cancelledToday: 1,
      doneToday: 3,
      activeNow: 4,
      lateNow: 0,
      unassignedNow: 1,
    },
    lastUpdatedAt: "2026-03-08T14:05:00.000Z",
    ...overrides,
  };
}

function buildHookState(detail: BranchDetailResult | null) {
  return {
    detail,
    loading: false,
    refreshing: false,
    error: null,
    logDays: [],
    logLoading: false,
    logLoadingMore: false,
    hasMoreLogs: false,
    logError: null,
    clearingLog: false,
    nowMs: new Date("2026-03-08T14:20:00.000Z").getTime(),
    refreshDetail: mockRefreshDetail,
    loadMoreLogs: mockLoadMoreLogs,
    clearLog: mockClearLog,
  };
}

describe("BranchDetailDialog", () => {
  beforeEach(() => {
    mockSetBranchMonitoring.mockReset();
    mockRefreshDetail.mockReset();
    mockLoadMoreLogs.mockReset();
    mockClearLog.mockReset();
  });

  it("keeps the dialog operational for snapshot_unavailable responses", () => {
    mockUseBranchDetailState.mockReturnValue(buildHookState({
      kind: "snapshot_unavailable",
      branch: createBranchSnapshot({
        status: "UNKNOWN",
        statusColor: "grey",
        closedUntil: undefined,
        closeStartedAt: undefined,
        metrics: {
          totalToday: 12,
          cancelledToday: 1,
          doneToday: 6,
          activeNow: 5,
          lateNow: 1,
          unassignedNow: 2,
        },
      }),
      totals: {
        totalToday: 12,
        cancelledToday: 1,
        doneToday: 6,
        activeNow: 5,
        lateNow: 1,
        unassignedNow: 2,
      },
      fetchedAt: "2026-03-08T14:18:00.000Z",
      unassignedOrders: [],
      preparingOrders: [],
      message: "Live availability snapshot is currently unavailable. Showing orders detail from the latest Orders API response.",
    }));

    render(<BranchDetailDialog open branchId={7} branchSnapshot={createBranchSnapshot()} onClose={() => {}} />);

    expect(screen.getByText("Live availability snapshot is currently unavailable. Showing orders detail from the latest Orders API response.")).toBeInTheDocument();
    expect(screen.getByText("Unassigned Orders")).toBeInTheDocument();
    expect(screen.getByText("Recent Log")).toBeInTheDocument();
  });

  it("shows a warning but keeps summary and logs visible for detail_fetch_failed", () => {
    mockUseBranchDetailState.mockReturnValue(buildHookState({
      kind: "detail_fetch_failed",
      branch: createBranchSnapshot(),
      totals: createBranchSnapshot().metrics,
      fetchedAt: null,
      unassignedOrders: [],
      preparingOrders: [],
      message: "Live orders detail is temporarily unavailable. Orders API request failed",
    }));

    render(<BranchDetailDialog open branchId={7} branchSnapshot={createBranchSnapshot()} onClose={() => {}} />);

    expect(screen.getByText("Live orders detail is temporarily unavailable. Orders API request failed")).toBeInTheDocument();
    expect(screen.getByText("Recent Log")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Refresh detail" }));
    expect(mockRefreshDetail).toHaveBeenCalledTimes(1);
  });

  it("renders a compact hard-stop view for branch_not_found", () => {
    mockUseBranchDetailState.mockReturnValue(buildHookState({
      kind: "branch_not_found",
      branchId: 7,
      message: "Branch not found",
    }));

    render(<BranchDetailDialog open branchId={7} branchSnapshot={createBranchSnapshot()} onClose={() => {}} />);

    expect(screen.getByText("Branch detail unavailable")).toBeInTheDocument();
    expect(screen.getByText("Branch not found")).toBeInTheDocument();
    expect(screen.queryByText("Recent Log")).not.toBeInTheDocument();
  });

  it("renders fresher live branch state from the dashboard snapshot when it is newer than detail", () => {
    const detailBranch = createBranchSnapshot({
      closedUntil: "2026-03-08T14:30:00.000Z",
      closeStartedAt: "2026-03-08T14:00:00.000Z",
      lastUpdatedAt: "2026-03-08T14:05:00.000Z",
    });
    mockUseBranchDetailState.mockReturnValue(buildHookState({
      kind: "ok",
      branch: detailBranch,
      totals: detailBranch.metrics,
      fetchedAt: "2026-03-08T14:10:00.000Z",
      unassignedOrders: [],
      preparingOrders: [],
    }));

    render(
      <BranchDetailDialog
        open
        branchId={7}
        branchSnapshot={createBranchSnapshot({
          closedUntil: "2026-03-08T14:49:00.000Z",
          closeStartedAt: "2026-03-08T14:19:00.000Z",
          lastUpdatedAt: "2026-03-08T14:21:00.000Z",
        })}
        onClose={() => {}}
      />,
    );

    expect(screen.getByText("Reopens at 16:49")).toBeInTheDocument();
  });

  it("lets operators toggle whether the branch is included in monitor", async () => {
    mockSetBranchMonitoring.mockResolvedValue({
      ok: true,
      item: {
        id: 7,
        name: "Branch A",
        chainName: "Chain A",
        ordersVendorId: 101,
        availabilityVendorId: "201",
        globalEntityId: "HF_EG",
        enabled: false,
      },
    });
    mockUseBranchDetailState.mockReturnValue(buildHookState({
      kind: "ok",
      branch: createBranchSnapshot({ monitorEnabled: true, status: "OPEN", statusColor: "green" }),
      totals: createBranchSnapshot({ monitorEnabled: true, status: "OPEN", statusColor: "green" }).metrics,
      fetchedAt: "2026-03-08T14:10:00.000Z",
      unassignedOrders: [],
      preparingOrders: [],
    }));

    render(<BranchDetailDialog open branchId={7} branchSnapshot={createBranchSnapshot()} onClose={() => {}} />);

    fireEvent.click(screen.getByRole("checkbox", { name: "Toggle branch monitoring" }));

    await waitFor(() => {
      expect(mockSetBranchMonitoring).toHaveBeenCalledWith(7, false);
      expect(mockRefreshDetail).toHaveBeenCalledTimes(1);
    });
  });
});
