import { createServer, type Server } from "node:http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WebSocket } from "ws";

const { mockGetSessionUserByToken } = vi.hoisted(() => ({
  mockGetSessionUserByToken: vi.fn(),
}));

vi.mock("../services/authStore.js", () => ({
  getSessionUserByToken: mockGetSessionUserByToken,
}));

import { AUTH_SESSION_COOKIE_NAME } from "./sessionCookie.js";
import { attachDashboardWebSocketServer } from "./dashboardWebSocket.js";

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
  const unsubscribe = vi.fn();
  const engine = {
    subscribe: vi.fn(() => unsubscribe),
  };
  const server = createServer((_req, res) => {
    res.statusCode = 404;
    res.end("Not found");
  });

  attachDashboardWebSocketServer({
    server,
    engine: engine as any,
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
    engine,
    unsubscribe,
    baseUrl: `ws://127.0.0.1:${address.port}/api/ws/dashboard`,
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

function connectDashboardSocket(url: string, options?: { cookie?: string; origin?: string }) {
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

describe("dashboard websocket", () => {
  let server: Server | null = null;
  let baseUrl = "";
  let trustedOrigin = "";

  beforeEach(async () => {
    mockGetSessionUserByToken.mockReset();
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
    await closeServer(server);
    server = null;
  });

  it("rejects unauthorized websocket connections", async () => {
    await expect(connectDashboardSocket(baseUrl, { origin: trustedOrigin })).rejects.toThrow("HTTP 401");
  });

  it("rejects untrusted websocket origins", async () => {
    await expect(
      connectDashboardSocket(baseUrl, {
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

    const first = await connectDashboardSocket(baseUrl, {
      cookie: validCookie("user-1"),
      origin: trustedOrigin,
    });

    await expect(
      connectDashboardSocket(baseUrl, {
        cookie: validCookie("user-1"),
        origin: trustedOrigin,
      }),
    ).rejects.toThrow("HTTP 429");

    const firstClosed = waitForClose(first);
    first.close();
    await firstClosed;

    const reopened = await connectDashboardSocket(baseUrl, {
      cookie: validCookie("user-1"),
      origin: trustedOrigin,
    });

    const reopenedClosed = waitForClose(reopened);
    reopened.close();
    await reopenedClosed;
  });
});
