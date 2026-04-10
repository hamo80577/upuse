import type { RequestHandler } from "express";
import { getSessionUserByToken } from "../services/authStore.js";
import { readAuthSessionToken, readAuthSessionTokenFromCookieHeader } from "./sessionCookie.js";
import { hasCapability, type AppCapability } from "./authorization.js";
import type { AppUser } from "../types/models.js";

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

export function requireAdminRole(): RequestHandler {
  return requireCapability("manage_users");
}

export function hasUpuseAccess(user: AppUser | null | undefined) {
  return !!user && user.upuseAccess;
}

export function hasScanoAccess(user: AppUser | null | undefined) {
  return !!user && (user.isPrimaryAdmin || user.scanoRole === "team_lead" || user.scanoRole === "scanner");
}

export function hasScanoLeadAccess(user: AppUser | null | undefined) {
  return !!user && (user.isPrimaryAdmin || user.scanoRole === "team_lead");
}

export function hasScanoTaskManagerAccess(user: AppUser | null | undefined) {
  return !!user && (user.isPrimaryAdmin || user.scanoRole === "team_lead");
}

export function hasScanoAdminAccess(user: AppUser | null | undefined) {
  return !!user && user.isPrimaryAdmin;
}

export function requireUpuseAccess(): RequestHandler {
  return (req, res, next) => {
    if (hasUpuseAccess(req.authUser)) {
      next();
      return;
    }

    res.status(403).json({
      ok: false,
      message: "Forbidden",
      code: "FORBIDDEN",
      errorOrigin: "authorization",
    });
  };
}

export function requireScanoAccess(): RequestHandler {
  return (req, res, next) => {
    if (hasScanoAccess(req.authUser)) {
      next();
      return;
    }

    res.status(403).json({
      ok: false,
      message: "Forbidden",
      code: "FORBIDDEN",
      errorOrigin: "authorization",
    });
  };
}

export function requireScanoTaskManager(): RequestHandler {
  return (req, res, next) => {
    if (hasScanoTaskManagerAccess(req.authUser)) {
      next();
      return;
    }

    res.status(403).json({
      ok: false,
      message: "Forbidden",
      code: "FORBIDDEN",
      errorOrigin: "authorization",
    });
  };
}

export function requireScanoLeadAccess(): RequestHandler {
  return (req, res, next) => {
    if (hasScanoLeadAccess(req.authUser)) {
      next();
      return;
    }

    res.status(403).json({
      ok: false,
      message: "Forbidden",
      code: "FORBIDDEN",
      errorOrigin: "authorization",
    });
  };
}

export function requireScanoAdmin(): RequestHandler {
  return (req, res, next) => {
    if (hasScanoAdminAccess(req.authUser)) {
      next();
      return;
    }

    res.status(403).json({
      ok: false,
      message: "Forbidden",
      code: "FORBIDDEN",
      errorOrigin: "authorization",
    });
  };
}

export function requireCapability(capability: AppCapability): RequestHandler {
  return (req, res, next) => {
    if (hasCapability(req.authUser?.role, capability, req.authUser?.upuseAccess === true)) {
      next();
      return;
    }

    res.status(403).json({
      ok: false,
      message: "Forbidden",
      code: "FORBIDDEN",
      errorOrigin: "authorization",
    });
  };
}
