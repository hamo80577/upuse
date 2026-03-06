import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockGetWithRetry } = vi.hoisted(() => ({
  mockGetWithRetry: vi.fn(),
}));

vi.mock("./httpClient.js", () => ({
  getWithRetry: mockGetWithRetry,
}));

import { lookupVendorName } from "./lookup.js";

describe("lookupVendorName", () => {
  beforeEach(() => {
    mockGetWithRetry.mockReset();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-06T10:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("queries a 30-day Cairo window and returns the first vendor name", async () => {
    mockGetWithRetry.mockResolvedValue({
      data: {
        items: [{ vendor: { name: "Branch A" } }],
      },
    });

    await expect(
      lookupVendorName({
        token: "orders-token",
        globalEntityId: "HF_EG",
        ordersVendorId: 77,
      }),
    ).resolves.toBe("Branch A");

    const [url] = mockGetWithRetry.mock.calls[0];
    const query = new URL(String(url)).searchParams;

    expect(query.get("global_entity_id")).toBe("HF_EG");
    expect(query.get("startDate")).toBe("2026-02-04T22:00:00.000Z");
    expect(query.get("endDate")).toBe("2026-03-06T21:59:59.999Z");
    expect(query.get("pageSize")).toBe("1");
    expect(query.get("vendor_id[0]")).toBe("77");
  });
});
