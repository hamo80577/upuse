import { beforeEach, describe, expect, it, vi } from "vitest";
import { AUTH_SESSION_COOKIE_NAME } from "./sessionCookie.js";
import { getAppPermissions } from "../../../web/src/core/systems/permissions/upusePermissions.ts";
import { hasCapability } from "./authorization.js";

const { mockGetSessionUserByToken } = vi.hoisted(() => ({
  mockGetSessionUserByToken: vi.fn(),
}));
const { mockCanUserAccessSystem } = vi.hoisted(() => ({
  mockCanUserAccessSystem: vi.fn((systemId: string, user: { upuseAccess?: boolean } | null | undefined) =>
    systemId === "upuse" && user?.upuseAccess === true),
}));

vi.mock("../services/authStore.js", () => ({
  getSessionUserByToken: mockGetSessionUserByToken,
}));

vi.mock("../core/systems/auth/registry/index.js", () => ({
  canUserAccessSystem: mockCanUserAccessSystem,
}));

import { createSessionAuthMiddleware, requireAuthenticatedApi, authorizeUpuseUpgradeFromCookieHeader } from "../shared/http/auth/sessionAuth.js";
import { requireCapability } from "../systems/upuse/policies/access.js";

describe("createSessionAuthMiddleware", () => {
  beforeEach(() => {
    mockGetSessionUserByToken.mockReset();
    mockCanUserAccessSystem.mockClear();
  });

  it("hydrates the authenticated user from the httpOnly session cookie", () => {
    const user = {
      id: 1,
      email: "admin@example.com",
      name: "Admin",
      role: "admin",
      active: true,
      createdAt: "2026-03-07T10:00:00.000Z",
    };
    mockGetSessionUserByToken.mockReturnValue({
      user,
      session: {
        token: "persisted-session-token",
        userId: 1,
        expiresAt: "2026-03-07T22:00:00.000Z",
        createdAt: "2026-03-07T10:00:00.000Z",
      },
    });

    const req: any = {
      path: "/api/auth/me",
      header: vi.fn((name: string) =>
        name.toLowerCase() === "cookie"
          ? `${AUTH_SESSION_COOKIE_NAME}=raw-session-token; theme=light`
          : undefined,
      ),
    };
    const next = vi.fn();

    createSessionAuthMiddleware()(req, {} as any, next);

    expect(mockGetSessionUserByToken).toHaveBeenCalledWith("raw-session-token");
    expect(req.authUser).toEqual(user);
    expect(req.authSessionToken).toBe("raw-session-token");
    expect(next).toHaveBeenCalledOnce();
  });

  it("does not authenticate requests from the removed legacy header", () => {
    const req: any = {
      path: "/api/auth/me",
      header: vi.fn(() => undefined),
      get: vi.fn((name: string) => (name === "X-UPuse-Session" ? "legacy-token" : undefined)),
    };
    const next = vi.fn();

    createSessionAuthMiddleware()(req, {} as any, next);

    expect(mockGetSessionUserByToken).not.toHaveBeenCalled();
    expect(req.authUser).toBeUndefined();
    expect(req.authSessionToken).toBeUndefined();
    expect(next).toHaveBeenCalledOnce();
  });
});

