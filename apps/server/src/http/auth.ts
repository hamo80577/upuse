import type { RequestHandler } from "express";
import { getSessionUserByToken } from "../services/authStore.js";
import { readAuthSessionToken } from "./sessionCookie.js";
import { hasCapability, type AppCapability } from "./authorization.js";

const PUBLIC_API_PATHS = new Set([
  "/api/health",
  "/api/ready",
  "/api/auth/login",
]);

function isPublicApiPath(path: string) {
  return PUBLIC_API_PATHS.has(path);
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

    const auth = getSessionUserByToken(sessionToken);
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
    });
  };
}

export function requireAdminRole(): RequestHandler {
  return requireCapability("manage_users");
}

export function requireCapability(capability: AppCapability): RequestHandler {
  return (req, res, next) => {
    if (hasCapability(req.authUser?.role, capability)) {
      next();
      return;
    }

    res.status(403).json({
      ok: false,
      message: "Forbidden",
    });
  };
}
