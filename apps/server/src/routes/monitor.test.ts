import { afterEach, describe, expect, it, vi } from "vitest";
import { streamRoute } from "./monitor.js";

function createStreamRequest(userId: number) {
  const handlers = new Map<string, () => void>();
  const req: any = {
    authUser: {
      id: userId,
    },
    on: vi.fn((event: string, handler: () => void) => {
      handlers.set(event, handler);
      return req;
    }),
  };

  return {
    req,
    close: () => handlers.get("close")?.(),
  };
}

function createStreamResponse() {
  const res: any = {
    headers: new Map<string, string>(),
    writableEnded: false,
    destroyed: false,
    statusCode: 200,
    body: undefined as unknown,
    setHeader: vi.fn((name: string, value: string) => {
      res.headers.set(name, value);
      return res;
    }),
    flushHeaders: vi.fn(),
    write: vi.fn(),
    end: vi.fn(() => {
      res.writableEnded = true;
      return res;
    }),
    status: vi.fn((statusCode: number) => {
      res.statusCode = statusCode;
      return res;
    }),
    json: vi.fn((body: unknown) => {
      res.body = body;
      return res;
    }),
    on: vi.fn(),
  };

  return res;
}

afterEach(() => {
  vi.useRealTimers();
});

describe("monitor.streamRoute", () => {
  it("limits concurrent dashboard streams per user and releases the slot on close", () => {
    vi.useFakeTimers();

    const unsubscribe = vi.fn();
    const engine: any = {
      subscribe: vi.fn(() => unsubscribe),
    };
    const route = streamRoute(engine, {
      maxConnectionsPerUser: 1,
      maxTotalConnections: 10,
    });

    const first = createStreamRequest(7);
    const firstRes = createStreamResponse();
    route(first.req, firstRes);

    expect(engine.subscribe).toHaveBeenCalledTimes(1);
    expect(firstRes.status).not.toHaveBeenCalled();

    const second = createStreamRequest(7);
    const secondRes = createStreamResponse();
    route(second.req, secondRes);

    expect(secondRes.statusCode).toBe(429);
    expect(secondRes.body).toEqual({
      ok: false,
      message: "Too many active dashboard streams for the current user.",
    });

    first.close();
    expect(unsubscribe).toHaveBeenCalledOnce();

    const third = createStreamRequest(7);
    const thirdRes = createStreamResponse();
    route(third.req, thirdRes);

    expect(engine.subscribe).toHaveBeenCalledTimes(2);
    expect(thirdRes.status).not.toHaveBeenCalled();
    third.close();
  });

  it("limits the global number of open dashboard streams", () => {
    vi.useFakeTimers();

    const engine: any = {
      subscribe: vi.fn(() => vi.fn()),
    };
    const route = streamRoute(engine, {
      maxConnectionsPerUser: 3,
      maxTotalConnections: 1,
    });

    const first = createStreamRequest(1);
    route(first.req, createStreamResponse());

    const second = createStreamRequest(2);
    const secondRes = createStreamResponse();
    route(second.req, secondRes);

    expect(secondRes.statusCode).toBe(429);
    expect(secondRes.body).toEqual({
      ok: false,
      message: "Too many active dashboard streams.",
    });

    first.close();
  });
});