describe("authorization capabilities", () => {
  it("authorizes websocket upgrades only for authenticated UPuse users", () => {
    mockGetSessionUserByToken.mockImplementation((token: string) => {
      if (token === "upuse-user") {
        return {
          user: {
            id: 1,
            email: "admin@example.com",
            name: "Admin",
            role: "admin",
            active: true,
            createdAt: "2026-03-07T10:00:00.000Z",
            upuseAccess: true,
            isPrimaryAdmin: false,
          },
        };
      }

      if (token === "scano-only") {
        return {
          user: {
            id: 2,
            email: "scanner@example.com",
            name: "Scanner",
            role: "user",
            active: true,
            createdAt: "2026-03-07T10:05:00.000Z",
            upuseAccess: false,
            isPrimaryAdmin: false,
            scanoRole: "scanner",
          },
        };
      }

      return null;
    });

    expect(authorizeUpuseUpgradeFromCookieHeader(undefined)).toEqual({
      ok: false,
      statusCode: 401,
      message: "Unauthorized",
      code: "SESSION_UNAUTHORIZED",
      errorOrigin: "session",
    });
    expect(authorizeUpuseUpgradeFromCookieHeader(`${AUTH_SESSION_COOKIE_NAME}=scano-only`)).toEqual({
      ok: false,
      statusCode: 403,
      message: "Forbidden",
      code: "FORBIDDEN",
      errorOrigin: "authorization",
    });
    expect(authorizeUpuseUpgradeFromCookieHeader(`${AUTH_SESSION_COOKIE_NAME}=upuse-user`)).toMatchObject({
      ok: true,
      sessionToken: "upuse-user",
      user: {
        id: 1,
        upuseAccess: true,
      },
    });
  });

  it("grants user access to mapping and token management, but not user management", () => {
    expect(hasCapability("user", "manage_monitor")).toBe(true);
    expect(hasCapability("user", "manage_branch_mappings")).toBe(true);
    expect(hasCapability("user", "delete_branch_mappings")).toBe(true);
    expect(hasCapability("user", "manage_thresholds")).toBe(true);
    expect(hasCapability("user", "manage_settings")).toBe(false);
    expect(hasCapability("user", "manage_settings_tokens")).toBe(true);
    expect(hasCapability("user", "test_settings_tokens")).toBe(true);
    expect(hasCapability("user", "manage_users")).toBe(false);
    expect(hasCapability("user", "clear_logs")).toBe(false);
  });

  it("returns 403 when the current user lacks the required capability", () => {
    const req: any = {
      authUser: {
        role: "user",
      },
    };
    const res: any = {
      statusCode: 200,
      body: undefined as unknown,
      status: vi.fn((statusCode: number) => {
        res.statusCode = statusCode;
        return res;
      }),
      json: vi.fn((body: unknown) => {
        res.body = body;
        return res;
      }),
    };
    const next = vi.fn();

    requireCapability("manage_users")(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
    expect(res.body).toEqual({
      ok: false,
      message: "Forbidden",
      code: "FORBIDDEN",
      errorOrigin: "authorization",
    });
  });

  it("keeps frontend role permissions aligned with backend capability enforcement", () => {
    for (const role of ["admin", "user"] as const) {
      const permissions = getAppPermissions(role);

      expect(permissions.canManageUsers).toBe(hasCapability(role, "manage_users"));
      expect(permissions.canManageMonitor).toBe(hasCapability(role, "manage_monitor"));
      expect(permissions.canRefreshOrdersNow).toBe(hasCapability(role, "refresh_monitor_orders"));
      expect(permissions.canManageBranches).toBe(hasCapability(role, "manage_branch_mappings"));
      expect(permissions.canDeleteBranches).toBe(hasCapability(role, "delete_branch_mappings"));
      expect(permissions.canManageThresholds).toBe(hasCapability(role, "manage_thresholds"));
      expect(permissions.canManageSettings).toBe(hasCapability(role, "manage_settings"));
      expect(permissions.canManageTokens).toBe(hasCapability(role, "manage_settings_tokens"));
      expect(permissions.canTestTokens).toBe(hasCapability(role, "test_settings_tokens"));
      expect(permissions.canClearLogs).toBe(hasCapability(role, "clear_logs"));
    }

    const anonymousPermissions = getAppPermissions(null);
    expect(anonymousPermissions.canManageTokens).toBe(false);
    expect(anonymousPermissions.canTestTokens).toBe(false);
  });

  it("allows readiness probes to bypass authenticated API enforcement", () => {
    const req: any = {
      path: "/api/ready",
      method: "GET",
    };
    const res: any = {
      status: vi.fn(() => res),
      json: vi.fn(() => res),
    };
    const next = vi.fn();

    requireAuthenticatedApi()(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalled();
  });
});
