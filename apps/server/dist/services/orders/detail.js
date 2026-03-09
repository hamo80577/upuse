import { DateTime } from "luxon";
import { cairoDayWindowUtc, isPastPickup } from "../../utils/time.js";
import { getWithRetry } from "./httpClient.js";
import { createPageLimitError } from "./paginationGuards.js";
import { getDetailCacheKey, nowUtcIso, resolveBranchDetailCacheTtlSeconds, resolveOrdersWindowSplitMaxDepth, resolveOrdersWindowSplitMinSpanMs, splitUtcWindow, toLiveOrder, } from "./shared.js";
import { BASE, BRANCH_DETAIL_MAX_PAGES, initMetrics } from "./types.js";
const detailCache = new Map();
function stableOrderKey(order) {
    if (order?.id != null)
        return String(order.id);
    if (order?.externalId != null)
        return String(order.externalId);
    return "";
}
export async function fetchVendorOrdersDetail(params) {
    const cacheTtlSeconds = resolveBranchDetailCacheTtlSeconds();
    const cacheKey = getDetailCacheKey(params.globalEntityId, params.vendorId);
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
                isCompleted: "false",
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
                if (order?.isCompleted) {
                    continue;
                }
                metrics.totalToday += 1;
                metrics.activeNow += 1;
                if (order?.pickupAt && isPastPickup(nowIso, order.pickupAt))
                    metrics.lateNow += 1;
                if (order?.status === "UNASSIGNED" || order?.shopper == null)
                    metrics.unassignedNow += 1;
                const liveOrder = toLiveOrder(order, nowIso);
                if (liveOrder.isUnassigned) {
                    unassignedOrders.push(liveOrder);
                }
                else {
                    preparingOrders.push(liveOrder);
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
    };
    if (cacheTtlSeconds > 0) {
        detailCache.set(cacheKey, {
            expiresAtMs: Date.now() + cacheTtlSeconds * 1000,
            value: result,
        });
    }
    return result;
}
