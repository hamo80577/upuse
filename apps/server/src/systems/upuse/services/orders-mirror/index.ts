import { DateTime } from "luxon";
import type { Statement } from "better-sqlite3";
import { db } from "../../../../config/db.js";
import type {
  OrdersVendorId,
  ResolvedBranchMapping,
} from "../../../../types/models.js";
import { cairoHourWindowUtc, nowUtcIso } from "../../../../utils/time.js";
import { Mutex } from "../../../../utils/mutex.js";
import { getGlobalEntityId, getSettings } from "../../../../services/settingsStore.js";
import { isPreparingQueueOrder } from "../../../../services/orders/classification.js";
import { getWithRetry } from "../../../../services/orders/httpClient.js";
import { createPageLimitError } from "../../../../services/orders/paginationGuards.js";
import {
  resolveOrdersEntitySyncMaxPages,
  resolveOrdersHistorySyncSeconds,
  resolveOrdersRepairSweepSeconds,
  resolveOrdersWindowSplitMaxDepth,
  resolveOrdersWindowSplitMinSpanMs,
  splitUtcWindow,
  type UtcWindow,
} from "../../../../services/orders/shared.js";
import { BASE } from "../../../../services/orders/types.js";
import type {
  BranchDetailCacheState,
  DroppedActiveOrderCandidate,
  EntitySyncBaseResult,
  EntitySyncError,
  MirrorOrdersDetail,
  NormalizedMirrorOrder,
  OrdersEntitySyncStateRow,
  OrdersFetchResult,
  OrdersMirrorEntitySyncStatus,
  OrdersMirrorRow,
  OrdersMirrorSyncSummary,
  OrdersMirrorVendorSyncStatus,
  OwnerLookupCandidate,
  TransportTypeLookupCandidate,
} from "./types.js";
import {
  ACTIVE_SYNC_PAGE_SIZE,
  BOOTSTRAP_SYNC_PAGE_SIZE,
  HISTORY_OVERLAP_MS,
  HISTORY_SYNC_PAGE_SIZE,
} from "./types.js";
import { publishEntitySyncStatus, subscribeOrdersMirrorEntitySync } from "./statusPublication.js";
import { getCairoDayKey, getDayWindow, getPreviousCairoDayKey, getSyncWindow, toMillis } from "./timeWindows.js";
import { extractTransportType, normalizeMirrorOrder, stableOrderKey } from "./normalization.js";
import { extractCancellationDetail, normalizeLookupError } from "./detailLookup.js";
import {
  getMirrorBranchDetail as readMirrorBranchDetail,
  getMirrorBranchPickers as readMirrorBranchPickers,
} from "./branchDetail.js";
export { refreshOrdersMirrorNow, startOrdersMirrorRuntime, stopOrdersMirrorRuntime } from "./runtime.js";
export { extractTransportType } from "./normalization.js";
export { extractCancellationDetail, extractCancellationOwner } from "./detailLookup.js";
export type {
  BranchDetailCacheState,
  MirrorSyncPhase,
  OrdersMirrorEntitySyncStatus,
  OrdersMirrorSyncSummary,
  OrdersMirrorVendorSyncStatus,
} from "./types.js";

let upsertMirrorOrderStatement: Statement<any[]> | null = null;

let updateCancellationLookupStatement: Statement<any[]> | null = null;
let updateTransportTypeLookupStatement: Statement<any[]> | null = null;

const entitySyncMutex = new Mutex();
const ownerLookupMutex = new Mutex();
const transportTypeLookupMutex = new Mutex();

let entitySyncInFlight: Promise<EntitySyncBaseResult> | null = null;
export { subscribeOrdersMirrorEntitySync };

export function getCurrentHourPlacedCountByVendor(params: {
  globalEntityId: string;
  vendorIds: OrdersVendorId[];
  nowIso?: string;
}) {
  if (!params.vendorIds.length) {
    return new Map<OrdersVendorId, number>();
  }

  const now = params.nowIso
    ? DateTime.fromISO(params.nowIso, { zone: "utc" })
    : DateTime.utc();
  const resolvedNow = now.isValid ? now : DateTime.utc();
  const dayKey = getCairoDayKey(resolvedNow);
  const hourWindow = cairoHourWindowUtc(resolvedNow);
  const placeholders = params.vendorIds.map(() => "?").join(", ");
  const rows = db.prepare<any[], { vendorId: OrdersVendorId; count: number }>(`
    SELECT vendorId, COUNT(*) AS count
    FROM orders_mirror
    WHERE dayKey = ?
      AND globalEntityId = ?
      AND placedAt IS NOT NULL
      AND placedAt >= ?
      AND placedAt < ?
      AND vendorId IN (${placeholders})
    GROUP BY vendorId
  `).all(
    dayKey,
    params.globalEntityId,
    hourWindow.startUtcIso,
    hourWindow.endUtcExclusiveIso,
    ...params.vendorIds,
  );

  const counts = new Map<OrdersVendorId, number>();
  for (const vendorId of params.vendorIds) {
    counts.set(vendorId, 0);
  }
  for (const row of rows) {
    counts.set(row.vendorId, row.count);
  }

  return counts;
}

function resolveFetchedAt(state: OrdersEntitySyncStateRow | null) {
  if (!state) return null;
  const candidates = [
    state.lastSuccessfulSyncAt,
    state.lastBootstrapSyncAt,
    state.lastActiveSyncAt,
    state.lastHistorySyncAt,
  ].filter((value): value is string => typeof value === "string" && value.length > 0);

  if (!candidates.length) return null;
  return candidates.reduce((latest, current) => (toMillis(current) > toMillis(latest) ? current : latest));
}

