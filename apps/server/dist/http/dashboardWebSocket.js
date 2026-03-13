import { WebSocket, WebSocketServer } from "ws";
import { getSessionUserByToken } from "../services/authStore.js";
import { readAuthSessionTokenFromCookieHeader } from "./sessionCookie.js";
import { isTrustedOrigin, parseCorsOrigins } from "./security.js";
const DASHBOARD_WEBSOCKET_PATH = "/api/ws/dashboard";
const HEARTBEAT_INTERVAL_MS = 20_000;
function writeUpgradeError(socket, statusCode, message) {
    const body = JSON.stringify({ ok: false, message });
    socket.write(`HTTP/1.1 ${statusCode} ${message}\r\n` +
        "Connection: close\r\n" +
        "Content-Type: application/json; charset=utf-8\r\n" +
        `Content-Length: ${Buffer.byteLength(body)}\r\n` +
        "Cache-Control: no-store\r\n" +
        "\r\n" +
        body);
    socket.destroy();
}
function getHeaderValue(req, name) {
    const value = req.headers[name.toLowerCase()];
    if (Array.isArray(value))
        return value[0];
    return value;
}
function createOriginRequestLike(req, trustProxy) {
    const protocol = "encrypted" in req.socket && req.socket.encrypted ? "https" : "http";
    return {
        headers: req.headers,
        protocol,
        get: (name) => getHeaderValue(req, name),
        app: {
            get: (name) => (name === "trust proxy" ? trustProxy : undefined),
        },
    };
}
function resolveAuthenticatedUser(req) {
    const sessionToken = readAuthSessionTokenFromCookieHeader(getHeaderValue(req, "cookie"));
    if (!sessionToken)
        return null;
    const auth = getSessionUserByToken(sessionToken);
    return auth?.user ?? null;
}
function sendMessage(ws, payload) {
    if (ws.readyState !== WebSocket.OPEN)
        return;
    ws.send(JSON.stringify(payload));
}
export function attachDashboardWebSocketServer(options) {
    const webSocketServer = new WebSocketServer({ noServer: true });
    const allowedOrigins = parseCorsOrigins(process.env.UPUSE_CORS_ORIGINS);
    const activeConnectionsByUserId = new Map();
    const aliveBySocket = new WeakMap();
    let activeConnectionsTotal = 0;
    const releaseConnectionSlot = (userId) => {
        const nextUserCount = (activeConnectionsByUserId.get(userId) ?? 1) - 1;
        if (nextUserCount > 0) {
            activeConnectionsByUserId.set(userId, nextUserCount);
        }
        else {
            activeConnectionsByUserId.delete(userId);
        }
        activeConnectionsTotal = Math.max(0, activeConnectionsTotal - 1);
    };
    const acceptConnection = (user) => {
        const userConnectionCount = activeConnectionsByUserId.get(user.id) ?? 0;
        if (userConnectionCount >= options.securityConfig.maxStreamConnectionsPerUser) {
            return { ok: false, statusCode: 429, message: "Too many active dashboard streams for the current user." };
        }
        if (activeConnectionsTotal >= options.securityConfig.maxStreamConnectionsTotal) {
            return { ok: false, statusCode: 429, message: "Too many active dashboard streams." };
        }
        activeConnectionsByUserId.set(user.id, userConnectionCount + 1);
        activeConnectionsTotal += 1;
        return { ok: true };
    };
    options.server.on("upgrade", (req, socket, head) => {
        const url = new URL(req.url ?? "/", "http://localhost");
        if (url.pathname !== DASHBOARD_WEBSOCKET_PATH) {
            socket.destroy();
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
        const accepted = acceptConnection(user);
        if (!accepted.ok) {
            writeUpgradeError(socket, accepted.statusCode, accepted.message);
            return;
        }
        webSocketServer.handleUpgrade(req, socket, head, (ws) => {
            webSocketServer.emit("connection", ws, req, user);
        });
    });
    webSocketServer.on("connection", (ws, _req, user) => {
        let cleaned = false;
        aliveBySocket.set(ws, true);
        let unsubscribe = () => { };
        try {
            unsubscribe = options.engine.subscribe((snapshot) => {
                sendMessage(ws, {
                    type: "snapshot",
                    data: snapshot,
                });
            });
        }
        catch (error) {
            console.error("Dashboard WebSocket subscription failed", error);
            releaseConnectionSlot(user.id);
            try {
                ws.close(1011, "Failed to initialize live dashboard stream");
            }
            catch {
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
            }
            catch { }
            sendMessage(ws, {
                type: "ping",
                data: { at: new Date().toISOString() },
            });
        }, HEARTBEAT_INTERVAL_MS);
        const cleanup = () => {
            if (cleaned)
                return;
            cleaned = true;
            clearInterval(heartbeat);
            unsubscribe();
            releaseConnectionSlot(user.id);
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
