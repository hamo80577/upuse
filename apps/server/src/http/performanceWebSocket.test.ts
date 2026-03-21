import { createServer, type Server } from "node:http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WebSocket } from "ws";

const {
  mockGetSessionUserByToken,
  syncSubscribers,
} = vi.hoisted(() => ({
  mockGetSessionUserByToken: vi.fn(),
  syncSubscribers: new Set<(status: unknown) => void>(),
}));

vi.mock("../services/authStore.js", () => ({
  getSessionUserByToken: mockGetSessionUserByToken,
}));

vi.mock("../services/ordersMirrorStore.js", () => ({
  subscribeOrdersMirrorEntitySync: (listener: (status: unknown) => void) => {
    syncSubscribers.add(listener);
    return () => {
      syncSubscribers.delete(listener);
    };
  },
}));

import { AUTH_SESSION_COOKIE_NAME } from "./sessionCookie.js";
import { attachPerformanceWebSocketServer } from "./performanceWebSocket.js";

function authenticatedUser(id: number) {
  return {
    id,
    email: `user${id}@example.com`,
    name: `User ${id}`,
    role: "user" as const,
    active: true,
    createdAt: "2026-03-21T10:00:00.000Z",
  };
}

function validCookie(token: string) {
  return `${AUTH_SESSION_COOKIE_NAME}=${token}`;
}

async function startServer(overrides?: Partial<{ maxConnectionsPerUser: number; maxConnectionsTotal: number }>) {
  const server = createServer((_req, res) => {
    res.statusCode = 404;
    res.end("Not found");
  });

  attachPerformanceWebSocketServer({
    server,
    securityConfig: {
      trustProxy: false,
      loginRateLimitMaxKeys: 5000,
      maxStreamConnectionsPerUser: overrides?.maxConnectionsPerUser ?? 3,
      maxStreamConnectionsTotal: overrides?.maxConnectionsTotal ?? 10,
    },
  });

  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve());
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Failed to start websocket test server");
  }

  return {
    server,
    baseUrl: `ws://127.0.0.1:${address.port}/api/ws/performance`,
    origin: `http://127.0.0.1:${address.port}`,
  };
}