function resolveCacheState(
  state: OrdersEntitySyncStateRow | null,
  ordersRefreshSeconds: number,
  nowMs = Date.now(),
): BranchDetailCacheState {
  if (!state?.bootstrapCompletedAt) {
    return "warming";
  }

  const fetchedAt = resolveFetchedAt(state);
  if (!fetchedAt) {
    return "warming";
  }

  const staleAfterMs = Math.max(60_000, ordersRefreshSeconds * 2_000);
  return nowMs - toMillis(fetchedAt) > staleAfterMs ? "stale" : "fresh";
}

function getOrdersHeaders(token: string) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/json",
    Origin: "https://portal.talabat.com",
    Referer: "https://portal.talabat.com/",
    "x-request-source": "ops-portal",
  };
}

function getEntitySyncState(dayKey: string, globalEntityId: string) {
  return db.prepare<[string, string], OrdersEntitySyncStateRow>(`
    SELECT
      dayKey,
      globalEntityId,
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
      bootstrapCompletedAt
    FROM orders_entity_sync_state
    WHERE dayKey = ? AND globalEntityId = ?
  `).get(dayKey, globalEntityId) ?? null;
}

function upsertEntitySyncState(dayKey: string, globalEntityId: string, patch: Partial<OrdersEntitySyncStateRow>) {
  const current = getEntitySyncState(dayKey, globalEntityId) ?? {
    dayKey,
    globalEntityId,
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
    bootstrapCompletedAt: null,
  };

  const next = {
    ...current,
    ...patch,
    dayKey,
    globalEntityId,
  };

  db.prepare(`
    INSERT INTO orders_entity_sync_state (
      dayKey,
      globalEntityId,
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
      bootstrapCompletedAt
    ) VALUES (
      @dayKey,
      @globalEntityId,
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
      @bootstrapCompletedAt
    )
    ON CONFLICT(dayKey, globalEntityId) DO UPDATE SET
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
      bootstrapCompletedAt = excluded.bootstrapCompletedAt
  `).run(next);
}

function pruneMirrorDays(dayKeysToKeep: string[]) {
  const placeholders = dayKeysToKeep.map(() => "?").join(", ");
  db.prepare(`DELETE FROM orders_mirror WHERE dayKey NOT IN (${placeholders})`).run(...dayKeysToKeep);
  db.prepare(`DELETE FROM orders_sync_state WHERE dayKey NOT IN (${placeholders})`).run(...dayKeysToKeep);
  db.prepare(`DELETE FROM orders_entity_sync_state WHERE dayKey NOT IN (${placeholders})`).run(...dayKeysToKeep);
}

function summarizeMirrorSyncError(error: any): EntitySyncError {
  const statusCode = typeof error?.response?.status === "number" ? error.response.status : undefined;
  const code = typeof error?.code === "string" ? error.code : undefined;
  const responseMessage =
    error?.response?.data?.message ||
    error?.response?.data?.error ||
    error?.message ||
    "Orders API request failed";

  return {
    statusCode,
    code,
    message: String(responseMessage),
  };
}

function buildMissingTokenError(): EntitySyncError {
  return {
    code: "UPUSE_ORDERS_TOKEN_MISSING",
    message: "Orders token is not configured.",
  };
}

function markEntitySyncFailure(dayKey: string, globalEntityId: string, error: EntitySyncError) {
  const current = getEntitySyncState(dayKey, globalEntityId);
  const nowIso = nowUtcIso();
  upsertEntitySyncState(dayKey, globalEntityId, {
    ...current,
    consecutiveFailures: (current?.consecutiveFailures ?? 0) + 1,
    lastErrorAt: nowIso,
    lastErrorCode: error.code ?? (error.statusCode != null ? String(error.statusCode) : null),
    lastErrorMessage: error.message,
    staleSince: current?.staleSince ?? nowIso,
  });
}

function markEntitySyncSuccess(dayKey: string, globalEntityId: string, fetchedAt: string, patch?: Partial<OrdersEntitySyncStateRow>) {
  const current = getEntitySyncState(dayKey, globalEntityId);
  upsertEntitySyncState(dayKey, globalEntityId, {
    ...current,
    ...patch,
    lastSuccessfulSyncAt: fetchedAt,
    consecutiveFailures: 0,
    lastErrorAt: null,
    lastErrorCode: null,
    lastErrorMessage: null,
    staleSince: null,
  });
}

export async function fetchOrdersWindow(params: {
  token: string;
  globalEntityId: string;
  pageSize: number;
  window: UtcWindow;
  nowIso: string;
  isCompleted?: boolean;
}) {
  const headers = getOrdersHeaders(params.token);
  const maxSplitDepth = resolveOrdersWindowSplitMaxDepth();
  const minSplitSpanMs = resolveOrdersWindowSplitMinSpanMs();
  const maxPages = resolveOrdersEntitySyncMaxPages();
  const seenOrderIds = new Set<string>();
  const items: any[] = [];

  const collectWindow = async (window: UtcWindow, depth: number): Promise<void> => {
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

      const res = await getWithRetry(`${BASE}/orders?${qs.toString()}`, headers, 2);
      const pageItems = Array.isArray(res.data?.items) ? res.data.items : [];

      for (const order of pageItems) {
        const orderKey = stableOrderKey(order);
        if (!orderKey || seenOrderIds.has(orderKey)) continue;
        seenOrderIds.add(orderKey);
        items.push(order);
      }

      if (pageItems.length < params.pageSize) break;
      if (page + 1 >= maxPages) {
        const splitWindows = depth < maxSplitDepth
          ? splitUtcWindow(window, minSplitSpanMs)
          : null;
        if (splitWindows) {
          await collectWindow(splitWindows[0], depth + 1);
          await collectWindow(splitWindows[1], depth + 1);
          return;
        }

        throw createPageLimitError({
          scope: "orders_aggregate",
          globalEntityId: params.globalEntityId,
          page,
          windowStartUtc: window.startUtcIso,
          windowEndUtc: window.endUtcIso,
          splitDepth: depth,
          maxPages,
        });
      }

      page += 1;
    }
  };

  await collectWindow(params.window, 0);
  return {
    items,
    fetchedAt: params.nowIso,
  } satisfies OrdersFetchResult;
}

