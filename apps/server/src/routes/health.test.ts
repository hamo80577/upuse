import { describe, expect, it } from "vitest";
import { buildHealthPayload, health, readiness } from "./health.js";

function createResponse() {
  return {
    statusCode: 200,
    payload: null as unknown,
    status(statusCode: number) {
      this.statusCode = statusCode;
      return this;
    },
    json(payload: unknown) {
      this.payload = payload;
      return this;
    },
  };
}

describe("health routes", () => {
  it("marks running-but-degraded monitoring as not ready", () => {
    const engine: any = {
      getSnapshot: () => ({
        monitoring: {
          running: true,
          degraded: true,
          lastOrdersFetchAt: "2026-03-14T08:00:00.000Z",
          lastAvailabilityFetchAt: "2026-03-14T08:00:05.000Z",
          lastHealthyAt: "2026-03-14T07:59:50.000Z",
          ordersSync: {
            mode: "mirror",
            state: "degraded",
            staleBranchCount: 3,
            consecutiveSourceFailures: 2,
            error: {
              source: "orders",
              category: "tunnel",
              summary: "Orders tunnel unavailable",
              message: "Orders sync could not reach the upstream because a tunnel or edge page was returned instead of API data.",
              actionHint: "Cached orders can stay visible for a while, but live counts will drift until the upstream route recovers.",
              at: "2026-03-14T08:00:10.000Z",
              retryable: true,
            },
          },
          availabilitySync: {
            state: "healthy",
            cadenceSeconds: 15,
            lastAttemptAt: "2026-03-14T08:00:05.000Z",
            lastSuccessfulSyncAt: "2026-03-14T08:00:05.000Z",
            consecutiveFailures: 0,
          },
          errors: {
            orders: {
              source: "orders",
              category: "tunnel",
              summary: "Orders tunnel unavailable",
              message: "Orders sync could not reach the upstream because a tunnel or edge page was returned instead of API data.",
              actionHint: "Cached orders can stay visible for a while, but live counts will drift until the upstream route recovers.",
              at: "2026-03-14T08:00:10.000Z",
              retryable: true,
            },
          },
        },
      }),
    };

    expect(buildHealthPayload(engine)).toMatchObject({
      live: true,
      ready: false,
      readiness: {
        state: "degraded",
        message: "Orders sync could not reach the upstream because a tunnel or edge page was returned instead of API data.",
      },
      monitorRunning: true,
      monitorDegraded: true,
      lastErrorAt: "2026-03-14T08:00:10.000Z",
      availabilitySync: {
        cadenceSeconds: 15,
      },
    });

    const res = createResponse();
    readiness(engine)({} as any, res as any);

    expect(res.statusCode).toBe(503);
    expect(res.payload).toMatchObject({
      ok: false,
      ready: false,
      readiness: {
        state: "degraded",
      },
    });
  });

  it("treats a warming monitor as live but not ready", () => {
    const engine: any = {
      getSnapshot: () => ({
        monitoring: {
          running: true,
          degraded: false,
          ordersSync: {
            mode: "mirror",
            state: "warming",
            staleBranchCount: 0,
            consecutiveSourceFailures: 0,
          },
          availabilitySync: {
            state: "warming",
            cadenceSeconds: 15,
            consecutiveFailures: 0,
          },
          errors: {},
        },
      }),
    };

    const res = createResponse();
    health(engine)({} as any, res as any);

    expect(res.statusCode).toBe(200);
    expect(res.payload).toMatchObject({
      ok: true,
      live: true,
      ready: false,
      readiness: {
        state: "warming",
      },
    });
  });

  it("reports an intentionally stopped monitor as ready but idle", () => {
    const engine: any = {
      getSnapshot: () => ({
        monitoring: {
          running: false,
          degraded: false,
          ordersSync: {
            mode: "mirror",
            state: "warming",
            staleBranchCount: 0,
            consecutiveSourceFailures: 0,
          },
          availabilitySync: {
            state: "warming",
            cadenceSeconds: 15,
            consecutiveFailures: 0,
          },
          errors: {},
        },
      }),
    };

    const res = createResponse();
    readiness(engine)({} as any, res as any);

    expect(res.statusCode).toBe(200);
    expect(res.payload).toMatchObject({
      ok: true,
      ready: true,
      readiness: {
        state: "idle",
      },
      monitorRunning: false,
    });
  });

  it("surfaces degraded availability auth issues as not ready", () => {
    const engine: any = {
      getSnapshot: () => ({
        monitoring: {
          running: true,
          degraded: true,
          ordersSync: {
            mode: "mirror",
            state: "healthy",
            staleBranchCount: 0,
            consecutiveSourceFailures: 0,
          },
          availabilitySync: {
            state: "degraded",
            cadenceSeconds: 15,
            lastAttemptAt: "2026-03-14T08:00:20.000Z",
            lastSuccessfulSyncAt: "2026-03-14T08:00:00.000Z",
            consecutiveFailures: 2,
            error: {
              source: "availability",
              category: "auth",
              summary: "Availability authentication failed",
              message: "VSS availability sync is blocked because the upstream rejected the current credentials.",
              actionHint: "Open Settings > Tokens to update or test the Availability API token.",
              at: "2026-03-14T08:00:20.000Z",
              statusCode: 401,
              retryable: false,
            },
          },
          errors: {},
        },
      }),
    };

    expect(buildHealthPayload(engine)).toMatchObject({
      ready: false,
      readiness: {
        state: "degraded",
        message: "VSS availability sync is blocked because the upstream rejected the current credentials.",
      },
      lastErrorAt: "2026-03-14T08:00:20.000Z",
    });
  });
});
