import axios from "axios";
import { z } from "zod";
import { GlobalEntityIdSchema } from "../config/globalEntityId.js";
const READ_BASE = "https://vendor-api-eg.me.restaurant-partners.com";
const WRITE_BASE = "https://vss.me.restaurant-partners.com";
const AvailabilityRecordSchema = z.object({
    platformKey: z.string().min(1),
    changeable: z.boolean(),
    availabilityState: z.enum(["OPEN", "CLOSED_UNTIL", "CLOSED"]),
    platformRestaurantId: z.string().min(1),
    globalEntityId: GlobalEntityIdSchema,
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
        globalEntityId: value.globalEntityId,
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
export async function fetchAvailabilities(token) {
    const url = `${READ_BASE}/api/1/platforms/restaurants/availabilities`;
    const headers = { Authorization: `Bearer ${token}`, Accept: "application/json" };
    const res = await getWithRetry(url, headers, 2);
    return normalizeAvailabilityPayload(res.data);
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
