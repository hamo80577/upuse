export function parseCorsOrigins(raw) {
    if (!raw)
        return [];
    return raw
        .split(",")
        .map((value) => value.trim())
        .filter((value, index, values) => value.length > 0 && values.indexOf(value) === index);
}
function isDefaultLocalOrigin(origin) {
    return /^https?:\/\/localhost(?::\d+)?$/i.test(origin) || /^https?:\/\/127\.0\.0\.1(?::\d+)?$/i.test(origin);
}
function firstHeaderValue(value) {
    if (Array.isArray(value)) {
        return value[0]?.trim() || undefined;
    }
    return value?.split(",")[0]?.trim() || undefined;
}
function normalizeOrigin(origin) {
    if (!origin)
        return null;
    try {
        return new URL(origin).origin;
    }
    catch {
        return null;
    }
}
function hasTrustedProxy(req) {
    return Boolean(req.app?.get?.("trust proxy"));
}
export function resolveRequestOrigin(req) {
    const trustProxy = hasTrustedProxy(req);
    const forwardedProto = trustProxy ? firstHeaderValue(req.headers["x-forwarded-proto"]) : undefined;
    const forwardedHost = trustProxy ? firstHeaderValue(req.headers["x-forwarded-host"]) : undefined;
    const host = forwardedHost || firstHeaderValue(req.headers.host) || req.get?.("host");
    if (!host)
        return null;
    const protocol = forwardedProto || req.protocol || "http";
    return normalizeOrigin(`${protocol}://${host}`);
}
export function isSameRequestOrigin(origin, req) {
    const normalizedOrigin = normalizeOrigin(origin);
    if (!normalizedOrigin) {
        return !origin;
    }
    return normalizedOrigin === resolveRequestOrigin(req);
}
export function isAllowedOrigin(origin, configuredOrigins) {
    if (!origin)
        return true;
    if (configuredOrigins.length > 0) {
        return configuredOrigins.includes(origin);
    }
    return isDefaultLocalOrigin(origin);
}
export function isTrustedOrigin(origin, req, configuredOrigins) {
    return isAllowedOrigin(origin, configuredOrigins) || isSameRequestOrigin(origin, req);
}
function resolveRequestInitiatorOrigin(req) {
    const requestOrigin = normalizeOrigin(firstHeaderValue(req.headers.origin));
    if (requestOrigin)
        return requestOrigin;
    const referer = firstHeaderValue(req.headers.referer);
    if (!referer)
        return null;
    try {
        return new URL(referer).origin;
    }
    catch {
        return null;
    }
}
function isSafeMethod(method) {
    return method === "GET" || method === "HEAD" || method === "OPTIONS";
}
export function createCorsOptions(configuredOrigins = parseCorsOrigins(process.env.UPUSE_CORS_ORIGINS)) {
    const trustedOrigins = configuredOrigins;
    return (req, callback) => {
        const requestOrigin = firstHeaderValue(req.headers.origin);
        const allow = isTrustedOrigin(requestOrigin, req, trustedOrigins);
        callback(allow ? null : new Error("CORS origin not allowed"), {
            origin: allow,
            credentials: true,
        });
    };
}
export function createApiNoStoreMiddleware() {
    return (req, res, next) => {
        if (req.path.startsWith("/api/")) {
            res.setHeader("Cache-Control", "no-store");
            res.setHeader("Pragma", "no-cache");
        }
        next();
    };
}
export function createTrustedOriginMiddleware(configuredOrigins = parseCorsOrigins(process.env.UPUSE_CORS_ORIGINS)) {
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
