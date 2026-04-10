import type { RequestHandler } from "express";
import type { AppUser } from "../../../types/models.js";

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

function createForbiddenResponse() {
  return {
    ok: false,
    message: "Forbidden",
    code: "FORBIDDEN",
    errorOrigin: "authorization" as const,
  };
}

export function requireScanoAccess(): RequestHandler {
  return (req, res, next) => {
    if (hasScanoAccess(req.authUser)) {
      next();
      return;
    }

    res.status(403).json(createForbiddenResponse());
  };
}

export function requireScanoTaskManager(): RequestHandler {
  return (req, res, next) => {
    if (hasScanoTaskManagerAccess(req.authUser)) {
      next();
      return;
    }

    res.status(403).json(createForbiddenResponse());
  };
}

export function requireScanoLeadAccess(): RequestHandler {
  return (req, res, next) => {
    if (hasScanoLeadAccess(req.authUser)) {
      next();
      return;
    }

    res.status(403).json(createForbiddenResponse());
  };
}

export function requireScanoAdmin(): RequestHandler {
  return (req, res, next) => {
    if (hasScanoAdminAccess(req.authUser)) {
      next();
      return;
    }

    res.status(403).json(createForbiddenResponse());
  };
}
