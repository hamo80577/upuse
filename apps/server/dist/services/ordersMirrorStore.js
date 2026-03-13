import { DateTime } from "luxon";
import { db } from "../config/db.js";
import { FIXED_GLOBAL_ENTITY_ID } from "../config/constants.js";
import { cairoDayWindowUtc, isPastPickup, nowUtcIso } from "../utils/time.js";
import { createOrdersPollingRequests } from "./monitorOrdersPolling.js";
import { getWithRetry, isRetryableOrdersRequestError } from "./orders/httpClient.js";
import { createPageLimitError, isVendorIdValidationError } from "./orders/paginationGuards.js";
import { splitUtcWindow, resolveOrdersHistorySyncSeconds, resolveOrdersRepairSweepSeconds, resolveOrdersWindowSplitMaxDepth, resolveOrdersWindowSplitMinSpanMs, } from "./orders/shared.js";
import { BASE, BRANCH_DETAIL_MAX_PAGES, ORDERS_API_SAFE_VENDOR_BATCH_LIMIT, chunk } from "./orders/types.js";
const ACTIVE_SYNC_PAGE_SIZE = 500;
const HISTORY_SYNC_PAGE_SIZE = 500;
const BOOTSTRAP_SYNC_PAGE_SIZE = 500;
const HISTORY_OVERLAP_MS = 10 * 60 * 1000;
function getCairoDayKey(date = DateTime.utc()) {
    return date.setZone("Africa/Cairo").toFormat("yyyy-LL-dd");
}
function getPreviousCairoDayKey(dayKey) {
    const day = DateTime.fromFormat(dayKey, "yyyy-LL-dd", { zone: "Africa/Cairo" });
    return day.isValid ? day.minus({ days: 1 }).toFormat("yyyy-LL-dd") : dayKey;
}
function getDayWindow(dayKey = getCairoDayKey()) {
    const cairoStart = DateTime.fromFormat(dayKey, "yyyy-LL-dd", { zone: "Africa/Cairo" }).startOf("day");
    if (!cairoStart.isValid) {
        return cairoDayWindowUtc(DateTime.utc());
    }
    return {
        startUtcIso: cairoStart.toUTC().toISO({ suppressMilliseconds: false }),
        endUtcIso: cairoStart.endOf("day").toUTC().toISO({ suppressMilliseconds: false }),
    };
}
function getSyncWindow(dayKey = getCairoDayKey(), endIso = nowUtcIso()) {
    const fullDay = getDayWindow(dayKey);
    const end = DateTime.fromISO(endIso, { zone: "utc" });
    const boundedEnd = end.isValid
        ? Math.min(end.toMillis(), DateTime.fromISO(fullDay.endUtcIso, { zone: "utc" }).toMillis())
        : DateTime.fromISO(fullDay.endUtcIso, { zone: "utc" }).toMillis();
    return {
        startUtcIso: fullDay.startUtcIso,
        endUtcIso: new Date(boundedEnd).toISOString(),
    };
}
function stableOrderKey(order) {
    if (order?.id != null)
        return String(order.id);
    if (order?.externalId != null)
        return String(order.externalId);
    if (order?.shortCode != null)
        return String(order.shortCode);
    return "";
}
function toIsoOrNull(value) {
    return typeof value === "string" && value.trim().length ? value : null;
}
function resolveShopperId(order) {
    return typeof order?.shopper?.id === "number" && Number.isFinite(order.shopper.id)
        ? order.shopper.id
        : null;
}
function resolveShopperFirstName(order) {
    return typeof order?.shopper?.firstName === "string" && order.shopper.firstName.trim().length
        ? order.shopper.firstName.trim()
        : null;
}
function normalizeMirrorOrder(order, nowIso) {
    const orderId = stableOrderKey(order);
    if (!orderId)
        return null;
    const isCompleted = Boolean(order?.isCompleted);
    const status = String(order?.status ?? "UNKNOWN");
    return {
        orderId,
        externalId: String(order?.externalId ?? order?.shortCode ?? order?.id ?? ""),
        status,
        isCompleted: isCompleted ? 1 : 0,
        isCancelled: status === "CANCELLED" ? 1 : 0,
        isUnassigned: status === "UNASSIGNED" || order?.shopper == null ? 1 : 0,
        placedAt: toIsoOrNull(order?.placedAt),
        pickupAt: toIsoOrNull(order?.pickupAt),
        customerFirstName: typeof order?.customerFirstName === "string" && order.customerFirstName.trim().length
            ? order.customerFirstName.trim()
            : null,
        shopperId: resolveShopperId(order),
        shopperFirstName: resolveShopperFirstName(order),
        isActiveNow: isCompleted ? 0 : 1,
        lastSeenAt: nowIso,
        lastActiveSeenAt: isCompleted ? null : nowIso,
    };
}
function toLiveOrder(row, nowIso) {
    const isUnassigned = row.isUnassigned === 1;
    const isLate = row.pickupAt ? isPastPickup(nowIso, row.pickupAt) : false;
    return {
        id: row.orderId,
        externalId: row.externalId,
        status: row.status,
        placedAt: row.placedAt ?? undefined,
        pickupAt: row.pickupAt ?? undefined,
        customerFirstName: row.customerFirstName ?? undefined,
        shopperId: row.shopperId ?? undefined,
        shopperFirstName: row.shopperFirstName ?? undefined,
        isUnassigned,
        isLate,
    };
}
function toMillis(iso) {
    if (!iso)
        return Number.NaN;
    const value = new Date(iso).getTime();
    return Number.isFinite(value) ? value : Number.NaN;
}
function resolveFetchedAt(state) {
    if (!state)
        return null;
    const candidates = [
        state.lastSuccessfulSyncAt,
        state.lastBootstrapSyncAt,
        state.lastActiveSyncAt,
        state.lastHistorySyncAt,
    ].filter((value) => typeof value === "string" && value.length > 0);
    if (!candidates.length)
        return null;
    return candidates.reduce((latest, current) => (toMillis(current) > toMillis(latest) ? current : latest));
}
function resolveCacheState(state, ordersRefreshSeconds, nowMs = Date.now()) {
    if (!state?.lastBootstrapSyncAt) {
        return "warming";
    }
    const fetchedAt = resolveFetchedAt(state);
    if (!fetchedAt) {
        return "warming";
    }
    const staleAfterMs = Math.max(60_000, ordersRefreshSeconds * 2_000);
    return nowMs - toMillis(fetchedAt) > staleAfterMs ? "stale" : "fresh";
}
function getMirrorState(dayKey, globalEntityId, vendorId) {
    return db.prepare(`
    SELECT
      dayKey,
      globalEntityId,
      vendorId,
      lastBootstrapSyncAt,
      lastActiveSyncAt,
      lastHistorySyncAt,
      lastFullHistorySweepAt,
      lastSuccessfulSyncAt,
      lastHistoryCursorAt,
      consecutiveFailures,
      lastErrorAt,
      lastErrorCode,
      lastErrorMessage,
      staleSince,
      quarantinedUntil
    FROM orders_sync_state
    WHERE dayKey = ? AND globalEntityId = ? AND vendorId = ?
  `).get(dayKey, globalEntityId, vendorId) ?? null;
}
function upsertMirrorState(dayKey, globalEntityId, vendorId, patch) {
    const current = getMirrorState(dayKey, globalEntityId, vendorId) ?? {
        dayKey,
        globalEntityId,
        vendorId,
        lastBootstrapSyncAt: null,
        lastActiveSyncAt: null,
        lastHistorySyncAt: null,
        lastFullHistorySweepAt: null,
        lastSuccessfulSyncAt: null,
        lastHistoryCursorAt: null,
        consecutiveFailures: 0,
        lastErrorAt: null,
        lastErrorCode: null,
        lastErrorMessage: null,
        staleSince: null,
        quarantinedUntil: null,
    };
    const next = {
        ...current,
        ...patch,
        dayKey,
        globalEntityId,
        vendorId,
    };
    db.prepare(`
    INSERT INTO orders_sync_state (
      dayKey,
      globalEntityId,
      vendorId,
      lastBootstrapSyncAt,
      lastActiveSyncAt,
      lastHistorySyncAt,
      lastFullHistorySweepAt,
      lastSuccessfulSyncAt,
      lastHistoryCursorAt,
      consecutiveFailures,
      lastErrorAt,
      lastErrorCode,
      lastErrorMessage,
      staleSince,
      quarantinedUntil
    ) VALUES (
      @dayKey,
      @globalEntityId,
      @vendorId,
      @lastBootstrapSyncAt,
      @lastActiveSyncAt,
      @lastHistorySyncAt,
      @lastFullHistorySweepAt,
      @lastSuccessfulSyncAt,
      @lastHistoryCursorAt,
      @consecutiveFailures,
      @lastErrorAt,
      @lastErrorCode,
      @lastErrorMessage,
      @staleSince,
      @quarantinedUntil
    )
    ON CONFLICT(dayKey, globalEntityId, vendorId) DO UPDATE SET
      lastBootstrapSyncAt = excluded.lastBootstrapSyncAt,
      lastActiveSyncAt = excluded.lastActiveSyncAt,
      lastHistorySyncAt = excluded.lastHistorySyncAt,
      lastFullHistorySweepAt = excluded.lastFullHistorySweepAt,
      lastSuccessfulSyncAt = excluded.lastSuccessfulSyncAt,
      lastHistoryCursorAt = excluded.lastHistoryCursorAt,
      consecutiveFailures = excluded.consecutiveFailures,
      lastErrorAt = excluded.lastErrorAt,
      lastErrorCode = excluded.lastErrorCode,
      lastErrorMessage = excluded.lastErrorMessage,
      staleSince = excluded.staleSince,
      quarantinedUntil = excluded.quarantinedUntil
  `).run(next);
}
function pruneMirrorDays(dayKeysToKeep) {
    const placeholders = dayKeysToKeep.map(() => "?").join(", ");
    db.prepare(`DELETE FROM orders_mirror WHERE dayKey NOT IN (${placeholders})`).run(...dayKeysToKeep);
    db.prepare(`DELETE FROM orders_sync_state WHERE dayKey NOT IN (${placeholders})`).run(...dayKeysToKeep);
}
function summarizeMirrorSyncError(error) {
    const statusCode = typeof error?.response?.status === "number" ? error.response.status : undefined;
    const code = typeof error?.code === "string" ? error.code : undefined;
    const responseMessage = error?.response?.data?.message ||
        error?.response?.data?.error ||
        error?.message ||
        "Orders API request failed";
    return {
        statusCode,
        code,
        message: String(responseMessage),
    };
}
function markVendorSyncSuccess(dayKey, globalEntityId, vendorId, fetchedAt, historyCursorAt) {
    const current = getMirrorState(dayKey, globalEntityId, vendorId);
    upsertMirrorState(dayKey, globalEntityId, vendorId, {
        ...current,
        lastSuccessfulSyncAt: fetchedAt,
        lastHistoryCursorAt: historyCursorAt ?? current?.lastHistoryCursorAt ?? null,
        consecutiveFailures: 0,
        lastErrorAt: null,
        lastErrorCode: null,
        lastErrorMessage: null,
        staleSince: null,
        quarantinedUntil: null,
    });
}
function markVendorSyncFailure(dayKey, globalEntityId, vendorId, error) {
    const current = getMirrorState(dayKey, globalEntityId, vendorId);
    const nowIso = nowUtcIso();
    const normalized = summarizeMirrorSyncError(error);
    upsertMirrorState(dayKey, globalEntityId, vendorId, {
        ...current,
        consecutiveFailures: (current?.consecutiveFailures ?? 0) + 1,
        lastErrorAt: nowIso,
        lastErrorCode: normalized.code ?? (normalized.statusCode != null ? String(normalized.statusCode) : null),
        lastErrorMessage: normalized.message,
        staleSince: current?.staleSince ?? nowIso,
    });
    return normalized;
}
function toVendorGroups(branches, vendorIds) {
    const sourceBranches = vendorIds
        ? branches.filter((branch) => vendorIds.includes(branch.ordersVendorId))
        : branches;
    const requests = createOrdersPollingRequests({
        branches: sourceBranches,
        vendorIds: sourceBranches.map((branch) => branch.ordersVendorId),
    });
    return requests.flatMap((request) => chunk(request.vendorIds, ORDERS_API_SAFE_VENDOR_BATCH_LIMIT).map((vendorChunk) => ({
        globalEntityId: request.globalEntityId,
        vendorIds: vendorChunk,
    })));
}
async function fetchOrdersWindow(params) {
    const headers = {
        Authorization: `Bearer ${params.token}`,
        Accept: "application/json",
    };
    const maxSplitDepth = resolveOrdersWindowSplitMaxDepth();
    const minSplitSpanMs = resolveOrdersWindowSplitMinSpanMs();
    const seenOrderIds = new Set();
    const items = [];
    const collectWindow = async (window, depth) => {
        let page = 0;
        while (true) {
            const qs = new URLSearchParams({
                global_entity_id: params.globalEntityId,
                page: String(page),
                pageSize: String(params.pageSize),
                startDate: window.startUtcIso,
                endDate: window.endUtcIso,
                order: "pickupAt,asc",
            });
            if (typeof params.isCompleted === "boolean") {
                qs.set("isCompleted", params.isCompleted ? "true" : "false");
            }
            params.vendorIds.forEach((vendorId, index) => {
                qs.append(`vendor_id[${index}]`, String(vendorId));
            });
            const res = await getWithRetry(`${BASE}/orders?${qs.toString()}`, headers, 2);
            const pageItems = Array.isArray(res.data?.items) ? res.data.items : [];
            for (const order of pageItems) {
                const orderKey = stableOrderKey(order);
                if (!orderKey)
                    continue;
                if (seenOrderIds.has(orderKey))
                    continue;
                seenOrderIds.add(orderKey);
                items.push(order);
            }
            if (pageItems.length < params.pageSize)
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
                    vendorChunk: params.vendorIds,
                    windowStartUtc: window.startUtcIso,
                    windowEndUtc: window.endUtcIso,
                    splitDepth: depth,
                });
            }
            page += 1;
        }
    };
    await collectWindow(params.window, 0);
    return {
        items,
        fetchedAt: params.nowIso,
    };
}
function upsertMirrorOrders(params) {
    const statement = db.prepare(`
    INSERT INTO orders_mirror (
      dayKey,
      globalEntityId,
      vendorId,
      orderId,
      externalId,
      status,
      isCompleted,
      isCancelled,
      isUnassigned,
      placedAt,
      pickupAt,
      customerFirstName,
      shopperId,
      shopperFirstName,
      isActiveNow,
      lastSeenAt,
      lastActiveSeenAt
    ) VALUES (
      @dayKey,
      @globalEntityId,
      @vendorId,
      @orderId,
      @externalId,
      @status,
      @isCompleted,
      @isCancelled,
      @isUnassigned,
      @placedAt,
      @pickupAt,
      @customerFirstName,
      @shopperId,
      @shopperFirstName,
      @isActiveNow,
      @lastSeenAt,
      @lastActiveSeenAt
    )
    ON CONFLICT(dayKey, globalEntityId, vendorId, orderId) DO UPDATE SET
      externalId = excluded.externalId,
      status = excluded.status,
      isCompleted = excluded.isCompleted,
      isCancelled = excluded.isCancelled,
      isUnassigned = excluded.isUnassigned,
      placedAt = excluded.placedAt,
      pickupAt = excluded.pickupAt,
      customerFirstName = excluded.customerFirstName,
      shopperId = excluded.shopperId,
      shopperFirstName = excluded.shopperFirstName,
      isActiveNow = CASE
        WHEN excluded.isCompleted = 1 THEN 0
        WHEN @activeOverwrite = 1 THEN excluded.isActiveNow
        ELSE orders_mirror.isActiveNow
      END,
      lastSeenAt = excluded.lastSeenAt,
      lastActiveSeenAt = CASE
        WHEN excluded.isCompleted = 1 THEN orders_mirror.lastActiveSeenAt
        WHEN @activeOverwrite = 1 AND excluded.isActiveNow = 1 THEN excluded.lastActiveSeenAt
        ELSE COALESCE(orders_mirror.lastActiveSeenAt, excluded.lastActiveSeenAt)
      END
  `);
    const run = db.transaction(() => {
        for (const row of params.rows) {
            if (!row)
                continue;
            statement.run({
                ...row,
                dayKey: params.dayKey,
                globalEntityId: params.globalEntityId,
                activeOverwrite: params.activeOverwrite ? 1 : 0,
            });
        }
    });
    run();
}
function markMissingActiveOrdersInactive(params) {
    if (!params.activeOrderIds.length) {
        db.prepare(`
      UPDATE orders_mirror
      SET isActiveNow = 0
      WHERE dayKey = ? AND globalEntityId = ? AND vendorId = ? AND isActiveNow = 1
    `).run(params.dayKey, params.globalEntityId, params.vendorId);
        return;
    }
    const placeholders = params.activeOrderIds.map(() => "?").join(", ");
    db.prepare(`
    UPDATE orders_mirror
    SET isActiveNow = 0
    WHERE dayKey = ? AND globalEntityId = ? AND vendorId = ? AND isActiveNow = 1 AND orderId NOT IN (${placeholders})
  `).run(params.dayKey, params.globalEntityId, params.vendorId, ...params.activeOrderIds);
}
function buildMirrorVendors(branches) {
    const byKey = new Map();
    for (const branch of branches.filter((item) => item.enabled)) {
        const globalEntityId = FIXED_GLOBAL_ENTITY_ID;
        const key = `${globalEntityId}::${branch.ordersVendorId}`;
        if (!byKey.has(key)) {
            byKey.set(key, {
                vendorId: branch.ordersVendorId,
                globalEntityId,
            });
        }
    }
    return Array.from(byKey.values());
}
function shouldSplitVendorGroupOnError(error) {
    return isRetryableOrdersRequestError(error) || isVendorIdValidationError(error);
}
async function runVendorGroupsIsolated(groups, worker, onFailure) {
    const consume = async (group) => {
        try {
            await worker(group);
        }
        catch (error) {
            if (group.vendorIds.length > 1 && shouldSplitVendorGroupOnError(error)) {
                const midpoint = Math.ceil(group.vendorIds.length / 2);
                await consume({
                    globalEntityId: group.globalEntityId,
                    vendorIds: group.vendorIds.slice(0, midpoint),
                });
                await consume({
                    globalEntityId: group.globalEntityId,
                    vendorIds: group.vendorIds.slice(midpoint),
                });
                return;
            }
            await onFailure(group, error);
        }
    };
    for (const group of groups) {
        await consume(group);
    }
}
export async function ensureOrdersMirrorBootstrap(params) {
    const result = {
        successfulVendorIds: new Set(),
        updatedVendorIds: new Set(),
        failures: [],
    };
    const dayKey = params.dayKey ?? getCairoDayKey();
    pruneMirrorDays([dayKey, getPreviousCairoDayKey(dayKey)]);
    const mirrorVendors = buildMirrorVendors(params.branches);
    const missingVendors = mirrorVendors.filter((vendor) => !getMirrorState(dayKey, vendor.globalEntityId, vendor.vendorId)?.lastBootstrapSyncAt);
    if (!missingVendors.length)
        return result;
    const vendorIdSet = new Set(missingVendors.map((item) => item.vendorId));
    const vendorGroups = toVendorGroups(params.branches, Array.from(vendorIdSet));
    const nowIso = nowUtcIso();
    const window = getSyncWindow(dayKey, nowIso);
    await runVendorGroupsIsolated(vendorGroups, async (group) => {
        const res = await fetchOrdersWindow({
            token: params.token,
            globalEntityId: group.globalEntityId,
            vendorIds: group.vendorIds,
            pageSize: BOOTSTRAP_SYNC_PAGE_SIZE,
            window,
            nowIso,
        });
        upsertMirrorOrders({
            dayKey,
            globalEntityId: group.globalEntityId,
            rows: res.items.map((order) => ({
                ...normalizeMirrorOrder(order, nowIso),
                vendorId: Number(order?.vendor?.id ?? 0),
            })).filter(Boolean),
            activeOverwrite: true,
        });
        for (const vendorId of group.vendorIds) {
            upsertMirrorState(dayKey, group.globalEntityId, vendorId, {
                lastBootstrapSyncAt: res.fetchedAt,
                lastHistorySyncAt: res.fetchedAt,
                lastFullHistorySweepAt: res.fetchedAt,
                lastSuccessfulSyncAt: res.fetchedAt,
                lastHistoryCursorAt: window.endUtcIso,
                consecutiveFailures: 0,
                lastErrorAt: null,
                lastErrorCode: null,
                lastErrorMessage: null,
                staleSince: null,
                quarantinedUntil: null,
            });
            result.successfulVendorIds.add(vendorId);
            result.updatedVendorIds.add(vendorId);
        }
    }, async (group, error) => {
        const normalized = summarizeMirrorSyncError(error);
        result.failures.push({
            vendorIds: [...group.vendorIds],
            statusCode: normalized.statusCode,
            message: normalized.message,
        });
        for (const vendorId of group.vendorIds) {
            markVendorSyncFailure(dayKey, group.globalEntityId, vendorId, error);
        }
    });
    return result;
}
export async function syncOrdersMirrorActive(params) {
    const result = {
        successfulVendorIds: new Set(),
        updatedVendorIds: new Set(),
        failures: [],
    };
    const dayKey = params.dayKey ?? getCairoDayKey();
    const branches = params.branches.filter((branch) => branch.enabled);
    if (!branches.length)
        return result;
    pruneMirrorDays([dayKey, getPreviousCairoDayKey(dayKey)]);
    const vendorGroups = toVendorGroups(branches);
    const nowIso = nowUtcIso();
    const window = getSyncWindow(dayKey, nowIso);
    await runVendorGroupsIsolated(vendorGroups, async (group) => {
        const res = await fetchOrdersWindow({
            token: params.token,
            globalEntityId: group.globalEntityId,
            vendorIds: group.vendorIds,
            pageSize: ACTIVE_SYNC_PAGE_SIZE,
            window,
            nowIso,
            isCompleted: false,
        });
        upsertMirrorOrders({
            dayKey,
            globalEntityId: group.globalEntityId,
            rows: res.items.map((order) => ({
                ...normalizeMirrorOrder(order, nowIso),
                vendorId: Number(order?.vendor?.id ?? 0),
            })).filter(Boolean),
            activeOverwrite: true,
        });
        const activeOrderIdsByVendor = new Map();
        for (const order of res.items) {
            const vendorId = Number(order?.vendor?.id ?? 0);
            const orderId = stableOrderKey(order);
            if (!vendorId || !orderId)
                continue;
            const items = activeOrderIdsByVendor.get(vendorId) ?? [];
            items.push(orderId);
            activeOrderIdsByVendor.set(vendorId, items);
        }
        for (const vendorId of group.vendorIds) {
            markMissingActiveOrdersInactive({
                dayKey,
                globalEntityId: group.globalEntityId,
                vendorId,
                activeOrderIds: activeOrderIdsByVendor.get(vendorId) ?? [],
            });
            upsertMirrorState(dayKey, group.globalEntityId, vendorId, {
                lastActiveSyncAt: res.fetchedAt,
                lastSuccessfulSyncAt: res.fetchedAt,
                consecutiveFailures: 0,
                lastErrorAt: null,
                lastErrorCode: null,
                lastErrorMessage: null,
                staleSince: null,
                quarantinedUntil: null,
            });
            result.successfulVendorIds.add(vendorId);
            result.updatedVendorIds.add(vendorId);
        }
    }, async (group, error) => {
        const normalized = summarizeMirrorSyncError(error);
        result.failures.push({
            vendorIds: [...group.vendorIds],
            statusCode: normalized.statusCode,
            message: normalized.message,
        });
        for (const vendorId of group.vendorIds) {
            markVendorSyncFailure(dayKey, group.globalEntityId, vendorId, error);
        }
    });
    return result;
}
export async function syncOrdersMirrorHistory(params) {
    const result = {
        successfulVendorIds: new Set(),
        updatedVendorIds: new Set(),
        failures: [],
    };
    const dayKey = params.dayKey ?? getCairoDayKey();
    const branches = params.branches.filter((branch) => branch.enabled);
    if (!branches.length)
        return result;
    pruneMirrorDays([dayKey, getPreviousCairoDayKey(dayKey)]);
    const vendorGroups = toVendorGroups(branches);
    const nowIso = nowUtcIso();
    const historyIntervalMs = resolveOrdersHistorySyncSeconds() * 1000;
    const repairSweepIntervalMs = resolveOrdersRepairSweepSeconds() * 1000;
    const liveDayWindow = getSyncWindow(dayKey, nowIso);
    const nowMs = Date.now();
    await runVendorGroupsIsolated(vendorGroups.filter((group) => {
        const states = group.vendorIds.map((vendorId) => getMirrorState(dayKey, group.globalEntityId, vendorId));
        const needsHistory = states.some((state) => {
            if (!state?.lastHistorySyncAt)
                return true;
            return nowMs - toMillis(state.lastHistorySyncAt) >= historyIntervalMs;
        });
        const needsRepair = states.some((state) => {
            if (!state?.lastFullHistorySweepAt)
                return true;
            return nowMs - toMillis(state.lastFullHistorySweepAt) >= repairSweepIntervalMs;
        });
        return needsHistory || needsRepair;
    }), async (group) => {
        const states = group.vendorIds.map((vendorId) => getMirrorState(dayKey, group.globalEntityId, vendorId));
        const needsRepair = states.some((state) => {
            if (!state?.lastFullHistorySweepAt)
                return true;
            return nowMs - toMillis(state.lastFullHistorySweepAt) >= repairSweepIntervalMs;
        });
        let window = liveDayWindow;
        if (!needsRepair) {
            const minCursorMs = states
                .map((state) => toMillis(state?.lastHistoryCursorAt ?? state?.lastHistorySyncAt))
                .filter(Number.isFinite)
                .reduce((min, current) => Math.min(min, current), Number.POSITIVE_INFINITY);
            const overlapStartMs = Number.isFinite(minCursorMs)
                ? Math.max(toMillis(liveDayWindow.startUtcIso), minCursorMs - HISTORY_OVERLAP_MS)
                : toMillis(liveDayWindow.startUtcIso);
            window = {
                startUtcIso: new Date(overlapStartMs).toISOString(),
                endUtcIso: liveDayWindow.endUtcIso,
            };
        }
        const res = await fetchOrdersWindow({
            token: params.token,
            globalEntityId: group.globalEntityId,
            vendorIds: group.vendorIds,
            pageSize: HISTORY_SYNC_PAGE_SIZE,
            window,
            nowIso,
        });
        upsertMirrorOrders({
            dayKey,
            globalEntityId: group.globalEntityId,
            rows: res.items.map((order) => ({
                ...normalizeMirrorOrder(order, nowIso),
                vendorId: Number(order?.vendor?.id ?? 0),
            })).filter(Boolean),
            activeOverwrite: false,
        });
        for (const vendorId of group.vendorIds) {
            upsertMirrorState(dayKey, group.globalEntityId, vendorId, {
                lastHistorySyncAt: res.fetchedAt,
                lastFullHistorySweepAt: needsRepair ? res.fetchedAt : getMirrorState(dayKey, group.globalEntityId, vendorId)?.lastFullHistorySweepAt ?? null,
                lastHistoryCursorAt: window.endUtcIso,
                lastSuccessfulSyncAt: res.fetchedAt,
                consecutiveFailures: 0,
                lastErrorAt: null,
                lastErrorCode: null,
                lastErrorMessage: null,
                staleSince: null,
                quarantinedUntil: null,
            });
            result.successfulVendorIds.add(vendorId);
            result.updatedVendorIds.add(vendorId);
        }
    }, async (group, error) => {
        const normalized = summarizeMirrorSyncError(error);
        result.failures.push({
            vendorIds: [...group.vendorIds],
            statusCode: normalized.statusCode,
            message: normalized.message,
        });
        for (const vendorId of group.vendorIds) {
            markVendorSyncFailure(dayKey, group.globalEntityId, vendorId, error);
        }
    });
    return result;
}
export function getMirrorVendorSyncStatus(params) {
    const dayKey = params.dayKey ?? getCairoDayKey();
    const state = getMirrorState(dayKey, params.globalEntityId, params.vendorId);
    return {
        vendorId: params.vendorId,
        cacheState: resolveCacheState(state, params.ordersRefreshSeconds),
        fetchedAt: resolveFetchedAt(state),
        consecutiveFailures: state?.consecutiveFailures ?? 0,
    };
}
export async function syncOrdersMirror(params) {
    const dayKey = params.dayKey ?? getCairoDayKey();
    const enabledBranches = params.branches.filter((branch) => branch.enabled);
    const vendorIds = Array.from(new Set(enabledBranches.map((branch) => branch.ordersVendorId)));
    const statusesByVendor = new Map();
    if (!vendorIds.length) {
        return {
            dayKey,
            totalVendors: 0,
            successfulVendors: 0,
            failedVendors: 0,
            updatedVendors: 0,
            staleVendorCount: 0,
            lastSuccessfulSyncAt: null,
            errors: [],
            statusesByVendor,
        };
    }
    const bootstrap = await ensureOrdersMirrorBootstrap({
        token: params.token,
        branches: enabledBranches,
        dayKey,
    });
    const active = await syncOrdersMirrorActive({
        token: params.token,
        branches: enabledBranches,
        dayKey,
    });
    const history = await syncOrdersMirrorHistory({
        token: params.token,
        branches: enabledBranches,
        dayKey,
    });
    const successfulVendorIds = new Set([
        ...bootstrap.successfulVendorIds,
        ...active.successfulVendorIds,
        ...history.successfulVendorIds,
    ]);
    const updatedVendorIds = new Set([
        ...bootstrap.updatedVendorIds,
        ...active.updatedVendorIds,
        ...history.updatedVendorIds,
    ]);
    const errors = [...bootstrap.failures, ...active.failures, ...history.failures];
    const failedVendorIds = new Set(errors.flatMap((error) => error.vendorIds));
    for (const vendorId of vendorIds) {
        statusesByVendor.set(vendorId, getMirrorVendorSyncStatus({
            globalEntityId: FIXED_GLOBAL_ENTITY_ID,
            vendorId,
            ordersRefreshSeconds: params.ordersRefreshSeconds,
            dayKey,
        }));
    }
    const lastSuccessfulSyncAt = Array.from(statusesByVendor.values())
        .map((status) => status.fetchedAt)
        .filter((value) => typeof value === "string" && value.length > 0)
        .sort()
        .at(-1) ?? null;
    const staleVendorCount = Array.from(statusesByVendor.values()).filter((status) => status.cacheState === "stale").length;
    return {
        dayKey,
        totalVendors: vendorIds.length,
        successfulVendors: successfulVendorIds.size,
        failedVendors: failedVendorIds.size,
        updatedVendors: updatedVendorIds.size,
        staleVendorCount,
        lastSuccessfulSyncAt,
        errors,
        statusesByVendor,
    };
}
function emptyMetrics() {
    return {
        totalToday: 0,
        cancelledToday: 0,
        doneToday: 0,
        activeNow: 0,
        lateNow: 0,
        unassignedNow: 0,
    };
}
function emptyPickers() {
    return {
        todayCount: 0,
        activePreparingCount: 0,
        lastHourCount: 0,
        items: [],
    };
}
function buildPickerFallbackName(shopperId, shopperFirstName) {
    return shopperFirstName && shopperFirstName.trim().length ? shopperFirstName.trim() : `Picker ${shopperId}`;
}
export function getMirrorBranchDetail(params) {
    const dayKey = params.dayKey ?? getCairoDayKey();
    const state = getMirrorState(dayKey, params.globalEntityId, params.vendorId);
    const fetchedAt = resolveFetchedAt(state);
    const cacheState = resolveCacheState(state, params.ordersRefreshSeconds);
    const nowIso = nowUtcIso();
    const nowMs = Date.now();
    const lastHourStartIso = new Date(nowMs - 60 * 60 * 1000).toISOString();
    const rows = db.prepare(`
    SELECT
      dayKey,
      globalEntityId,
      vendorId,
      orderId,
      externalId,
      status,
      isCompleted,
      isCancelled,
      isUnassigned,
      placedAt,
      pickupAt,
      customerFirstName,
      shopperId,
      shopperFirstName,
      isActiveNow,
      lastSeenAt,
      lastActiveSeenAt
    FROM orders_mirror
    WHERE dayKey = ? AND globalEntityId = ? AND vendorId = ?
  `).all(dayKey, params.globalEntityId, params.vendorId);
    const metrics = rows.length
        ? rows.reduce((current, row) => {
            current.totalToday += 1;
            if (row.isCancelled === 1)
                current.cancelledToday += 1;
            if (row.isCompleted === 1)
                current.doneToday += 1;
            if (row.isActiveNow === 1) {
                current.activeNow += 1;
                if (row.isUnassigned === 1)
                    current.unassignedNow += 1;
                if (row.pickupAt && isPastPickup(nowIso, row.pickupAt))
                    current.lateNow += 1;
            }
            return current;
        }, emptyMetrics())
        : emptyMetrics();
    const unassignedOrders = rows
        .filter((row) => row.isActiveNow === 1 && row.isUnassigned === 1)
        .sort((left, right) => toMillis(left.placedAt) - toMillis(right.placedAt))
        .map((row) => toLiveOrder(row, nowIso));
    const preparingOrders = rows
        .filter((row) => row.isActiveNow === 1 && row.isUnassigned === 0)
        .sort((left, right) => toMillis(left.pickupAt) - toMillis(right.pickupAt))
        .map((row) => toLiveOrder(row, nowIso));
    const pickerCountRow = db.prepare(`
    SELECT
      COUNT(DISTINCT CASE WHEN shopperId IS NOT NULL THEN shopperId END) AS todayCount,
      COUNT(DISTINCT CASE WHEN shopperId IS NOT NULL AND isActiveNow = 1 AND isUnassigned = 0 THEN shopperId END) AS activePreparingCount,
      COUNT(DISTINCT CASE WHEN shopperId IS NOT NULL AND pickupAt IS NOT NULL AND pickupAt <= ? AND pickupAt >= ? THEN shopperId END) AS lastHourCount
    FROM orders_mirror
    WHERE dayKey = ? AND globalEntityId = ? AND vendorId = ?
  `).get(nowIso, lastHourStartIso, dayKey, params.globalEntityId, params.vendorId) ?? {
        todayCount: 0,
        activePreparingCount: 0,
        lastHourCount: 0,
    };
    let items = [];
    if (params.includePickerItems !== false) {
        const pickerRows = db.prepare(`
      SELECT
        shopperId,
        (
          SELECT shopperFirstName
          FROM orders_mirror latest
          WHERE latest.dayKey = mirror.dayKey
            AND latest.globalEntityId = mirror.globalEntityId
            AND latest.vendorId = mirror.vendorId
            AND latest.shopperId = mirror.shopperId
            AND latest.shopperFirstName IS NOT NULL
            AND TRIM(latest.shopperFirstName) <> ''
          ORDER BY COALESCE(latest.pickupAt, latest.placedAt, latest.lastSeenAt) DESC
          LIMIT 1
        ) AS shopperFirstName,
        COUNT(*) AS ordersToday,
        MIN(CASE WHEN pickupAt IS NOT NULL THEN pickupAt END) AS firstPickupAt,
        MAX(CASE WHEN pickupAt IS NOT NULL THEN pickupAt END) AS lastPickupAt,
        MAX(CASE WHEN pickupAt IS NOT NULL AND pickupAt <= ? AND pickupAt >= ? THEN 1 ELSE 0 END) AS activeLastHour
      FROM orders_mirror mirror
      WHERE dayKey = ? AND globalEntityId = ? AND vendorId = ? AND shopperId IS NOT NULL
      GROUP BY shopperId
      ORDER BY ordersToday DESC,
        CASE WHEN lastPickupAt IS NULL THEN 1 ELSE 0 END ASC,
        lastPickupAt DESC,
        LOWER(COALESCE(shopperFirstName, '')) ASC
    `).all(nowIso, lastHourStartIso, dayKey, params.globalEntityId, params.vendorId);
        items = pickerRows.map((row) => ({
            shopperId: row.shopperId,
            shopperFirstName: buildPickerFallbackName(row.shopperId, row.shopperFirstName),
            ordersToday: row.ordersToday,
            firstPickupAt: row.firstPickupAt,
            lastPickupAt: row.lastPickupAt,
            activeLastHour: row.activeLastHour === 1,
        }));
    }
    return {
        metrics,
        fetchedAt,
        unassignedOrders,
        preparingOrders,
        pickers: {
            todayCount: pickerCountRow.todayCount ?? 0,
            activePreparingCount: pickerCountRow.activePreparingCount ?? 0,
            lastHourCount: pickerCountRow.lastHourCount ?? 0,
            items,
        },
        cacheState,
    };
}
export function getMirrorBranchPickers(params) {
    const detail = getMirrorBranchDetail({
        ...params,
        includePickerItems: true,
    });
    if (!detail.fetchedAt) {
        return {
            pickers: emptyPickers(),
            cacheState: detail.cacheState,
        };
    }
    return {
        pickers: detail.pickers,
        cacheState: detail.cacheState,
    };
}
