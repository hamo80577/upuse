import type { Request as ExpressRequest } from "express";
import type { CorsOptionsDelegate } from "cors";
import { isTrustedOrigin, parseCorsOrigins, readFirstHeaderValue } from "../../shared/security/origins.js";

export function createCorsOptions(
  configuredOrigins = parseCorsOrigins(process.env.UPUSE_CORS_ORIGINS),
): CorsOptionsDelegate<ExpressRequest> {
  const trustedOrigins = configuredOrigins;

  return (req, callback) => {
    const requestOrigin = readFirstHeaderValue(req.headers.origin);
    const allow = isTrustedOrigin(requestOrigin, req, trustedOrigins);

    callback(null, {
      origin: allow ? requestOrigin ?? true : false,
      credentials: true,
    });
  };
}
