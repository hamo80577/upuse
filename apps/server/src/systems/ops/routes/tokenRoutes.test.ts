import express from "express";
import type { Server } from "node:http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerApiErrorHandler } from "../../../app/error-handling/registerApiErrorHandler.js";
import { db as testDb } from "../../../config/db.js";
import { buildSharedSchemaSql } from "../../../shared/db/schema/sharedSchema.js";
import { requireAuthenticatedApi } from "../../../shared/http/auth/sessionAuth.js";
import type { AppUser, SettingsTokenTestSnapshot } from "../../../types/models.js";
import { buildScanoSchemaSql } from "../../scano/db/schema.js";
import { buildOpsSchemaSql } from "../db/schema.js";
import { registerOpsRoutes } from "./registerRoutes.js";

const {
  mockStartSettingsTokenTestJob,
  mockGetSettingsTokenTestSnapshot,
  mockTestScanoCatalogConnection,
  mockNotifyScanoConfigChanged,
} = vi.hoisted(() => ({
  mockStartSettingsTokenTestJob: vi.fn(),
  mockGetSettingsTokenTestSnapshot: vi.fn(),
  mockTestScanoCatalogConnection: vi.fn(),
  mockNotifyScanoConfigChanged: vi.fn(),
}));

vi.mock("../../../config/db.js", async () => {
  const Database = (await import("better-sqlite3")).default;
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");

  return {
    db,
    cryptoBox: {
      encrypt: (value: string) => `sealed:${Buffer.from(value, "utf8").toString("base64")}`,
      decrypt: (value: string) => {
        if (!value.startsWith("sealed:")) return value;
        return Buffer.from(value.slice("sealed:".length), "base64").toString("utf8");
      },
    },
  };
});

vi.mock("../../../services/settingsTokenTestStore.js", () => ({
  startSettingsTokenTestJob: mockStartSettingsTokenTestJob,
  getSettingsTokenTestSnapshot: mockGetSettingsTokenTestSnapshot,
}));

vi.mock("../../../services/scanoCatalogClient.js", () => ({
  testScanoCatalogConnection: mockTestScanoCatalogConnection,
}));

vi.mock("../../../services/scanoMasterProductEnrichmentRuntime.js", () => ({
  notifyScanoMasterProductEnrichmentConfigChanged: mockNotifyScanoConfigChanged,
}));

const testSnapshot: SettingsTokenTestSnapshot = {
  jobId: "11111111-1111-4111-8111-111111111111",
  status: "completed",
  createdAt: "2026-04-16T10:00:00.000Z",
  startedAt: "2026-04-16T10:00:01.000Z",
  completedAt: "2026-04-16T10:00:02.000Z",
  progress: {
    totalBranches: 0,
    processedBranches: 0,
    passedBranches: 0,
    failedBranches: 0,
    percent: 100,
  },
  availability: {
    configured: true,
    ok: true,
    status: 200,
    message: "Availability token is valid.",
  },
  orders: {
    configValid: true,
    ok: true,
    enabledBranchCount: 0,
    passedBranchCount: 0,
    failedBranchCount: 0,
    branches: [],
  },
};

function encode(value: string) {
  return `sealed:${Buffer.from(value, "utf8").toString("base64")}`;
}

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

function dropAllTables() {
  testDb.pragma("foreign_keys = OFF");
  const rows = testDb.prepare<[], { name: string }>(`
    SELECT name
    FROM sqlite_master
    WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
  `).all();
  for (const row of rows) {
    testDb.prepare(`DROP TABLE IF EXISTS "${row.name}"`).run();
  }
  testDb.pragma("foreign_keys = ON");
}

