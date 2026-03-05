import { beforeEach, describe, expect, it, vi } from "vitest";

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
    shopper: { firstName: "Shopper" },
    ...overrides,
  };
}

describe("ordersClient.fetchVendorOrdersDetail", () => {
  beforeEach(() => {
    mockAxiosGet.mockReset();
    mockCairoDayWindowUtc.mockClear();
    mockNowUtcIso.mockClear();
    mockIsPastPickup.mockClear();
    process.env.UPUSE_ORDERS_WINDOW_SPLIT_MAX_DEPTH = "8";
  });

  it("fetches all pages using isCompleted=false and pickupAt sorting", async () => {
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
      globalEntityId: "HF_EG",
      vendorId: 56742,
    });

    expect(mockAxiosGet).toHaveBeenCalledTimes(2);

    const firstUrl = String(mockAxiosGet.mock.calls[0]?.[0]);
    const secondUrl = String(mockAxiosGet.mock.calls[1]?.[0]);

    expect(firstUrl).toContain("global_entity_id=HF_EG");
    expect(firstUrl).toContain("page=0");
    expect(firstUrl).toContain("pageSize=20");
    expect(firstUrl).toContain("startDate=2026-03-04T22%3A00%3A00.000Z");
    expect(firstUrl).toContain("endDate=2026-03-05T21%3A59%3A59.999Z");
    expect(firstUrl).toContain("order=pickupAt%2Casc");
    expect(firstUrl).toContain("isCompleted=false");
    expect(firstUrl).toContain("vendor_id%5B0%5D=56742");

    expect(secondUrl).toContain("page=1");
    expect(secondUrl).toContain("isCompleted=false");

    expect(result.metrics.activeNow).toBe(23);
    expect(result.metrics.totalToday).toBe(23);
    expect(result.metrics.doneToday).toBe(0);
    expect(result.metrics.cancelledToday).toBe(0);
    expect(result.unassignedOrders.length).toBe(2);
    expect(result.preparingOrders.length).toBe(21);
    expect(result.unassignedOrders[0]?.externalId).toBe("ORD-1");
    expect(result.fetchedAt).toBe("2026-03-05T10:00:00.000Z");
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
        globalEntityId: "HF_EG",
        vendorId: 56742,
        pageSize: 1,
      }),
    ).rejects.toMatchObject({
      code: "UPUSE_ORDERS_PAGE_LIMIT_EXCEEDED",
      details: expect.objectContaining({
        scope: "branch_detail",
        globalEntityId: "HF_EG",
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
      globalEntityId: "HF_EG",
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
      globalEntityId: "HF_EG",
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
        globalEntityId: "HF_EG",
        vendorIds: [56742],
        pageSize: 1,
        maxVendorsPerRequest: 1,
      }),
    ).rejects.toMatchObject({
      code: "UPUSE_ORDERS_PAGE_LIMIT_EXCEEDED",
      details: expect.objectContaining({
        scope: "orders_aggregate",
        globalEntityId: "HF_EG",
      }),
    });
  });
});
