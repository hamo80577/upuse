import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BranchDetailResult, BranchSnapshot } from "../../../api/types";
import { UPUSE_LOGS_CLEAR_CAPABILITY } from "../../../routes/capabilities";

const mockRefreshDetail = vi.hoisted(() => vi.fn());
const mockLoadMoreLogs = vi.hoisted(() => vi.fn());
const mockClearLog = vi.hoisted(() => vi.fn());
const mockUseBranchDetailState = vi.hoisted(() => vi.fn());

vi.mock("../../../api/client", () => ({
  api: {},
  describeApiError: (error: unknown, fallback = "Request failed") => (error instanceof Error ? error.message : fallback),
}));

vi.mock("../../../app/providers/AuthProvider", () => ({
  useAuth: () => ({
    getSystemAccess: () => ({
      enabled: true,
      role: "admin",
      roleLabel: "Admin",
      capabilities: [UPUSE_LOGS_CLEAR_CAPABILITY],
    }),
    hasSystemCapability: (systemId: string, capability: string) => (
      systemId === "upuse" && capability === UPUSE_LOGS_CLEAR_CAPABILITY
    ),
  }),
}));

vi.mock("../../../features/branches/useBranchDetailState", () => ({
  useBranchDetailState: mockUseBranchDetailState,
}));

import { BranchDetailDialog } from "./BranchDetailDialog";

