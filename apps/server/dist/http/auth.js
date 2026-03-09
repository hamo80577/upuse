import { getSessionUserByToken } from "../services/authStore.js";
import { readAuthSessionToken } from "./sessionCookie.js";
const roleCapabilities = {
    admin: new Set([
        "manage_users",
        "manage_monitor",
        "refresh_monitor_orders",
        "manage_branch_mappings",
        "delete_branch_mappings",
        "lookup_branch_vendors",
        "manage_settings",
        "manage_settings_tokens",
        "test_settings_tokens",
        "clear_logs",
    ]),
    user: new Set([
        "manage_monitor",
        "manage_branch_mappings",
        "lookup_branch_vendors",
        "manage_settings_tokens",
        "test_settings_tokens",
    ]),
};
function isPublicApiPath(path) {
    return path === "/api/health" || path === "/api/auth/login";
}
export function hasCapability(role, capability) {
    if (!role)
        return false;
    return roleCapabilities[role]?.has(capability) ?? false;
}
export function createSessionAuthMiddleware() {
    return (req, _res, next) => {
        if (!req.path.startsWith("/api/")) {
            next();
            return;
        }
        const sessionToken = readAuthSessionToken(req);
        if (!sessionToken) {
            next();
            return;
        }
        const auth = getSessionUserByToken(sessionToken);
        if (auth) {
            req.authUser = auth.user;
            req.authSessionToken = sessionToken;
        }
        next();
    };
}
export function requireAuthenticatedApi() {
    return (req, res, next) => {
        if (!req.path.startsWith("/api/") || req.method === "OPTIONS" || isPublicApiPath(req.path)) {
            next();
            return;
        }
        if (req.authUser) {
            next();
            return;
        }
        res.status(401).json({
            ok: false,
            message: "Unauthorized",
        });
    };
}
export function requireAdminRole() {
    return requireCapability("manage_users");
}
export function requireCapability(capability) {
    return (req, res, next) => {
        if (hasCapability(req.authUser?.role, capability)) {
            next();
            return;
        }
        res.status(403).json({
            ok: false,
            message: "Forbidden",
        });
    };
}