function getUpsertMirrorOrderStatement() {
  upsertMirrorOrderStatement ??= db.prepare(`
    INSERT INTO orders_mirror (
      dayKey,
      globalEntityId,
      vendorId,
      vendorName,
      orderId,
      externalId,
      status,
      transportType,
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
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(dayKey, globalEntityId, vendorId, orderId) DO UPDATE SET
      vendorName = COALESCE(excluded.vendorName, orders_mirror.vendorName),
      externalId = excluded.externalId,
      status = excluded.status,
      transportType = COALESCE(excluded.transportType, orders_mirror.transportType),
      isCompleted = excluded.isCompleted,
      isCancelled = excluded.isCancelled,
      isUnassigned = excluded.isUnassigned,
      placedAt = COALESCE(excluded.placedAt, orders_mirror.placedAt),
      pickupAt = COALESCE(excluded.pickupAt, orders_mirror.pickupAt),
      customerFirstName = COALESCE(excluded.customerFirstName, orders_mirror.customerFirstName),
      shopperId = excluded.shopperId,
      shopperFirstName = COALESCE(excluded.shopperFirstName, orders_mirror.shopperFirstName),
      isActiveNow = CASE
        WHEN excluded.isActiveNow = 1 THEN 1
        WHEN excluded.isCompleted = 1 THEN 0
        ELSE orders_mirror.isActiveNow
      END,
      lastSeenAt = excluded.lastSeenAt,
      lastActiveSeenAt = CASE
        WHEN excluded.isActiveNow = 1 THEN excluded.lastActiveSeenAt
        ELSE orders_mirror.lastActiveSeenAt
      END,
      transportTypeLookupAt = CASE
        WHEN excluded.transportType IS NOT NULL THEN COALESCE(orders_mirror.transportTypeLookupAt, excluded.lastSeenAt)
        ELSE orders_mirror.transportTypeLookupAt
      END,
      transportTypeLookupError = CASE
        WHEN excluded.transportType IS NOT NULL THEN NULL
        ELSE orders_mirror.transportTypeLookupError
      END,
      cancellationOwner = CASE
        WHEN excluded.isCancelled = 1 THEN orders_mirror.cancellationOwner
        ELSE NULL
      END,
      cancellationReason = CASE
        WHEN excluded.isCancelled = 1 THEN orders_mirror.cancellationReason
        ELSE NULL
      END,
      cancellationStage = CASE
        WHEN excluded.isCancelled = 1 THEN orders_mirror.cancellationStage
        ELSE NULL
      END,
      cancellationSource = CASE
        WHEN excluded.isCancelled = 1 THEN orders_mirror.cancellationSource
        ELSE NULL
      END,
      cancellationCreatedAt = CASE
        WHEN excluded.isCancelled = 1 THEN orders_mirror.cancellationCreatedAt
        ELSE NULL
      END,
      cancellationUpdatedAt = CASE
        WHEN excluded.isCancelled = 1 THEN orders_mirror.cancellationUpdatedAt
        ELSE NULL
      END,
      cancellationOwnerLookupAt = CASE
        WHEN excluded.isCancelled = 1 THEN orders_mirror.cancellationOwnerLookupAt
        ELSE NULL
      END,
      cancellationOwnerLookupError = CASE
        WHEN excluded.isCancelled = 1 THEN orders_mirror.cancellationOwnerLookupError
        ELSE NULL
      END
  `);

  return upsertMirrorOrderStatement;
}

function upsertMirrorOrders(rows: NormalizedMirrorOrder[]) {
  if (!rows.length) return;

  const run = db.transaction((items: NormalizedMirrorOrder[]) => {
    const statement = getUpsertMirrorOrderStatement();
    for (const row of items) {
      statement.run(
        row.dayKey,
        row.globalEntityId,
        row.vendorId,
        row.vendorName,
        row.orderId,
        row.externalId,
        row.status,
        row.transportType,
        row.isCompleted,
        row.isCancelled,
        row.isUnassigned,
        row.placedAt,
        row.pickupAt,
        row.customerFirstName,
        row.shopperId,
        row.shopperFirstName,
        row.isActiveNow,
        row.lastSeenAt,
        row.lastActiveSeenAt,
      );
    }
  });

  run(rows);
}

function replaceActiveOrders(params: {
  dayKey: string;
  globalEntityId: string;
  activeOrderIds: string[];
}) {
  if (!params.activeOrderIds.length) {
    db.prepare(`
      UPDATE orders_mirror
      SET isActiveNow = 0
      WHERE dayKey = ? AND globalEntityId = ? AND isActiveNow = 1
    `).run(params.dayKey, params.globalEntityId);
    return;
  }

  const placeholders = params.activeOrderIds.map(() => "?").join(", ");
  db.prepare(`
    UPDATE orders_mirror
    SET isActiveNow = 0
    WHERE dayKey = ? AND globalEntityId = ? AND isActiveNow = 1 AND orderId NOT IN (${placeholders})
  `).run(params.dayKey, params.globalEntityId, ...params.activeOrderIds);
}

function listDroppedActiveOrderCandidates(params: {
  dayKey: string;
  globalEntityId: string;
  activeOrderIds: string[];
}) {
  if (!params.activeOrderIds.length) {
    return db.prepare<[string, string], DroppedActiveOrderCandidate>(`
      SELECT
        dayKey,
        globalEntityId,
        vendorId,
        vendorName,
        orderId,
        externalId
      FROM orders_mirror
      WHERE dayKey = ? AND globalEntityId = ? AND isActiveNow = 1
    `).all(params.dayKey, params.globalEntityId);
  }

  const placeholders = params.activeOrderIds.map(() => "?").join(", ");
  return db.prepare<any[], DroppedActiveOrderCandidate>(`
    SELECT
      dayKey,
      globalEntityId,
      vendorId,
      vendorName,
      orderId,
      externalId
    FROM orders_mirror
    WHERE dayKey = ? AND globalEntityId = ? AND isActiveNow = 1 AND orderId NOT IN (${placeholders})
  `).all(params.dayKey, params.globalEntityId, ...params.activeOrderIds);
}

