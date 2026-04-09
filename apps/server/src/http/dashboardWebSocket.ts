import type { IncomingMessage, Server as HttpServer } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocket, WebSocketServer } from "ws";
import type { SecurityConfig } from "../config/security.js";
import { getSessionUserByToken } from "../services/authStore.js";
import type { MonitorEngine } from "../services/monitorEngine.js";
import type { AppUser, DashboardSnapshot } from "../types/models.js";
import { createConnectionQuota } from "./connectionQuota.js";
import { readAuthSessionTokenFromCookieHeader } from "./sessionCookie.js";
import { isTrustedOrigin, parseCorsOrigins } from "./security.js";

const DASHBOARD_WEBSOCKET_PATH = "/api/ws/dashboard";
const HEARTBEAT_INTERVAL_MS = 20_000;

interface DashboardWebSocketEnvelope {
  type: "snapshot" | "ping";
  data: DashboardSnapshot | { at: string };
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

function sendMessage(ws: WebSocket, payload: DashboardWebSocketEnvelope) {
  if (ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify(payload));
}

export function attachDashboardWebSocketServer(options: {
  server: HttpServer;
  engine: MonitorEngine;
  securityConfig: SecurityConfig;
}) {
  const webSocketServer = new WebSocketServer({ noServer: true });
  const allowedOrigins = parseCorsOrigins(process.env.UPUSE_CORS_ORIGINS);
  const aliveBySocket = new WeakMap<WebSocket, boolean>();
  const connectionQuota = createConnectionQuota({
    maxConnectionsPerUser: options.securityConfig.maxStreamConnectionsPerUser,
    maxConnectionsTotal: options.securityConfig.maxStreamConnectionsTotal,
    perUserLimitMessage: "Too many active dashboard streams for the current user.",
    globalLimitMessage: "Too many active dashboard streams.",
  });

  options.server.on("upgrade", (req, socket, head) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (url.pathname !== DASHBOARD_WEBSOCKET_PATH) {
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
    aliveBySocket.set(ws, true);

    let unsubscribe = () => {};
    try {
      unsubscribe = options.engine.subscribe((snapshot) => {
        sendMessage(ws, {
          type: "snapshot",
          data: snapshot,
        });
      });
    } catch (error) {
      console.error("Dashboard WebSocket subscription failed", error);
      connectionQuota.release(user.id);
      try {
        ws.close(1011, "Failed to initialize live dashboard stream");
      } catch {
        ws.terminate();
      }
      return;
    }

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
      clearInterval(heartbeat);
      unsubscribe();
      connectionQuota.release(user.id);
    };

    ws.on("pong", () => {
      aliveBySocket.set(ws, true);
    });
    ws.on("close", cleanup);
    ws.on("error", cleanup);
  });

  options.server.on("close", () => {
    webSocketServer.close();
  });
}
