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
