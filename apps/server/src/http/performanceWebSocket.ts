import type { IncomingMessage, Server as HttpServer } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocket, WebSocketServer } from "ws";
import type { SecurityConfig } from "../config/security.js";
import { getSessionUserByToken } from "../services/authStore.js";
import type { MonitorEngine } from "../services/monitorEngine.js";
import { getCurrentCairoDayKey, getPerformanceSummary } from "../services/performanceStore.js";
import { buildPerformanceStatusColorMap } from "../services/performanceStatusColors.js";
import { subscribeOrdersMirrorEntitySync, type OrdersMirrorEntitySyncStatus } from "../services/ordersMirrorStore.js";
import type { AppUser, PerformanceSummaryResponse } from "../types/models.js";
import { createConnectionQuota } from "./connectionQuota.js";
import { readAuthSessionTokenFromCookieHeader } from "./sessionCookie.js";
import { isTrustedOrigin, parseCorsOrigins } from "./security.js";

const PERFORMANCE_WEBSOCKET_PATH = "/api/ws/performance";
const HEARTBEAT_INTERVAL_MS = 20_000;

interface PerformanceWebSocketEnvelope {
  type: "summary" | "sync" | "ping";
  data: PerformanceSummaryResponse | OrdersMirrorEntitySyncStatus | { at: string };
}

function writeUpgradeError(socket: Duplex, statusCode: number, message: string) {
  const body = JSON.stringify({ ok: false, message });
  socket.write(
    `HTTP/1.1 ${statusCode} ${message}\r\n` +
      "Connection: close\r\n" +
      "Content-Type: application/json; charset=utf-8\r\n" +
      `Content-Length: ${Buffer.byteLength(body)}\r\n` +
      "Cache-Control: no-store\r\n" +
      "\r\n" +
      body,
  );
  socket.destroy();
}

function getHeaderValue(req: IncomingMessage, name: string) {
  const value = req.headers[name.toLowerCase()];
  if (Array.isArray(value)) return value[0];
  return value;
}

function createOriginRequestLike(req: IncomingMessage, trustProxy: SecurityConfig["trustProxy"]) {
  const protocol = "encrypted" in req.socket && req.socket.encrypted ? "https" : "http";

  return {
    headers: req.headers,
    protocol,
    get: (name: string) => getHeaderValue(req, name),
    app: {
      get: (name: string) => (name === "trust proxy" ? trustProxy : undefined),
    },
  } as Parameters<typeof isTrustedOrigin>[1];
}

function resolveAuthenticatedUser(req: IncomingMessage) {
  const sessionToken = readAuthSessionTokenFromCookieHeader(getHeaderValue(req, "cookie"));
  if (!sessionToken) return null;

  const auth = getSessionUserByToken(sessionToken);
  return auth?.user ?? null;
}

function sendMessage(ws: WebSocket, payload: PerformanceWebSocketEnvelope) {
  if (ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify(payload));
}

