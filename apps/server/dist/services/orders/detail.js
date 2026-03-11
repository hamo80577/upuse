import { DateTime } from "luxon";
import { cairoDayWindowUtc, isPastPickup } from "../../utils/time.js";
import { getWithRetry } from "./httpClient.js";
import { createPageLimitError } from "./paginationGuards.js";
import { getDetailCacheKey, nowUtcIso, resolveBranchDetailCacheTtlSeconds, resolveOrdersWindowSplitMaxDepth, resolveOrdersWindowSplitMinSpanMs, splitUtcWindow, toLiveOrder, } from "./shared.js";
import { BASE, BRANCH_DETAIL_MAX_PAGES, initMetrics } from "./types.js";
const detailCache = new Map();
const PICKER_LAST_HOUR_WINDOW_MS = 60 * 60 * 1000;
function resolveShopperId(order) {
    return typeof order?.shopper?.id === "number" && Number.isFinite(order.shopper.id)
        ? order.shopper.id
        : null;
}
function resolveShopperFirstName(order, shopperId) {
    return typeof order?.shopper?.firstName === "string" && order.shopper.firstName.trim().length
        ? order.shopper.firstName.trim()
        : `Picker ${shopperId}`;
}
function toValidTimeMs(iso) {
    if (!iso)
        return Number.NaN;
    const value = new Date(iso).getTime();
    return Number.isFinite(value) ? value : Number.NaN;
}
function updatePickerPickupBounds(picker, pickupAt) {
    if (!pickupAt)
        return;
    const pickupAtMs = toValidTimeMs(pickupAt);
    if (!Number.isFinite(pickupAtMs))
        return;
    const firstPickupAtMs = toValidTimeMs(picker.firstPickupAt);
    if (!Number.isFinite(firstPickupAtMs) || pickupAtMs < firstPickupAtMs) {
        picker.firstPickupAt = pickupAt;
    }
    const lastPickupAtMs = toValidTimeMs(picker.lastPickupAt);
    if (!Number.isFinite(lastPickupAtMs) || pickupAtMs > lastPickupAtMs) {
        picker.lastPickupAt = pickupAt;
    }
}
function createEmptyPickersSummary() {
    return {
        todayCount: 0,
        activePreparingCount: 0,
        lastHourCount: 0,
        items: [],
    };
}
function buildPickersSummary(params) {
    const items = params.includeItems
        ? Array.from(params.pickersById.values())
            .sort((left, right) => {
            if (right.ordersToday !== left.ordersToday) {
                return right.ordersToday - left.ordersToday;
            }
            const leftLastPickupAtMs = toValidTimeMs(left.lastPickupAt);
            const rightLastPickupAtMs = toValidTimeMs(right.lastPickupAt);
            if (Number.isFinite(leftLastPickupAtMs) || Number.isFinite(rightLastPickupAtMs)) {
                if (!Number.isFinite(leftLastPickupAtMs))
                    return 1;
                if (!Number.isFinite(rightLastPickupAtMs))
                    return -1;
                if (rightLastPickupAtMs !== leftLastPickupAtMs) {
                    return rightLastPickupAtMs - leftLastPickupAtMs;
                }
            }
            return left.shopperFirstName.localeCompare(right.shopperFirstName, "en", { sensitivity: "base" });
        })
            .map((picker) => ({
            shopperId: picker.shopperId,
            shopperFirstName: picker.shopperFirstName,
            ordersToday: picker.ordersToday,
            firstPickupAt: picker.firstPickupAt,
            lastPickupAt: picker.lastPickupAt,
            activeLastHour: params.lastHourPickerIds.has(picker.shopperId),
        }))
        : [];
    return {
        todayCount: params.todayPickerIds.size,
        activePreparingCount: params.activePreparingPickerIds.size,
        lastHourCount: params.lastHourPickerIds.size,
        items,
    };
}
function stableOrderKey(order) {
    if (order?.id != null)
        return String(order.id);
    if (order?.externalId != null)
        return String(order.externalId);
    return "";
}
export async function fetchVendorOrdersDetail(params) {
    const cacheTtlSeconds = resolveBranchDetailCacheTtlSeconds();
    const includeMetrics = params.includeMetrics ?? true;
    const includeOrders = params.includeOrders ?? true;
    const includePickers = params.includePickers ?? true;
    const includePickerItems = includePickers && (params.includePickerItems ?? true);
    const cacheKey = `${getDetailCacheKey(params.globalEntityId, params.vendorId)}::metrics=${includeMetrics ? 1 : 0}|orders=${includeOrders ? 1 : 0}|pickers=${includePickers ? 1 : 0}|pickerItems=${includePickerItems ? 1 : 0}`;
    const cached = detailCache.get(cacheKey);
    if (cacheTtlSeconds > 0 && cached && cached.expiresAtMs > Date.now()) {
        return cached.value;
    }
    const pageSize = params.pageSize ?? 20;
    const { startUtcIso, endUtcIso } = cairoDayWindowUtc(DateTime.utc());
    const dayWindow = { startUtcIso, endUtcIso };
    const nowIso = nowUtcIso();
    const headers = {
        Authorization: `Bearer ${params.token}`,
        Accept: "application/json",
    };
    const maxSplitDepth = resolveOrdersWindowSplitMaxDepth();
    const minSplitSpanMs = resolveOrdersWindowSplitMinSpanMs();
    const seenOrderIds = new Set();
    const metrics = initMetrics();
    const unassignedOrders = [];
    const preparingOrders = [];
    const pickersById = new Map();
    const todayPickerIds = new Set();
    const activePreparingPickerIds = new Set();
    const lastHourPickerIds = new Set();
    const nowMs = new Date(nowIso).getTime();
    const collectWindow = async (window, depth) => {
        let page = 0;
        while (true) {
            const qs = new URLSearchParams({
                global_entity_id: params.globalEntityId,
                page: String(page),
                pageSize: String(pageSize),
                startDate: window.startUtcIso,
                endDate: window.endUtcIso,
                order: "pickupAt,asc",
            });
            qs.append("vendor_id[0]", String(params.vendorId));
            const url = `${BASE}/orders?${qs.toString()}`;
            const res = await getWithRetry(url, headers, 2);
            const items = res.data?.items ?? [];
            for (const order of items) {
                const orderKey = stableOrderKey(order);
                if (orderKey) {
                    if (seenOrderIds.has(orderKey))
                        continue;
                    seenOrderIds.add(orderKey);
                }
                const liveOrder = includeOrders || includePickers ? toLiveOrder(order, nowIso) : null;
                const isCompleted = Boolean(order?.isCompleted);
                const isUnassigned = liveOrder
                    ? liveOrder.isUnassigned
                    : order?.status === "UNASSIGNED" || order?.shopper == null;
                if (includeMetrics) {
                    metrics.totalToday += 1;
                    if (order?.status === "CANCELLED")
                        metrics.cancelledToday += 1;
                    if (isCompleted) {
                        metrics.doneToday += 1;
                    }
                    else {
                        metrics.activeNow += 1;
                        if (order?.pickupAt && isPastPickup(nowIso, order.pickupAt))
                            metrics.lateNow += 1;
                        if (isUnassigned)
                            metrics.unassignedNow += 1;
                    }
                }
                if (includeOrders && liveOrder && !isCompleted) {
                    if (liveOrder.isUnassigned) {
                        unassignedOrders.push(liveOrder);
                    }
                    else {
                        preparingOrders.push(liveOrder);
                    }
                }
                if (!includePickers) {
                    continue;
                }
                const shopperId = resolveShopperId(order);
                if (shopperId == null) {
                    continue;
                }
                todayPickerIds.add(shopperId);
                if (includePickerItems) {
                    const currentPicker = pickersById.get(shopperId) ?? {
                        shopperId,
                        shopperFirstName: resolveShopperFirstName(order, shopperId),
                        ordersToday: 0,
                        firstPickupAt: null,
                        lastPickupAt: null,
                    };
                    currentPicker.ordersToday += 1;
                    updatePickerPickupBounds(currentPicker, order?.pickupAt);
                    pickersById.set(shopperId, currentPicker);
                }
                if (!isCompleted && !isUnassigned) {
                    activePreparingPickerIds.add(shopperId);
                }
                const pickupAtMs = toValidTimeMs(order?.pickupAt);
                if (Number.isFinite(nowMs) &&
                    Number.isFinite(pickupAtMs) &&
                    pickupAtMs <= nowMs &&
                    pickupAtMs >= nowMs - PICKER_LAST_HOUR_WINDOW_MS) {
                    lastHourPickerIds.add(shopperId);
                }
            }
            if (items.length < pageSize)
                break;
            if (page + 1 >= BRANCH_DETAIL_MAX_PAGES) {
                const splitWindows = depth < maxSplitDepth
                    ? splitUtcWindow(window, minSplitSpanMs)
                    : null;
                if (splitWindows) {
                    await collectWindow(splitWindows[0], depth + 1);
                    await collectWindow(splitWindows[1], depth + 1);
                    return;
                }
                throw createPageLimitError({
                    scope: "branch_detail",
                    globalEntityId: params.globalEntityId,
                    page,
                    vendorId: params.vendorId,
                    windowStartUtc: window.startUtcIso,
                    windowEndUtc: window.endUtcIso,
                    splitDepth: depth,
                });
            }
            page += 1;
        }
    };
    await collectWindow(dayWindow, 0);
    unassignedOrders.sort((a, b) => {
        const t1 = a.placedAt ? new Date(a.placedAt).getTime() : 0;
        const t2 = b.placedAt ? new Date(b.placedAt).getTime() : 0;
        return t1 - t2;
    });
    preparingOrders.sort((a, b) => {
        const t1 = a.pickupAt ? new Date(a.pickupAt).getTime() : Number.MAX_SAFE_INTEGER;
        const t2 = b.pickupAt ? new Date(b.pickupAt).getTime() : Number.MAX_SAFE_INTEGER;
        return t1 - t2;
    });
    const result = {
        metrics,
        fetchedAt: nowIso,
        unassignedOrders,
        preparingOrders,
        pickers: includePickers && (todayPickerIds.size || activePreparingPickerIds.size || lastHourPickerIds.size || pickersById.size)
            ? buildPickersSummary({
                pickersById,
                todayPickerIds,
                activePreparingPickerIds,
                lastHourPickerIds,
                includeItems: includePickerItems,
            })
            : createEmptyPickersSummary(),
    };
    if (cacheTtlSeconds > 0) {
        detailCache.set(cacheKey, {
            expiresAtMs: Date.now() + cacheTtlSeconds * 1000,
            value: result,
        });
    }
    return result;
}
export async function fetchVendorPickersSummary(params) {
    const result = await fetchVendorOrdersDetail({
        ...params,
        includeMetrics: false,
        includeOrders: false,
        includePickers: true,
        includePickerItems: true,
    });
    return result.pickers;
}
