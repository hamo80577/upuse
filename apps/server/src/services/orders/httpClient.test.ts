import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockAxiosGet } = vi.hoisted(() => ({
  mockAxiosGet: vi.fn(),
}));

vi.mock("axios", () => ({
  default: {
    get: mockAxiosGet,
  },
}));

import { getWithRetry, isRetryableOrdersRequestError } from "./httpClient.js";

describe("orders.httpClient", () => {
  beforeEach(() => {
    mockAxiosGet.mockReset();
    vi.useFakeTimers();
    delete process.env.UPUSE_ORDERS_HTTP_TIMEOUT_MS;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("retries timeout errors and eventually resolves", async () => {
    mockAxiosGet
      .mockRejectedValueOnce({ code: "ECONNABORTED", message: "timeout of 25000ms exceeded" })
      .mockResolvedValueOnce({ data: { ok: true } });

    const promise = getWithRetry("https://example.test/orders", { Authorization: "Bearer token" }, 1);
    await vi.runAllTimersAsync();

    await expect(promise).resolves.toEqual({ data: { ok: true } });
    expect(mockAxiosGet).toHaveBeenCalledTimes(2);
  });

  it("does not retry unauthorized responses", async () => {
    const error = { response: { status: 401 }, message: "Unauthorized" };
    mockAxiosGet.mockRejectedValue(error);

    await expect(
      getWithRetry("https://example.test/orders", { Authorization: "Bearer token" }, 2),
    ).rejects.toBe(error);
    expect(mockAxiosGet).toHaveBeenCalledTimes(1);
  });

  it("detects retryable transient network and server errors", () => {
    expect(isRetryableOrdersRequestError({ code: "ETIMEDOUT", message: "socket hang up" })).toBe(true);
    expect(isRetryableOrdersRequestError({ response: { status: 503 }, message: "Service Unavailable" })).toBe(true);
    expect(isRetryableOrdersRequestError({ response: { status: 401 }, message: "Unauthorized" })).toBe(false);
  });
});