function getHistoryWindow(dayKey: string, state: OrdersEntitySyncStateRow | null, endUtcIso: string) {
  const fullDay = getDayWindow(dayKey);
  const dayStartMs = toMillis(fullDay.startUtcIso);
  const dayEndMs = toMillis(endUtcIso);
  const cursorMs = Number.isFinite(toMillis(state?.lastHistoryCursorAt))
    ? toMillis(state?.lastHistoryCursorAt)
    : dayStartMs;
  const startMs = Math.max(dayStartMs, cursorMs - HISTORY_OVERLAP_MS);

  return {
    startUtcIso: new Date(startMs).toISOString(),
    endUtcIso,
    shouldRun: dayEndMs > startMs,
  };
}

function shouldRunRepair(state: OrdersEntitySyncStateRow | null) {
  if (!state?.lastFullHistorySweepAt) return true;
  const lastSweepMs = toMillis(state.lastFullHistorySweepAt);
  if (!Number.isFinite(lastSweepMs)) return true;
  return Date.now() - lastSweepMs >= resolveOrdersRepairSweepSeconds() * 1000;
}

function shouldReuseFreshState(state: OrdersEntitySyncStateRow | null, ordersRefreshSeconds: number) {
  if (!state?.bootstrapCompletedAt) return false;
  if (resolveCacheState(state, ordersRefreshSeconds) !== "fresh") return false;
  const fetchedAt = resolveFetchedAt(state);
  if (!fetchedAt) return false;
  return Date.now() - toMillis(fetchedAt) < Math.max(5_000, ordersRefreshSeconds * 1000);
}

function shouldRequireFullRecoveryAudit(state: OrdersEntitySyncStateRow | null, ordersRefreshSeconds: number) {
  if (!state?.bootstrapCompletedAt) return false;
  if ((state.consecutiveFailures ?? 0) > 0) return true;
  if (state.staleSince) return true;
  return resolveCacheState(state, ordersRefreshSeconds) === "stale";
}

function buildEntityStatus(dayKey: string, globalEntityId: string, ordersRefreshSeconds: number): OrdersMirrorEntitySyncStatus {
  const state = getEntitySyncState(dayKey, globalEntityId);
  const fetchedAt = resolveFetchedAt(state);

  return {
    dayKey,
    globalEntityId,
    cacheState: resolveCacheState(state, ordersRefreshSeconds),
    fetchedAt,
    lastSuccessfulSyncAt: state?.lastSuccessfulSyncAt ?? fetchedAt,
    consecutiveFailures: state?.consecutiveFailures ?? 0,
    lastErrorMessage: state?.lastErrorMessage ?? null,
    bootstrapCompleted: Boolean(state?.bootstrapCompletedAt),
  };
}

export function getOrdersMirrorEntitySyncStatus(params?: {
  dayKey?: string;
  globalEntityId?: string;
  ordersRefreshSeconds?: number;
}) {
  const dayKey = params?.dayKey ?? getCairoDayKey();
  const globalEntityId = params?.globalEntityId ?? getGlobalEntityId();
  const ordersRefreshSeconds = params?.ordersRefreshSeconds ?? getSettings().ordersRefreshSeconds;
  return buildEntityStatus(dayKey, globalEntityId, ordersRefreshSeconds);
}

async function mapWithConcurrency<T>(items: T[], concurrency: number, worker: (item: T) => Promise<void>) {
  if (!items.length) return;

  let cursor = 0;
  const workerCount = Math.max(1, Math.min(concurrency, items.length));
  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (cursor < items.length) {
        const index = cursor;
        cursor += 1;
        await worker(items[index]!);
      }
    }),
  );
}

function resolveOwnerLookupBatchLimit() {
  const raw = Number(process.env.UPUSE_PERFORMANCE_OWNER_LOOKUP_BATCH_LIMIT ?? "48");
  if (!Number.isFinite(raw)) return 48;
  return Math.max(1, Math.min(200, Math.floor(raw)));
}

function resolveTransportTypeLookupBatchLimit() {
  const raw = Number(process.env.UPUSE_PERFORMANCE_TRANSPORT_TYPE_LOOKUP_BATCH_LIMIT ?? "96");
  if (!Number.isFinite(raw)) return 96;
  return Math.max(1, Math.min(300, Math.floor(raw)));
}

function resolveDetailLookupConcurrency() {
  const raw = Number(process.env.UPUSE_PERFORMANCE_DETAIL_LOOKUP_CONCURRENCY ?? "4");
  if (!Number.isFinite(raw)) return 4;
  return Math.max(1, Math.min(10, Math.floor(raw)));
}

function resolveDetailLookupCooldownMs() {
  const raw = Number(process.env.UPUSE_PERFORMANCE_DETAIL_LOOKUP_COOLDOWN_MS ?? `${5 * 60 * 1000}`);
  if (!Number.isFinite(raw)) return 5 * 60 * 1000;
  return Math.max(30_000, Math.min(60 * 60 * 1000, Math.floor(raw)));
}

function getUpdateCancellationLookupStatement() {
  updateCancellationLookupStatement ??= db.prepare<
    [string | null, string | null, string | null, string | null, string | null, string | null, string, string | null, string, string, number, string]
  >(`
    UPDATE orders_mirror
    SET
      cancellationOwner = ?,
      cancellationReason = ?,
      cancellationStage = ?,
      cancellationSource = ?,
      cancellationCreatedAt = ?,
      cancellationUpdatedAt = ?,
      cancellationOwnerLookupAt = ?,
      cancellationOwnerLookupError = ?
    WHERE dayKey = ? AND globalEntityId = ? AND vendorId = ? AND orderId = ?
  `);

  return updateCancellationLookupStatement;
}

