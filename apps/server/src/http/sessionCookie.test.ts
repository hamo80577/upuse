import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AUTH_SESSION_COOKIE_NAME,
  PRODUCTION_AUTH_SESSION_COOKIE_NAME,
  clearAuthSessionCookie,
  readAuthSessionTokenFromCookieHeader,
  readAuthSessionToken,
  setAuthSessionCookie,
} from "./sessionCookie.js";

const originalNodeEnv = process.env.NODE_ENV;

afterEach(() => {
  process.env.NODE_ENV = originalNodeEnv;
});

describe("session cookies", () => {
  it("reads the legacy cookie name by default", () => {
    const req: any = {
      header: vi.fn((name: string) =>
        name.toLowerCase() === "cookie"
          ? `${AUTH_SESSION_COOKIE_NAME}=legacy-token; theme=light`
          : undefined,
      ),
    };

    expect(readAuthSessionToken(req)).toBe("legacy-token");
  });

  it("prefers the production host-only cookie but still accepts the legacy fallback", () => {
    process.env.NODE_ENV = "production";

    const req: any = {
      header: vi.fn((name: string) =>
        name.toLowerCase() === "cookie"
          ? `${AUTH_SESSION_COOKIE_NAME}=legacy-token; ${PRODUCTION_AUTH_SESSION_COOKIE_NAME}=host-token`
          : undefined,
      ),
    };

    expect(readAuthSessionToken(req)).toBe("host-token");
  });

  it("reads the auth token directly from a raw cookie header", () => {
    process.env.NODE_ENV = "production";

    expect(
      readAuthSessionTokenFromCookieHeader(
        `theme=light; ${PRODUCTION_AUTH_SESSION_COOKIE_NAME}=socket-token; ${AUTH_SESSION_COOKIE_NAME}=legacy-token`,
      ),
    ).toBe("socket-token");
  });

  it("uses the host-only cookie name in production", () => {
    process.env.NODE_ENV = "production";

    const res: any = {
      cookie: vi.fn(),
    };

    setAuthSessionCookie(res, "session-token", "2026-03-12T20:00:00.000Z");

    expect(res.cookie).toHaveBeenCalledWith(
      PRODUCTION_AUTH_SESSION_COOKIE_NAME,
      "session-token",
      expect.objectContaining({
        httpOnly: true,
        sameSite: "lax",
        secure: true,
        path: "/",
      }),
    );
  });

  it("clears both production and legacy cookie names in production", () => {
    process.env.NODE_ENV = "production";

    const res: any = {
      clearCookie: vi.fn(),
    };

    clearAuthSessionCookie(res);

    expect(res.clearCookie).toHaveBeenNthCalledWith(
      1,
      PRODUCTION_AUTH_SESSION_COOKIE_NAME,
      expect.objectContaining({
        httpOnly: true,
        sameSite: "lax",
        secure: true,
        path: "/",
      }),
    );
    expect(res.clearCookie).toHaveBeenNthCalledWith(
      2,
      AUTH_SESSION_COOKIE_NAME,
      expect.objectContaining({
        httpOnly: true,
        sameSite: "lax",
        secure: true,
        path: "/",
      }),
    );
  });
});
