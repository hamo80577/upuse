import type { RequestHandler } from "express";
import type { AppUser } from "../../../types/models.js";

export function hasOpsAccess(user: AppUser | null | undefined) {
  return user?.isPrimaryAdmin === true;
}

function createForbiddenResponse() {
  return {
    ok: false,
    message: "Forbidden",
    code: "FORBIDDEN",
    errorOrigin: "authorization" as const,
  };
}

function createUnauthorizedResponse() {
  return {
    ok: false,
    message: "Unauthorized",
    code: "SESSION_UNAUTHORIZED",
    errorOrigin: "session" as const,
  };
}

export function requireOpsAccess(): RequestHandler {
  return (req, res, next) => {
    if (hasOpsAccess(req.authUser)) {
      next();
      return;
    }

    res.status(403).json(createForbiddenResponse());
  };
}

export function requireOpsTelemetryWriteAccess(): RequestHandler {
  return (req, res, next) => {
    if (req.authUser) {
      next();
      return;
    }

    res.status(401).json(createUnauthorizedResponse());
  };
}