function getUpdateTransportTypeLookupStatement() {
  updateTransportTypeLookupStatement ??= db.prepare(`
    UPDATE orders_mirror
    SET
      transportType = ?,
      transportTypeLookupAt = ?,
      transportTypeLookupError = ?
    WHERE dayKey = ? AND globalEntityId = ? AND vendorId = ? AND orderId = ?
  `);

  return updateTransportTypeLookupStatement;
}

function listPendingOwnerLookupCandidates(dayKey: string, globalEntityId: string, cutoffIso: string, limit: number) {
  if (limit <= 0) return [];

  return db.prepare<[string, string, string, number], OwnerLookupCandidate>(`
    SELECT
      dayKey,
      globalEntityId,
      vendorId,
      orderId
    FROM orders_mirror
    WHERE dayKey = ?
      AND globalEntityId = ?
      AND isCancelled = 1
      AND (
        cancellationOwner IS NULL
        OR cancellationReason IS NULL
        OR cancellationCreatedAt IS NULL
      )
      AND (cancellationOwnerLookupAt IS NULL OR cancellationOwnerLookupAt <= ?)
    ORDER BY COALESCE(cancellationOwnerLookupAt, '') ASC, lastSeenAt DESC
    LIMIT ?
  `).all(dayKey, globalEntityId, cutoffIso, limit);
}

function listPendingTransportTypeLookupCandidates(dayKey: string, globalEntityId: string, cutoffIso: string, limit: number) {
  if (limit <= 0) return [];

  return db.prepare<[string, string, string, number], TransportTypeLookupCandidate>(`
    SELECT
      dayKey,
      globalEntityId,
      vendorId,
      orderId
    FROM orders_mirror
    WHERE dayKey = ?
      AND globalEntityId = ?
      AND transportType IS NULL
      AND (transportTypeLookupAt IS NULL OR transportTypeLookupAt <= ?)
    ORDER BY COALESCE(transportTypeLookupAt, '') ASC, lastSeenAt DESC
    LIMIT ?
  `).all(dayKey, globalEntityId, cutoffIso, limit);
}

function persistCancellationLookupResult(
  candidate: OwnerLookupCandidate,
  result: {
    owner: string | null;
    reason: string | null;
    stage: string | null;
    source: string | null;
    createdAt: string | null;
    updatedAt: string | null;
    lookedUpAt: string;
    error: string | null;
  },
) {
  getUpdateCancellationLookupStatement().run(
    result.owner,
    result.reason,
    result.stage,
    result.source,
    result.createdAt,
    result.updatedAt,
    result.lookedUpAt,
    result.error,
    candidate.dayKey,
    candidate.globalEntityId,
    candidate.vendorId,
    candidate.orderId,
  );
}

function persistTransportTypeLookupResult(
  candidate: TransportTypeLookupCandidate,
  result: {
    transportType: string | null;
    lookedUpAt: string;
    error: string | null;
  },
) {
  getUpdateTransportTypeLookupStatement().run(
    result.transportType,
    result.lookedUpAt,
    result.error,
    candidate.dayKey,
    candidate.globalEntityId,
    candidate.vendorId,
    candidate.orderId,
  );
}

async function fetchOrderDetailMetadata(orderId: string, token: string) {
  const response = await getWithRetry(
    `${BASE}/orders/${encodeURIComponent(orderId)}`,
    getOrdersHeaders(token),
    1,
  );

  return {
    order: response.data,
    cancellation: extractCancellationDetail(response.data),
    transportType: extractTransportType(response.data),
  };
}

async function reconcileDroppedActiveOrders(params: {
  token: string;
  candidates: DroppedActiveOrderCandidate[];
}) {
  if (!params.candidates.length || !params.token.trim().length) return;

  const lookedUpAt = nowUtcIso();
  const normalizedRows: NormalizedMirrorOrder[] = [];
  let fatalAuthError: string | null = null;

  await mapWithConcurrency(params.candidates, resolveDetailLookupConcurrency(), async (candidate) => {
    if (fatalAuthError) return;

    try {
      const detail = await fetchOrderDetailMetadata(candidate.orderId, params.token);
      const normalized = normalizeMirrorOrder(
        detail.order,
        candidate.dayKey,
        candidate.globalEntityId,
        lookedUpAt,
        {
          vendorId: candidate.vendorId,
          vendorName: candidate.vendorName,
          orderId: candidate.orderId,
          externalId: candidate.externalId,
        },
      );

      if (normalized) {
        normalizedRows.push(normalized);
      }

      persistTransportTypeLookupResult(candidate, {
        transportType: detail.transportType,
        lookedUpAt,
        error: detail.transportType ? null : "Transport type was missing from the detail response.",
      });

      if (
        normalized?.isCancelled === 1
        || detail.cancellation.owner
        || detail.cancellation.reason
        || detail.cancellation.createdAt
      ) {
        persistCancellationLookupResult(candidate, {
          owner: detail.cancellation.owner,
          reason: detail.cancellation.reason,
          stage: detail.cancellation.stage,
          source: detail.cancellation.source,
          createdAt: detail.cancellation.createdAt,
          updatedAt: detail.cancellation.updatedAt,
          lookedUpAt,
          error:
            detail.cancellation.owner || detail.cancellation.reason || detail.cancellation.createdAt
              ? null
              : "Cancellation detail was missing from the detail response.",
        });
      }
    } catch (error: any) {
      const normalizedError = normalizeLookupError(error);
      if (normalizedError.status === 401 || normalizedError.status === 403) {
        fatalAuthError = normalizedError.message;
      }
    }
  });

  upsertMirrorOrders(normalizedRows);
}

