import type { RequestHandler } from "express";
import { getSessionUserByToken } from "../services/authStore.js";
import type { AppUserRole } from "../types/models.js";
import { readAuthSessionToken } from "./sessionCookie.js";

export type AppCapability =
  | "manage_users"
  | "manage_monitor"
  | "refresh_monitor_orders"
  | "manage_branch_mappings"
  | "delete_branch_mappings"
  | "manage_thresholds"
  | "manage_settings"
  | "manage_settings_tokens"
  | "test_settings_tokens"
  | "clear_logs";

const PUBLIC_API_PATHS = new Set([
  "/api/health",
  "/api/ready",
  "/api/auth/login",
]);

const roleCapabilities: Record<AppUserRole, ReadonlySet<AppCapability>> = {
  admin: new Set<AppCapability>([
    "manage_users",
    "manage_monitor",
    "refresh_monitor_orders",
    "manage_branch_mappings",
    "delete_branch_mappings",
    "manage_thresholds",
    "manage_settings",
    "manage_settings_tokens",
    "test_settings_tokens",
    "clear_logs",
  ]),
  user: new Set<AppCapability>([
    "manage_monitor",
    "manage_branch_mappings",
    "delete_branch_mappings",
    "manage_thresholds",
    "manage_settings_tokens",
    "test_settings_tokens",
  ]),
};

function isPublicApiPath(path: string) {
  return PUBLIC_API_PATHS.has(path);
}

export function hasCapability(role: AppUserRole | undefined, capability: AppCapability) {
  if (!role) return false;
  return roleCapabilities[role]?.has(capability) ?? false;
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
