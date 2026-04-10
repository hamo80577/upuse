import type { RequestHandler } from "express";
import { getSessionUserByToken } from "../../../services/authStore.js";
import { readAuthSessionToken, readAuthSessionTokenFromCookieHeader } from "../../../http/sessionCookie.js";
import { hasUpuseAccess } from "../../../systems/upuse/policies/access.js";
import type { AppUser } from "../../../types/models.js";

const PUBLIC_API_PATHS = new Set([
  "/api/health",
  "/api/ready",
  "/api/auth/login",
]);

function isPublicApiPath(path: string) {
  return PUBLIC_API_PATHS.has(path);
}

function resolveSessionAuthByToken(sessionToken: string | undefined) {
  if (!sessionToken) {
    return null;
  }

  return getSessionUserByToken(sessionToken);
}

export function resolveSessionUserFromCookieHeader(cookieHeader: string | undefined) {
  const sessionToken = readAuthSessionTokenFromCookieHeader(cookieHeader);
  if (!sessionToken) {
    return null;
  }

  const auth = resolveSessionAuthByToken(sessionToken);
  if (!auth) {
    return null;
  }

  return {
    user: auth.user,
    sessionToken,
  };
}

export type UpuseUpgradeAuthorizationResult =
  | {
      ok: true;
      user: AppUser;
      sessionToken: string;
    }
  | {
      ok: false;
      statusCode: 401 | 403;
      message: "Unauthorized" | "Forbidden";
      code: "SESSION_UNAUTHORIZED" | "FORBIDDEN";
      errorOrigin: "session" | "authorization";
    };

export function authorizeUpuseUpgradeFromCookieHeader(cookieHeader: string | undefined): UpuseUpgradeAuthorizationResult {
  const session = resolveSessionUserFromCookieHeader(cookieHeader);
  if (!session) {
    return {
      ok: false,
      statusCode: 401,
      message: "Unauthorized",
      code: "SESSION_UNAUTHORIZED",
      errorOrigin: "session",
    };
  }

  if (!hasUpuseAccess(session.user)) {
    return {
      ok: false,
      statusCode: 403,
      message: "Forbidden",
      code: "FORBIDDEN",
      errorOrigin: "authorization",
    };
  }

  return {
    ok: true,
    user: session.user,
    sessionToken: session.sessionToken,
  };
}

export function createSessionAuthMiddleware(): RequestHandler {
  return (req, _res, next) => {
    if (!req.path.startsWith("/api/")) {
      next();
      return;
    }

    const sessionToken = readAuthSessionToken(req);
    if (!sessionToken) {
      next();
      return;
    }

    const auth = resolveSessionAuthByToken(sessionToken);
    if (auth) {
      req.authUser = auth.user;
      req.authSessionToken = sessionToken;
    }

    next();
  };
}

export function requireAuthenticatedApi(): RequestHandler {
  return (req, res, next) => {
    if (!req.path.startsWith("/api/") || req.method === "OPTIONS" || isPublicApiPath(req.path)) {
      next();
      return;
    }

    if (req.authUser) {
      next();
      return;
    }

    res.status(401).json({
      ok: false,
      message: "Unauthorized",
      code: "SESSION_UNAUTHORIZED",
      errorOrigin: "session",
    });
  };
}
