import axios from "axios";
import { z } from "zod";
const READ_BASE = "https://vendor-api-eg.me.restaurant-partners.com";
const WRITE_BASE = "https://vss.me.restaurant-partners.com";
const FALLBACK_STATUS_URL = `${WRITE_BASE}/api/v1/vendors/status`;
const AvailabilityRecordSchema = z.object({
    platformKey: z.string().min(1),
    changeable: z.boolean(),
    availabilityState: z.enum(["OPEN", "CLOSED_UNTIL", "CLOSED", "UNKNOWN"]),
    platformRestaurantId: z.string().min(1),
}).passthrough();
const FallbackAvailabilityRootSchema = z.object({
    vendors: z.record(z.unknown()),
});
const FallbackVendorStatusSchema = z.object({
    platformVendorId: z.string().min(1),
    changeable: z.boolean().optional(),
    nextOpeningAt: z.string().optional(),
    endTime: z.string().optional(),
    adjustmentMinutes: z.number().optional(),
}).passthrough();
function createMalformedAvailabilityPayloadError(message) {
    const error = new Error(`Availability API returned malformed payload: ${message}`);
    error.status = 502;
    return error;
}
function normalizeAvailabilityRecord(value) {
    return {
        platformKey: value.platformKey,
        changeable: value.changeable,
        availabilityState: value.availabilityState,
        platformRestaurantId: value.platformRestaurantId,
        currentSlotEndAt: typeof value.currentSlotEndAt === "string" ? value.currentSlotEndAt : undefined,
        closedUntil: typeof value.closedUntil === "string" ? value.closedUntil : undefined,
        closedReason: typeof value.closedReason === "string" ? value.closedReason : undefined,
        modifiedBy: typeof value.modifiedBy === "string" ? value.modifiedBy : undefined,
        preptimeAdjustment: value.preptimeAdjustment &&
            typeof value.preptimeAdjustment === "object" &&
            typeof value.preptimeAdjustment.adjustmentMinutes === "number" &&
            typeof value.preptimeAdjustment.interval?.startTime === "string" &&
            typeof value.preptimeAdjustment.interval?.endTime === "string"
            ? {
                adjustmentMinutes: value.preptimeAdjustment.adjustmentMinutes,
                interval: {
                    startTime: value.preptimeAdjustment.interval.startTime,
                    endTime: value.preptimeAdjustment.interval.endTime,
                },
            }
            : undefined,
    };
}
function normalizeExpectedVendorIds(expectedVendorIds) {
    if (!expectedVendorIds)
        return [];
    const normalized = new Set();
    for (const vendorId of expectedVendorIds) {
        const value = String(vendorId ?? "").trim();
        if (value) {
            normalized.add(value);
        }
    }
    return Array.from(normalized);
}
function normalizeAvailabilityPayload(payload) {
    if (!Array.isArray(payload)) {
        throw createMalformedAvailabilityPayloadError("expected an array response");
    }
    return payload.map((item, index) => {
        const parsed = AvailabilityRecordSchema.safeParse(item);
        if (!parsed.success) {
            const issue = parsed.error.issues[0];
            const path = issue?.path?.length ? issue.path.join(".") : "record";
            throw createMalformedAvailabilityPayloadError(`item ${index} ${path}: ${issue?.message ?? "invalid shape"}`);
        }
        return normalizeAvailabilityRecord(parsed.data);
    });
}
function collectFallbackVendorStatusGroups(node, path = []) {
    if (!node || typeof node !== "object" || Array.isArray(node)) {
        return [];
    }
    const groups = [];
    const entries = Object.entries(node);
    for (const [key, value] of entries) {
        if (key === "vendorStatuses") {
            if (!Array.isArray(value)) {
                throw createMalformedAvailabilityPayloadError(`fallback payload ${path.join(".")} vendorStatuses: expected an array`);
            }
            groups.push({ path, items: value });
            continue;
        }
        groups.push(...collectFallbackVendorStatusGroups(value, [...path, key]));
    }
    return groups;
}
function mapFallbackPathToAvailabilityState(path) {
    const normalizedPath = path.map((segment) => segment.toLowerCase());
    if (normalizedPath.includes("temporarilyclosed")) {
        return "CLOSED_UNTIL";
    }
    if (normalizedPath.includes("offhours")) {
        return "CLOSED";
    }
    if (normalizedPath.includes("closed")) {
        return "CLOSED";
    }
    if (normalizedPath.includes("open")) {
        return "OPEN";
    }
    return "UNKNOWN";
}
function normalizeFallbackAvailabilityPayload(payload) {
    const parsedRoot = FallbackAvailabilityRootSchema.safeParse(payload);
    if (!parsedRoot.success) {
        throw createMalformedAvailabilityPayloadError("fallback payload expected an object with vendors");
    }
    const groups = collectFallbackVendorStatusGroups(parsedRoot.data.vendors, ["vendors"]);
    const records = new Map();
    for (const group of groups) {
        const availabilityState = mapFallbackPathToAvailabilityState(group.path);
        for (const [index, item] of group.items.entries()) {
            const parsedItem = FallbackVendorStatusSchema.safeParse(item);
            if (!parsedItem.success) {
                const issue = parsedItem.error.issues[0];
                const issuePath = issue?.path?.length ? issue.path.join(".") : "record";
                throw createMalformedAvailabilityPayloadError(`fallback payload ${group.path.join(".")} item ${index} ${issuePath}: ${issue?.message ?? "invalid shape"}`);
            }
            const value = parsedItem.data;
            records.set(value.platformVendorId, {
                platformKey: "vss_vendor_status",
                changeable: value.changeable ?? false,
                availabilityState,
                platformRestaurantId: value.platformVendorId,
                currentSlotEndAt: typeof value.endTime === "string" ? value.endTime : undefined,
                closedUntil: typeof value.nextOpeningAt === "string" ? value.nextOpeningAt : undefined,
            });
        }
    }
    return Array.from(records.values());
}
export function isRetryableAvailabilityRequestError(error) {
    const status = typeof error?.response?.status === "number" ? error.response.status : null;
    if (status === 408 || status === 409 || status === 425 || status === 429) {
        return true;
    }
    if (typeof status === "number" && status >= 500) {
        return true;
    }
    const code = typeof error?.code === "string" ? error.code.toUpperCase() : "";
    if ([
        "ECONNABORTED",
        "ETIMEDOUT",
        "ECONNRESET",
        "EAI_AGAIN",
        "ENOTFOUND",
        "ERR_NETWORK",
        "ERR_SOCKET_CONNECTION_TIMEOUT",
    ].includes(code)) {
        return true;
    }
    const message = typeof error?.message === "string" ? error.message.toLowerCase() : "";
    return message.includes("timeout") || message.includes("socket hang up") || message.includes("network error");
}
async function getWithRetry(url, headers, retries = 2) {
    let lastErr;
    for (let i = 0; i <= retries; i += 1) {
        try {
            return await axios.get(url, { headers, timeout: 15000 });
        }
        catch (error) {
            lastErr = error;
            const backoff = 400 * Math.pow(2, i);
            if (i < retries && isRetryableAvailabilityRequestError(error)) {
                await new Promise((r) => setTimeout(r, backoff));
                continue;
            }
            break;
        }
    }
    throw lastErr;
}
async function putWithRetry(url, payload, headers, retries = 1) {
    let lastErr;
    for (let i = 0; i <= retries; i += 1) {
        try {
            return await axios.put(url, payload, { headers, timeout: 15000 });
        }
        catch (error) {
            lastErr = error;
            const backoff = 400 * Math.pow(2, i);
            if (i < retries && isRetryableAvailabilityRequestError(error)) {
                await new Promise((r) => setTimeout(r, backoff));
                continue;
            }
            break;
        }
    }
    throw lastErr;
}
async function fetchFallbackAvailabilities(token, expectedVendorIds) {
    const headers = {
        Authorization: `Bearer ${token}`,
        Accept: "application/json, text/plain, */*",
        Origin: "https://partner-app.talabat.com",
        Referer: "https://partner-app.talabat.com/",
    };
    const res = await getWithRetry(FALLBACK_STATUS_URL, headers, 1);
    const fallbackRows = normalizeFallbackAvailabilityPayload(res.data);
    if (!expectedVendorIds.length) {
        return fallbackRows;
    }
    const missingVendorIds = new Set(expectedVendorIds);
    return fallbackRows.filter((row) => missingVendorIds.has(row.platformRestaurantId));
}
export async function fetchAvailabilities(token, options = {}) {
    const url = `${READ_BASE}/api/1/platforms/restaurants/availabilities`;
    const headers = { Authorization: `Bearer ${token}`, Accept: "application/json" };
    const res = await getWithRetry(url, headers, 2);
    const primaryRows = normalizeAvailabilityPayload(res.data);
    const expectedVendorIds = normalizeExpectedVendorIds(options.expectedVendorIds);
    if (!expectedVendorIds.length) {
        return primaryRows;
    }
    const merged = new Map(primaryRows.map((row) => [row.platformRestaurantId, row]));
    const missingVendorIds = expectedVendorIds.filter((vendorId) => !merged.has(vendorId));
    if (!missingVendorIds.length) {
        return primaryRows;
    }
    try {
        const fallbackRows = await fetchFallbackAvailabilities(token, missingVendorIds);
        for (const row of fallbackRows) {
            if (!merged.has(row.platformRestaurantId)) {
                merged.set(row.platformRestaurantId, row);
            }
        }
    }
    catch {
        // The fallback endpoint is supplementary; primary data remains authoritative.
    }
    return Array.from(merged.values());
}
export async function setAvailability(params) {
    const url = `${WRITE_BASE}/api/v2/globalEntities/${params.globalEntityId}/vendors/${params.availabilityVendorId}/availability`;
    const headers = { Authorization: `Bearer ${params.token}`, "Content-Type": "application/json", Accept: "application/json" };
    const payload = params.state === "OPEN"
        ? { availabilityState: "OPEN" }
        : { availabilityState: "TEMPORARY_CLOSURE", durationMinutes: params.durationMinutes ?? 30 };
    const res = await putWithRetry(url, payload, headers, 1);
    if (res.data == null) {
        return {};
    }
    if (typeof res.data !== "object" || Array.isArray(res.data)) {
        throw createMalformedAvailabilityPayloadError("expected an object response from availability mutation");
    }
    return res.data;
}
