import { fetchAvailabilities } from "./availabilityClient.js";
import { getWithRetry } from "./orders/httpClient.js";
import { BASE, chunk } from "./orders/types.js";
import { listBranches } from "./branchStore.js";
import { getSettings } from "./settingsStore.js";
import { getBranchCatalogItem, getBranchCatalogSyncState, listBranchCatalog, markBranchCatalogMissing, setBranchCatalogSyncState, updateBranchCatalogResolution, upsertBranchCatalogSources, } from "./branchCatalogStore.js";
const CATALOG_STALE_MS = 5 * 60 * 1000;
const RESOLVE_BATCH_SIZE = 8;
const syncsInFlight = new Map();
function normalizeWarehouseIds(value) {
    if (Array.isArray(value)) {
        return value.map((item) => String(item).trim()).filter(Boolean);
    }
    if (typeof value === "string" && value.trim()) {
        return [value.trim()];
    }
    return [];
}
function matchesAvailabilityVendorId(item, availabilityVendorId) {
    const expected = availabilityVendorId.trim();
    if (!expected)
        return false;
    return normalizeWarehouseIds(item.platformVendorId).includes(expected)
        || normalizeWarehouseIds(item.externalId).includes(expected);
}
function extractWarehouseLookupItems(payload) {
    if (Array.isArray(payload))
        return payload;
    if (Array.isArray(payload?.data))
        return payload.data;
    return [];
}
function describeSyncError(error) {
    const status = error?.response?.status;
    const upstreamMessage = error?.response?.data?.message;
    const fallback = error?.message || "Catalog sync failed";
    if (status && upstreamMessage) {
        return `${status}: ${String(upstreamMessage)}`;
    }
    if (status) {
        return `${status}: ${fallback}`;
    }
    return String(fallback);
}
function resolveSyncState(globalEntityId) {
    const current = getBranchCatalogSyncState(globalEntityId);
    if (current.syncState === "syncing") {
        return {
            syncState: "syncing",
            lastSyncedAt: current.lastSyncedAt,
            lastError: current.lastError,
        };
    }
    if (current.syncState === "error") {
        return {
            syncState: "error",
            lastSyncedAt: current.lastSyncedAt,
            lastError: current.lastError,
        };
    }
    if (!current.lastSyncedAt) {
        return {
            syncState: "stale",
            lastSyncedAt: null,
            lastError: current.lastError,
        };
    }
    const ageMs = Date.now() - new Date(current.lastSyncedAt).getTime();
    return {
        syncState: ageMs > CATALOG_STALE_MS ? "stale" : "fresh",
        lastSyncedAt: current.lastSyncedAt,
        lastError: current.lastError,
    };
}
async function lookupWarehouseForAvailabilityVendor(params) {
    const url = `${BASE}/v2/entities/${encodeURIComponent(params.globalEntityId)}/warehouses?permission=${encodeURIComponent("order:read")}&search=${encodeURIComponent(params.availabilityVendorId)}`;
    const response = await getWithRetry(url, {
        Authorization: `Bearer ${params.ordersToken}`,
        Accept: "application/json",
    }, 1);
    const items = extractWarehouseLookupItems(response.data);
    return items.find((item) => matchesAvailabilityVendorId(item, params.availabilityVendorId)) ?? null;
}
async function resolveCatalogRows(globalEntityId, ordersToken, resolvedAt) {
    const rows = listBranchCatalog(globalEntityId).filter((item) => item.presentInSource && (!item.ordersVendorId || !item.name || item.resolveStatus !== "resolved"));
    if (!rows.length)
        return { hasFatalError: false, lastError: null };
    let lastError = null;
    let hasFatalError = false;
    for (const group of chunk(rows, RESOLVE_BATCH_SIZE)) {
        const results = await Promise.all(group.map(async (item) => {
            try {
                const warehouse = await lookupWarehouseForAvailabilityVendor({
                    globalEntityId: item.globalEntityId,
                    availabilityVendorId: item.availabilityVendorId,
                    ordersToken,
                });
                if (!warehouse?.id || !warehouse.name?.trim()) {
                    updateBranchCatalogResolution({
                        availabilityVendorId: item.availabilityVendorId,
                        ordersVendorId: item.ordersVendorId,
                        name: item.name,
                        resolveStatus: "unresolved",
                        resolvedAt: item.resolvedAt,
                        lastError: null,
                    });
                    return;
                }
                updateBranchCatalogResolution({
                    availabilityVendorId: item.availabilityVendorId,
                    ordersVendorId: Number(warehouse.id),
                    name: warehouse.name.trim(),
                    resolveStatus: "resolved",
                    resolvedAt,
                    lastError: null,
                });
            }
            catch (error) {
                const message = describeSyncError(error);
                lastError = message;
                hasFatalError = true;
                updateBranchCatalogResolution({
                    availabilityVendorId: item.availabilityVendorId,
                    ordersVendorId: item.ordersVendorId,
                    name: item.name,
                    resolveStatus: item.ordersVendorId && item.name ? "resolved" : "error",
                    resolvedAt: item.resolvedAt,
                    lastError: message,
                });
            }
        }));
        await Promise.all(results);
        if (hasFatalError) {
            break;
        }
    }
    return { hasFatalError, lastError };
}
async function runCatalogSync(globalEntityId) {
    const settings = getSettings();
    const startedAt = new Date().toISOString();
    setBranchCatalogSyncState({
        globalEntityId,
        syncState: "syncing",
        lastAttemptedAt: startedAt,
        lastSyncedAt: getBranchCatalogSyncState(globalEntityId).lastSyncedAt,
        lastError: null,
    });
    try {
        const availabilities = await fetchAvailabilities(settings.availabilityToken);
        const sourceRows = availabilities
            .filter((item) => item.globalEntityId === globalEntityId)
            .map((item) => ({
            availabilityVendorId: String(item.platformRestaurantId).trim(),
            globalEntityId: item.globalEntityId,
            availabilityState: item.availabilityState,
            changeable: !!item.changeable,
            lastSeenAt: startedAt,
        }))
            .filter((item) => item.availabilityVendorId);
        upsertBranchCatalogSources(sourceRows);
        markBranchCatalogMissing(globalEntityId, sourceRows.map((item) => item.availabilityVendorId));
        if (!settings.ordersToken.trim()) {
            const lastError = "Orders token is missing. Branch catalog cannot resolve orders vendor IDs.";
            setBranchCatalogSyncState({
                globalEntityId,
                syncState: "error",
                lastAttemptedAt: startedAt,
                lastSyncedAt: getBranchCatalogSyncState(globalEntityId).lastSyncedAt,
                lastError,
            });
            return;
        }
        const resolution = await resolveCatalogRows(globalEntityId, settings.ordersToken, startedAt);
        setBranchCatalogSyncState({
            globalEntityId,
            syncState: resolution.hasFatalError ? "error" : "fresh",
            lastAttemptedAt: startedAt,
            lastSyncedAt: resolution.hasFatalError ? getBranchCatalogSyncState(globalEntityId).lastSyncedAt : startedAt,
            lastError: resolution.lastError,
        });
    }
    catch (error) {
        setBranchCatalogSyncState({
            globalEntityId,
            syncState: "error",
            lastAttemptedAt: startedAt,
            lastSyncedAt: getBranchCatalogSyncState(globalEntityId).lastSyncedAt,
            lastError: describeSyncError(error),
        });
    }
}
export function triggerBranchCatalogRefresh(globalEntityId, options) {
    const state = resolveSyncState(globalEntityId);
    if (!options?.force && state.syncState === "fresh") {
        return syncsInFlight.get(globalEntityId) ?? Promise.resolve();
    }
    const inFlight = syncsInFlight.get(globalEntityId);
    if (inFlight)
        return inFlight;
    const promise = runCatalogSync(globalEntityId)
        .finally(() => {
        syncsInFlight.delete(globalEntityId);
    });
    syncsInFlight.set(globalEntityId, promise);
    return promise;
}
export async function refreshBranchCatalogNow(globalEntityId) {
    await triggerBranchCatalogRefresh(globalEntityId, { force: true });
    return getBranchCatalogResponse(globalEntityId, { triggerRefreshIfStale: false });
}
export function getBranchCatalogResponse(globalEntityId, options) {
    const rows = listBranchCatalog(globalEntityId);
    const branches = listBranches();
    const mappedByAvailabilityVendorId = new Map(branches.map((branch) => [branch.availabilityVendorId, branch]));
    const syncMeta = resolveSyncState(globalEntityId);
    if (options?.triggerRefreshIfStale !== false && (syncMeta.syncState === "stale" || (syncMeta.syncState === "error" && !rows.length))) {
        void triggerBranchCatalogRefresh(globalEntityId);
    }
    const items = rows.map((row) => {
        const linkedBranch = mappedByAvailabilityVendorId.get(row.availabilityVendorId) ?? null;
        return {
            availabilityVendorId: row.availabilityVendorId,
            ordersVendorId: row.ordersVendorId,
            name: row.name,
            globalEntityId: row.globalEntityId,
            availabilityState: row.availabilityState,
            changeable: row.changeable,
            presentInSource: row.presentInSource,
            resolveStatus: row.resolveStatus,
            lastSeenAt: row.lastSeenAt,
            resolvedAt: row.resolvedAt,
            lastError: row.lastError,
            alreadyAdded: Boolean(linkedBranch),
            branchId: linkedBranch?.id ?? null,
            chainName: linkedBranch?.chainName ?? null,
            enabled: linkedBranch ? linkedBranch.enabled : null,
        };
    });
    return {
        items,
        syncState: syncMeta.syncState,
        lastSyncedAt: syncMeta.lastSyncedAt,
        lastError: syncMeta.lastError,
    };
}
export function getResolvedCatalogBranchForAdd(globalEntityId, availabilityVendorId) {
    const item = getBranchCatalogItem(availabilityVendorId);
    if (!item || item.globalEntityId !== globalEntityId)
        return null;
    return item;
}
