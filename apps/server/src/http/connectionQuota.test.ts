import { describe, expect, it } from "vitest";
import { createConnectionQuota } from "./connectionQuota.js";

describe("connection quota", () => {
  it("blocks per-user overages and allows reuse after release", () => {
    const quota = createConnectionQuota({
      maxConnectionsPerUser: 1,
      maxConnectionsTotal: 3,
      perUserLimitMessage: "per-user",
      globalLimitMessage: "global",
    });

    expect(quota.acquire(7)).toEqual({ ok: true });
    expect(quota.acquire(7)).toEqual({
      ok: false,
      statusCode: 429,
      message: "per-user",
    });

    quota.release(7);

    expect(quota.acquire(7)).toEqual({ ok: true });
  });

  it("blocks global overages independently from the per-user quota", () => {
    const quota = createConnectionQuota({
      maxConnectionsPerUser: 2,
      maxConnectionsTotal: 2,
      perUserLimitMessage: "per-user",
      globalLimitMessage: "global",
    });

    expect(quota.acquire(1)).toEqual({ ok: true });
    expect(quota.acquire(2)).toEqual({ ok: true });
    expect(quota.acquire(3)).toEqual({
      ok: false,
      statusCode: 429,
      message: "global",
    });
  });

  it("ignores extra release calls without corrupting the counters", () => {
    const quota = createConnectionQuota({
      maxConnectionsPerUser: 1,
      maxConnectionsTotal: 1,
      perUserLimitMessage: "per-user",
      globalLimitMessage: "global",
    });

    expect(quota.acquire(1)).toEqual({ ok: true });
    quota.release(1);
    quota.release(1);

    expect(quota.acquire(2)).toEqual({ ok: true });
  });
});
