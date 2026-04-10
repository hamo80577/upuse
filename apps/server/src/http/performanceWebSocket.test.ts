import { createServer, type Server } from "node:http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WebSocket } from "ws";

const {
  mockGetSessionUserByToken,
  mockGetPerformanceSummary,
  syncSubscribers,
} = vi.hoisted(() => ({
  mockGetSessionUserByToken: vi.fn(),
  mockGetPerformanceSummary: vi.fn(),
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

vi.mock("../services/performanceStore.js", () => ({
  getCurrentCairoDayKey: () => "2026-03-21",
  getPerformanceSummary: mockGetPerformanceSummary,
}));

import { AUTH_SESSION_COOKIE_NAME } from "./sessionCookie.js";
import { attachPerformanceWebSocketServer } from "./performanceWebSocket.js";

const bufferedMessagesBySocket = new WeakMap<WebSocket, Array<{ type?: string; data?: unknown }>>();

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

  const engineSnapshot = {
    branches: [
      {
        branchId: 7,
        statusColor: "green",
      },
    ],
  };

  attachPerformanceWebSocketServer({
    server,
    engine: {
      getSnapshot: () => engineSnapshot,
      subscribe: (listener: (snapshot: typeof engineSnapshot) => void) => {
        listener(engineSnapshot);
        return () => {};
      },
    } as any,
    securityConfig: {
      trustProxy: false,
      loginRateLimitMaxKeys: 5000,
      maxStreamConnectionsPerUser: overrides?.maxConnectionsPerUser ?? 3,
      maxStreamConnectionsTotal: overrides?.maxConnectionsTotal ?? 10,
      scanoCsvUploadMaxFileSizeBytes: 5 * 1024 * 1024,
      scanoCsvUploadMaxParts: 5,
      scanoImageUploadMaxFileSizeBytes: 5 * 1024 * 1024,
      scanoImageUploadMaxFiles: 5,
      scanoImageUploadMaxParts: 10,
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
    const bufferedMessages: Array<{ type?: string; data?: unknown }> = [];
    bufferedMessagesBySocket.set(ws, bufferedMessages);

    const cleanup = () => {
      ws.off("open", handleOpen);
      ws.off("error", handleError);
      ws.off("unexpected-response", handleUnexpectedResponse);
    };

    ws.on("message", (raw: unknown) => {
      try {
        bufferedMessages.push(JSON.parse(String(raw)) as { type?: string; data?: unknown });
      } catch {}
    });

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
  return waitForTypedMessage(ws, "sync");
}

function waitForSummaryMessage(ws: WebSocket) {
  return waitForTypedMessage(ws, "summary");
}

function waitForTypedMessage(ws: WebSocket, type: "sync" | "summary") {
  const bufferedMessages = bufferedMessagesBySocket.get(ws) ?? [];
  const bufferedIndex = bufferedMessages.findIndex((message) => message?.type === type);
  if (bufferedIndex >= 0) {
    const [message] = bufferedMessages.splice(bufferedIndex, 1);
    return Promise.resolve(message?.data);
  }

  return new Promise<any>((resolve, reject) => {
    const timeout = setTimeout(() => {
      ws.off("message", handleMessage);
      reject(new Error(`Timed out waiting for ${type} message`));
    }, 2_000);

    const handleMessage = (raw: unknown) => {
      const parsed = JSON.parse(String(raw));
      if (parsed?.type !== type) {
        return;
      }
      const queuedMessages = bufferedMessagesBySocket.get(ws);
      if (queuedMessages) {
        const queuedIndex = queuedMessages.findIndex((message) => message?.type === type);
        if (queuedIndex >= 0) {
          queuedMessages.splice(queuedIndex, 1);
        }
      }
      clearTimeout(timeout);
      ws.off("message", handleMessage);
      resolve(parsed.data);
    };

    ws.on("message", handleMessage);
  });
}

function clearBufferedMessages(ws: WebSocket, type?: "sync" | "summary") {
  const bufferedMessages = bufferedMessagesBySocket.get(ws);
  if (!bufferedMessages) return;
  if (!type) {
    bufferedMessages.length = 0;
    return;
  }
  for (let index = bufferedMessages.length - 1; index >= 0; index -= 1) {
    if (bufferedMessages[index]?.type === type) {
      bufferedMessages.splice(index, 1);
    }
  }
}

describe("performance websocket", () => {
  let server: Server | null = null;
  let baseUrl = "";
  let trustedOrigin = "";

  beforeEach(async () => {
    mockGetSessionUserByToken.mockReset();
    mockGetPerformanceSummary.mockReset();
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
    mockGetPerformanceSummary.mockResolvedValue({
      scope: {
        dayKey: "2026-03-21",
        timezone: "Africa/Cairo",
        startUtcIso: "2026-03-20T22:00:00.000Z",
        endUtcIso: "2026-03-21T21:59:59.999Z",
      },
      cards: {
        branchCount: 1,
        totalOrders: 12,
        totalCancelledOrders: 2,
        activeOrders: 6,
        lateNow: 1,
        onHoldOrders: 1,
        unassignedOrders: 1,
        preparingNow: 3,
        readyToPickupOrders: 2,
        vfr: 8.33,
        lfr: 8.33,
        vlfr: 16.67,
        vendorOwnerCancelledCount: 1,
        transportOwnerCancelledCount: 1,
      },
      branches: [],
      statusCounts: [],
      ownerCoverage: {
        totalCancelledOrders: 2,
        resolvedOwnerCount: 2,
        unresolvedOwnerCount: 0,
        vendorOwnerCancelledCount: 1,
        transportOwnerCancelledCount: 1,
        lookupErrorCount: 0,
        coverageRatio: 1,
        warning: null,
      },
      chains: [],
      unmappedVendors: [],
      fetchedAt: "2026-03-21T12:00:00.000Z",
      cacheState: "fresh",
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

  it("sends a live summary snapshot on connect and broadcasts one rebuilt snapshot per sync", async () => {
    const first = await connectPerformanceSocket(baseUrl, {
      cookie: validCookie("user-1"),
      origin: trustedOrigin,
    });
    await expect(waitForSummaryMessage(first)).resolves.toMatchObject({
      fetchedAt: "2026-03-21T12:00:00.000Z",
      cacheState: "fresh",
    });
    expect(mockGetPerformanceSummary).toHaveBeenCalledTimes(1);

    const second = await connectPerformanceSocket(baseUrl, {
      cookie: validCookie("user-2"),
      origin: trustedOrigin,
    });
    await expect(waitForSummaryMessage(second)).resolves.toMatchObject({
      fetchedAt: "2026-03-21T12:00:00.000Z",
      cacheState: "fresh",
    });

    expect(mockGetPerformanceSummary).toHaveBeenCalledTimes(1);
    expect(syncSubscribers.size).toBe(1);
    clearBufferedMessages(first, "summary");
    clearBufferedMessages(second, "summary");

    mockGetPerformanceSummary.mockResolvedValueOnce({
      scope: {
        dayKey: "2026-03-21",
        timezone: "Africa/Cairo",
        startUtcIso: "2026-03-20T22:00:00.000Z",
        endUtcIso: "2026-03-21T21:59:59.999Z",
      },
      cards: {
        branchCount: 1,
        totalOrders: 15,
        totalCancelledOrders: 3,
        activeOrders: 8,
        lateNow: 2,
        onHoldOrders: 1,
        unassignedOrders: 1,
        preparingNow: 4,
        readyToPickupOrders: 2,
        vfr: 13.33,
        lfr: 6.67,
        vlfr: 20,
        vendorOwnerCancelledCount: 2,
        transportOwnerCancelledCount: 1,
      },
      branches: [],
      statusCounts: [],
      ownerCoverage: {
        totalCancelledOrders: 3,
        resolvedOwnerCount: 3,
        unresolvedOwnerCount: 0,
        vendorOwnerCancelledCount: 2,
        transportOwnerCancelledCount: 1,
        lookupErrorCount: 0,
        coverageRatio: 1,
        warning: null,
      },
      chains: [],
      unmappedVendors: [],
      fetchedAt: "2026-03-21T12:05:00.000Z",
      cacheState: "fresh",
    });

    const firstSyncMessage = waitForSyncMessage(first);
    const secondSyncMessage = waitForSyncMessage(second);
    const firstSummaryMessage = waitForSummaryMessage(first);
    const secondSummaryMessage = waitForSummaryMessage(second);

    for (const subscriber of syncSubscribers) {
      subscriber({
        dayKey: "2026-03-21",
        globalEntityId: "TB_EG",
        cacheState: "fresh",
        fetchedAt: "2026-03-21T12:05:00.000Z",
        lastSuccessfulSyncAt: "2026-03-21T12:05:00.000Z",
        consecutiveFailures: 0,
        lastErrorMessage: null,
        bootstrapCompleted: true,
      });
    }

    await expect(firstSyncMessage).resolves.toMatchObject({
      dayKey: "2026-03-21",
      cacheState: "fresh",
    });
    await expect(secondSyncMessage).resolves.toMatchObject({
      dayKey: "2026-03-21",
      cacheState: "fresh",
    });
    await expect(firstSummaryMessage).resolves.toMatchObject({
      fetchedAt: "2026-03-21T12:05:00.000Z",
      cards: {
        totalOrders: 15,
      },
    });
    await expect(secondSummaryMessage).resolves.toMatchObject({
      fetchedAt: "2026-03-21T12:05:00.000Z",
      cards: {
        totalOrders: 15,
      },
    });

    expect(mockGetPerformanceSummary).toHaveBeenCalledTimes(2);

    const firstClosed = waitForClose(first);
    const secondClosed = waitForClose(second);
    first.close();
    second.close();
    await Promise.all([firstClosed, secondClosed]);
    await waitForCondition(() => syncSubscribers.size === 0);
  });
});
