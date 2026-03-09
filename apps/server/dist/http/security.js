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
export function resolveRequestOrigin(req) {
    const forwardedProto = firstHeaderValue(req.headers["x-forwarded-proto"]);
    const forwardedHost = firstHeaderValue(req.headers["x-forwarded-host"]);
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
export function createCorsOptions() {
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
