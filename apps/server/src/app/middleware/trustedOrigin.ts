import type { RequestHandler } from "express";
import {
  isSafeMethod,
  isTrustedOrigin,
  parseCorsOrigins,
  readFirstHeaderValue,
  resolveRefererOrigin,
} from "../../shared/security/origins.js";

export function createTrustedOriginMiddleware(configuredOrigins = parseCorsOrigins(process.env.UPUSE_CORS_ORIGINS)): RequestHandler {
  const trustedOrigins = configuredOrigins;

  return (req, res, next) => {
    if (!req.path.startsWith("/api/") || isSafeMethod(req.method)) {
      next();
      return;
    }

    const fetchSite = readFirstHeaderValue(req.headers["sec-fetch-site"])?.toLowerCase();
    if (fetchSite && fetchSite !== "same-origin" && fetchSite !== "same-site" && fetchSite !== "none") {
      res.status(403).json({
        ok: false,
        message: "Cross-site API request blocked",
      });
      return;
    }

    const rawOrigin = readFirstHeaderValue(req.headers.origin);
    if (rawOrigin) {
      if (isTrustedOrigin(rawOrigin, req, trustedOrigins)) {
        next();
        return;
      }

      res.status(403).json({
        ok: false,
        message: "Untrusted request origin",
      });
      return;
    }

    const rawReferer = readFirstHeaderValue(req.headers.referer);
    const refererOrigin = rawReferer ? resolveRefererOrigin(req) : null;
    if (rawReferer) {
      if (refererOrigin && isTrustedOrigin(refererOrigin, req, trustedOrigins)) {
        next();
        return;
      }

      res.status(403).json({
        ok: false,
        message: "Untrusted request origin",
      });
      return;
    }

    if (fetchSite === "same-origin" || fetchSite === "same-site") {
      next();
      return;
    }

    res.status(403).json({
      ok: false,
      message: "Untrusted request origin",
    });
  };
}
