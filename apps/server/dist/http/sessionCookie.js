export const AUTH_SESSION_COOKIE_NAME = "upuse_session";
export const PRODUCTION_AUTH_SESSION_COOKIE_NAME = "__Host-upuse_session";
function isProduction() {
    return process.env.NODE_ENV?.trim().toLowerCase() === "production";
}
function getAuthSessionCookieNames() {
    return isProduction()
        ? [PRODUCTION_AUTH_SESSION_COOKIE_NAME, AUTH_SESSION_COOKIE_NAME]
        : [AUTH_SESSION_COOKIE_NAME];
}
function getPrimaryAuthSessionCookieName() {
    return getAuthSessionCookieNames()[0];
}
function createAuthSessionCookieOptions() {
    return {
        httpOnly: true,
        sameSite: "lax",
        secure: isProduction(),
        path: "/",
        priority: "high",
    };
}
function parseCookieHeader(headerValue) {
    const cookies = new Map();
    if (!headerValue)
        return cookies;
    for (const chunk of headerValue.split(";")) {
        const [rawName, ...rawValueParts] = chunk.split("=");
        const name = rawName?.trim();
        if (!name)
            continue;
        const rawValue = rawValueParts.join("=").trim();
        if (!rawValue)
            continue;
        try {
            cookies.set(name, decodeURIComponent(rawValue));
        }
        catch {
            cookies.set(name, rawValue);
        }
    }
    return cookies;
}
export function readAuthSessionTokenFromCookieHeader(headerValue) {
    const cookies = parseCookieHeader(headerValue);
    for (const cookieName of getAuthSessionCookieNames()) {
        const value = cookies.get(cookieName);
        if (value)
            return value;
    }
    return undefined;
}
export function readAuthSessionToken(req) {
    return readAuthSessionTokenFromCookieHeader(req.header("cookie"));
}
export function setAuthSessionCookie(res, token, expiresAt) {
    const expiresAtMs = new Date(expiresAt).getTime();
    res.cookie(getPrimaryAuthSessionCookieName(), token, {
        ...createAuthSessionCookieOptions(),
        expires: new Date(expiresAt),
        maxAge: Number.isFinite(expiresAtMs) ? Math.max(0, expiresAtMs - Date.now()) : undefined,
    });
}
export function clearAuthSessionCookie(res) {
    for (const cookieName of getAuthSessionCookieNames()) {
        res.clearCookie(cookieName, createAuthSessionCookieOptions());
    }
}
