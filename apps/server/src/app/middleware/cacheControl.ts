import type { RequestHandler } from "express";

export function createApiNoStoreMiddleware(): RequestHandler {
  return (req, res, next) => {
    if (req.path.startsWith("/api/")) {
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("Pragma", "no-cache");
    }

    next();
  };
}
