import type { CorsOptionsDelegate } from "cors";
import type { Request } from "express";

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

type RequestOriginLike = Pick<Request, "headers" | "protocol" | "get">;

export function resolveRequestOrigin(req: RequestOriginLike) {
  const forwardedProto = firstHeaderValue(req.headers["x-forwarded-proto"]);
  const forwardedHost = firstHeaderValue(req.headers["x-forwarded-host"]);
  const host = forwardedHost || firstHeaderValue(req.headers.host) || req.get?.("host");
  if (!host) return null;

  const protocol = forwardedProto || req.protocol || "http";
  return normalizeOrigin(`${protocol}://${host}`);
}

export function isSameRequestOrigin(origin: string | undefined, req: RequestOriginLike) {
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

export function createCorsOptions(): CorsOptionsDelegate<Request> {
  const configuredOrigins = parseCorsOrigins(process.env.UPUSE_CORS_ORIGINS);

  return (req, callback) => {
    const requestOrigin = firstHeaderValue(req.headers.origin);
    const allow = isAllowedOrigin(requestOrigin, configuredOrigins) || isSameRequestOrigin(requestOrigin, req);

    callback(allow ? null : new Error("CORS origin not allowed"), {
      origin: allow,
      credentials: true,
    });
  };
}
