import { beforeEach, describe, expect, it, vi } from "vitest";
import { TEST_GLOBAL_ENTITY_ID } from "../../../../test/globalEntityId";

const {
  mockAxiosGet,
  mockCairoDayWindowUtc,
  mockNowUtcIso,
  mockIsPastPickup,
} = vi.hoisted(() => ({
  mockAxiosGet: vi.fn(),
  mockCairoDayWindowUtc: vi.fn(() => ({
    startUtcIso: "2026-03-04T22:00:00.000Z",
    endUtcIso: "2026-03-05T21:59:59.999Z",
  })),
  mockNowUtcIso: vi.fn(() => "2026-03-05T10:00:00.000Z"),
  mockIsPastPickup: vi.fn((nowIsoUtc: string, pickupIsoUtc: string) => {
    return new Date(nowIsoUtc).getTime() > new Date(pickupIsoUtc).getTime();
  }),
}));

vi.mock("axios", () => ({
  default: {
    get: mockAxiosGet,
  },
}));

vi.mock("../utils/time.js", () => ({
  cairoDayWindowUtc: mockCairoDayWindowUtc,
  nowUtcIso: mockNowUtcIso,
  isPastPickup: mockIsPastPickup,
}));

import { fetchOrdersAggregates, fetchVendorOrdersDetail } from "./ordersClient.js";

function order(index: number, overrides?: Partial<Record<string, unknown>>) {
  return {
    id: index + 1,
    externalId: `ORD-${index + 1}`,
    status: "PREPARING",
    isCompleted: false,
    placedAt: `2026-03-05T0${(index % 9) + 1}:00:00.000Z`,
    pickupAt: `2026-03-05T1${(index % 9)}:00:00.000Z`,
    vendor: { id: 56742 },
    shopper: { id: 90_000 + index, firstName: `Shopper ${index + 1}` },
    ...overrides,
  };
}

