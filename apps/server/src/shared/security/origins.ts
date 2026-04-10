import type { Request as ExpressRequest } from "express";

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

export function parseCorsOrigins(raw: string | undefined) {
  if (!raw) return [];

  return raw
    .split(",")
    .map((value) => value.trim())
    .filter((value, index, values) => value.length > 0 && values.indexOf(value) === index);
}

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

export function resolveRefererOrigin(req: RequestOriginLike) {
  const referer = firstHeaderValue(req.headers.referer);
  if (!referer) return null;

  try {
    return new URL(referer).origin;
  } catch {
    return null;
  }
}

export function isSafeMethod(method: string) {
  return method === "GET" || method === "HEAD" || method === "OPTIONS";
}

export function readFirstHeaderValue(value: string | string[] | undefined) {
  return firstHeaderValue(value);
}
