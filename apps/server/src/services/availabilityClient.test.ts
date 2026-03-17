import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TEST_GLOBAL_ENTITY_ID } from "../../../../test/globalEntityId";

const { mockAxiosGet, mockAxiosPut } = vi.hoisted(() => ({
  mockAxiosGet: vi.fn(),
  mockAxiosPut: vi.fn(),
}));

vi.mock("axios", () => ({
  default: {
    get: mockAxiosGet,
    put: mockAxiosPut,
  },
}));

import { fetchAvailabilities, isRetryableAvailabilityRequestError, setAvailability } from "./availabilityClient.js";

function fallbackStatusPayload(params: {
  openVendorStatuses?: Array<Record<string, unknown>>;
  temporarilyClosedVendorStatuses?: Array<Record<string, unknown>>;
  offHoursVendorStatuses?: Array<Record<string, unknown>>;
}) {
  return {
    vendors: {
      open: {
        count: params.openVendorStatuses?.length ?? 0,
        open: {
          count: params.openVendorStatuses?.length ?? 0,
          vendorStatuses: params.openVendorStatuses ?? [],
        },
      },
      temporarilyClosed: {
        count: params.temporarilyClosedVendorStatuses?.length ?? 0,
        shortClosures: {
          count: params.temporarilyClosedVendorStatuses?.length ?? 0,
          vendorStatuses: params.temporarilyClosedVendorStatuses ?? [],
        },
      },
      offHours: {
        count: params.offHoursVendorStatuses?.length ?? 0,
        vendorStatuses: params.offHoursVendorStatuses ?? [],
      },
    },
  };
}

