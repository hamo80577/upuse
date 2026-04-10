import crypto from "node:crypto";
import type { RequestHandler } from "express";

export const CLOUDFLARE_INSIGHTS_SCRIPT_ORIGIN = "https://static.cloudflareinsights.com";
export const CLOUDFLARE_INSIGHTS_BEACON_ORIGIN = "https://cloudflareinsights.com";

export function createCspNonceMiddleware(): RequestHandler {
  return (_req, res, next) => {
    res.locals.cspNonce = crypto.randomBytes(16).toString("base64");
    next();
  };
}

function resolveCspNonce(_req: any, res: any) {
  const nonce = typeof res.locals.cspNonce === "string" ? res.locals.cspNonce : "";
  return `'nonce-${nonce}'`;
}

export function createContentSecurityPolicyDirectives() {
  return {
    "img-src": [
      "'self'",
      "data:",
      "blob:",
      "https:",
    ],
    "script-src": [
      "'self'",
      CLOUDFLARE_INSIGHTS_SCRIPT_ORIGIN,
      resolveCspNonce,
    ],
    "connect-src": [
      "'self'",
      CLOUDFLARE_INSIGHTS_BEACON_ORIGIN,
    ],
  };
}