function emptyPickers() {
  return {
    todayCount: 0,
    activePreparingCount: 0,
    recentActiveCount: 0,
    items: [],
  };
}

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
    preparingNow: 3,
    preparingPickersNow: 2,
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
    pickers: detail && detail.kind !== "branch_not_found" ? detail.pickers : emptyPickers(),
    pickersLoading: false,
    pickersError: null,
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
      cacheState: "fresh",
      unassignedOrders: [],
      preparingOrders: [],
      readyToPickupOrders: [],
      pickers: emptyPickers(),
      message: "Live availability snapshot is currently unavailable. Showing orders detail from the latest Orders API response.",
    }));

    render(<BranchDetailDialog open branchId={7} branchSnapshot={createBranchSnapshot()} onClose={() => {}} />);

    expect(screen.getByText("Live availability snapshot is currently unavailable. Showing orders detail from the latest Orders API response.")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Queue" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Pickers" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Log" })).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "Overview" })).not.toBeInTheDocument();
    expect(screen.getByText("Live Operations")).toBeInTheDocument();
  }, 10_000);

  it("shows a warning but keeps summary and logs visible for detail_fetch_failed", () => {
    mockUseBranchDetailState.mockReturnValue(buildHookState({
      kind: "detail_fetch_failed",
      branch: createBranchSnapshot({ preparingNow: 3, preparingPickersNow: 2 }),
      totals: createBranchSnapshot().metrics,
      fetchedAt: null,
      cacheState: "warming",
      unassignedOrders: [],
      preparingOrders: [],
      readyToPickupOrders: [],
      pickers: emptyPickers(),
      message: "Live orders detail is temporarily unavailable. Orders API request failed",
    }));

    render(<BranchDetailDialog open branchId={7} branchSnapshot={createBranchSnapshot()} onClose={() => {}} />);

    expect(screen.getByText("Live orders detail is temporarily unavailable. Orders API request failed")).toBeInTheDocument();
    expect(screen.getAllByText("2 pickers").length).toBeGreaterThan(0);
    expect(screen.getByRole("tab", { name: "Log" })).toBeInTheDocument();
    expect(screen.getByText("Live Operations")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Refresh detail" }));
    expect(mockRefreshDetail).toHaveBeenCalledTimes(1);
  });

  it("shows recent active as unavailable when the orders cache is not fresh", () => {
    mockUseBranchDetailState.mockReturnValue(buildHookState({
      kind: "detail_fetch_failed",
      branch: createBranchSnapshot({ status: "OPEN", statusColor: "green" }),
      totals: createBranchSnapshot().metrics,
      fetchedAt: null,
      cacheState: "warming",
      unassignedOrders: [],
      preparingOrders: [],
      readyToPickupOrders: [],
      pickers: {
        todayCount: 4,
        activePreparingCount: 2,
        recentActiveCount: 3,
        items: [
          {
            shopperId: 90202,
            shopperFirstName: "Mohamed",
            ordersToday: 5,
            firstPickupAt: "2026-03-08T09:00:00.000Z",
            lastPickupAt: "2026-03-08T13:35:00.000Z",
            recentlyActive: true,
          },
        ],
      },
      message: "Live orders detail is temporarily unavailable. Orders API request failed",
    }));

    render(<BranchDetailDialog open branchId={7} branchSnapshot={createBranchSnapshot()} onClose={() => {}} />);

    fireEvent.click(screen.getByRole("tab", { name: "Pickers" }));

    expect(screen.getAllByText("Recent Active")).toHaveLength(1);
    expect(screen.getByText("--")).toBeInTheDocument();
  });

  it("renders a compact hard-stop view for branch_not_found", () => {
    mockUseBranchDetailState.mockReturnValue(buildHookState({
      kind: "branch_not_found",
      branchId: 7,
      message: "Branch not found",
    }));

    render(<BranchDetailDialog open branchId={7} branchSnapshot={createBranchSnapshot()} onClose={() => {}} />);

    expect(screen.getAllByText("Branch detail unavailable").length).toBeGreaterThan(0);
    expect(screen.getByText("Branch not found")).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: /Log/i })).not.toBeInTheDocument();
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
      cacheState: "fresh",
      unassignedOrders: [],
      preparingOrders: [],
      readyToPickupOrders: [],
      pickers: emptyPickers(),
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

    expect(screen.getByText("Reopens at")).toBeInTheDocument();
    expect(screen.getByText("16:49")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Pickers" })).toBeInTheDocument();
    expect(screen.getByText("Live Operations")).toBeInTheDocument();
  });

  it("shows picker analytics in the overview and picker tabs", () => {
    mockUseBranchDetailState.mockReturnValue(buildHookState({
      kind: "ok",
      branch: createBranchSnapshot({ monitorEnabled: true, status: "OPEN", statusColor: "green" }),
      totals: createBranchSnapshot({ monitorEnabled: true, status: "OPEN", statusColor: "green" }).metrics,
      fetchedAt: "2026-03-08T14:10:00.000Z",
      cacheState: "fresh",
      unassignedOrders: [],
      preparingOrders: [
        {
          id: "2",
          externalId: "ORD-2",
          status: "PREPARING",
          pickupAt: "2026-03-08T13:35:00.000Z",
          shopperId: 90202,
          shopperFirstName: "Mohamed",
          isUnassigned: false,
          isLate: false,
        },
      ],
      readyToPickupOrders: [],
      pickers: {
        todayCount: 4,
        activePreparingCount: 2,
        recentActiveCount: 3,
        items: [
          {
            shopperId: 90202,
            shopperFirstName: "Mohamed",
            ordersToday: 5,
            firstPickupAt: "2026-03-08T09:00:00.000Z",
            lastPickupAt: "2026-03-08T13:35:00.000Z",
            recentlyActive: true,
          },
        ],
      },
    }));

    render(<BranchDetailDialog open branchId={7} branchSnapshot={createBranchSnapshot()} onClose={() => {}} />);

    expect(screen.getAllByText("2 pickers").length).toBeGreaterThan(0);
    expect(screen.getByText("Live Operations")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "Queue" }));
    expect(screen.getByText("In Preparation")).toBeInTheDocument();
    expect(screen.getAllByText("2 pickers").length).toBeGreaterThan(0);
    expect(screen.queryByText("1 order • 2 pickers")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "Pickers" }));
    expect(screen.getByText("Mohamed")).toBeInTheDocument();
    expect(screen.getByText("5 orders")).toBeInTheDocument();
    expect(screen.getAllByText("Recent Active").length).toBeGreaterThan(0);
    expect(screen.getByText("Live Operations")).toBeInTheDocument();
  });

  it("renders ready-to-pickup orders in a separate queue section", () => {
    mockUseBranchDetailState.mockReturnValue(buildHookState({
      kind: "ok",
      branch: createBranchSnapshot({ monitorEnabled: true, status: "OPEN", statusColor: "green" }),
      totals: createBranchSnapshot({ monitorEnabled: true, status: "OPEN", statusColor: "green" }).metrics,
      fetchedAt: "2026-03-08T14:10:00.000Z",
      cacheState: "fresh",
      unassignedOrders: [],
      preparingOrders: [
        {
          id: "prep-1",
          externalId: "PREP-1",
          status: "PREPARING",
          pickupAt: "2026-03-08T13:35:00.000Z",
          shopperId: 90202,
          shopperFirstName: "Mohamed",
          isUnassigned: false,
          isLate: false,
        },
      ],
      readyToPickupOrders: [
        {
          id: "ready-1",
          externalId: "READY-7",
          status: "READY_FOR_PICKUP",
          pickupAt: "2026-03-08T13:45:00.000Z",
          shopperId: 90205,
          shopperFirstName: "Amina",
          isUnassigned: false,
          isLate: false,
        },
      ],
      pickers: {
        todayCount: 4,
        activePreparingCount: 1,
        recentActiveCount: 2,
        items: [],
      },
    }));

    render(<BranchDetailDialog open branchId={7} branchSnapshot={createBranchSnapshot()} onClose={() => {}} />);

    expect(screen.getByText("In Preparation")).toBeInTheDocument();
    expect(screen.getByText("Ready To Pickup")).toBeInTheDocument();
    expect(screen.getByText("#READY-7")).toBeInTheDocument();
    expect(screen.getAllByText("#READY-7")).toHaveLength(1);
  });

  it("keeps the branch snapshot shell visible while queue detail is still loading", () => {
    mockUseBranchDetailState.mockReturnValue({
      ...buildHookState(null),
      loading: true,
      detail: null,
    });

    render(<BranchDetailDialog open branchId={7} branchSnapshot={createBranchSnapshot({ status: "OPEN", statusColor: "green" })} onClose={() => {}} />);

    expect(screen.getByText("Branch A")).toBeInTheDocument();
    expect(screen.getByText("Live Operations")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Queue" })).toBeInTheDocument();
  });

  it("keeps close state context inside the status window instead of the header chips", () => {
    mockUseBranchDetailState.mockReturnValue(buildHookState({
      kind: "ok",
      branch: createBranchSnapshot(),
      totals: createBranchSnapshot().metrics,
      fetchedAt: "2026-03-08T14:10:00.000Z",
      cacheState: "fresh",
      unassignedOrders: [],
      preparingOrders: [],
      readyToPickupOrders: [],
      pickers: emptyPickers(),
    }));

    render(<BranchDetailDialog open branchId={7} branchSnapshot={createBranchSnapshot()} onClose={() => {}} />);

    expect(screen.getAllByText("Temporary Close")).toHaveLength(1);
    expect(screen.getByText("UPuse Control")).toBeInTheDocument();
    expect(screen.getByText("Unassigned Trigger")).toBeInTheDocument();
    expect(screen.getByLabelText("Unassigned Trigger")).toBeInTheDocument();
    expect(screen.queryByText("Late Trigger")).not.toBeInTheDocument();
  });

  it("shows the capacity trigger badge when the branch closed from overload", () => {
    mockUseBranchDetailState.mockReturnValue(buildHookState({
      kind: "ok",
      branch: createBranchSnapshot({
        closeReason: "CAPACITY",
        metrics: {
          ...createBranchSnapshot().metrics,
          activeNow: 10,
          unassignedNow: 0,
        },
      }),
      totals: createBranchSnapshot().metrics,
      fetchedAt: "2026-03-08T14:10:00.000Z",
      cacheState: "fresh",
      unassignedOrders: [],
      preparingOrders: [],
      readyToPickupOrders: [],
      pickers: emptyPickers(),
    }));

    render(
      <BranchDetailDialog
        open
        branchId={7}
        branchSnapshot={createBranchSnapshot({ closeReason: "CAPACITY" })}
        onClose={() => {}}
      />,
    );

    expect(screen.getByText("Capacity Trigger")).toBeInTheDocument();
    expect(screen.getByLabelText("Capacity Trigger")).toBeInTheDocument();
    expect(screen.queryByLabelText("Unassigned Trigger")).not.toBeInTheDocument();
  });
});