export function attachPerformanceWebSocketServer(options: {
  server: HttpServer;
  engine: MonitorEngine;
  securityConfig: SecurityConfig;
}) {
  const webSocketServer = new WebSocketServer({ noServer: true });
  const allowedOrigins = parseCorsOrigins(process.env.UPUSE_CORS_ORIGINS);
  const activeSockets = new Set<WebSocket>();
  const aliveBySocket = new WeakMap<WebSocket, boolean>();
  const connectionQuota = createConnectionQuota({
    maxConnectionsPerUser: options.securityConfig.maxStreamConnectionsPerUser,
    maxConnectionsTotal: options.securityConfig.maxStreamConnectionsTotal,
    perUserLimitMessage: "Too many active performance streams for the current user.",
    globalLimitMessage: "Too many active performance streams.",
  });
  let unsubscribeSync = () => {};
  let syncSubscribed = false;
  let lastSummarySnapshot: PerformanceSummaryResponse | null = null;
  let summaryBuildPromise: Promise<PerformanceSummaryResponse | null> | null = null;
  let pendingSummaryBroadcast = false;

  const getCachedSummarySnapshot = () => {
    if (!lastSummarySnapshot) return null;
    return lastSummarySnapshot.scope.dayKey === getCurrentCairoDayKey() ? lastSummarySnapshot : null;
  };

  const buildSummarySnapshot = async () => {
    try {
      const summary = await getPerformanceSummary(buildPerformanceStatusColorMap(options.engine));
      lastSummarySnapshot = summary.scope.dayKey === getCurrentCairoDayKey() ? summary : null;
      return summary;
    } catch (error) {
      console.error("Performance websocket summary build failed", error);
      return null;
    }
  };

  const loadSummarySnapshot = () => {
    if (summaryBuildPromise) {
      return summaryBuildPromise;
    }

    summaryBuildPromise = buildSummarySnapshot().finally(() => {
      summaryBuildPromise = null;
      if (pendingSummaryBroadcast && activeSockets.size) {
        pendingSummaryBroadcast = false;
        void refreshSummaryAndBroadcast();
      } else {
        pendingSummaryBroadcast = false;
      }
    });

    return summaryBuildPromise;
  };

  const broadcastSummarySnapshot = (summary: PerformanceSummaryResponse) => {
    for (const socket of activeSockets) {
      sendMessage(socket, {
        type: "summary",
        data: summary,
      });
    }
  };

  const refreshSummaryAndBroadcast = async () => {
    if (summaryBuildPromise) {
      pendingSummaryBroadcast = true;
      return summaryBuildPromise;
    }

    const summary = await loadSummarySnapshot();
    if (summary) {
      broadcastSummarySnapshot(summary);
    }
    return summary;
  };

  const releaseSyncSubscriptionIfIdle = () => {
    if (!syncSubscribed || activeSockets.size > 0) return;
    unsubscribeSync();
    unsubscribeSync = () => {};
    syncSubscribed = false;
    pendingSummaryBroadcast = false;
  };

  const ensureSyncSubscription = () => {
    if (syncSubscribed || !activeSockets.size) return;

    unsubscribeSync = subscribeOrdersMirrorEntitySync((status) => {
      for (const socket of activeSockets) {
        sendMessage(socket, {
          type: "sync",
          data: status,
        });
      }
      void refreshSummaryAndBroadcast();
    });
    syncSubscribed = true;
  };

  const sendInitialSummarySnapshot = async (ws: WebSocket) => {
    const cachedSummary = getCachedSummarySnapshot();
    if (cachedSummary) {
      sendMessage(ws, {
        type: "summary",
        data: cachedSummary,
      });
      return;
    }

    const summary = await loadSummarySnapshot();
    if (!summary || ws.readyState !== WebSocket.OPEN) return;
    sendMessage(ws, {
      type: "summary",
      data: summary,
    });
  };

  options.server.on("upgrade", (req, socket, head) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (url.pathname !== PERFORMANCE_WEBSOCKET_PATH) {
      return;
    }

    const requestOrigin = getHeaderValue(req, "origin");
    if (!isTrustedOrigin(requestOrigin, createOriginRequestLike(req, options.securityConfig.trustProxy), allowedOrigins)) {
      writeUpgradeError(socket, 403, "Untrusted request origin");
      return;
    }

    const user = resolveAuthenticatedUser(req);
    if (!user) {
      writeUpgradeError(socket, 401, "Unauthorized");
      return;
    }

    const accepted = connectionQuota.acquire(user.id);
    if (!accepted.ok) {
      writeUpgradeError(socket, accepted.statusCode, accepted.message);
      return;
    }

    webSocketServer.handleUpgrade(req, socket, head, (ws: WebSocket) => {
      webSocketServer.emit("connection", ws, req, user);
    });
  });

  webSocketServer.on("connection", (ws: WebSocket, _req: IncomingMessage, user: AppUser) => {
    let cleaned = false;
    activeSockets.add(ws);
    aliveBySocket.set(ws, true);

    try {
      ensureSyncSubscription();
    } catch (error) {
      console.error("Performance WebSocket subscription failed", error);
      activeSockets.delete(ws);
      connectionQuota.release(user.id);
      try {
        ws.close(1011, "Failed to initialize live performance stream");
      } catch {
        ws.terminate();
      }
      return;
    }

    void sendInitialSummarySnapshot(ws);

    const heartbeat = setInterval(() => {
      if (aliveBySocket.get(ws) === false) {
        ws.terminate();
        return;
      }

      aliveBySocket.set(ws, false);
      try {
        ws.ping();
      } catch {}

      sendMessage(ws, {
        type: "ping",
        data: { at: new Date().toISOString() },
      });
    }, HEARTBEAT_INTERVAL_MS);

    const cleanup = () => {
      if (cleaned) return;
      cleaned = true;
      activeSockets.delete(ws);
      clearInterval(heartbeat);
      releaseSyncSubscriptionIfIdle();
      connectionQuota.release(user.id);
    };

    ws.on("pong", () => {
      aliveBySocket.set(ws, true);
    });
    ws.on("close", cleanup);
    ws.on("error", cleanup);
  });

  options.server.on("close", () => {
    unsubscribeSync();
    webSocketServer.close();
  });
}