function closeServer(server: Server | null) {
  return new Promise<void>((resolve, reject) => {
    if (!server) {
      resolve();
      return;
    }
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

function connectPerformanceSocket(
  url: string,
  options?: { cookie?: string; origin?: string },
) {
  return new Promise<WebSocket>((resolve, reject) => {
    const ws = new WebSocket(url, {
      headers: {
        ...(options?.origin ? { Origin: options.origin } : {}),
        ...(options?.cookie ? { Cookie: options.cookie } : {}),
      },
    });

    const cleanup = () => {
      ws.off("open", handleOpen);
      ws.off("error", handleError);
      ws.off("unexpected-response", handleUnexpectedResponse);
    };

    const handleOpen = () => {
      cleanup();
      resolve(ws);
    };

    const handleError = (error: Error) => {
      cleanup();
      reject(error);
    };

    const handleUnexpectedResponse = (_request: unknown, response: { statusCode?: number; statusMessage?: string; resume: () => void }) => {
      cleanup();
      response.resume();
      reject(new Error(`HTTP ${response.statusCode ?? 0}: ${response.statusMessage ?? "Unexpected response"}`));
    };

    ws.on("open", handleOpen);
    ws.on("error", handleError);
    ws.on("unexpected-response", handleUnexpectedResponse);
  });
}

function waitForClose(ws: WebSocket) {
  return new Promise<void>((resolve) => {
    ws.once("close", () => resolve());
  });
}

async function waitForCondition(check: () => boolean, timeoutMs = 2_000) {
  const startedAt = Date.now();
  while (!check()) {
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error("Timed out waiting for websocket condition");
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

function waitForSyncMessage(ws: WebSocket) {
  return new Promise<any>((resolve, reject) => {
    const timeout = setTimeout(() => {
      ws.off("message", handleMessage);
      reject(new Error("Timed out waiting for sync message"));
    }, 2_000);

    const handleMessage = (raw: unknown) => {
      const parsed = JSON.parse(String(raw));
      if (parsed?.type !== "sync") {
        return;
      }
      clearTimeout(timeout);
      ws.off("message", handleMessage);
      resolve(parsed.data);
    };

    ws.on("message", handleMessage);
  });
}

describe("performance websocket", () => {
  let server: Server | null = null;
  let baseUrl = "";
  let trustedOrigin = "";

  beforeEach(async () => {
    mockGetSessionUserByToken.mockReset();
    syncSubscribers.clear();
    mockGetSessionUserByToken.mockImplementation((token: string) => {
      if (token === "user-1") {
        return { user: authenticatedUser(1) };
      }
      if (token === "user-2") {
        return { user: authenticatedUser(2) };
      }
      return null;
    });

    const started = await startServer();
    server = started.server;
    baseUrl = started.baseUrl;
    trustedOrigin = started.origin;
  });

  afterEach(async () => {
    syncSubscribers.clear();
    await closeServer(server);
    server = null;
  });

  it("rejects unauthorized websocket connections", async () => {
    await expect(connectPerformanceSocket(baseUrl, { origin: trustedOrigin })).rejects.toThrow("HTTP 401");
  });

  it("rejects untrusted websocket origins", async () => {
    await expect(
      connectPerformanceSocket(baseUrl, {
        cookie: validCookie("user-1"),
        origin: "https://evil.example",
      }),
    ).rejects.toThrow("HTTP 403");
  });

  it("enforces per-user connection limits and releases slots after close", async () => {
    await closeServer(server);
    const restarted = await startServer({
      maxConnectionsPerUser: 1,
      maxConnectionsTotal: 3,
    });
    server = restarted.server;
    baseUrl = restarted.baseUrl;
    trustedOrigin = restarted.origin;

    const first = await connectPerformanceSocket(baseUrl, {
      cookie: validCookie("user-1"),
      origin: trustedOrigin,
    });

    await expect(
      connectPerformanceSocket(baseUrl, {
        cookie: validCookie("user-1"),
        origin: trustedOrigin,
      }),
    ).rejects.toThrow("HTTP 429");

    const firstClosed = waitForClose(first);
    first.close();
    await firstClosed;
    await waitForCondition(() => syncSubscribers.size === 0);

    const reopened = await connectPerformanceSocket(baseUrl, {
      cookie: validCookie("user-1"),
      origin: trustedOrigin,
    });

    const reopenedClosed = waitForClose(reopened);
    reopened.close();
    await reopenedClosed;
  });

  it("broadcasts sync updates to all active subscribers and cleans up on close", async () => {
    const first = await connectPerformanceSocket(baseUrl, {
      cookie: validCookie("user-1"),
      origin: trustedOrigin,
    });
    const second = await connectPerformanceSocket(baseUrl, {
      cookie: validCookie("user-2"),
      origin: trustedOrigin,
    });

    expect(syncSubscribers.size).toBe(2);

    const firstMessage = waitForSyncMessage(first);
    const secondMessage = waitForSyncMessage(second);

    for (const subscriber of [...syncSubscribers]) {
      subscriber({
        dayKey: "2026-03-21",
        globalEntityId: "TB_EG",
        cacheState: "fresh",
        fetchedAt: "2026-03-21T12:00:00.000Z",
        lastSuccessfulSyncAt: "2026-03-21T12:00:00.000Z",
        consecutiveFailures: 0,
        lastErrorMessage: null,
        bootstrapCompleted: true,
      });
    }

    await expect(firstMessage).resolves.toMatchObject({
      dayKey: "2026-03-21",
      cacheState: "fresh",
    });
    await expect(secondMessage).resolves.toMatchObject({
      dayKey: "2026-03-21",
      cacheState: "fresh",
    });

    const firstClosed = waitForClose(first);
    const secondClosed = waitForClose(second);
    first.close();
    second.close();
    await Promise.all([firstClosed, secondClosed]);
    await waitForCondition(() => syncSubscribers.size === 0);
  });
});
