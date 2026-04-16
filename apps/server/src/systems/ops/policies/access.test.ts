import express from "express";
import type { Server } from "node:http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { canUserAccessSystem } from "../../../core/systems/auth/registry/index.js";
import { requireAuthenticatedApi } from "../../../shared/http/auth/sessionAuth.js";
import type { AppUser } from "../../../types/models.js";
import { hasOpsAccess } from "./access.js";
import { registerOpsRoutes } from "../routes/registerRoutes.js";

vi.mock("../../../config/db.js", () => ({
  db: {
    prepare: vi.fn(() => ({
      all: vi.fn(() => []),
      get: vi.fn(() => undefined),
      run: vi.fn(() => ({ changes: 0 })),
    })),
    exec: vi.fn(),
    transaction: vi.fn((callback) => callback),
  },
  cryptoBox: {
    encrypt: (value: string) => value,
    decrypt: (value: string) => value,
  },
}));

vi.mock("../../../services/authStore.js", () => ({
  getSessionUserByToken: vi.fn(() => null),
}));

function buildUser(overrides: Partial<AppUser> = {}): AppUser {
  return {
    id: 1,
    email: "user@example.com",
    name: "User",
    role: "user",
    active: true,
    createdAt: "2026-04-16T00:00:00.000Z",
    upuseAccess: true,
    isPrimaryAdmin: false,
    ...overrides,
  };
}

function createApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const kind = req.header("x-test-user");
    if (kind === "primary") {
      req.authUser = buildUser({
        id: 1,
        email: "primary@example.com",
        name: "Primary Admin",
        role: "admin",
        isPrimaryAdmin: true,
      });
    }
    if (kind === "admin") {
      req.authUser = buildUser({
        id: 2,
        email: "admin@example.com",
        name: "Admin",
        role: "admin",
      });
    }
    if (kind === "user") {
      req.authUser = buildUser({
        id: 3,
        email: "user@example.com",
        name: "User",
        role: "user",
      });
    }
    next();
  });
  app.use(requireAuthenticatedApi());
  registerOpsRoutes({ app, engine: null as any, securityConfig: null as any });
  return app;
}

async function startServer() {
  const app = createApp();
  const server = await new Promise<Server>((resolve) => {
    const nextServer = app.listen(0, () => resolve(nextServer));
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Failed to resolve test server address");
  }

  return {
    server,
    baseUrl: `http://127.0.0.1:${address.port}`,
  };
}

describe("Ops access", () => {
  let server: Server | null = null;
  let baseUrl = "";

  beforeEach(async () => {
    const started = await startServer();
    server = started.server;
    baseUrl = started.baseUrl;
  });

  afterEach(async () => {
    await new Promise<void>((resolve, reject) => {
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
    server = null;
  });

  it("allows Ops access only for the primary admin identity", () => {
    expect(hasOpsAccess(null)).toBe(false);
    expect(hasOpsAccess(buildUser({ role: "admin", isPrimaryAdmin: false }))).toBe(false);
    expect(hasOpsAccess(buildUser({ role: "user", isPrimaryAdmin: false }))).toBe(false);
    expect(hasOpsAccess(buildUser({ role: "admin", isPrimaryAdmin: true }))).toBe(true);
  });

  it("exposes Ops through the generic system auth registry", () => {
    expect(canUserAccessSystem("ops", buildUser({ role: "admin", isPrimaryAdmin: false }))).toBe(false);
    expect(canUserAccessSystem("ops", buildUser({ role: "user", isPrimaryAdmin: false }))).toBe(false);
    expect(canUserAccessSystem("ops", buildUser({ role: "admin", isPrimaryAdmin: true }))).toBe(true);
  });

  it("requires authentication for Ops health", async () => {
    const response = await fetch(`${baseUrl}/api/ops/health`);
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).toMatchObject({
      ok: false,
      code: "SESSION_UNAUTHORIZED",
    });
  });

  it("rejects non-primary authenticated users from Ops health", async () => {
    const adminResponse = await fetch(`${baseUrl}/api/ops/health`, {
      headers: { "x-test-user": "admin" },
    });
    const userResponse = await fetch(`${baseUrl}/api/ops/health`, {
      headers: { "x-test-user": "user" },
    });

    expect(adminResponse.status).toBe(403);
    expect(await adminResponse.json()).toMatchObject({
      ok: false,
      code: "FORBIDDEN",
      errorOrigin: "authorization",
    });
    expect(userResponse.status).toBe(403);
  });

  it("returns a protected health payload for primary admin", async () => {
    const response = await fetch(`${baseUrl}/api/ops/health`, {
      headers: { "x-test-user": "primary" },
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      system: "ops",
      status: "ready",
    });
  });
});