async function enrichTransportTypes(dayKey: string, globalEntityId: string, token: string) {
  if (!token.trim().length || transportTypeLookupMutex.locked) return;

  await transportTypeLookupMutex.runExclusive(async () => {
    const retryAfterIso = new Date(Date.now() - resolveDetailLookupCooldownMs()).toISOString();
    const candidates = listPendingTransportTypeLookupCandidates(
      dayKey,
      globalEntityId,
      retryAfterIso,
      resolveTransportTypeLookupBatchLimit(),
    );
    if (!candidates.length) return;

    const lookedUpAt = nowUtcIso();
    let fatalAuthError: string | null = null;

    await mapWithConcurrency(candidates, resolveDetailLookupConcurrency(), async (candidate) => {
      if (fatalAuthError) {
        persistTransportTypeLookupResult(candidate, {
          transportType: null,
          lookedUpAt,
          error: fatalAuthError,
        });
        return;
      }

      try {
        const detail = await fetchOrderDetailMetadata(candidate.orderId, token);
        persistTransportTypeLookupResult(candidate, {
          transportType: detail.transportType,
          lookedUpAt,
          error: detail.transportType ? null : "Transport type was missing from the detail response.",
        });
      } catch (error: any) {
        const normalized = normalizeLookupError(error);
        if (normalized.status === 401 || normalized.status === 403) {
          fatalAuthError = normalized.message;
        }
        persistTransportTypeLookupResult(candidate, {
          transportType: null,
          lookedUpAt,
          error: normalized.message,
        });
      }
    });
  });
}

async function enrichCancellationOwners(dayKey: string, globalEntityId: string, token: string) {
  if (!token.trim().length || ownerLookupMutex.locked) return;

  await ownerLookupMutex.runExclusive(async () => {
    const retryAfterIso = new Date(Date.now() - resolveDetailLookupCooldownMs()).toISOString();
    const candidates = listPendingOwnerLookupCandidates(
      dayKey,
      globalEntityId,
      retryAfterIso,
      resolveOwnerLookupBatchLimit(),
    );
    if (!candidates.length) return;

    const lookedUpAt = nowUtcIso();
    let fatalAuthError: string | null = null;

    await mapWithConcurrency(candidates, resolveDetailLookupConcurrency(), async (candidate) => {
      if (fatalAuthError) {
        persistCancellationLookupResult(candidate, {
          owner: null,
          reason: null,
          stage: null,
          source: null,
          createdAt: null,
          updatedAt: null,
          lookedUpAt,
          error: fatalAuthError,
        });
        return;
      }

      try {
        const detail = await fetchOrderDetailMetadata(candidate.orderId, token);
        persistCancellationLookupResult(candidate, {
          owner: detail.cancellation.owner,
          reason: detail.cancellation.reason,
          stage: detail.cancellation.stage,
          source: detail.cancellation.source,
          createdAt: detail.cancellation.createdAt,
          updatedAt: detail.cancellation.updatedAt,
          lookedUpAt,
          error:
            detail.cancellation.owner || detail.cancellation.reason || detail.cancellation.createdAt
              ? null
              : "Cancellation detail was missing from the detail response.",
        });
      } catch (error: any) {
        const normalized = normalizeLookupError(error);
        if (normalized.status === 401 || normalized.status === 403) {
          fatalAuthError = normalized.message;
        }
        persistCancellationLookupResult(candidate, {
          owner: null,
          reason: null,
          stage: null,
          source: null,
          createdAt: null,
          updatedAt: null,
          lookedUpAt,
          error: normalized.message,
        });
      }
    });
  });
}

async function drainTransportTypeEnrichment(dayKey: string, globalEntityId: string, token: string) {
  while (true) {
    const retryAfterIso = new Date(Date.now() - resolveDetailLookupCooldownMs()).toISOString();
    const pendingCandidates = listPendingTransportTypeLookupCandidates(
      dayKey,
      globalEntityId,
      retryAfterIso,
      resolveTransportTypeLookupBatchLimit(),
    );
    if (!pendingCandidates.length) {
      return;
    }
    await enrichTransportTypes(dayKey, globalEntityId, token);
  }
}

async function drainCancellationOwnerEnrichment(dayKey: string, globalEntityId: string, token: string) {
  while (true) {
    const retryAfterIso = new Date(Date.now() - resolveDetailLookupCooldownMs()).toISOString();
    const pendingCandidates = listPendingOwnerLookupCandidates(
      dayKey,
      globalEntityId,
      retryAfterIso,
      resolveOwnerLookupBatchLimit(),
    );
    if (!pendingCandidates.length) {
      return;
    }
    await enrichCancellationOwners(dayKey, globalEntityId, token);
  }
}

