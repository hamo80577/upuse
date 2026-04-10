import type { RequestHandler } from "express";
import { hasCapability, type AppCapability } from "../../../http/authorization.js";
import type { AppUser } from "../../../types/models.js";

export function hasUpuseAccess(user: AppUser | null | undefined) {
  return !!user && user.upuseAccess;
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

export function requireAdminRole(): RequestHandler {
  return requireCapability("manage_users");
}
