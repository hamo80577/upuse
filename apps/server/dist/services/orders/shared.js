import { DateTime } from "luxon";
import { cairoDayWindowUtc, isPastPickup, nowUtcIso } from "../../utils/time.js";
export function resolveOrdersMode() {
    return process.env.UPUSE_ORDERS_MODE === "incremental" ? "incremental" : "fullday";
}
export function resolveOrdersHistorySyncSeconds() {
    const raw = Number(process.env.UPUSE_ORDERS_HISTORY_SYNC_SECONDS ?? "120");
    if (!Number.isFinite(raw))
        return 120;
    return Math.max(30, Math.min(3600, Math.floor(raw)));
}
export function resolveOrdersRepairSweepSeconds() {
    const raw = Number(process.env.UPUSE_ORDERS_REPAIR_SWEEP_SECONDS ?? "1800");
    if (!Number.isFinite(raw))
        return 1800;
    return Math.max(120, Math.min(86_400, Math.floor(raw)));
}
export function resolveOrdersStaleMultiplier() {
    const raw = Number(process.env.UPUSE_ORDERS_STALE_MULTIPLIER ?? "2");
    if (!Number.isFinite(raw))
        return 2;
    return Math.max(1, Math.min(10, Math.floor(raw)));
}
export function resolveBranchDetailCacheTtlSeconds() {
    const raw = Number(process.env.UPUSE_BRANCH_DETAIL_CACHE_TTL_SECONDS ?? "15");
    if (!Number.isFinite(raw) || raw <= 0)
        return 0;
    return Math.floor(raw);
}
export function resolveOrdersChunkConcurrency() {
    const raw = Number(process.env.UPUSE_ORDERS_CHUNK_CONCURRENCY ?? "3");
    if (!Number.isFinite(raw))
        return 3;
    return Math.max(1, Math.min(8, Math.floor(raw)));
}
export function resolveOrdersWindowSplitMaxDepth() {
    const raw = Number(process.env.UPUSE_ORDERS_WINDOW_SPLIT_MAX_DEPTH ?? "8");
    if (!Number.isFinite(raw))
        return 8;
    return Math.max(0, Math.min(16, Math.floor(raw)));
}
export function resolveOrdersWindowSplitMinSpanMs() {
    const raw = Number(process.env.UPUSE_ORDERS_WINDOW_MIN_SPAN_MS ?? `${5 * 60 * 1000}`);
    if (!Number.isFinite(raw))
        return 5 * 60 * 1000;
    return Math.max(1000, Math.min(12 * 60 * 60 * 1000, Math.floor(raw)));
}
export function resolveOrdersWindowUtc(mode) {
    // The monitor sync now uses local mirror incremental scheduling directly.
    // Keep the legacy window helper stable for detail and compatibility paths.
    void mode;
    return cairoDayWindowUtc(DateTime.utc());
}
export function splitUtcWindow(window, minSpanMs) {
    const start = DateTime.fromISO(window.startUtcIso, { zone: "utc" });
    const end = DateTime.fromISO(window.endUtcIso, { zone: "utc" });
    if (!start.isValid || !end.isValid)
        return null;
    const spanMs = end.toMillis() - start.toMillis();
    if (spanMs <= minSpanMs)
        return null;
    const midpointMs = Math.floor((start.toMillis() + end.toMillis()) / 2);
    const rightStartMs = midpointMs + 1;
    if (rightStartMs >= end.toMillis())
        return null;
    const leftEnd = DateTime.fromMillis(midpointMs, { zone: "utc" });
    const rightStart = DateTime.fromMillis(rightStartMs, { zone: "utc" });
    return [
        {
            startUtcIso: start.toISO({ suppressMilliseconds: false }),
            endUtcIso: leftEnd.toISO({ suppressMilliseconds: false }),
        },
        {
            startUtcIso: rightStart.toISO({ suppressMilliseconds: false }),
            endUtcIso: end.toISO({ suppressMilliseconds: false }),
        },
    ];
}
export function getDetailCacheKey(globalEntityId, vendorId) {
    const dayKey = DateTime.now().setZone("Africa/Cairo").toFormat("yyyy-LL-dd");
    return `${globalEntityId}::${vendorId}::${dayKey}`;
}
export function toLiveOrder(order, nowIso) {
    const isUnassigned = order?.status === "UNASSIGNED" || order?.shopper == null;
    const isLate = order?.pickupAt ? isPastPickup(nowIso, order.pickupAt) : false;
    const shopperId = typeof order?.shopper?.id === "number" && Number.isFinite(order.shopper.id)
        ? order.shopper.id
        : undefined;
    const shopperFirstName = typeof order?.shopper?.firstName === "string" && order.shopper.firstName.trim().length
        ? order.shopper.firstName.trim()
        : undefined;
    return {
        id: String(order?.id ?? ""),
        externalId: String(order?.externalId ?? order?.shortCode ?? order?.id ?? ""),
        status: String(order?.status ?? "UNKNOWN"),
        placedAt: order?.placedAt,
        pickupAt: order?.pickupAt,
        customerFirstName: order?.customerFirstName,
        shopperId,
        shopperFirstName,
        isUnassigned,
        isLate,
    };
}
export { nowUtcIso };
