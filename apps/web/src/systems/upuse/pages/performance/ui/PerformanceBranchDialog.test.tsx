import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PerformanceBranchDialog } from "./PerformanceBranchDialog";

const TEST_TIMEOUT_MS = 15_000;

const subject = {
  vendorId: 112,
  name: "Heliopolis",
  statusColor: "green" as const,
  totalOrders: 12,
  activeOrders: 6,
  lateNow: 1,
  onHoldOrders: 1,
  unassignedOrders: 2,
  preparingNow: 4,
  inPrepOrders: 4,
  readyToPickupOrders: 3,
  deliveryMode: "self" as const,
  lfrApplicable: false,
  vendorOwnerCancelledCount: 0,
  transportOwnerCancelledCount: 0,
  vfr: 0,
  lfr: 0,
  vlfr: 0,
  statusCounts: [],
  ownerCoverage: {
    totalCancelledOrders: 2,
    resolvedOwnerCount: 1,
    unresolvedOwnerCount: 1,
    vendorOwnerCancelledCount: 0,
    transportOwnerCancelledCount: 0,
    lookupErrorCount: 1,
    coverageRatio: 0.5,
    warning: "1 cancelled orders still have unresolved owners.",
  },
};

const detail = {
  kind: "vendor" as const,
  vendor: {
    vendorId: 112,
    vendorName: "Heliopolis",
    globalEntityId: "TB_EG",
    statusColor: "green" as const,
  },
  mappedBranch: {
    branchId: 8,
    name: "Heliopolis Branch",
    chainName: "Spinneys",
    availabilityVendorId: "223",
  },
  summary: {
    totalOrders: 12,
    totalCancelledOrders: 2,
    activeOrders: 6,
    lateNow: 1,
    onHoldOrders: 1,
    unassignedOrders: 2,
    preparingNow: 4,
    inPrepOrders: 4,
    readyToPickupOrders: 3,
    vendorOwnerCancelledCount: 0,
    transportOwnerCancelledCount: 0,
    customerOwnerCancelledCount: 1,
    unknownOwnerCancelledCount: 1,
    vfr: 0,
    lfr: 0,
    vlfr: 0,
    deliveryMode: "self" as const,
    lfrApplicable: false,
  },
  statusCounts: [
    { status: "ON_HOLD", count: 1 },
    { status: "UNASSIGNED", count: 2 },
  ],
  ownerCoverage: {
    totalCancelledOrders: 2,
    resolvedOwnerCount: 1,
    unresolvedOwnerCount: 1,
    vendorOwnerCancelledCount: 0,
    transportOwnerCancelledCount: 0,
    lookupErrorCount: 1,
    coverageRatio: 0.5,
    warning: "1 cancelled orders still have unresolved owners.",
  },
  onHoldOrders: [
    {
      id: "hold-1",
      externalId: "2003",
      status: "ON_HOLD",
      placedAt: "2026-03-20T11:30:00.000Z",
      pickupAt: "2026-03-20T11:50:00.000Z",
      customerFirstName: "Nada",
      shopperId: undefined,
      shopperFirstName: undefined,
      isUnassigned: false,
      isLate: false,
    },
  ],
  unassignedOrders: [
    {
      id: "unassigned-1",
      externalId: "2004",
      status: "UNASSIGNED",
      placedAt: "2026-03-20T11:10:00.000Z",
      pickupAt: "2026-03-20T11:40:00.000Z",
      customerFirstName: "Ali",
      shopperId: undefined,
      shopperFirstName: undefined,
      isUnassigned: true,
      isLate: false,
    },
  ],
  inPrepOrders: [
    {
      id: "prep-1",
      externalId: "2005",
      status: "STARTED",
      placedAt: "2026-03-20T11:20:00.000Z",
      pickupAt: "2026-03-20T11:45:00.000Z",
      customerFirstName: "Yara",
      shopperId: 321,
      shopperFirstName: "Mohamed",
      isUnassigned: false,
      isLate: true,
    },
  ],
  readyToPickupOrders: [
    {
      id: "ready-1",
      externalId: "2006",
      status: "READY_FOR_PICKUP",
      placedAt: "2026-03-20T10:40:00.000Z",
      pickupAt: "2026-03-20T11:00:00.000Z",
      customerFirstName: "Mona",
      shopperId: 654,
      shopperFirstName: "Youssef",
      isUnassigned: false,
      isLate: false,
    },
  ],
  cancelledOrders: [
    {
      orderId: "cancel-2",
      externalId: "2002",
      status: "CANCELLED",
      customerFirstName: "Nada",
      placedAt: "2026-03-20T12:00:00.000Z",
      pickupAt: "2026-03-20T12:20:00.000Z",
      cancellationOwner: "CUSTOMER",
      cancellationReason: "FRAUD_PRANK",
      cancellationStage: "PREPARATION",
      cancellationSource: "CONTACT_CENTER",
      cancellationCreatedAt: "2026-03-20T15:38:57.071Z",
      cancellationUpdatedAt: "2026-03-20T15:38:57.071Z",
      cancellationOwnerLookupAt: "2026-03-20T15:39:00.000Z",
      cancellationOwnerLookupError: null,
    },
    {
      orderId: "cancel-1",
      externalId: "2001",
      status: "CANCELLED",
      customerFirstName: "Ali",
      placedAt: "2026-03-20T11:00:00.000Z",
      pickupAt: "2026-03-20T11:20:00.000Z",
      cancellationOwner: null,
      cancellationReason: null,
      cancellationStage: null,
      cancellationSource: null,
      cancellationCreatedAt: null,
      cancellationUpdatedAt: null,
      cancellationOwnerLookupAt: "2026-03-20T15:39:00.000Z",
      cancellationOwnerLookupError: "HTTP 401: expired token",
    },
  ],
  vendorOwnerCancelledOrders: [],
  unknownOwnerCancelledOrders: [],
  pickers: {
    todayCount: 2,
    activePreparingCount: 1,
    recentActiveCount: 1,
    items: [
      {
        shopperId: 90202,
        shopperFirstName: "Mohamed",
        ordersToday: 2,
        firstPickupAt: "2026-03-20T12:05:00.000Z",
        lastPickupAt: "2026-03-20T13:05:00.000Z",
        recentlyActive: true,
      },
    ],
  },
  fetchedAt: "2026-03-20T12:00:00.000Z",
  cacheState: "fresh" as const,
};