async function performEntitySync(params: {
  token: string;
  globalEntityId: string;
  ordersRefreshSeconds: number;
  force?: boolean;
}) {
  const dayKey = getCairoDayKey();
  const previousDayKey = getPreviousCairoDayKey(dayKey);
  pruneMirrorDays([dayKey, previousDayKey]);

  let state = getEntitySyncState(dayKey, params.globalEntityId);
  if (!params.force && shouldReuseFreshState(state, params.ordersRefreshSeconds)) {
    const entityStatus = buildEntityStatus(dayKey, params.globalEntityId, params.ordersRefreshSeconds);
    return {
      dayKey,
      globalEntityId: params.globalEntityId,
      success: true,
      fetchedAt: entityStatus.fetchedAt,
      cacheState: entityStatus.cacheState,
      consecutiveFailures: entityStatus.consecutiveFailures,
    } satisfies EntitySyncBaseResult;
  }

  if (!params.token.trim().length) {
    const missingTokenError = buildMissingTokenError();
    markEntitySyncFailure(dayKey, params.globalEntityId, missingTokenError);
    const entityStatus = buildEntityStatus(dayKey, params.globalEntityId, params.ordersRefreshSeconds);
    publishEntitySyncStatus(entityStatus);
    return {
      dayKey,
      globalEntityId: params.globalEntityId,
      success: false,
      fetchedAt: entityStatus.fetchedAt,
      cacheState: entityStatus.cacheState,
      consecutiveFailures: entityStatus.consecutiveFailures,
      error: missingTokenError,
    } satisfies EntitySyncBaseResult;
  }

  try {
    const nowIso = nowUtcIso();
    const syncWindow = getSyncWindow(dayKey, nowIso);
    const phaseFetchedAt: string[] = [];
    const bootstrapRequired = !state?.bootstrapCompletedAt;
    const recoveryAuditRequired = shouldRequireFullRecoveryAudit(state, params.ordersRefreshSeconds);

    if (bootstrapRequired) {
      const bootstrap = await fetchOrdersWindow({
        token: params.token,
        globalEntityId: params.globalEntityId,
        pageSize: BOOTSTRAP_SYNC_PAGE_SIZE,
        window: syncWindow,
        nowIso,
      });

      upsertMirrorOrders(
        bootstrap.items
          .map((order) => normalizeMirrorOrder(order, dayKey, params.globalEntityId, bootstrap.fetchedAt))
          .filter((row): row is NormalizedMirrorOrder => Boolean(row)),
      );

      phaseFetchedAt.push(bootstrap.fetchedAt);
      upsertEntitySyncState(dayKey, params.globalEntityId, {
        ...state,
        lastBootstrapSyncAt: bootstrap.fetchedAt,
        lastHistoryCursorAt: syncWindow.endUtcIso,
        bootstrapCompletedAt: bootstrap.fetchedAt,
      });
      state = getEntitySyncState(dayKey, params.globalEntityId);
    } else {
      const active = await fetchOrdersWindow({
        token: params.token,
        globalEntityId: params.globalEntityId,
        pageSize: ACTIVE_SYNC_PAGE_SIZE,
        window: syncWindow,
        nowIso,
        isCompleted: false,
      });

      const activeRows = active.items
        .map((order) => normalizeMirrorOrder(order, dayKey, params.globalEntityId, active.fetchedAt))
        .filter((row): row is NormalizedMirrorOrder => Boolean(row));
      const activeOrderIds = activeRows.map((row) => row.orderId);

      upsertMirrorOrders(activeRows);
      const droppedActiveCandidates = listDroppedActiveOrderCandidates({
        dayKey,
        globalEntityId: params.globalEntityId,
        activeOrderIds,
      });
      replaceActiveOrders({
        dayKey,
        globalEntityId: params.globalEntityId,
        activeOrderIds,
      });
      await reconcileDroppedActiveOrders({
        token: params.token,
        candidates: droppedActiveCandidates,
      });
      phaseFetchedAt.push(active.fetchedAt);
      upsertEntitySyncState(dayKey, params.globalEntityId, {
        ...state,
        lastActiveSyncAt: active.fetchedAt,
      });
      state = getEntitySyncState(dayKey, params.globalEntityId);

      if (recoveryAuditRequired) {
        const recoveryAudit = await fetchOrdersWindow({
          token: params.token,
          globalEntityId: params.globalEntityId,
          pageSize: HISTORY_SYNC_PAGE_SIZE,
          window: syncWindow,
          nowIso,
        });

        upsertMirrorOrders(
          recoveryAudit.items
            .map((order) => normalizeMirrorOrder(order, dayKey, params.globalEntityId, recoveryAudit.fetchedAt))
            .filter((row): row is NormalizedMirrorOrder => Boolean(row)),
        );

        phaseFetchedAt.push(recoveryAudit.fetchedAt);
        upsertEntitySyncState(dayKey, params.globalEntityId, {
          ...state,
          lastHistorySyncAt: recoveryAudit.fetchedAt,
          lastFullHistorySweepAt: recoveryAudit.fetchedAt,
          lastHistoryCursorAt: syncWindow.endUtcIso,
        });
        state = getEntitySyncState(dayKey, params.globalEntityId);
      } else {
        const historyWindow = getHistoryWindow(dayKey, state, syncWindow.endUtcIso);
        const shouldRunHistory =
          historyWindow.shouldRun &&
          (params.force || !state?.lastHistorySyncAt || Date.now() - toMillis(state.lastHistorySyncAt) >= resolveOrdersHistorySyncSeconds() * 1000);

        if (shouldRunHistory) {
          const history = await fetchOrdersWindow({
            token: params.token,
            globalEntityId: params.globalEntityId,
            pageSize: HISTORY_SYNC_PAGE_SIZE,
            window: {
              startUtcIso: historyWindow.startUtcIso,
              endUtcIso: historyWindow.endUtcIso,
            },
            nowIso,
          });

          upsertMirrorOrders(
            history.items
              .map((order) => normalizeMirrorOrder(order, dayKey, params.globalEntityId, history.fetchedAt))
              .filter((row): row is NormalizedMirrorOrder => Boolean(row)),
          );

          phaseFetchedAt.push(history.fetchedAt);
          upsertEntitySyncState(dayKey, params.globalEntityId, {
            ...state,
            lastHistorySyncAt: history.fetchedAt,
            lastHistoryCursorAt: historyWindow.endUtcIso,
          });
          state = getEntitySyncState(dayKey, params.globalEntityId);
        }

        if (params.force || shouldRunRepair(state)) {
          const repair = await fetchOrdersWindow({
            token: params.token,
            globalEntityId: params.globalEntityId,
            pageSize: HISTORY_SYNC_PAGE_SIZE,
            window: syncWindow,
            nowIso,
          });

          upsertMirrorOrders(
            repair.items
              .map((order) => normalizeMirrorOrder(order, dayKey, params.globalEntityId, repair.fetchedAt))
              .filter((row): row is NormalizedMirrorOrder => Boolean(row)),
          );

          phaseFetchedAt.push(repair.fetchedAt);
          upsertEntitySyncState(dayKey, params.globalEntityId, {
            ...state,
            lastFullHistorySweepAt: repair.fetchedAt,
          });
          state = getEntitySyncState(dayKey, params.globalEntityId);
        }
      }
    }

    const latestFetchedAt = phaseFetchedAt.length
      ? phaseFetchedAt.reduce((latest, current) => (toMillis(current) > toMillis(latest) ? current : latest))
      : resolveFetchedAt(state) ?? nowIso;

    if (recoveryAuditRequired) {
      await drainTransportTypeEnrichment(dayKey, params.globalEntityId, params.token);
      await drainCancellationOwnerEnrichment(dayKey, params.globalEntityId, params.token);
    } else {
      await enrichTransportTypes(dayKey, params.globalEntityId, params.token);
      await enrichCancellationOwners(dayKey, params.globalEntityId, params.token);
    }

    markEntitySyncSuccess(dayKey, params.globalEntityId, latestFetchedAt, {
      ...state,
      bootstrapCompletedAt: state?.bootstrapCompletedAt ?? latestFetchedAt,
    });

    const entityStatus = buildEntityStatus(dayKey, params.globalEntityId, params.ordersRefreshSeconds);
    publishEntitySyncStatus(entityStatus);
    return {
      dayKey,
      globalEntityId: params.globalEntityId,
      success: true,
      fetchedAt: entityStatus.fetchedAt,
      cacheState: entityStatus.cacheState,
      consecutiveFailures: entityStatus.consecutiveFailures,
    } satisfies EntitySyncBaseResult;
  } catch (error: any) {
    const normalized = summarizeMirrorSyncError(error);
    markEntitySyncFailure(dayKey, params.globalEntityId, normalized);
    const entityStatus = buildEntityStatus(dayKey, params.globalEntityId, params.ordersRefreshSeconds);
    publishEntitySyncStatus(entityStatus);

    return {
      dayKey,
      globalEntityId: params.globalEntityId,
      success: false,
      fetchedAt: entityStatus.fetchedAt,
      cacheState: entityStatus.cacheState,
      consecutiveFailures: entityStatus.consecutiveFailures,
      error: normalized,
    } satisfies EntitySyncBaseResult;
  }
}

