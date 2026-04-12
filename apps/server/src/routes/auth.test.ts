import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ZodError } from "zod";
import { AUTH_SESSION_COOKIE_NAME } from "../http/sessionCookie.js";

const {
  mockCreateAuthSession,
  mockCreateUser,
  mockDeleteAuthSession,
  mockDeleteUserById,
  mockUpdateUser,
  mockVerifyUserCredentials,
} = vi.hoisted(() => {
  return {
    mockCreateAuthSession: vi.fn(),
    mockCreateUser: vi.fn(),
    mockDeleteAuthSession: vi.fn(),
    mockDeleteUserById: vi.fn(),
    mockUpdateUser: vi.fn(),
    mockVerifyUserCredentials: vi.fn(),
  };
});

vi.mock("../config/db.js", async () => {
  const BetterSqlite3 = (await import("better-sqlite3")).default;
  const db = new BetterSqlite3(":memory:");
  db.exec(`
    CREATE TABLE login_attempts (
      key TEXT PRIMARY KEY,
      count INTEGER NOT NULL,
      windowStartedAt TEXT NOT NULL,
      blockedUntil TEXT,
      updatedAt TEXT NOT NULL
    );

    CREATE INDEX idx_login_attempts_updated
      ON login_attempts(updatedAt, key);
  `);
  return { db };
});

vi.mock("../services/authStore.js", () => ({
  createAuthSession: mockCreateAuthSession,
  createUser: mockCreateUser,
  deleteAuthSession: mockDeleteAuthSession,
  deleteUserById: mockDeleteUserById,
  listUsers: vi.fn(() => []),
  updateUser: mockUpdateUser,
  verifyUserCredentials: mockVerifyUserCredentials,
}));

import { db as authTestDb } from "../config/db.js";
import { createUserRoute, deleteUserRoute, loginRoute, logoutRoute, meRoute, resetLoginRateLimitStateForTests, updateUserRoute } from "./auth.js";

function createMockResponse() {
  return {
    statusCode: 200,
    payload: null as unknown,
    status(statusCode: number) {
      this.statusCode = statusCode;
      return this;
    },
    cookie: vi.fn(function (this: unknown) {
      return this;
    }),
    clearCookie: vi.fn(function (this: unknown) {
      return this;
    }),
    json(payload: unknown) {
      this.payload = payload;
      return this;
    },
  };
}