describe("ordersClient.fetchVendorOrdersDetail", () => {
  beforeEach(() => {
    mockAxiosGet.mockReset();
    mockCairoDayWindowUtc.mockClear();
    mockNowUtcIso.mockClear();
    mockIsPastPickup.mockClear();
    process.env.UPUSE_BRANCH_DETAIL_CACHE_TTL_SECONDS = "0";
    process.env.UPUSE_ORDERS_WINDOW_SPLIT_MAX_DEPTH = "8";
  });

  it("fetches all pages using pickupAt sorting and returns queue + picker analytics", async () => {
    const page0 = Array.from({ length: 20 }, (_, index) =>
      order(index, index === 0 ? { status: "UNASSIGNED", shopper: null } : {}),
    );
    const page1 = [
      order(20),
      order(21, { status: "UNASSIGNED", shopper: null }),
      order(22),
    ];

    mockAxiosGet
      .mockResolvedValueOnce({ data: { items: page0 } })
      .mockResolvedValueOnce({ data: { items: page1 } });

    const result = await fetchVendorOrdersDetail({
      token: "token",
      globalEntityId: TEST_GLOBAL_ENTITY_ID,
      vendorId: 56742,
    });

    expect(mockAxiosGet).toHaveBeenCalledTimes(2);

    const firstUrl = String(mockAxiosGet.mock.calls[0]?.[0]);
    const secondUrl = String(mockAxiosGet.mock.calls[1]?.[0]);

    expect(firstUrl).toContain(`global_entity_id=${TEST_GLOBAL_ENTITY_ID}`);
    expect(firstUrl).toContain("page=0");
    expect(firstUrl).toContain("pageSize=20");
    expect(firstUrl).toContain("startDate=2026-03-04T22%3A00%3A00.000Z");
    expect(firstUrl).toContain("endDate=2026-03-05T21%3A59%3A59.999Z");
    expect(firstUrl).toContain("order=pickupAt%2Casc");
    expect(firstUrl).toContain("vendor_id%5B0%5D=56742");

    expect(secondUrl).toContain("page=1");

    expect(result.metrics.activeNow).toBe(23);
    expect(result.metrics.totalToday).toBe(23);
    expect(result.metrics.doneToday).toBe(0);
    expect(result.metrics.cancelledToday).toBe(0);
    expect(result.unassignedOrders.length).toBe(2);
    expect(result.preparingOrders.length).toBe(21);
    expect(result.unassignedOrders[0]?.externalId).toBe("ORD-1");
    expect(result.preparingOrders[0]?.shopperId).toBe(90009);
    expect(result.pickers.todayCount).toBe(21);
    expect(result.pickers.activePreparingCount).toBe(21);
    expect(result.pickers.recentActiveCount).toBe(21);
    expect(result.fetchedAt).toBe("2026-03-05T10:00:00.000Z");
  });

  it("computes unique picker analytics across all branch orders for the Cairo day", async () => {
    mockAxiosGet.mockResolvedValue({
      data: {
        items: [
          order(0, {
            status: "PREPARING",
            pickupAt: "2026-03-05T10:30:00.000Z",
            shopper: { id: 101, firstName: "Mohamed" },
            lastActiveSeenAt: "2026-03-05T09:50:00.000Z",
          }),
          order(1, {
            isCompleted: true,
            pickupAt: "2026-03-05T09:45:00.000Z",
            shopper: { id: 101, firstName: "Mohamed" },
            lastActiveSeenAt: "2026-03-05T09:40:00.000Z",
          }),
          order(2, {
            status: "PREPARING",
            pickupAt: "2026-03-05T10:40:00.000Z",
            shopper: { id: 202, firstName: "Sara" },
            lastActiveSeenAt: "2026-03-05T09:20:00.000Z",
          }),
          order(3, {
            status: "UNASSIGNED",
            shopper: null,
          }),
          order(4, {
            isCompleted: true,
            pickupAt: undefined,
            shopper: { id: 202, firstName: "Sara" },
          }),
          order(5, {
            isCompleted: true,
            pickupAt: "2026-03-05T09:10:00.000Z",
            shopper: { id: 404, firstName: "Ali" },
            last_active_seen_at: "2026-03-05T09:35:00.000Z",
          }),
          order(6, {
            isCompleted: true,
            pickupAt: undefined,
            shopper: { id: 505, firstName: "Nada" },
          }),
          order(7, {
            isCompleted: true,
            pickupAt: "2026-03-05T10:30:00.000Z",
            shopper: { id: 101, firstName: "Mohamed" },
            lastActiveSeenAt: "2026-03-05T08:59:00.000Z",
          }),
        ],
      },
    });

    const result = await fetchVendorOrdersDetail({
      token: "token",
      globalEntityId: TEST_GLOBAL_ENTITY_ID,
      vendorId: 56742,
      pageSize: 20,
    });

    expect(result.metrics.totalToday).toBe(8);
    expect(result.metrics.doneToday).toBe(5);
    expect(result.metrics.activeNow).toBe(3);
    expect(result.metrics.unassignedNow).toBe(1);
    expect(result.unassignedOrders).toHaveLength(1);
    expect(result.preparingOrders).toHaveLength(2);
    expect(result.pickers).toEqual({
      todayCount: 4,
      activePreparingCount: 2,
      recentActiveCount: 2,
      items: [
        {
          shopperId: 101,
          shopperFirstName: "Mohamed",
          ordersToday: 3,
          firstPickupAt: "2026-03-05T09:45:00.000Z",
          lastPickupAt: "2026-03-05T10:30:00.000Z",
          recentlyActive: true,
        },
        {
          shopperId: 202,
          shopperFirstName: "Sara",
          ordersToday: 2,
          firstPickupAt: "2026-03-05T10:40:00.000Z",
          lastPickupAt: "2026-03-05T10:40:00.000Z",
          recentlyActive: false,
        },
        {
          shopperId: 404,
          shopperFirstName: "Ali",
          ordersToday: 1,
          firstPickupAt: "2026-03-05T09:10:00.000Z",
          lastPickupAt: "2026-03-05T09:10:00.000Z",
          recentlyActive: true,
        },
        {
          shopperId: 505,
          shopperFirstName: "Nada",
          ordersToday: 1,
          firstPickupAt: null,
          lastPickupAt: null,
          recentlyActive: false,
        },
      ],
    });
  });

  it("throws a structured error when branch detail pagination exceeds the safe page limit", async () => {
    process.env.UPUSE_ORDERS_WINDOW_SPLIT_MAX_DEPTH = "0";
    mockAxiosGet.mockResolvedValue({
      data: {
        items: [order(0)],
      },
    });

    await expect(
      fetchVendorOrdersDetail({
        token: "token",
        globalEntityId: TEST_GLOBAL_ENTITY_ID,
        vendorId: 56742,
        pageSize: 1,
      }),
    ).rejects.toMatchObject({
      code: "UPUSE_ORDERS_PAGE_LIMIT_EXCEEDED",
      details: expect.objectContaining({
        scope: "branch_detail",
        globalEntityId: TEST_GLOBAL_ENTITY_ID,
        vendorId: 56742,
      }),
    });
  });
});

