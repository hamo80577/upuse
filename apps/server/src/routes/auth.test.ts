import { beforeEach, describe, expect, it, vi } from "vitest";
import { AUTH_SESSION_COOKIE_NAME } from "../http/sessionCookie.js";

const { mockCreateAuthSession, mockCreateUser, mockDeleteAuthSession, mockVerifyUserCredentials } = vi.hoisted(() => ({
  mockCreateAuthSession: vi.fn(),
  mockCreateUser: vi.fn(),
  mockDeleteAuthSession: vi.fn(),
  mockVerifyUserCredentials: vi.fn(),
}));

vi.mock("../services/authStore.js", () => ({
  createAuthSession: mockCreateAuthSession,
  createUser: mockCreateUser,
  deleteAuthSession: mockDeleteAuthSession,
  listUsers: vi.fn(() => []),
  verifyUserCredentials: mockVerifyUserCredentials,
}));

import { createUserRoute, loginRoute, logoutRoute, resetLoginRateLimitStateForTests } from "./auth.js";

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
    mockCreateAuthSession.mockReset();
    mockCreateUser.mockReset();
    mockDeleteAuthSession.mockReset();
    mockVerifyUserCredentials.mockReset();
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

  it("accepts the renamed user role when creating users", () => {
    const createdUser = {
      id: 2,
      email: "user@example.com",
      name: "User",
      role: "user",
      active: true,
      createdAt: "2026-03-07T10:30:00.000Z",
    };
    mockCreateUser.mockReturnValue(createdUser);

    const req = {
      body: {
        email: "user@example.com",
        password: "password-123",
        name: "User",
        role: "user",
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
});