describe("auth.logoutRoute", () => {
  beforeEach(() => {
    resetLoginRateLimitStateForTests();
    authTestDb.prepare("DELETE FROM login_attempts").run();
    mockCreateAuthSession.mockReset();
    mockCreateUser.mockReset();
    mockDeleteAuthSession.mockReset();
    mockDeleteUserById.mockReset();
    mockUpdateUser.mockReset();
    mockVerifyUserCredentials.mockReset();
  });

  afterAll(() => {
    authTestDb.close();
  });

  it("sets the auth cookie and returns the authenticated user without exposing the session token", async () => {
    const user = {
      id: 1,
      email: "admin@example.com",
      name: "Admin",
      role: "admin",
      active: true,
      createdAt: "2026-03-07T10:00:00.000Z",
    };
    mockVerifyUserCredentials.mockReturnValue(user);
    mockCreateAuthSession.mockReturnValue({
      token: "raw-session-token",
      userId: 1,
      expiresAt: "2026-03-07T22:00:00.000Z",
      createdAt: "2026-03-07T10:00:00.000Z",
    });

    const req = {
      ip: "127.0.0.1",
      body: {
        email: "admin@example.com",
        password: "correct horse battery staple",
      },
    };
    const res = createMockResponse();

    await loginRoute(req as any, res as any);

    expect(res.cookie).toHaveBeenCalledWith(
      AUTH_SESSION_COOKIE_NAME,
      "raw-session-token",
      expect.objectContaining({
        httpOnly: true,
        sameSite: "lax",
        path: "/",
      }),
    );
    expect(res.payload).toEqual({
      ok: true,
      user,
    });
  });

  it("rate-limits repeated failed sign-in attempts for the same ip/email pair", async () => {
    mockVerifyUserCredentials.mockReturnValue(null);

    const req = {
      ip: "127.0.0.1",
      body: {
        email: "admin@example.com",
        password: "wrong-password",
      },
    };

    for (let attempt = 1; attempt <= 4; attempt += 1) {
      const res = createMockResponse();
      await loginRoute(req as any, res as any);
      expect(res.statusCode).toBe(401);
    }

    const fifthAttempt = createMockResponse();
    await loginRoute(req as any, fifthAttempt as any);
    expect(fifthAttempt.statusCode).toBe(429);

    const blockedAttempt = createMockResponse();
    await loginRoute(req as any, blockedAttempt as any);
    expect(blockedAttempt.statusCode).toBe(429);
    expect(mockVerifyUserCredentials).toHaveBeenCalledTimes(5);
  });

  it("persists throttle rows in sqlite and clears only the account-specific key after a successful login", async () => {
    mockVerifyUserCredentials.mockReturnValue(null);

    const failedAttemptResponse = createMockResponse();
    await loginRoute({
      ip: "127.0.0.1",
      body: {
        email: "admin@example.com",
        password: "wrong-password",
      },
    } as any, failedAttemptResponse as any);

    expect(failedAttemptResponse.statusCode).toBe(401);
    expect(
      authTestDb.prepare("SELECT key, count, blockedUntil FROM login_attempts WHERE key = ?").get("acct:127.0.0.1:admin@example.com"),
    ).toEqual({
      key: "acct:127.0.0.1:admin@example.com",
      count: 1,
      blockedUntil: null,
    });

    const user = {
      id: 1,
      email: "admin@example.com",
      name: "Admin",
      role: "admin",
      active: true,
      createdAt: "2026-03-07T10:00:00.000Z",
    };
    mockVerifyUserCredentials.mockReturnValue(user);
    mockCreateAuthSession.mockReturnValue({
      token: "raw-session-token",
      userId: 1,
      expiresAt: "2026-03-07T22:00:00.000Z",
      createdAt: "2026-03-07T10:00:00.000Z",
    });

    const successResponse = createMockResponse();
    await loginRoute({
      ip: "127.0.0.1",
      body: {
        email: "admin@example.com",
        password: "correct horse battery staple",
      },
    } as any, successResponse as any);

    expect(successResponse.statusCode).toBe(200);
    const keys = (authTestDb.prepare("SELECT key FROM login_attempts ORDER BY key ASC").all() as Array<{ key: string }>).map((row) => row.key);
    expect(keys).toEqual(["ip:127.0.0.1"]);
  });

  it("keeps the login throttle active across later requests for the same normalized ip/email key", async () => {
    mockVerifyUserCredentials.mockReturnValue(null);

    for (let attempt = 1; attempt <= 5; attempt += 1) {
      const res = createMockResponse();
      await loginRoute({
        ip: "127.0.0.1",
        body: {
          email: "admin@example.com",
          password: "wrong-password",
        },
      } as any, res as any);
    }

    mockVerifyUserCredentials.mockReturnValue({
      id: 1,
      email: "admin@example.com",
      name: "Admin",
      role: "admin",
      active: true,
      createdAt: "2026-03-07T10:00:00.000Z",
    });

    const blockedRes = createMockResponse();
    await loginRoute({
      ip: "127.0.0.1",
      body: {
        email: "ADMIN@example.com",
        password: "correct horse battery staple",
      },
    } as any, blockedRes as any);

    expect(blockedRes.statusCode).toBe(429);
    expect(blockedRes.payload).toEqual({
      ok: false,
      message: expect.stringContaining("Too many failed sign-in attempts."),
    });
    expect(mockVerifyUserCredentials).toHaveBeenCalledTimes(5);
    expect(mockCreateAuthSession).not.toHaveBeenCalled();
  });

  it("rate-limits password spraying across many accounts from the same ip", async () => {
    mockVerifyUserCredentials.mockReturnValue(null);

    for (let attempt = 1; attempt <= 19; attempt += 1) {
      const res = createMockResponse();
      await loginRoute({
        ip: "127.0.0.1",
        body: {
          email: `user${attempt}@example.com`,
          password: "wrong-password",
        },
      } as any, res as any);
      expect(res.statusCode).toBe(401);
    }

    const throttledAttempt = createMockResponse();
    await loginRoute({
      ip: "127.0.0.1",
      body: {
        email: "user20@example.com",
        password: "wrong-password",
      },
    } as any, throttledAttempt as any);
    expect(throttledAttempt.statusCode).toBe(429);

    mockVerifyUserCredentials.mockReturnValue({
      id: 1,
      email: "admin@example.com",
      name: "Admin",
      role: "admin",
      active: true,
      createdAt: "2026-03-07T10:00:00.000Z",
    });
    const blockedSuccessAttempt = createMockResponse();
    await loginRoute({
      ip: "127.0.0.1",
      body: {
        email: "admin@example.com",
        password: "correct horse battery staple",
      },
    } as any, blockedSuccessAttempt as any);

    expect(blockedSuccessAttempt.statusCode).toBe(429);
    expect(blockedSuccessAttempt.payload).toEqual({
      ok: false,
      message: expect.stringContaining("Too many failed sign-in attempts."),
    });
    expect(mockVerifyUserCredentials).toHaveBeenCalledTimes(20);
    expect(authTestDb.prepare("SELECT count FROM login_attempts WHERE key = ?").get("ip:127.0.0.1")).toEqual({ count: 20 });
  });

  it("clears only the account throttle on successful login and preserves ip-wide spray state", async () => {
    mockVerifyUserCredentials.mockReturnValue(null);

    await loginRoute({
      ip: "127.0.0.1",
      body: {
        email: "first@example.com",
        password: "wrong-password",
      },
    } as any, createMockResponse() as any);
    await loginRoute({
      ip: "127.0.0.1",
      body: {
        email: "second@example.com",
        password: "wrong-password",
      },
    } as any, createMockResponse() as any);

    mockVerifyUserCredentials.mockReturnValue({
      id: 1,
      email: "first@example.com",
      name: "Admin",
      role: "admin",
      active: true,
      createdAt: "2026-03-07T10:00:00.000Z",
    });
    mockCreateAuthSession.mockReturnValue({
      token: "raw-session-token",
      userId: 1,
      expiresAt: "2026-03-07T22:00:00.000Z",
      createdAt: "2026-03-07T10:00:00.000Z",
    });

    const successResponse = createMockResponse();
    await loginRoute({
      ip: "127.0.0.1",
      body: {
        email: "first@example.com",
        password: "correct horse battery staple",
      },
    } as any, successResponse as any);

    expect(successResponse.statusCode).toBe(200);
    const keys = (authTestDb.prepare("SELECT key FROM login_attempts ORDER BY key ASC").all() as Array<{ key: string }>).map((row) => row.key);
    expect(keys).toEqual([
      "acct:127.0.0.1:second@example.com",
      "ip:127.0.0.1",
    ]);
  });

  it("deletes the current session without touching the monitor lifecycle", () => {
    const req = {
      authSessionToken: "session-123",
    };
    const res = createMockResponse();

    logoutRoute()(req as any, res as any);

    expect(mockDeleteAuthSession).toHaveBeenCalledWith("session-123");
    expect(res.clearCookie).toHaveBeenCalledWith(
      AUTH_SESSION_COOKIE_NAME,
      expect.objectContaining({
        httpOnly: true,
        sameSite: "lax",
        path: "/",
      }),
    );
    expect(res.payload).toEqual({
      ok: true,
    });
  });

  it("still clears the cookie when no session token is attached", () => {
    const req = {};
    const res = createMockResponse();

    logoutRoute()(req as any, res as any);

    expect(mockDeleteAuthSession).not.toHaveBeenCalled();
    expect(res.clearCookie).toHaveBeenCalledOnce();
    expect(res.payload).toEqual({
      ok: true,
    });
  });

  it("returns a session-shaped 401 from /api/auth/me when no authenticated user is attached", () => {
    const req = {};
    const res = createMockResponse();

    meRoute(req as any, res as any);

    expect(res.statusCode).toBe(401);
    expect(res.payload).toEqual({
      ok: false,
      message: "Unauthorized",
      code: "SESSION_UNAUTHORIZED",
      errorOrigin: "session",
    });
  });

  it("accepts the renamed user role when creating users", async () => {
    const createdUser = {
      id: 2,
      email: "user@example.com",
      name: "User",
      role: "user",
      active: true,
      createdAt: "2026-03-07T10:30:00.000Z",
      upuseAccess: true,
      isPrimaryAdmin: false,
    };
    mockCreateUser.mockReturnValue(createdUser);

    const req = {
      body: {
        email: "user@example.com",
        password: "password-123",
        name: "User",
        upuseAccess: true,
        upuseRole: "user",
        scanoAccessRole: "scanner",
      },
    };
    const res = createMockResponse();

    await createUserRoute(req as any, res as any);

    expect(mockCreateUser).toHaveBeenCalledWith(req.body);
    expect(res.statusCode).toBe(201);
    expect(res.payload).toEqual({
      ok: true,
      user: createdUser,
    });
  });

  it("rejects create-user passwords shorter than 12 characters", async () => {
    const req = {
      body: {
        email: "user@example.com",
        password: "short-pass1",
        name: "User",
        upuseAccess: true,
        upuseRole: "user",
        scanoAccessRole: "scanner",
      },
    };
    const res = createMockResponse();

    await expect(createUserRoute(req as any, res as any)).rejects.toThrow(ZodError);
    expect(mockCreateUser).not.toHaveBeenCalled();
  });

  it("updates an existing user and forwards the acting admin id", async () => {
    const updatedUser = {
      id: 2,
      email: "user@example.com",
      name: "Updated User",
      role: "user",
      active: true,
      createdAt: "2026-03-07T10:30:00.000Z",
      upuseAccess: true,
      isPrimaryAdmin: false,
    };
    mockUpdateUser.mockReturnValue(updatedUser);

    const req = {
      params: { id: "2" },
      authUser: { id: 1 },
      body: {
        email: "user@example.com",
        password: "",
        name: "Updated User",
        upuseAccess: true,
        upuseRole: "user",
        scanoAccessRole: "team_lead",
      },
    };
    const res = createMockResponse();

    await updateUserRoute(req as any, res as any);

    expect(mockUpdateUser).toHaveBeenCalledWith({
      id: 2,
      email: "user@example.com",
      name: "Updated User",
      upuseAccess: true,
      upuseRole: "user",
      scanoAccessRole: "team_lead",
      password: undefined,
      actorUserId: 1,
    });
    expect(res.statusCode).toBe(200);
    expect(res.payload).toEqual({
      ok: true,
      user: updatedUser,
    });
  });

  it("rejects update-user passwords shorter than 12 characters", async () => {
    const req = {
      params: { id: "2" },
      authUser: { id: 1 },
      body: {
        email: "user@example.com",
        password: "short-pass1",
        name: "Updated User",
        upuseAccess: true,
        upuseRole: "user",
        scanoAccessRole: "team_lead",
      },
    };
    const res = createMockResponse();

    await expect(updateUserRoute(req as any, res as any)).rejects.toThrow(ZodError);
    expect(mockUpdateUser).not.toHaveBeenCalled();
  });

  it("accepts update-user passwords with 12 or more characters", async () => {
    const updatedUser = {
      id: 2,
      email: "user@example.com",
      name: "Updated User",
      role: "user",
      active: true,
      createdAt: "2026-03-07T10:30:00.000Z",
      upuseAccess: true,
      isPrimaryAdmin: false,
    };
    mockUpdateUser.mockReturnValue(updatedUser);

    const req = {
      params: { id: "2" },
      authUser: { id: 1 },
      body: {
        email: "user@example.com",
        password: "updated-pass1",
        name: "Updated User",
        upuseAccess: true,
        upuseRole: "user",
        scanoAccessRole: "team_lead",
      },
    };
    const res = createMockResponse();

    await updateUserRoute(req as any, res as any);

    expect(mockUpdateUser).toHaveBeenCalledWith({
      id: 2,
      email: "user@example.com",
      name: "Updated User",
      upuseAccess: true,
      upuseRole: "user",
      scanoAccessRole: "team_lead",
      password: "updated-pass1",
      actorUserId: 1,
    });
    expect(res.statusCode).toBe(200);
  });

  it("archives an existing user and forwards the acting admin id", () => {
    const req = {
      params: { id: "2" },
      authUser: { id: 1 },
    };
    const res = createMockResponse();

    deleteUserRoute(req as any, res as any);

    expect(mockDeleteUserById).toHaveBeenCalledWith({
      id: 2,
      actorUserId: 1,
    });
    expect(res.statusCode).toBe(200);
    expect(res.payload).toEqual({
      ok: true,
    });
  });
});