describe("PerformanceBranchDialog", () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders overview flow sections beside each other and grouped cancellations", () => {
    render(
      <PerformanceBranchDialog
        open
        subject={subject}
        detail={detail}
        loading={false}
        refreshing={false}
        error={null}
        onClose={() => {}}
        onRefresh={() => {}}
      />,
    );

    const dialog = screen.getByRole("dialog");

    function expectDialogTileValues(label: string, expectedValues: string[]) {
      const tile = within(dialog).getAllByText(label)[0]?.parentElement;
      expect(tile).not.toBeNull();
      for (const expectedValue of expectedValues) {
        expect(tile).toHaveTextContent(expectedValue);
      }
    }

    expect(screen.getByRole("tab", { name: "Overview" })).toBeInTheDocument();
    expect(screen.getByText("Summary")).toBeInTheDocument();
    expect(screen.getByText("Cancellation")).toBeInTheDocument();
    expect(screen.getByText("Flow")).toBeInTheDocument();
    expect(screen.queryByText("Customer Cancels")).not.toBeInTheDocument();
    expect(screen.queryByText("Vendor Cancels")).not.toBeInTheDocument();
    expect(screen.queryByText("Transport Cancels")).not.toBeInTheDocument();
    expect(screen.queryByText("Unknown Owner")).not.toBeInTheDocument();
    expect(screen.getByText("Mapped branch: Heliopolis Branch")).toBeInTheDocument();
    expect(screen.queryByText("Status Breakdown")).not.toBeInTheDocument();
    expect(screen.queryByText("Late")).not.toBeInTheDocument();
    expectDialogTileValues("VFR", ["0", "0.00%"]);
    expectDialogTileValues("LFR", ["TMP"]);
    expectDialogTileValues("V+L FR", ["0", "0.00%"]);

    fireEvent.click(screen.getByRole("button", { name: "Toggle Ready to Pickup orders" }));
    expect(screen.getByText("#2006")).toBeInTheDocument();
    expect(screen.getByText("Pickup delta")).toBeInTheDocument();
    expect(screen.queryByText("Duration")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Toggle Assigned Prep Queue orders" }));

    expect(screen.getByText("#2005")).toBeInTheDocument();
    expect(screen.getByText("#2006")).toBeInTheDocument();
    expect(screen.getAllByText("Pickup delta").length).toBeGreaterThan(0);
    expect(screen.queryByText("Duration")).not.toBeInTheDocument();
    expect(screen.getAllByText("Late")).toHaveLength(1);

    fireEvent.click(screen.getByRole("tab", { name: "Cancellations" }));

    expect(screen.getByText("Customer")).toBeInTheDocument();
    expect(screen.getByText("Other / Unknown")).toBeInTheDocument();

    expect(screen.queryByText("Reason: FRAUD_PRANK")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Toggle Customer cancellations" }));
    fireEvent.click(screen.getByRole("button", { name: "Toggle Other / Unknown cancellations" }));

    expect(screen.getByText("Reason: FRAUD_PRANK")).toBeInTheDocument();
    expect(screen.queryByText(/Order ID cancel-2/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Mohamed/i)).not.toBeInTheDocument();
    expect(screen.queryByText("Stage: PREPARATION")).not.toBeInTheDocument();
    expect(screen.queryByText("Source: CONTACT_CENTER")).not.toBeInTheDocument();
    expect(screen.getByText("HTTP 401: expired token")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "Pickers" }));

    expect(screen.getByText("Picker Activity")).toBeInTheDocument();
    expect(screen.getByText("Mohamed")).toBeInTheDocument();
    expect(screen.getByText("2 orders")).toBeInTheDocument();
  }, TEST_TIMEOUT_MS);

  it("updates pickup delta live while the dialog stays open", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-20T11:00:02.000Z"));

    render(
      <PerformanceBranchDialog
        open
        subject={subject}
        detail={detail}
        loading={false}
        refreshing={false}
        error={null}
        onClose={() => {}}
        onRefresh={() => {}}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Toggle Ready to Pickup orders" }));

    expect(screen.getByText("-00:02")).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(2000);
    });

    expect(screen.getByText("-00:04")).toBeInTheDocument();
  });
});