async function runEntitySync(params: {
  token: string;
  globalEntityId: string;
  ordersRefreshSeconds: number;
  force?: boolean;
}) {
  if (entitySyncInFlight) {
    return entitySyncInFlight;
  }

  entitySyncInFlight = entitySyncMutex
    .runExclusive(async () => performEntitySync(params))
    .finally(() => {
      entitySyncInFlight = null;
    });

  return entitySyncInFlight;
}

function buildSyncSummary(params: {
  branches: ResolvedBranchMapping[];
  dayKey: string;
  globalEntityId: string;
  ordersRefreshSeconds: number;
  base: EntitySyncBaseResult;
}): OrdersMirrorSyncSummary {
  const vendorIds = Array.from(new Set(params.branches.map((branch) => branch.ordersVendorId)));
  const entityStatus = buildEntityStatus(params.dayKey, params.globalEntityId, params.ordersRefreshSeconds);
  const statusesByVendor = new Map<OrdersVendorId, OrdersMirrorVendorSyncStatus>();

  for (const vendorId of vendorIds) {
    statusesByVendor.set(vendorId, {
      vendorId,
      cacheState: entityStatus.cacheState,
      fetchedAt: entityStatus.fetchedAt,
      consecutiveFailures: entityStatus.consecutiveFailures,
    });
  }

  return {
    dayKey: params.dayKey,
    totalVendors: vendorIds.length,
    successfulVendors: params.base.success ? vendorIds.length : 0,
    failedVendors: params.base.success ? 0 : vendorIds.length,
    updatedVendors: params.base.success ? vendorIds.length : 0,
    staleVendorCount: entityStatus.cacheState === "stale" ? vendorIds.length : 0,
    lastSuccessfulSyncAt: entityStatus.lastSuccessfulSyncAt,
    errors: params.base.error
      ? [
          {
            vendorIds,
            statusCode: params.base.error.statusCode,
            message: params.base.error.message,
          },
        ]
      : [],
    statusesByVendor,
  };
}

export function getMirrorVendorSyncStatus(params: {
  globalEntityId: string;
  vendorId: OrdersVendorId;
  ordersRefreshSeconds: number;
  dayKey?: string;
}): OrdersMirrorVendorSyncStatus {
  const dayKey = params.dayKey ?? getCairoDayKey();
  const entityStatus = buildEntityStatus(dayKey, params.globalEntityId, params.ordersRefreshSeconds);

  return {
    vendorId: params.vendorId,
    cacheState: entityStatus.cacheState,
    fetchedAt: entityStatus.fetchedAt,
    consecutiveFailures: entityStatus.consecutiveFailures,
  };
}

export async function syncOrdersMirror(params: {
  token: string;
  branches: ResolvedBranchMapping[];
  ordersRefreshSeconds: number;
  force?: boolean;
}): Promise<OrdersMirrorSyncSummary> {
  const globalEntityId = params.branches[0]?.globalEntityId ?? getGlobalEntityId();
  const base = await runEntitySync({
    token: params.token,
    globalEntityId,
    ordersRefreshSeconds: params.ordersRefreshSeconds,
    force: params.force,
  });

  return buildSyncSummary({
    branches: params.branches,
    dayKey: base.dayKey,
    globalEntityId,
    ordersRefreshSeconds: params.ordersRefreshSeconds,
    base,
  });
}

export function getMirrorBranchDetail(params: {
  globalEntityId: string;
  vendorId: OrdersVendorId;
  ordersRefreshSeconds: number;
  includePickerItems?: boolean;
  dayKey?: string;
}): MirrorOrdersDetail {
  return readMirrorBranchDetail({
    ...params,
    resolveEntityStatus: buildEntityStatus,
  });
}

export function getMirrorBranchPickers(params: {
  globalEntityId: string;
  vendorId: OrdersVendorId;
  ordersRefreshSeconds: number;
  dayKey?: string;
}) {
  return readMirrorBranchPickers({
    ...params,
    resolveEntityStatus: buildEntityStatus,
  });
}