function resetDb() {
  dropAllTables();
  testDb.exec(buildSharedSchemaSql());
  testDb.exec(buildScanoSchemaSql());
  testDb.exec(buildOpsSchemaSql());

  testDb.prepare(`
    INSERT INTO users (id, email, name, role, passwordHash, active, createdAt, upuseAccess, isPrimaryAdmin)
    VALUES
      (1, 'primary@example.com', 'Primary Admin', 'admin', 'hash', 1, '2026-04-16T00:00:00.000Z', 1, 1),
      (2, 'admin@example.com', 'Admin', 'admin', 'hash', 1, '2026-04-16T00:00:00.000Z', 1, 0),
      (3, 'user@example.com', 'User', 'user', 'hash', 1, '2026-04-16T00:00:00.000Z', 1, 0)
  `).run();

  testDb.prepare(`
    INSERT INTO settings (
      id,
      ordersTokenEnc,
      availabilityTokenEnc,
      globalEntityId,
      chainNamesJson,
      chainThresholdsJson,
      lateThreshold,
      lateReopenThreshold,
      unassignedThreshold,
      unassignedReopenThreshold,
      readyThreshold,
      readyReopenThreshold,
      tempCloseMinutes,
      graceMinutes,
      ordersRefreshSeconds,
      availabilityRefreshSeconds,
      maxVendorsPerOrdersRequest
    ) VALUES (1, ?, ?, 'test_entity', '[]', '[]', 5, 0, 5, 0, 0, 0, 30, 5, 30, 30, 50)
  `).run(
    encode("orders-token-secret-value"),
    encode("availability-token-secret-value"),
  );

  testDb.prepare(`
    INSERT INTO scano_settings (id, catalogBaseUrl, catalogTokenEnc, updatedAt)
    VALUES (1, 'https://catalog.example.test', ?, '2026-04-16T09:00:00.000Z')
  `).run(encode("scano-token-secret-value"));
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
    throw new Error("Failed to resolve Ops token test server address");
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

describe("Ops token routes", () => {
  let server: Server | null = null;
  let baseUrl = "";

  beforeEach(async () => {
    vi.clearAllMocks();
    mockStartSettingsTokenTestJob.mockReturnValue({
      jobId: testSnapshot.jobId,
      snapshot: testSnapshot,
    });
    mockGetSettingsTokenTestSnapshot.mockReturnValue(testSnapshot);
    mockTestScanoCatalogConnection.mockResolvedValue({
      ok: true,
      message: "Scano catalog token is valid.",
      baseUrl: "https://catalog.example.test",
    });

    resetDb();
    const started = await startServer();
    server = started.server;
    baseUrl = started.baseUrl;
  });

  afterEach(async () => {
    await closeServer(server);
    server = null;
  });

  it("keeps Ops token management primary-admin-only", async () => {
    const routes = [
      { method: "GET", path: "/api/ops/tokens" },
      { method: "PATCH", path: "/api/ops/tokens", body: { upuseOrdersToken: "next-orders-token" } },
      { method: "POST", path: "/api/ops/tokens/test", body: {} },
      { method: "GET", path: `/api/ops/tokens/test/upuse/${testSnapshot.jobId}` },
    ];

    for (const route of routes) {
      const unauthenticated = await fetch(`${baseUrl}${route.path}`, {
        method: route.method,
        headers: route.body ? jsonHeaders() : undefined,
        body: route.body ? JSON.stringify(route.body) : undefined,
      });
      expect(unauthenticated.status).toBe(401);

      for (const userKind of ["admin", "user"]) {
        const forbidden = await fetch(`${baseUrl}${route.path}`, {
          method: route.method,
          headers: route.body ? jsonHeaders({ "x-test-user": userKind }) : { "x-test-user": userKind },
          body: route.body ? JSON.stringify(route.body) : undefined,
        });
        expect(forbidden.status).toBe(403);
      }

      const primary = await fetch(`${baseUrl}${route.path}`, {
        method: route.method,
        headers: route.body ? jsonHeaders({ "x-test-user": "primary" }) : { "x-test-user": "primary" },
        body: route.body ? JSON.stringify(route.body) : undefined,
      });
      expect([200, 202]).toContain(primary.status);
    }
  });

  it("returns masked token inventory without leaking raw stored secrets", async () => {
    const response = await fetch(`${baseUrl}/api/ops/tokens`, {
      headers: { "x-test-user": "primary" },
    });
    const bodyText = await response.text();
    const body = JSON.parse(bodyText);

    expect(response.status).toBe(200);
    expect(body.tokens).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "upuse_orders",
        configured: true,
        mask: "orde…alue",
      }),
      expect.objectContaining({
        id: "upuse_availability",
        configured: true,
        mask: "avai…alue",
      }),
      expect.objectContaining({
        id: "scano_catalog",
        configured: true,
        mask: "scan…alue",
        updatedAt: "2026-04-16T09:00:00.000Z",
      }),
    ]));
    expect(bodyText).not.toContain("orders-token-secret-value");
    expect(bodyText).not.toContain("availability-token-secret-value");
    expect(bodyText).not.toContain("scano-token-secret-value");
  });

  it("updates existing encrypted token stores and returns only masked values", async () => {
    const response = await fetch(`${baseUrl}/api/ops/tokens`, {
      method: "PATCH",
      headers: jsonHeaders({ "x-test-user": "primary" }),
      body: JSON.stringify({
        upuseOrdersToken: "next-orders-token-secret",
        upuseAvailabilityToken: "next-availability-token-secret",
        scanoCatalogToken: "next-scano-token-secret",
      }),
    });
    const bodyText = await response.text();
    const body = JSON.parse(bodyText);

    expect(response.status).toBe(200);
    expect(mockNotifyScanoConfigChanged).toHaveBeenCalledOnce();
    expect(body.tokens).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "upuse_orders", mask: "next…cret" }),
      expect.objectContaining({ id: "upuse_availability", mask: "next…cret" }),
      expect.objectContaining({ id: "scano_catalog", mask: "next…cret" }),
    ]));
    expect(bodyText).not.toContain("next-orders-token-secret");
    expect(bodyText).not.toContain("next-availability-token-secret");
    expect(bodyText).not.toContain("next-scano-token-secret");

    const settingsRow = testDb.prepare<[], { ordersTokenEnc: string; availabilityTokenEnc: string }>(`
      SELECT ordersTokenEnc, availabilityTokenEnc FROM settings WHERE id = 1
    `).get();
    const scanoRow = testDb.prepare<[], { catalogTokenEnc: string }>(`
      SELECT catalogTokenEnc FROM scano_settings WHERE id = 1
    `).get();

    expect(settingsRow?.ordersTokenEnc).not.toContain("next-orders-token-secret");
    expect(settingsRow?.availabilityTokenEnc).not.toContain("next-availability-token-secret");
    expect(scanoRow?.catalogTokenEnc).not.toContain("next-scano-token-secret");
  });

  it("runs token tests with optional draft tokens but never echoes token values", async () => {
    const response = await fetch(`${baseUrl}/api/ops/tokens/test`, {
      method: "POST",
      headers: jsonHeaders({ "x-test-user": "primary" }),
      body: JSON.stringify({
        upuseOrdersToken: "draft-orders-token-secret",
        upuseAvailabilityToken: "draft-availability-token-secret",
        scanoCatalogToken: "draft-scano-token-secret",
      }),
    });
    const bodyText = await response.text();
    const body = JSON.parse(bodyText);

    expect(response.status).toBe(202);
    expect(mockStartSettingsTokenTestJob).toHaveBeenCalledWith({
      ordersToken: "draft-orders-token-secret",
      availabilityToken: "draft-availability-token-secret",
    });
    expect(mockTestScanoCatalogConnection).toHaveBeenCalledWith({
      catalogToken: "draft-scano-token-secret",
    });
    expect(body).toMatchObject({
      ok: true,
      upuse: {
        jobId: testSnapshot.jobId,
      },
      scano: {
        ok: true,
        message: "Scano catalog token is valid.",
      },
    });
    expect(bodyText).not.toContain("draft-orders-token-secret");
    expect(bodyText).not.toContain("draft-availability-token-secret");
    expect(bodyText).not.toContain("draft-scano-token-secret");
  });

  it("wraps Scano token-test failures as readable results instead of exposing raw token data", async () => {
    mockTestScanoCatalogConnection.mockRejectedValueOnce(Object.assign(new Error("Scano catalog token is invalid."), {
      status: 502,
    }));

    const response = await fetch(`${baseUrl}/api/ops/tokens/test`, {
      method: "POST",
      headers: jsonHeaders({ "x-test-user": "primary" }),
      body: JSON.stringify({
        targets: ["scano"],
        scanoCatalogToken: "bad-scano-token-secret",
      }),
    });
    const bodyText = await response.text();
    const body = JSON.parse(bodyText);

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      ok: true,
      scano: {
        ok: false,
        status: 502,
        message: "Scano catalog token is invalid.",
      },
    });
    expect(bodyText).not.toContain("bad-scano-token-secret");
  });

  it("returns wrapped UPuse token-test snapshots without exposing secrets", async () => {
    const response = await fetch(`${baseUrl}/api/ops/tokens/test/upuse/${testSnapshot.jobId}`, {
      headers: { "x-test-user": "primary" },
    });
    const bodyText = await response.text();
    const body = JSON.parse(bodyText);

    expect(response.status).toBe(200);
    expect(mockGetSettingsTokenTestSnapshot).toHaveBeenCalledWith(testSnapshot.jobId);
    expect(body).toEqual({
      ok: true,
      snapshot: testSnapshot,
    });
    expect(bodyText).not.toContain("orders-token-secret-value");
    expect(bodyText).not.toContain("availability-token-secret-value");
  });
});
