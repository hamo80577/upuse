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
          },
          errors: {
            orders: {
              source: "orders",
              message: "Orders API request failed",
              at: "2026-03-14T08:00:10.000Z",
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
        message: "Orders API request failed",
      },
      monitorRunning: true,
      monitorDegraded: true,
      lastErrorAt: "2026-03-14T08:00:10.000Z",
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
});
