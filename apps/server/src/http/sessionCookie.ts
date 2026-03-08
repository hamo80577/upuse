import type { CookieOptions, Request, Response } from "express";

export const AUTH_SESSION_COOKIE_NAME = "upuse_session";

function isProduction() {
  return process.env.NODE_ENV?.trim().toLowerCase() === "production";
}

function createAuthSessionCookieOptions(): CookieOptions {
  return {
    httpOnly: true,
    sameSite: "lax",
    secure: isProduction(),
    path: "/",
    priority: "high",
  };
}

function parseCookieHeader(headerValue: string | undefined) {
  const cookies = new Map<string, string>();
  if (!headerValue) return cookies;

  for (const chunk of headerValue.split(";")) {
    const [rawName, ...rawValueParts] = chunk.split("=");
    const name = rawName?.trim();
    if (!name) continue;

    const rawValue = rawValueParts.join("=").trim();
    if (!rawValue) continue;

    try {
      cookies.set(name, decodeURIComponent(rawValue));
    } catch {
      cookies.set(name, rawValue);
    }
  }

  return cookies;
}

export function readAuthSessionToken(req: Request) {
  return parseCookieHeader(req.header("cookie")).get(AUTH_SESSION_COOKIE_NAME);
}

export function setAuthSessionCookie(res: Response, token: string, expiresAt: string) {
  const expiresAtMs = new Date(expiresAt).getTime();

  res.cookie(AUTH_SESSION_COOKIE_NAME, token, {
    ...createAuthSessionCookieOptions(),
    expires: new Date(expiresAt),
    maxAge: Number.isFinite(expiresAtMs) ? Math.max(0, expiresAtMs - Date.now()) : undefined,
  });
}

export function clearAuthSessionCookie(res: Response) {
  res.clearCookie(AUTH_SESSION_COOKIE_NAME, createAuthSessionCookieOptions());
}
