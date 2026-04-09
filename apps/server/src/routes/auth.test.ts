import { beforeEach, describe, expect, it, vi } from "vitest";
import { AUTH_SESSION_COOKIE_NAME } from "../http/sessionCookie.js";

const {
  mockCreateAuthSession,
  mockCreateUser,
  mockDeleteAuthSession,
  mockDeleteUserById,
  mockUpdateUser,
  mockVerifyUserCredentials,
  mockResetLoginThrottleStoreForTests,
  mockLoginThrottleStore,
} = vi.hoisted(() => {
  const attempts = new Map<string, {
    count: number;
    windowStartedAtMs: number;
    blockedUntilMs: number | null;
  }>();
  const MAX_LOGIN_ATTEMPTS = 5;
  const LOGIN_ATTEMPT_WINDOW_MS = 10 * 60 * 1000;
  const LOGIN_ATTEMPT_BLOCK_MS = 15 * 60 * 1000;

  function prune(nowMs = Date.now()) {
    for (const [key, state] of attempts.entries()) {
      const windowExpired = nowMs - state.windowStartedAtMs > LOGIN_ATTEMPT_WINDOW_MS;
      const blockExpired = !state.blockedUntilMs || state.blockedUntilMs <= nowMs;
      if (windowExpired && blockExpired) {
        attempts.delete(key);
      }
    }
  }

  return {
    mockCreateAuthSession: vi.fn(),
    mockCreateUser: vi.fn(),
    mockDeleteAuthSession: vi.fn(),
    mockDeleteUserById: vi.fn(),
    mockUpdateUser: vi.fn(),
    mockVerifyUserCredentials: vi.fn(),
    mockResetLoginThrottleStoreForTests: vi.fn(() => {
      attempts.clear();
    }),
    mockLoginThrottleStore: {
      initialize: vi.fn(),
      pruneExpired: vi.fn(() => {
        prune();
      }),
      getBlockedUntilMs: vi.fn((key: string) => {
        prune();
        const state = attempts.get(key);
        if (!state?.blockedUntilMs || state.blockedUntilMs <= Date.now()) {
          if (state?.blockedUntilMs && state.blockedUntilMs <= Date.now()) {
            attempts.delete(key);
          }
          return null;
        }
        attempts.delete(key);
        attempts.set(key, state);
        return state.blockedUntilMs;
      }),
      registerFailedAttempt: vi.fn((key: string) => {
        const nowMs = Date.now();
        const current = attempts.get(key);
        const withinWindow = current && nowMs - current.windowStartedAtMs <= LOGIN_ATTEMPT_WINDOW_MS;
        const nextState = withinWindow
          ? {
              count: current.count + 1,
              windowStartedAtMs: current.windowStartedAtMs,
              blockedUntilMs: current.blockedUntilMs,
            }
          : {
              count: 1,
              windowStartedAtMs: nowMs,
              blockedUntilMs: null,
            };

        if (nextState.count >= MAX_LOGIN_ATTEMPTS) {
          nextState.blockedUntilMs = nowMs + LOGIN_ATTEMPT_BLOCK_MS;
        }

        attempts.delete(key);
        attempts.set(key, nextState);
        return {
          count: nextState.count,
          blockedUntilMs: nextState.blockedUntilMs,
        };
      }),
      clear: vi.fn((key: string) => {
        attempts.delete(key);
      }),
      resetForTests: vi.fn(() => {
        attempts.clear();
      }),
    },
  };
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

vi.mock("../services/loginThrottleStore.js", () => ({
  loginThrottleStore: mockLoginThrottleStore,
}));

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
    mockResetLoginThrottleStoreForTests.mockClear();
    mockCreateAuthSession.mockReset();
    mockCreateUser.mockReset();
    mockDeleteAuthSession.mockReset();
    mockDeleteUserById.mockReset();
    mockUpdateUser.mockReset();
    mockVerifyUserCredentials.mockReset();
    mockLoginThrottleStore.getBlockedUntilMs.mockClear();
    mockLoginThrottleStore.registerFailedAttempt.mockClear();
    mockLoginThrottleStore.clear.mockClear();
    mockLoginThrottleStore.resetForTests.mockClear();
  });

  it("sets the auth cookie and returns the authenticated user without exposing the session token", () => {
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

    loginRoute(req as any, res as any);

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

  it("rate-limits repeated failed sign-in attempts for the same ip/email pair", () => {
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
      loginRoute(req as any, res as any);
      expect(res.statusCode).toBe(401);
    }

    const fifthAttempt = createMockResponse();
    loginRoute(req as any, fifthAttempt as any);
    expect(fifthAttempt.statusCode).toBe(429);

    const blockedAttempt = createMockResponse();
    loginRoute(req as any, blockedAttempt as any);
    expect(blockedAttempt.statusCode).toBe(429);
    expect(mockVerifyUserCredentials).toHaveBeenCalledTimes(5);
  });

  it("keeps the login throttle active across later requests for the same normalized ip/email key", () => {
    mockVerifyUserCredentials.mockReturnValue(null);

    for (let attempt = 1; attempt <= 5; attempt += 1) {
      const res = createMockResponse();
      loginRoute({
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
    loginRoute({
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

  it("accepts the renamed user role when creating users", () => {
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

    createUserRoute(req as any, res as any);

    expect(mockCreateUser).toHaveBeenCalledWith(req.body);
    expect(res.statusCode).toBe(201);
    expect(res.payload).toEqual({
      ok: true,
      user: createdUser,
    });
  });

  it("updates an existing user and forwards the acting admin id", () => {
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

    updateUserRoute(req as any, res as any);

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
