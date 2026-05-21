import { beforeEach, describe, expect, it, vi } from "vitest";
import { TEST_GLOBAL_ENTITY_ID } from "../../../../../test/globalEntityId";

const { mockGetWithRetry } = vi.hoisted(() => ({
  mockGetWithRetry: vi.fn(),
}));

vi.mock("./httpClient.js", () => ({
  getWithRetry: mockGetWithRetry,
}));

import { lookupWarehouseVendorByAvailabilityId } from "./warehouses.js";

describe("lookupWarehouseVendorByAvailabilityId", () => {
  beforeEach(() => {
    mockGetWithRetry.mockReset();
  });

  it("maps an exact platform vendor match into vendor catalog fields", async () => {
    mockGetWithRetry.mockResolvedValue({
      data: [
        {
          id: 23697,
          platformVendorId: ["709024"],
          externalId: ["709024"],
          name: "Kheir Zaman",
          globalEntityId: TEST_GLOBAL_ENTITY_ID,
        },
      ],
    });

    await expect(
      lookupWarehouseVendorByAvailabilityId({
        token: "orders-token",
        globalEntityId: TEST_GLOBAL_ENTITY_ID,
        availabilityVendorId: "709024",
      }),
    ).resolves.toEqual({
      availabilityVendorId: "709024",
      ordersVendorId: 23697,
      name: "Kheir Zaman",
      globalEntityId: TEST_GLOBAL_ENTITY_ID,
    });

    const [url, headers] = mockGetWithRetry.mock.calls[0];
    const parsedUrl = new URL(String(url));
    expect(parsedUrl.pathname).toBe(`/v2/entities/${TEST_GLOBAL_ENTITY_ID}/warehouses`);
    expect(parsedUrl.searchParams.get("permission")).toBe("order:read");
    expect(parsedUrl.searchParams.get("search")).toBe("709024");
    expect(headers.Authorization).toBe("Bearer orders-token");
  });

  it("ignores partial search matches", async () => {
    mockGetWithRetry.mockResolvedValue({
      data: [
        {
          id: 1,
          platformVendorId: ["7090249"],
          name: "Wrong Branch",
          globalEntityId: TEST_GLOBAL_ENTITY_ID,
        },
      ],
    });

    await expect(
      lookupWarehouseVendorByAvailabilityId({
        token: "orders-token",
        globalEntityId: TEST_GLOBAL_ENTITY_ID,
        availabilityVendorId: "709024",
      }),
    ).resolves.toBeNull();
  });
});