describe("ordersClient.fetchOrdersAggregates", () => {
  beforeEach(() => {
    mockAxiosGet.mockReset();
    mockCairoDayWindowUtc.mockClear();
    mockNowUtcIso.mockClear();
    mockIsPastPickup.mockClear();
    process.env.UPUSE_ORDERS_WINDOW_SPLIT_MAX_DEPTH = "8";
    process.env.UPUSE_ORDERS_CHUNK_CONCURRENCY = "1";
  });

  it("splits vendor batches to the safe limit", async () => {
    const vendorIds = Array.from({ length: 22 }, (_, index) => 70000 + index);

    mockAxiosGet
      .mockResolvedValueOnce({ data: { items: [] } })
      .mockResolvedValueOnce({ data: { items: [] } });

    const result = await fetchOrdersAggregates({
      token: "token",
      globalEntityId: TEST_GLOBAL_ENTITY_ID,
      vendorIds,
      pageSize: 500,
      maxVendorsPerRequest: 50,
    });

    expect(mockAxiosGet).toHaveBeenCalledTimes(2);

    const firstUrl = String(mockAxiosGet.mock.calls[0]?.[0]);
    const secondUrl = String(mockAxiosGet.mock.calls[1]?.[0]);

    expect(firstUrl).toContain("vendor_id%5B19%5D=70019");
    expect(firstUrl).not.toContain("vendor_id%5B20%5D=");

    expect(secondUrl).toContain("vendor_id%5B0%5D=70020");
    expect(secondUrl).toContain("vendor_id%5B1%5D=70021");

    expect(result.byVendor.size).toBe(22);
    expect(result.fetchedAt).toBe("2026-03-05T10:00:00.000Z");
  });

  it("falls back to recursive chunk split when API rejects a vendor batch", async () => {
    const vendorIds = [56742, 56743, 50098, 51125];

    const vendorValidationError = {
      response: {
        status: 400,
        data: {
          status: 400,
          message: "Bad Request",
          details: { "query.vendorId": "Invalid value" },
        },
      },
    };

    mockAxiosGet
      .mockRejectedValueOnce(vendorValidationError)
      .mockResolvedValueOnce({ data: { items: [] } })
      .mockResolvedValueOnce({ data: { items: [] } });

    const result = await fetchOrdersAggregates({
      token: "token",
      globalEntityId: TEST_GLOBAL_ENTITY_ID,
      vendorIds,
      pageSize: 500,
      maxVendorsPerRequest: 50,
    });

    expect(mockAxiosGet).toHaveBeenCalledTimes(3);

    const firstRetryUrl = String(mockAxiosGet.mock.calls[1]?.[0]);
    const secondRetryUrl = String(mockAxiosGet.mock.calls[2]?.[0]);

    expect(firstRetryUrl).toContain("vendor_id%5B0%5D=56742");
    expect(firstRetryUrl).toContain("vendor_id%5B1%5D=56743");
    expect(secondRetryUrl).toContain("vendor_id%5B0%5D=50098");
    expect(secondRetryUrl).toContain("vendor_id%5B1%5D=51125");

    expect(result.byVendor.size).toBe(4);
  });

  it("tracks in-preparation orders and unique active pickers per vendor", async () => {
    mockAxiosGet.mockResolvedValue({
      data: {
        items: [
          order(0, {
            vendor: { id: 56742 },
            shopper: { id: 101, firstName: "Mohamed" },
          }),
          order(1, {
            vendor: { id: 56742 },
            shopper: { id: 101, firstName: "Mohamed" },
          }),
          order(2, {
            vendor: { id: 56742 },
            status: "UNASSIGNED",
            shopper: null,
          }),
          order(3, {
            vendor: { id: 56743 },
            shopper: { id: 202, firstName: "Sara" },
          }),
          order(4, {
            vendor: { id: 56743 },
            isCompleted: true,
            shopper: { id: 202, firstName: "Sara" },
          }),
        ],
      },
    });

    const result = await fetchOrdersAggregates({
      token: "token",
      globalEntityId: TEST_GLOBAL_ENTITY_ID,
      vendorIds: [56742, 56743],
      pageSize: 500,
      maxVendorsPerRequest: 10,
    });

    expect(result.preparingByVendor.get(56742)).toEqual({
      preparingNow: 2,
      preparingPickersNow: 1,
    });
    expect(result.preparingByVendor.get(56743)).toEqual({
      preparingNow: 1,
      preparingPickersNow: 1,
    });
  });

  it("throws a structured error when aggregate pagination exceeds the safe page limit", async () => {
    process.env.UPUSE_ORDERS_WINDOW_SPLIT_MAX_DEPTH = "0";
    mockAxiosGet.mockResolvedValue({
      data: {
        items: [
          {
            vendor: { id: 56742 },
            isCompleted: false,
            status: "PREPARING",
          },
        ],
      },
    });

    await expect(
      fetchOrdersAggregates({
        token: "token",
        globalEntityId: TEST_GLOBAL_ENTITY_ID,
        vendorIds: [56742],
        pageSize: 1,
        maxVendorsPerRequest: 1,
      }),
    ).rejects.toMatchObject({
      code: "UPUSE_ORDERS_PAGE_LIMIT_EXCEEDED",
      details: expect.objectContaining({
        scope: "orders_aggregate",
        globalEntityId: TEST_GLOBAL_ENTITY_ID,
      }),
    });
  });
});
