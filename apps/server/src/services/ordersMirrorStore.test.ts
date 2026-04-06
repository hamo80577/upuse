import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockPrepare,
  mockGetWithRetry,
} = vi.hoisted(() => ({
  mockPrepare: vi.fn(() => ({
    get: vi.fn(() => null),
    all: vi.fn(() => []),
    run: vi.fn(),
  })),
  mockGetWithRetry: vi.fn(),
}));

vi.mock("../config/db.js", () => ({
  db: {
    prepare: mockPrepare,
  },
}));

vi.mock("./branchStore.js", () => ({
  listResolvedBranches: vi.fn(() => []),
}));

vi.mock("./settingsStore.js", () => ({
  getGlobalEntityId: vi.fn(() => "HF_EG"),
  getSettings: vi.fn(() => ({
    ordersRefreshSeconds: 30,
  })),
}));

vi.mock("./orders/httpClient.js", () => ({
  getWithRetry: mockGetWithRetry,
}));

import {
  extractCancellationDetail,
  extractTransportType,
  fetchOrdersWindow,
  getCurrentHourPlacedCountByVendor,
} from "./ordersMirrorStore.js";

describe("ordersMirrorStore.fetchOrdersWindow", () => {
  beforeEach(() => {
    mockPrepare.mockClear();
    mockGetWithRetry.mockReset();
    process.env.UPUSE_ORDERS_ENTITY_SYNC_MAX_PAGES = "2";
    process.env.UPUSE_ORDERS_WINDOW_SPLIT_MAX_DEPTH = "8";
    process.env.UPUSE_ORDERS_WINDOW_MIN_SPAN_MS = "1000";
  });

  it("splits the entity-wide window before requesting pages beyond the API-safe limit", async () => {
    const rootWindow = {
      startUtcIso: "2026-03-19T22:00:00.000Z",
      endUtcIso: "2026-03-19T23:00:00.000Z",
    };

    mockGetWithRetry.mockImplementation(async (url: string) => {
      const search = new URL(url).searchParams;
      const page = search.get("page");
      const startDate = search.get("startDate");
      const endDate = search.get("endDate");

      if (startDate === rootWindow.startUtcIso && endDate === rootWindow.endUtcIso && page === "0") {
        return {
          data: {
            items: [
              { id: 1, vendor: { id: 10 } },
              { id: 2, vendor: { id: 10 } },
            ],
          },
        };
      }

      if (startDate === rootWindow.startUtcIso && endDate === rootWindow.endUtcIso && page === "1") {
        return {
          data: {
            items: [
              { id: 3, vendor: { id: 10 } },
              { id: 4, vendor: { id: 10 } },
            ],
          },
        };
      }

      if (page === "2") {
        throw new Error("entity sync should split before requesting page 2");
      }

      if (page === "0" && startDate === rootWindow.startUtcIso) {
        return { data: { items: [] } };
      }

      if (page === "0" && endDate === rootWindow.endUtcIso) {
        return {
          data: {
            items: [{ id: 5, vendor: { id: 10 } }],
          },
        };
      }

      return { data: { items: [] } };
    });

    const result = await fetchOrdersWindow({
      token: "token",
      globalEntityId: "HF_EG",
      pageSize: 2,
      window: rootWindow,
      nowIso: "2026-03-20T18:00:00.000Z",
    });

    expect(result.items.map((item) => item.id)).toEqual([1, 2, 3, 4, 5]);

    const rootRequests = mockGetWithRetry.mock.calls
      .map((call) => String(call[0]))
      .filter((url) => url.includes(`startDate=${encodeURIComponent(rootWindow.startUtcIso)}`) && url.includes(`endDate=${encodeURIComponent(rootWindow.endUtcIso)}`));

    expect(rootRequests).toHaveLength(2);
    expect(rootRequests[0]).toContain("page=0");
    expect(rootRequests[1]).toContain("page=1");
  });

  it("normalizes transport type values from order payloads", () => {
    expect(extractTransportType({ transportType: " logistics_delivery " })).toBe("LOGISTICS_DELIVERY");
    expect(extractTransportType({ transportType: "vendor_delivery" })).toBe("VENDOR_DELIVERY");
    expect(extractTransportType({})).toBeNull();
  });

  it("extracts cancellation detail fields from order detail payloads", () => {
    expect(extractCancellationDetail({
      cancellation: {
        owner: " customer ",
        reason: " FRAUD_PRANK ",
        stage: " PREPARATION ",
        source: " CONTACT_CENTER ",
        createdAt: "2026-03-20T15:38:57.071Z",
        updatedAt: "2026-03-20T15:38:57.071Z",
      },
    })).toEqual({
      owner: "CUSTOMER",
      reason: "FRAUD_PRANK",
      stage: "PREPARATION",
      source: "CONTACT_CENTER",
      createdAt: "2026-03-20T15:38:57.071Z",
      updatedAt: "2026-03-20T15:38:57.071Z",
    });

    expect(extractCancellationDetail({})).toEqual({
      owner: null,
      reason: null,
      stage: null,
      source: null,
      createdAt: null,
      updatedAt: null,
    });
  });

  it("counts placed orders per vendor for the current Cairo hour", () => {
    const all = vi.fn(() => [{ vendorId: 10, count: 5 }]);
    mockPrepare.mockReturnValueOnce({
      get: vi.fn(() => null),
      all,
      run: vi.fn(),
    });

    const counts = getCurrentHourPlacedCountByVendor({
      globalEntityId: "HF_EG",
      vendorIds: [10, 20],
      nowIso: "2026-03-20T12:17:00.000Z",
    });

    expect(all).toHaveBeenCalledWith(
      expect.any(String),
      "HF_EG",
      expect.any(String),
      expect.any(String),
      10,
      20,
    );
    expect(counts).toEqual(new Map([
      [10, 5],
      [20, 0],
    ]));
  });
});
