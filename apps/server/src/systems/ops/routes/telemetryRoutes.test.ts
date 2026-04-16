import express from "express";
import type { Server } from "node:http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerApiErrorHandler } from "../../../app/error-handling/registerApiErrorHandler.js";
import { db as testDb } from "../../../config/db.js";
import { requireAuthenticatedApi } from "../../../shared/http/auth/sessionAuth.js";
import { buildSharedSchemaSql } from "../../../shared/db/schema/sharedSchema.js";
import type { AppUser } from "../../../types/models.js";
import { buildOpsSchemaSql } from "../db/schema.js";
import { registerOpsRoutes } from "./registerRoutes.js";

vi.mock("../../../config/db.js", async () => {
  const Database = (await import("better-sqlite3")).default;
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  return {
    db,
    cryptoBox: {
      encrypt: (value: string) => value,
      decrypt: (value: string) => value,
    },
  };
});

function buildUser(overrides: Partial<AppUser> = {}): AppUser {
  return {
    id: 1,
    email: "primary@example.com",
    name: "Primary Admin",
    role: "admin",
    active: true,
    createdAt: "2026-04-16T00:00:00.000Z",
    upuseAccess: true,
    isPrimaryAdmin: true,
    ...overrides,
  };
}

function resetDb() {
  testDb.exec(`
    PRAGMA foreign_keys = OFF;
    DROP TABLE IF EXISTS ops_metric_snapshots;
    DROP TABLE IF EXISTS ops_errors;
    DROP TABLE IF EXISTS ops_events;
    DROP TABLE IF EXISTS ops_sessions;
    DROP TABLE IF EXISTS sessions;
    DROP TABLE IF EXISTS users;
    PRAGMA foreign_keys = ON;
  `);
  testDb.exec(buildSharedSchemaSql());
  testDb.exec(buildOpsSchemaSql());
  testDb.prepare(`
    INSERT INTO users (id, email, name, role, passwordHash, active, createdAt, upuseAccess, isPrimaryAdmin)
    VALUES
      (1, 'primary@example.com', 'Primary Admin', 'admin', 'hash', 1, '2026-04-16T00:00:00.000Z', 1, 1),
      (2, 'admin@example.com', 'Admin', 'admin', 'hash', 1, '2026-04-16T00:00:00.000Z', 1, 0),
      (3, 'user@example.com', 'User', 'user', 'hash', 1, '2026-04-16T00:00:00.000Z', 1, 0)
  `).run();
}

function createApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const kind = req.header("x-test-user");
    if (kind === "primary") {
      req.authUser = buildUser();
    }
    if (kind === "admin") {
      req.authUser = buildUser({
        id: 2,
        email: "admin@example.com",
        name: "Admin",
        role: "admin",
        isPrimaryAdmin: false,
      });
    }
    if (kind === "user") {
      req.authUser = buildUser({
        id: 3,
        email: "user@example.com",
        name: "User",
        role: "user",
        isPrimaryAdmin: false,
      });
    }
    next();
  });
  app.use(requireAuthenticatedApi());
  registerOpsRoutes({ app, engine: undefined as never, securityConfig: null as never });
  registerApiErrorHandler(app);
  return app;
}

