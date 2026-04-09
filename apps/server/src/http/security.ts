import crypto from "node:crypto";
import type { CorsOptionsDelegate } from "cors";
import type { Request as ExpressRequest, RequestHandler } from "express";

export const CLOUDFLARE_INSIGHTS_SCRIPT_ORIGIN = "https://static.cloudflareinsights.com";
export const CLOUDFLARE_INSIGHTS_BEACON_ORIGIN = "https://cloudflareinsights.com";

export function parseCorsOrigins(raw: string | undefined) {
  if (!raw) return [];

  return raw
    .split(",")
    .map((value) => value.trim())
    .filter((value, index, values) => value.length > 0 && values.indexOf(value) === index);
}

function isDefaultLocalOrigin(origin: string) {
  return /^https?:\/\/localhost(?::\d+)?$/i.test(origin) || /^https?:\/\/127\.0\.0\.1(?::\d+)?$/i.test(origin);
}

function firstHeaderValue(value: string | string[] | undefined) {
  if (Array.isArray(value)) {
    return value[0]?.trim() || undefined;
  }

  return value?.split(",")[0]?.trim() || undefined;
}

function normalizeOrigin(origin: string | undefined) {
  if (!origin) return null;

  try {
    return new URL(origin).origin;
  } catch {
    return null;
  }
}

type RequestOriginLike = Pick<ExpressRequest, "headers" | "protocol" | "get">;

function hasTrustedProxy(req: RequestOriginLike & { app?: { get?: (name: string) => unknown } }) {
  return Boolean(req.app?.get?.("trust proxy"));
}

type RequestSecurityLike = RequestOriginLike & { app?: { get?: (name: string) => unknown } };

export function resolveRequestOrigin(req: RequestSecurityLike) {
  const trustProxy = hasTrustedProxy(req);
  const forwardedProto = trustProxy ? firstHeaderValue(req.headers["x-forwarded-proto"]) : undefined;
  const forwardedHost = trustProxy ? firstHeaderValue(req.headers["x-forwarded-host"]) : undefined;
  const host = forwardedHost || firstHeaderValue(req.headers.host) || req.get?.("host");
  if (!host) return null;

  const protocol = forwardedProto || req.protocol || "http";
  return normalizeOrigin(`${protocol}://${host}`);
}

export function isSameRequestOrigin(origin: string | undefined, req: RequestSecurityLike) {
  const normalizedOrigin = normalizeOrigin(origin);
  if (!normalizedOrigin) {
    return !origin;
  }

  return normalizedOrigin === resolveRequestOrigin(req);
}

export function isAllowedOrigin(origin: string | undefined, configuredOrigins: string[]) {
  if (!origin) return true;

  if (configuredOrigins.length > 0) {
    return configuredOrigins.includes(origin);
  }

  return isDefaultLocalOrigin(origin);
}

export function isTrustedOrigin(origin: string | undefined, req: RequestSecurityLike, configuredOrigins: string[]) {
  return isAllowedOrigin(origin, configuredOrigins) || isSameRequestOrigin(origin, req);
}

function resolveRequestInitiatorOrigin(req: RequestOriginLike) {
  const requestOrigin = normalizeOrigin(firstHeaderValue(req.headers.origin));
  if (requestOrigin) return requestOrigin;

  const referer = firstHeaderValue(req.headers.referer);
  if (!referer) return null;

  try {
    return new URL(referer).origin;
  } catch {
    return null;
  }
}

function isSafeMethod(method: string) {
  return method === "GET" || method === "HEAD" || method === "OPTIONS";
}

export function createCorsOptions(
  configuredOrigins = parseCorsOrigins(process.env.UPUSE_CORS_ORIGINS),
): CorsOptionsDelegate<ExpressRequest> {
  const trustedOrigins = configuredOrigins;

  return (req, callback) => {
    const requestOrigin = firstHeaderValue(req.headers.origin);
    const allow = isTrustedOrigin(requestOrigin, req, trustedOrigins);

    callback(null, {
      origin: allow ? requestOrigin ?? true : false,
      credentials: true,
    });
  };
}

export function createApiNoStoreMiddleware(): RequestHandler {
  return (req, res, next) => {
    if (req.path.startsWith("/api/")) {
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("Pragma", "no-cache");
    }

    next();
  };
}

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

export function createTrustedOriginMiddleware(configuredOrigins = parseCorsOrigins(process.env.UPUSE_CORS_ORIGINS)): RequestHandler {
  const trustedOrigins = configuredOrigins;

  return (req, res, next) => {
    if (!req.path.startsWith("/api/") || isSafeMethod(req.method)) {
      next();
      return;
    }

    const fetchSite = firstHeaderValue(req.headers["sec-fetch-site"])?.toLowerCase();
    if (fetchSite && fetchSite !== "same-origin" && fetchSite !== "same-site" && fetchSite !== "none") {
      res.status(403).json({
        ok: false,
        message: "Cross-site API request blocked",
      });
      return;
    }

    const initiatorOrigin = resolveRequestInitiatorOrigin(req);
    if (!initiatorOrigin || isTrustedOrigin(initiatorOrigin, req, trustedOrigins)) {
      next();
      return;
    }

    res.status(403).json({
      ok: false,
      message: "Untrusted request origin",
    });
  };
}
