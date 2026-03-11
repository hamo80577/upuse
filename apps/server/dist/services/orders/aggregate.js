import { isPastPickup } from "../../utils/time.js";
import { getWithRetry } from "./httpClient.js";
import { createPageLimitError, isVendorIdValidationError } from "./paginationGuards.js";
import { resolveOrdersChunkConcurrency, resolveOrdersMode, resolveOrdersWindowSplitMaxDepth, resolveOrdersWindowSplitMinSpanMs, resolveOrdersWindowUtc, splitUtcWindow, nowUtcIso, } from "./shared.js";
import { BASE, chunk, initMetrics, ORDERS_AGG_MAX_PAGES, ORDERS_API_SAFE_VENDOR_BATCH_LIMIT, } from "./types.js";
async function runWithConcurrency(items, concurrency, worker) {
    if (!items.length)
        return;
    const safeConcurrency = Math.max(1, Math.min(concurrency, items.length));
    let cursor = 0;
    const consume = async () => {
        while (true) {
            const nextIndex = cursor;
            cursor += 1;
            if (nextIndex >= items.length)
                return;
            await worker(items[nextIndex]);
        }
    };
    await Promise.all(Array.from({ length: safeConcurrency }, () => consume()));
}
function stableOrderKey(order) {
    if (order?.id != null)
        return String(order.id);
    if (order?.externalId != null)
        return String(order.externalId);
    return "";
}
export async function fetchOrdersAggregates(params) {
    const pageSize = params.pageSize ?? 500;
    const configuredMaxVendors = Math.max(1, params.maxVendorsPerRequest ?? 50);
    const maxVendors = Math.min(configuredMaxVendors, ORDERS_API_SAFE_VENDOR_BATCH_LIMIT);
    const mode = resolveOrdersMode();
    const { startUtcIso, endUtcIso } = resolveOrdersWindowUtc(mode);
    const baseWindow = { startUtcIso, endUtcIso };
    const nowIso = nowUtcIso();
    const headers = {
        Authorization: `Bearer ${params.token}`,
        Accept: "application/json",
    };
    const maxSplitDepth = resolveOrdersWindowSplitMaxDepth();
    const minSplitSpanMs = resolveOrdersWindowSplitMinSpanMs();
    const chunkConcurrency = resolveOrdersChunkConcurrency();
    const byVendor = new Map();
    const preparingByVendor = new Map();
    const pickerIdsByVendor = new Map();
    for (const vendorId of params.vendorIds)
        byVendor.set(vendorId, initMetrics());
    for (const vendorId of params.vendorIds) {
        preparingByVendor.set(vendorId, { preparingNow: 0, preparingPickersNow: 0 });
        pickerIdsByVendor.set(vendorId, new Set());
    }
    if (!params.vendorIds.length) {
        return { byVendor, preparingByVendor, fetchedAt: nowIso };
    }
    const collectChunkWindow = async (vendorChunk, window, depth, seenOrderIds) => {
        let page = 0;
        try {
            while (true) {
                const qs = new URLSearchParams({
                    global_entity_id: params.globalEntityId,
                    page: String(page),
                    pageSize: String(pageSize),
                    startDate: window.startUtcIso,
                    endDate: window.endUtcIso,
                });
                vendorChunk.forEach((id, idx) => qs.append(`vendor_id[${idx}]`, String(id)));
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
                    const vendorId = order?.vendor?.id;
                    if (!byVendor.has(vendorId))
                        continue;
                    const metrics = byVendor.get(vendorId);
                    metrics.totalToday += 1;
                    if (order?.status === "CANCELLED")
                        metrics.cancelledToday += 1;
                    if (order?.isCompleted) {
                        metrics.doneToday += 1;
                    }
                    else {
                        metrics.activeNow += 1;
                        if (order?.pickupAt && isPastPickup(nowIso, order.pickupAt))
                            metrics.lateNow += 1;
                        if (order?.status === "UNASSIGNED" || order?.shopper == null) {
                            metrics.unassignedNow += 1;
                        }
                        else {
                            const preparation = preparingByVendor.get(vendorId);
                            if (preparation) {
                                preparation.preparingNow += 1;
                                const shopperId = typeof order?.shopper?.id === "number" ? order.shopper.id : null;
                                if (shopperId != null) {
                                    const pickerIds = pickerIdsByVendor.get(vendorId);
                                    pickerIds?.add(shopperId);
                                    preparation.preparingPickersNow = pickerIds?.size ?? preparation.preparingPickersNow;
                                }
                            }
                        }
                    }
                }
                if (items.length < pageSize)
                    break;
                if (page + 1 >= ORDERS_AGG_MAX_PAGES) {
                    const splitWindows = depth < maxSplitDepth
                        ? splitUtcWindow(window, minSplitSpanMs)
                        : null;
                    if (splitWindows) {
                        await collectChunkWindow(vendorChunk, splitWindows[0], depth + 1, seenOrderIds);
                        await collectChunkWindow(vendorChunk, splitWindows[1], depth + 1, seenOrderIds);
                        return;
                    }
                    throw createPageLimitError({
                        scope: "orders_aggregate",
                        globalEntityId: params.globalEntityId,
                        page,
                        vendorChunk,
                        windowStartUtc: window.startUtcIso,
                        windowEndUtc: window.endUtcIso,
                        splitDepth: depth,
                    });
                }
                page += 1;
            }
        }
        catch (error) {
            if (vendorChunk.length > 1 && isVendorIdValidationError(error)) {
                const midpoint = Math.ceil(vendorChunk.length / 2);
                await collectChunkWindow(vendorChunk.slice(0, midpoint), window, depth, seenOrderIds);
                await collectChunkWindow(vendorChunk.slice(midpoint), window, depth, seenOrderIds);
                return;
            }
            throw error;
        }
    };
    const vendorChunks = chunk(params.vendorIds, maxVendors);
    await runWithConcurrency(vendorChunks, chunkConcurrency, async (vendorChunk) => {
        const seenOrderIds = new Set();
        await collectChunkWindow(vendorChunk, baseWindow, 0, seenOrderIds);
    });
    return { byVendor, preparingByVendor, fetchedAt: nowIso };
}