async function startServer() {
  const app = createApp();
  const server = await new Promise<Server>((resolve) => {
    const nextServer = app.listen(0, () => resolve(nextServer));
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Failed to resolve Ops test server address");
  }
  return {
    server,
    baseUrl: `http://127.0.0.1:${address.port}`,
  };
}

async function closeServer(server: Server | null) {
  await new Promise<void>((resolve, reject) => {
    if (!server) {
      resolve();
      return;
    }
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

function jsonHeaders(extra: Record<string, string> = {}) {
  return {
    "Content-Type": "application/json",
    ...extra,
  };
}

function getSession(sessionId: string) {
  return testDb.prepare<[string], {
    id: string;
    userId: number | null;
    userEmail: string | null;
    currentPath: string | null;
    state: string;
    endedAt: string | null;
  }>(`
    SELECT id, userId, userEmail, currentPath, state, endedAt
    FROM ops_sessions
    WHERE id = ?
  `).get(sessionId);
}

function countEventsForSession(sessionId: string, userId?: number) {
  const row = userId == null
    ? testDb.prepare<[string], { count: number }>(`
      SELECT COUNT(*) AS count FROM ops_events WHERE sessionId = ?
    `).get(sessionId)
    : testDb.prepare<[string, number], { count: number }>(`
      SELECT COUNT(*) AS count FROM ops_events WHERE sessionId = ? AND userId = ?
    `).get(sessionId, userId);
  return row?.count ?? 0;
}

describe("Ops telemetry routes", () => {
  let server: Server | null = null;
  let baseUrl = "";

  beforeEach(async () => {
    resetDb();
    const started = await startServer();
    server = started.server;
    baseUrl = started.baseUrl;
  });

  afterEach(async () => {
    await closeServer(server);
    server = null;
  });

  it("keeps Ops telemetry write routes authenticated without requiring primary-admin access", async () => {
    const writeRoutes = [
      { method: "POST", path: "/api/ops/ingest", body: { events: [{ type: "page_view" }] } },
      { method: "POST", path: "/api/ops/presence/heartbeat", body: {} },
      { method: "POST", path: "/api/ops/presence/end", body: { sessionId: "11111111-1111-4111-8111-111111111111" } },
    ];

    for (const route of writeRoutes) {
      const unauthenticated = await fetch(`${baseUrl}${route.path}`, {
        method: route.method,
        headers: jsonHeaders(),
        body: JSON.stringify(route.body),
      });
      expect(unauthenticated.status).toBe(401);

      for (const userKind of ["admin", "user", "primary"]) {
        const authorized = await fetch(`${baseUrl}${route.path}`, {
          method: route.method,
          headers: jsonHeaders({ "x-test-user": userKind }),
          body: JSON.stringify(route.body),
        });
        expect(authorized.status).toBe(200);
      }
    }
  });

  it("keeps Ops health and read routes primary-admin-only", async () => {
    const readRoutes = [
      { method: "GET", path: "/api/ops/health" },
      { method: "GET", path: "/api/ops/summary" },
      { method: "GET", path: "/api/ops/sessions" },
      { method: "GET", path: "/api/ops/events" },
      { method: "GET", path: "/api/ops/errors" },
    ];

    for (const route of readRoutes) {
      const unauthenticated = await fetch(`${baseUrl}${route.path}`, {
        method: route.method,
      });
      expect(unauthenticated.status).toBe(401);

      for (const userKind of ["admin", "user"]) {
        const forbidden = await fetch(`${baseUrl}${route.path}`, {
          method: route.method,
          headers: { "x-test-user": userKind },
        });
        expect(forbidden.status).toBe(403);
        expect(await forbidden.json()).toMatchObject({
          ok: false,
          code: "FORBIDDEN",
          errorOrigin: "authorization",
        });
      }

      const primary = await fetch(`${baseUrl}${route.path}`, {
        method: route.method,
        headers: { "x-test-user": "primary" },
      });
      expect(primary.status).toBe(200);
    }
  });

  it("allows the primary admin to access all Ops telemetry routes", async () => {
    const heartbeat = await fetch(`${baseUrl}/api/ops/presence/heartbeat`, {
      method: "POST",
      headers: jsonHeaders({ "x-test-user": "primary" }),
      body: JSON.stringify({
        path: "/ops",
        system: "ops",
        state: "active",
      }),
    });
    const heartbeatBody = await heartbeat.json();

    expect(heartbeat.status).toBe(200);
    expect(heartbeatBody).toMatchObject({
      ok: true,
      session: {
        currentSystem: "ops",
        state: "active",
        userEmail: "primary@example.com",
      },
    });

    const routes = [
      { method: "POST", path: "/api/ops/ingest", body: { session: { sessionId: heartbeatBody.sessionId }, events: [{ type: "page_view", path: "/ops" }] } },
      { method: "POST", path: "/api/ops/presence/end", body: { sessionId: heartbeatBody.sessionId } },
      { method: "GET", path: "/api/ops/summary" },
      { method: "GET", path: "/api/ops/sessions" },
      { method: "GET", path: "/api/ops/events" },
      { method: "GET", path: "/api/ops/errors" },
    ];

    for (const route of routes) {
      const response = await fetch(`${baseUrl}${route.path}`, {
        method: route.method,
        headers: route.body ? jsonHeaders({ "x-test-user": "primary" }) : { "x-test-user": "primary" },
        body: route.body ? JSON.stringify(route.body) : undefined,
      });
      expect(response.status).toBe(200);
    }
  });

  it("rotates heartbeat writes away from a foreign session id without overwriting the original owner", async () => {
    const foreignSessionId = "11111111-1111-4111-8111-111111111111";
    const ownerResponse = await fetch(`${baseUrl}/api/ops/presence/heartbeat`, {
      method: "POST",
      headers: jsonHeaders({ "x-test-user": "admin" }),
      body: JSON.stringify({
        sessionId: foreignSessionId,
        path: "/performance",
        system: "upuse",
        state: "active",
      }),
    });
    expect(ownerResponse.status).toBe(200);

    const rotatedResponse = await fetch(`${baseUrl}/api/ops/presence/heartbeat`, {
      method: "POST",
      headers: jsonHeaders({ "x-test-user": "user" }),
      body: JSON.stringify({
        sessionId: foreignSessionId,
        path: "/scano/my-tasks",
        system: "scano",
        state: "active",
      }),
    });
    const rotatedBody = await rotatedResponse.json();

    expect(rotatedResponse.status).toBe(200);
    expect(rotatedBody.sessionId).not.toBe(foreignSessionId);
    expect(rotatedBody.session).toMatchObject({
      id: rotatedBody.sessionId,
      userId: 3,
      userEmail: "user@example.com",
      currentPath: "/scano/my-tasks",
    });
    expect(getSession(foreignSessionId)).toMatchObject({
      userId: 2,
      userEmail: "admin@example.com",
      currentPath: "/performance",
      state: "active",
      endedAt: null,
    });
  });

  it("attaches ingest events to a rotated owned session instead of a foreign session id", async () => {
    const foreignSessionId = "11111111-1111-4111-8111-111111111111";
    const ownerResponse = await fetch(`${baseUrl}/api/ops/presence/heartbeat`, {
      method: "POST",
      headers: jsonHeaders({ "x-test-user": "admin" }),
      body: JSON.stringify({
        sessionId: foreignSessionId,
        path: "/settings",
        system: "upuse",
      }),
    });
    expect(ownerResponse.status).toBe(200);

    const ingestResponse = await fetch(`${baseUrl}/api/ops/ingest`, {
      method: "POST",
      headers: jsonHeaders({ "x-test-user": "user" }),
      body: JSON.stringify({
        session: {
          sessionId: foreignSessionId,
          path: "/scano/assign-task",
          system: "scano",
        },
        events: [
          { type: "page_view", path: "/scano/assign-task", system: "scano" },
        ],
      }),
    });
    const ingestBody = await ingestResponse.json();

    expect(ingestResponse.status).toBe(200);
    expect(ingestBody.sessionId).not.toBe(foreignSessionId);
    expect(countEventsForSession(foreignSessionId, 3)).toBe(0);
    expect(countEventsForSession(ingestBody.sessionId, 3)).toBeGreaterThan(0);
    expect(getSession(foreignSessionId)).toMatchObject({
      userId: 2,
      userEmail: "admin@example.com",
      currentPath: "/settings",
    });
    expect(getSession(ingestBody.sessionId)).toMatchObject({
      userId: 3,
      userEmail: "user@example.com",
      currentPath: "/scano/assign-task",
    });
  });

  it("does not let one authenticated user end another user's Ops session", async () => {
    const foreignSessionId = "11111111-1111-4111-8111-111111111111";
    const ownerResponse = await fetch(`${baseUrl}/api/ops/presence/heartbeat`, {
      method: "POST",
      headers: jsonHeaders({ "x-test-user": "admin" }),
      body: JSON.stringify({
        sessionId: foreignSessionId,
        path: "/",
        system: "upuse",
        state: "active",
      }),
    });
    expect(ownerResponse.status).toBe(200);

    const foreignEndResponse = await fetch(`${baseUrl}/api/ops/presence/end`, {
      method: "POST",
      headers: jsonHeaders({ "x-test-user": "user" }),
      body: JSON.stringify({
        sessionId: foreignSessionId,
        endedAt: "2026-04-16T09:10:00.000Z",
      }),
    });
    const foreignEndBody = await foreignEndResponse.json();

    expect(foreignEndResponse.status).toBe(200);
    expect(foreignEndBody).toMatchObject({
      ok: true,
      sessionId: foreignSessionId,
      ended: false,
    });
    expect(getSession(foreignSessionId)).toMatchObject({
      userId: 2,
      state: "active",
      endedAt: null,
    });

    const ownerEndResponse = await fetch(`${baseUrl}/api/ops/presence/end`, {
      method: "POST",
      headers: jsonHeaders({ "x-test-user": "admin" }),
      body: JSON.stringify({
        sessionId: foreignSessionId,
        endedAt: "2026-04-16T09:12:00.000Z",
      }),
    });
    const ownerEndBody = await ownerEndResponse.json();

    expect(ownerEndResponse.status).toBe(200);
    expect(ownerEndBody).toMatchObject({
      ok: true,
      sessionId: foreignSessionId,
      ended: true,
    });
    expect(getSession(foreignSessionId)).toMatchObject({
      userId: 2,
      state: "offline",
      endedAt: "2026-04-16T09:12:00.000Z",
    });
  });

  it("lets the same owner continue using the same session id without rotation", async () => {
    const sessionId = "11111111-1111-4111-8111-111111111111";
    const firstResponse = await fetch(`${baseUrl}/api/ops/presence/heartbeat`, {
      method: "POST",
      headers: jsonHeaders({ "x-test-user": "user" }),
      body: JSON.stringify({
        sessionId,
        path: "/",
        system: "upuse",
        state: "active",
      }),
    });
    const firstBody = await firstResponse.json();
    const secondResponse = await fetch(`${baseUrl}/api/ops/presence/heartbeat`, {
      method: "POST",
      headers: jsonHeaders({ "x-test-user": "user" }),
      body: JSON.stringify({
        sessionId,
        path: "/performance",
        system: "upuse",
        state: "idle",
      }),
    });
    const secondBody = await secondResponse.json();

    expect(firstResponse.status).toBe(200);
    expect(secondResponse.status).toBe(200);
    expect(firstBody.sessionId).toBe(sessionId);
    expect(secondBody.sessionId).toBe(sessionId);
    expect(getSession(sessionId)).toMatchObject({
      userId: 3,
      userEmail: "user@example.com",
      currentPath: "/performance",
      state: "idle",
    });
  });

  it("tracks heartbeat and end state transitions", async () => {
    const sessionId = "11111111-1111-4111-8111-111111111111";
    const activeResponse = await fetch(`${baseUrl}/api/ops/presence/heartbeat`, {
      method: "POST",
      headers: jsonHeaders({ "x-test-user": "primary" }),
      body: JSON.stringify({
        sessionId,
        path: "/ops",
        system: "ops",
        state: "active",
        userAgent: "Mozilla/5.0 Chrome/124 Desktop",
        occurredAt: "2026-04-16T09:00:00.000Z",
      }),
    });
    const idleResponse = await fetch(`${baseUrl}/api/ops/presence/heartbeat`, {
      method: "POST",
      headers: jsonHeaders({ "x-test-user": "primary" }),
      body: JSON.stringify({
        sessionId,
        path: "/ops",
        system: "ops",
        state: "idle",
        occurredAt: "2026-04-16T09:05:00.000Z",
      }),
    });
    const endResponse = await fetch(`${baseUrl}/api/ops/presence/end`, {
      method: "POST",
      headers: jsonHeaders({ "x-test-user": "primary" }),
      body: JSON.stringify({
        sessionId,
        endedAt: "2026-04-16T09:10:00.000Z",
      }),
    });

    expect(activeResponse.status).toBe(200);
    expect(idleResponse.status).toBe(200);
    expect(endResponse.status).toBe(200);
    expect(testDb.prepare<[string], { state: string; endedAt: string | null }>(`
      SELECT state, endedAt FROM ops_sessions WHERE id = ?
    `).get(sessionId)).toEqual({
      state: "offline",
      endedAt: "2026-04-16T09:10:00.000Z",
    });
    expect(testDb.prepare<[string], { count: number }>(`
      SELECT COUNT(*) AS count FROM ops_events WHERE sessionId = ? AND eventType = 'heartbeat'
    `).get(sessionId)).toEqual({
      count: 2,
    });
  });

  it("ingests events, aggregates errors, and sanitizes sensitive metadata", async () => {
    const response = await fetch(`${baseUrl}/api/ops/ingest`, {
      method: "POST",
      headers: jsonHeaders({ "x-test-user": "primary" }),
      body: JSON.stringify({
        session: {
          path: "/ops",
          system: "ops",
          state: "active",
        },
        events: [
          {
            type: "page_view",
            path: "/ops",
            system: "ops",
            metadata: {
              safe: "visible",
              token: "must-not-store",
            },
          },
          {
            type: "js_error",
            path: "/ops",
            system: "ops",
            metadata: {
              component: "OpsOverview",
            },
            error: {
              message: "Boom token=abc123",
              code: "OPS_TEST",
              stack: "Error: Boom\n    at token=abc123",
              metadata: {
                password: "must-not-store",
                feature: "overview",
              },
            },
          },
        ],
      }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      ok: true,
      accepted: {
        events: 2,
        errors: 1,
      },
    });

    const eventList = await fetch(`${baseUrl}/api/ops/events?type=page_view`, {
      headers: { "x-test-user": "primary" },
    });
    const eventBody = await eventList.json();
    expect(eventList.status).toBe(200);
    expect(eventBody.items[0].metadata).toEqual({
      safe: "visible",
    });

    const errorList = await fetch(`${baseUrl}/api/ops/errors?query=OPS_TEST`, {
      headers: { "x-test-user": "primary" },
    });
    const errorBody = await errorList.json();
    expect(errorList.status).toBe(200);
    expect(errorBody.items[0]).toMatchObject({
      code: "OPS_TEST",
      count: 1,
      message: "Boom token=[redacted]",
      sampleMetadata: {
        component: "OpsOverview",
        feature: "overview",
      },
    });
    expect(errorBody.items[0].stackFingerprint).toMatch(/^[a-f0-9]{32}$/);
  });

  it("rejects invalid telemetry payloads before persistence", async () => {
    const invalidType = await fetch(`${baseUrl}/api/ops/ingest`, {
      method: "POST",
      headers: jsonHeaders({ "x-test-user": "primary" }),
      body: JSON.stringify({
        events: [{ type: "unknown_event" }],
      }),
    });
    expect(invalidType.status).toBe(400);

    const nestedMetadata = await fetch(`${baseUrl}/api/ops/ingest`, {
      method: "POST",
      headers: jsonHeaders({ "x-test-user": "primary" }),
      body: JSON.stringify({
        events: [{
          type: "page_view",
          metadata: {
            nested: { value: true },
          },
        }],
      }),
    });
    expect(nestedMetadata.status).toBe(400);

    const tooManyEvents = await fetch(`${baseUrl}/api/ops/ingest`, {
      method: "POST",
      headers: jsonHeaders({ "x-test-user": "primary" }),
      body: JSON.stringify({
        events: Array.from({ length: 26 }, () => ({ type: "page_view" })),
      }),
    });
    expect(tooManyEvents.status).toBe(400);
    expect(testDb.prepare<[], { count: number }>("SELECT COUNT(*) AS count FROM ops_events").get()).toEqual({
      count: 0,
    });
  });

  it("returns dashboard-ready summary data and paginated filtered lists", async () => {
    const ingest = await fetch(`${baseUrl}/api/ops/ingest`, {
      method: "POST",
      headers: jsonHeaders({ "x-test-user": "primary" }),
      body: JSON.stringify({
        session: {
          path: "/ops",
          system: "ops",
          state: "active",
        },
        events: [
          { type: "page_view", path: "/ops", system: "ops" },
          { type: "api_request", endpoint: "/api/ops/summary", method: "GET", statusCode: 200, success: true, system: "ops" },
          { type: "api_error", endpoint: "/api/ops/errors", method: "GET", statusCode: 500, success: false, system: "ops" },
        ],
      }),
    });
    expect(ingest.status).toBe(200);

    const summaryResponse = await fetch(`${baseUrl}/api/ops/summary?windowMinutes=1440`, {
      headers: { "x-test-user": "primary" },
    });
    const summary = await summaryResponse.json();

    expect(summaryResponse.status).toBe(200);
    expect(summary).toMatchObject({
      ok: true,
      counts: {
        apiRequestCount: 2,
        apiFailureCount: 1,
      },
      health: {
        dashboard: {
          name: "UPuse",
        },
        performance: {
          status: "good",
        },
      },
      quality: {
        status: "critical",
        score: 75,
      },
    });
    expect(summary.quality.factors).toEqual(expect.arrayContaining([
      expect.objectContaining({
        key: "api_failure_rate",
        status: "critical",
        penalty: 25,
      }),
    ]));
    expect(summary.alerts).toEqual(expect.arrayContaining([
      expect.objectContaining({
        subsystem: "api",
        title: "API failure rate is elevated",
      }),
    ]));
    expect(summary.subsystems).toMatchObject({
      dashboard: {
        label: "UPuse Dashboard",
      },
      performance: {
        label: "UPuse Performance",
      },
      telemetry: {
        label: "Ops Telemetry",
      },
    });
    expect(summary.topPages).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: "/ops", views: 1 }),
    ]));
    expect(summary.topEventTypes).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "api_error", count: 1 }),
      expect.objectContaining({ type: "page_view", count: 1 }),
    ]));

    const sessionsResponse = await fetch(`${baseUrl}/api/ops/sessions?system=ops&page=1&pageSize=1`, {
      headers: { "x-test-user": "primary" },
    });
    const sessions = await sessionsResponse.json();
    expect(sessionsResponse.status).toBe(200);
    expect(sessions.meta).toMatchObject({
      page: 1,
      pageSize: 1,
      total: 1,
      totalPages: 1,
    });

    const eventsResponse = await fetch(`${baseUrl}/api/ops/events?type=api_request&pageSize=100`, {
      headers: { "x-test-user": "primary" },
    });
    const events = await eventsResponse.json();
    expect(eventsResponse.status).toBe(200);
    expect(events.items).toHaveLength(1);
    expect(events.items[0]).toMatchObject({
      endpoint: "/api/ops/summary",
      method: "GET",
      statusCode: 200,
    });

    const errorsResponse = await fetch(`${baseUrl}/api/ops/errors?severity=error`, {
      headers: { "x-test-user": "primary" },
    });
    const errors = await errorsResponse.json();
    expect(errorsResponse.status).toBe(200);
    expect(errors.items[0]).toMatchObject({
      statusCode: 500,
      count: 1,
    });
  });

  it("classifies dashboard and performance subsystem regressions in the Ops quality model", async () => {
    const ingest = await fetch(`${baseUrl}/api/ops/ingest`, {
      method: "POST",
      headers: jsonHeaders({ "x-test-user": "primary" }),
      body: JSON.stringify({
        session: {
          path: "/performance",
          system: "upuse",
          state: "active",
        },
        events: [
          {
            type: "api_error",
            endpoint: "/api/dashboard",
            method: "GET",
            statusCode: 502,
            success: false,
            source: "frontend",
            system: "upuse",
            error: { message: "Dashboard snapshot failed" },
          },
          {
            type: "api_error",
            endpoint: "/api/ws/performance",
            method: "GET",
            success: false,
            source: "websocket",
            system: "upuse",
            error: { message: "Performance websocket disconnected" },
          },
          {
            type: "api_request",
            endpoint: "/api/performance",
            method: "GET",
            statusCode: 200,
            success: true,
            durationMs: 5000,
            system: "upuse",
          },
          {
            type: "js_error",
            path: "/performance",
            system: "upuse",
            error: { message: "Performance render failed" },
          },
          {
            type: "token_test_finished",
            path: "/settings",
            system: "upuse",
            success: false,
            severity: "warning",
          },
        ],
      }),
    });
    expect(ingest.status).toBe(200);

    const summaryResponse = await fetch(`${baseUrl}/api/ops/summary?windowMinutes=1440`, {
      headers: { "x-test-user": "primary" },
    });
    const summary = await summaryResponse.json();

    expect(summaryResponse.status).toBe(200);
    expect(summary.quality).toMatchObject({
      status: "critical",
    });
    expect(summary.quality.factors).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: "p95_api_latency", status: "critical" }),
      expect.objectContaining({ key: "performance_surface", status: "critical" }),
      expect.objectContaining({ key: "token_test_failures", status: "degraded" }),
    ]));
    expect(summary.subsystems.dashboard).toMatchObject({
      label: "UPuse Dashboard",
      status: "degraded",
      failures: 1,
    });
    expect(summary.subsystems.performance).toMatchObject({
      label: "UPuse Performance",
      status: "critical",
      websocketFailures: 1,
      p95LatencyMs: 5000,
    });
    expect(summary.alerts).toEqual(expect.arrayContaining([
      expect.objectContaining({ title: "Dashboard surface needs attention" }),
      expect.objectContaining({ title: "Performance surface needs attention" }),
      expect.objectContaining({ title: "Token test failures detected" }),
    ]));
  });
});