describe("availabilityClient", () => {
  beforeEach(() => {
    mockAxiosGet.mockReset();
    mockAxiosPut.mockReset();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("rejects malformed availability payloads instead of trusting them", async () => {
    mockAxiosGet.mockResolvedValue({
      data: {
        items: [],
      },
    });

    await expect(fetchAvailabilities("token")).rejects.toThrow(/malformed payload/i);
    expect(mockAxiosGet).toHaveBeenCalledTimes(1);
  });

  it("retries transient network failures and eventually resolves", async () => {
    mockAxiosGet
      .mockRejectedValueOnce({ code: "ETIMEDOUT", message: "socket hang up" })
      .mockResolvedValueOnce({
        data: [
          {
            platformKey: "test",
            changeable: true,
            availabilityState: "OPEN",
            platformRestaurantId: "vendor-1",
            globalEntityId: TEST_GLOBAL_ENTITY_ID,
          },
        ],
      });

    const promise = fetchAvailabilities("token");
    await vi.runAllTimersAsync();

    await expect(promise).resolves.toEqual([
      expect.objectContaining({
        platformRestaurantId: "vendor-1",
      }),
    ]);
    expect(mockAxiosGet).toHaveBeenCalledTimes(2);
  });

  it("accepts payload items that omit globalEntityId", async () => {
    mockAxiosGet.mockResolvedValue({
      data: [
        {
          platformKey: "test",
          changeable: true,
          availabilityState: "OPEN",
          platformRestaurantId: "vendor-no-entity",
        },
      ],
    });

    await expect(fetchAvailabilities("token")).resolves.toEqual([
      expect.objectContaining({
        platformRestaurantId: "vendor-no-entity",
        availabilityState: "OPEN",
      }),
    ]);
  });

  it("does not call the fallback status endpoint when the primary payload already covers expected vendors", async () => {
    mockAxiosGet.mockResolvedValue({
      data: [
        {
          platformKey: "test",
          changeable: true,
          availabilityState: "OPEN",
          platformRestaurantId: "vendor-1",
        },
      ],
    });

    await expect(fetchAvailabilities("token", {
      expectedVendorIds: ["vendor-1"],
    })).resolves.toEqual([
      expect.objectContaining({
        platformRestaurantId: "vendor-1",
        availabilityState: "OPEN",
      }),
    ]);

    expect(mockAxiosGet).toHaveBeenCalledTimes(1);
    expect(String(mockAxiosGet.mock.calls[0]?.[0])).toContain("/platforms/restaurants/availabilities");
  });

  it("fills missing expected vendors from the fallback vendor-status endpoint", async () => {
    mockAxiosGet
      .mockResolvedValueOnce({
        data: [
          {
            platformKey: "test",
            changeable: true,
            availabilityState: "OPEN",
            platformRestaurantId: "vendor-1",
          },
        ],
      })
      .mockResolvedValueOnce({
        data: fallbackStatusPayload({
          temporarilyClosedVendorStatuses: [
            {
              name: "Fallback Branch",
              globalEntityId: TEST_GLOBAL_ENTITY_ID,
              platformVendorId: "vendor-2",
              nextOpeningAt: "2026-03-14T13:39:39Z",
              changeable: true,
              closedReason: "TECHNICAL_PROBLEM",
            },
          ],
        }),
      });

    await expect(fetchAvailabilities("token", {
      expectedVendorIds: ["vendor-1", "vendor-2"],
    })).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({
        platformRestaurantId: "vendor-1",
        availabilityState: "OPEN",
        changeable: true,
      }),
      expect.objectContaining({
        platformRestaurantId: "vendor-2",
        availabilityState: "CLOSED_UNTIL",
        closedUntil: "2026-03-14T13:39:39Z",
        closedReason: "TECHNICAL_PROBLEM",
        changeable: true,
        platformKey: "vss_vendor_status",
      }),
    ]));

    expect(mockAxiosGet).toHaveBeenCalledTimes(2);
    expect(String(mockAxiosGet.mock.calls[1]?.[0])).toContain("/api/v1/vendors/status");
  });

  it("maps fallback offHours vendors to CLOSED", async () => {
    mockAxiosGet
      .mockResolvedValueOnce({
        data: [],
      })
      .mockResolvedValueOnce({
        data: fallbackStatusPayload({
          offHoursVendorStatuses: [
            {
              platformVendorId: "vendor-off-hours",
              endTime: "2026-03-14T22:00:00Z",
            },
          ],
        }),
      });

    await expect(fetchAvailabilities("token", {
      expectedVendorIds: ["vendor-off-hours"],
    })).resolves.toEqual([
      expect.objectContaining({
        platformRestaurantId: "vendor-off-hours",
        availabilityState: "CLOSED",
        currentSlotEndAt: "2026-03-14T22:00:00Z",
        platformKey: "vss_vendor_status",
      }),
    ]);
  });

  it("keeps primary availability data when the fallback endpoint returns malformed payloads", async () => {
    mockAxiosGet
      .mockResolvedValueOnce({
        data: [
          {
            platformKey: "test",
            changeable: true,
            availabilityState: "OPEN",
            platformRestaurantId: "vendor-1",
          },
        ],
      })
      .mockResolvedValueOnce({
        data: {
          vendors: {
            open: {
              vendorStatuses: "not-an-array",
            },
          },
        },
      });

    await expect(fetchAvailabilities("token", {
      expectedVendorIds: ["vendor-1", "vendor-2"],
    })).resolves.toEqual([
      expect.objectContaining({
        platformRestaurantId: "vendor-1",
        availabilityState: "OPEN",
      }),
    ]);

    expect(mockAxiosGet).toHaveBeenCalledTimes(2);
  });

  it("accepts upstream UNKNOWN availability states without treating the payload as malformed", async () => {
    mockAxiosGet.mockResolvedValue({
      data: [
        {
          platformKey: "test",
          changeable: true,
          availabilityState: "UNKNOWN",
          platformRestaurantId: "vendor-unknown",
        },
      ],
    });

    await expect(fetchAvailabilities("token")).resolves.toEqual([
      expect.objectContaining({
        platformRestaurantId: "vendor-unknown",
        availabilityState: "UNKNOWN",
      }),
    ]);
  });

  it("detects retryable transient availability failures", () => {
    expect(isRetryableAvailabilityRequestError({ code: "ETIMEDOUT", message: "socket hang up" })).toBe(true);
    expect(isRetryableAvailabilityRequestError({ response: { status: 503 }, message: "Service unavailable" })).toBe(true);
    expect(isRetryableAvailabilityRequestError({ response: { status: 401 }, message: "Unauthorized" })).toBe(false);
  });

  it("rejects malformed successful mutation payloads", async () => {
    mockAxiosPut.mockResolvedValue({
      data: "<html>ok?</html>",
    });

    await expect(setAvailability({
      token: "token",
      globalEntityId: TEST_GLOBAL_ENTITY_ID,
      availabilityVendorId: "vendor-1",
      state: "OPEN",
    })).rejects.toThrow(/malformed payload/i);
  });
});
