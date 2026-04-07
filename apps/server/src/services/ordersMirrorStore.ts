import { DateTime } from "luxon";
import type { Statement } from "better-sqlite3";
import { db } from "../config/db.js";
import type {
  BranchLiveOrder,
  BranchPickerSummaryItem,
  BranchPickersSummary,
  OrdersMetrics,
  OrdersVendorId,
  ResolvedBranchMapping,
} from "../types/models.js";
import { TZ, cairoDayWindowUtc, cairoHourWindowUtc, isPastPickup, nowUtcIso } from "../utils/time.js";
import { Mutex } from "../utils/mutex.js";
import { listResolvedBranches } from "./branchStore.js";
import { getGlobalEntityId, getSettings } from "./settingsStore.js";
import { getWithRetry } from "./orders/httpClient.js";
import { createPageLimitError } from "./orders/paginationGuards.js";
import {
  resolveOrdersEntitySyncMaxPages,
  resolveOrdersHistorySyncSeconds,
  resolveOrdersRepairSweepSeconds,
  resolveOrdersWindowSplitMaxDepth,
  resolveOrdersWindowSplitMinSpanMs,
  splitUtcWindow,
  type UtcWindow,
} from "./orders/shared.js";
import { BASE } from "./orders/types.js";

const BOOTSTRAP_SYNC_PAGE_SIZE = 500;
const ACTIVE_SYNC_PAGE_SIZE = 500;
const HISTORY_SYNC_PAGE_SIZE = 500;
const HISTORY_OVERLAP_MS = 10 * 60 * 1000;
const PICKER_RECENT_ACTIVE_WINDOW_MS = 60 * 60 * 1000;

export type BranchDetailCacheState = "fresh" | "warming" | "stale";
export type MirrorSyncPhase = "bootstrap" | "active" | "history" | "repair";

interface OrdersMirrorRow {
  dayKey: string;
  globalEntityId: string;
  vendorId: number;
  vendorName: string | null;
  orderId: string;
  externalId: string;
  status: string;
  transportType: string | null;
  isCompleted: number;
  isCancelled: number;
  isUnassigned: number;
  placedAt: string | null;
  pickupAt: string | null;
  customerFirstName: string | null;
  shopperId: number | null;
  shopperFirstName: string | null;
  isActiveNow: number;
  lastSeenAt: string;
  lastActiveSeenAt: string | null;
  cancellationOwner: string | null;
  cancellationOwnerLookupAt: string | null;
  cancellationOwnerLookupError: string | null;
}

interface OrdersEntitySyncStateRow {
  dayKey: string;
  globalEntityId: string;
  lastBootstrapSyncAt: string | null;
  lastActiveSyncAt: string | null;
  lastHistorySyncAt: string | null;
  lastFullHistorySweepAt: string | null;
  lastSuccessfulSyncAt: string | null;
  lastHistoryCursorAt: string | null;
  consecutiveFailures: number;
  lastErrorAt: string | null;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  staleSince: string | null;
  bootstrapCompletedAt: string | null;
}

interface MirrorOrdersDetail {
  metrics: OrdersMetrics;
  fetchedAt: string | null;
  unassignedOrders: BranchLiveOrder[];
  preparingOrders: BranchLiveOrder[];
  pickers: BranchPickersSummary;
  cacheState: BranchDetailCacheState;
}

interface NormalizedMirrorOrder {
  dayKey: string;
  globalEntityId: string;
  vendorId: number;
  vendorName: string | null;
  orderId: string;
  externalId: string;
  status: string;
  transportType: string | null;
  isCompleted: number;
  isCancelled: number;
  isUnassigned: number;
  placedAt: string | null;
  pickupAt: string | null;
  customerFirstName: string | null;
  shopperId: number | null;
  shopperFirstName: string | null;
  isActiveNow: number;
  lastSeenAt: string;
  lastActiveSeenAt: string | null;
}

interface OrdersFetchResult {
  items: any[];
  fetchedAt: string;
}

interface EntitySyncError {
  statusCode?: number;
  code?: string;
  message: string;
}

interface EntitySyncBaseResult {
  dayKey: string;
  globalEntityId: string;
  success: boolean;
  fetchedAt: string | null;
  cacheState: BranchDetailCacheState;
  consecutiveFailures: number;
  error?: EntitySyncError;
}

interface OwnerLookupCandidate {
  dayKey: string;
  globalEntityId: string;
  vendorId: number;
  orderId: string;
}

interface TransportTypeLookupCandidate {
  dayKey: string;
  globalEntityId: string;
  vendorId: number;
  orderId: string;
}

export interface OrdersMirrorEntitySyncStatus {
  dayKey: string;
  globalEntityId: string;
  cacheState: BranchDetailCacheState;
  fetchedAt: string | null;
  lastSuccessfulSyncAt: string | null;
  consecutiveFailures: number;
  lastErrorMessage: string | null;
  bootstrapCompleted: boolean;
}

export interface OrdersMirrorVendorSyncStatus {
  vendorId: OrdersVendorId;
  cacheState: BranchDetailCacheState;
  fetchedAt: string | null;
  consecutiveFailures: number;
}

export interface OrdersMirrorSyncSummary {
  dayKey: string;
  totalVendors: number;
  successfulVendors: number;
  failedVendors: number;
  updatedVendors: number;
  staleVendorCount: number;
  lastSuccessfulSyncAt: string | null;
  errors: Array<{
    vendorIds: OrdersVendorId[];
    statusCode?: number;
    message: string;
  }>;
  statusesByVendor: Map<OrdersVendorId, OrdersMirrorVendorSyncStatus>;
}

let upsertMirrorOrderStatement: Statement<any[]> | null = null;

let updateCancellationLookupStatement: Statement<any[]> | null = null;
let updateTransportTypeLookupStatement: Statement<any[]> | null = null;

const entitySyncMutex = new Mutex();
const ownerLookupMutex = new Mutex();
const transportTypeLookupMutex = new Mutex();

let entitySyncInFlight: Promise<EntitySyncBaseResult> | null = null;
let runtimeStarted = false;
let runtimeTimer: NodeJS.Timeout | null = null;
const entitySyncSubscribers = new Set<(status: OrdersMirrorEntitySyncStatus) => void>();

function publishEntitySyncStatus(status: OrdersMirrorEntitySyncStatus) {
  for (const subscriber of entitySyncSubscribers) {
    try {
      subscriber(status);
    } catch (error) {
      console.error("Orders mirror subscriber failed", error);
    }
  }
}

export function subscribeOrdersMirrorEntitySync(fn: (status: OrdersMirrorEntitySyncStatus) => void) {
  entitySyncSubscribers.add(fn);
  return () => {
    entitySyncSubscribers.delete(fn);
  };
}

function emptyMetrics(): OrdersMetrics {
  return {
    totalToday: 0,
    cancelledToday: 0,
    doneToday: 0,
    activeNow: 0,
    lateNow: 0,
    unassignedNow: 0,
  };
}

function emptyPickers(): BranchPickersSummary {
  return {
    todayCount: 0,
    activePreparingCount: 0,
    recentActiveCount: 0,
    items: [],
  };
}

function getCairoDayKey(date = DateTime.utc()) {
  return date.setZone(TZ).toFormat("yyyy-LL-dd");
}

function getPreviousCairoDayKey(dayKey: string) {
  const day = DateTime.fromFormat(dayKey, "yyyy-LL-dd", { zone: TZ });
  return day.isValid ? day.minus({ days: 1 }).toFormat("yyyy-LL-dd") : dayKey;
}

function getDayWindow(dayKey = getCairoDayKey()) {
  const cairoStart = DateTime.fromFormat(dayKey, "yyyy-LL-dd", { zone: TZ }).startOf("day");
  if (!cairoStart.isValid) {
    return cairoDayWindowUtc(DateTime.utc());
  }

  return {
    startUtcIso: cairoStart.toUTC().toISO({ suppressMilliseconds: false })!,
    endUtcIso: cairoStart.endOf("day").toUTC().toISO({ suppressMilliseconds: false })!,
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

function stableOrderKey(order: any) {
  if (order?.id != null) return String(order.id);
  if (order?.externalId != null) return String(order.externalId);
  if (order?.shortCode != null) return String(order.shortCode);
  return "";
}

function toIsoOrNull(value: unknown) {
  return typeof value === "string" && value.trim().length ? value : null;
}

function resolveShopperId(order: any) {
  const raw = order?.shopper?.id;
  return typeof raw === "number" && Number.isFinite(raw)
    ? raw
    : typeof raw === "string" && raw.trim().length && Number.isFinite(Number(raw))
      ? Number(raw)
      : null;
}

function resolveShopperFirstName(order: any) {
  return typeof order?.shopper?.firstName === "string" && order.shopper.firstName.trim().length
    ? order.shopper.firstName.trim()
    : null;
}

function resolveVendorId(order: any) {
  const raw =
    typeof order?.vendor?.id !== "undefined"
      ? order.vendor.id
      : typeof order?.vendorId !== "undefined"
        ? order.vendorId
        : null;

  if (typeof raw === "number" && Number.isFinite(raw)) return Math.trunc(raw);
  if (typeof raw === "string" && raw.trim().length && Number.isFinite(Number(raw))) {
    return Math.trunc(Number(raw));
  }
  return 0;
}

function resolveVendorName(order: any) {
  if (typeof order?.vendor?.name === "string" && order.vendor.name.trim().length) {
    return order.vendor.name.trim();
  }
  if (typeof order?.vendorName === "string" && order.vendorName.trim().length) {
    return order.vendorName.trim();
  }
  return null;
}

export function extractTransportType(payload: unknown) {
  const transportType = (payload as { transportType?: unknown } | null | undefined)?.transportType;
  if (typeof transportType !== "string") return null;
  const normalized = transportType.trim().toUpperCase();
  return normalized.length ? normalized : null;
}

function normalizeMirrorOrder(order: any, dayKey: string, globalEntityId: string, nowIso: string): NormalizedMirrorOrder | null {
  const orderId = stableOrderKey(order);
  const vendorId = resolveVendorId(order);
  if (!orderId || !vendorId) return null;

  const isCompleted = Boolean(order?.isCompleted);
  const status = String(order?.status ?? "UNKNOWN");
  const isActiveNow = isCompleted ? 0 : 1;

  return {
    dayKey,
    globalEntityId,
    vendorId,
    vendorName: resolveVendorName(order),
    orderId,
    externalId: String(order?.externalId ?? order?.shortCode ?? order?.id ?? ""),
    status,
    transportType: extractTransportType(order),
    isCompleted: isCompleted ? 1 : 0,
    isCancelled: status === "CANCELLED" ? 1 : 0,
    isUnassigned: status === "UNASSIGNED" || order?.shopper == null ? 1 : 0,
    placedAt: toIsoOrNull(order?.placedAt),
    pickupAt: toIsoOrNull(order?.pickupAt),
    customerFirstName:
      typeof order?.customerFirstName === "string" && order.customerFirstName.trim().length
        ? order.customerFirstName.trim()
        : null,
    shopperId: resolveShopperId(order),
    shopperFirstName: resolveShopperFirstName(order),
    isActiveNow,
    lastSeenAt: nowIso,
    lastActiveSeenAt: isActiveNow ? nowIso : null,
  };
}

function toLiveOrder(row: OrdersMirrorRow, nowIso: string): BranchLiveOrder {
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

function toMillis(iso?: string | null) {
  if (!iso) return Number.NaN;
  const value = new Date(iso).getTime();
  return Number.isFinite(value) ? value : Number.NaN;
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

export function extractCancellationOwner(payload: unknown) {
  const owner = (payload as { cancellation?: { owner?: unknown } } | null | undefined)?.cancellation?.owner;
  if (typeof owner !== "string") return null;
  const normalized = owner.trim().toUpperCase();
  return normalized.length ? normalized : null;
}

function extractCancellationText(payload: unknown, key: "reason" | "stage" | "source") {
  const value = (payload as { cancellation?: Record<string, unknown> } | null | undefined)?.cancellation?.[key];
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized.length ? normalized : null;
}

function extractCancellationIso(payload: unknown, key: "createdAt" | "updatedAt") {
  const value = (payload as { cancellation?: Record<string, unknown> } | null | undefined)?.cancellation?.[key];
  return typeof value === "string" && value.trim().length ? value.trim() : null;
}

export function extractCancellationDetail(payload: unknown) {
  return {
    owner: extractCancellationOwner(payload),
    reason: extractCancellationText(payload, "reason"),
    stage: extractCancellationText(payload, "stage"),
    source: extractCancellationText(payload, "source"),
    createdAt: extractCancellationIso(payload, "createdAt"),
    updatedAt: extractCancellationIso(payload, "updatedAt"),
  };
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

function normalizeLookupError(error: any) {
  const status = typeof error?.response?.status === "number" ? error.response.status : null;
  const responseMessage =
    typeof error?.response?.data?.message === "string" && error.response.data.message.trim().length
      ? error.response.data.message.trim()
      : null;
  const baseMessage =
    responseMessage ||
    (typeof error?.message === "string" && error.message.trim().length ? error.message.trim() : "Cancellation lookup failed.");

  return {
    status,
    message: status ? `HTTP ${status}: ${baseMessage}` : baseMessage,
  };
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
    cancellation: extractCancellationDetail(response.data),
    transportType: extractTransportType(response.data),
  };
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

      upsertMirrorOrders(activeRows);
      replaceActiveOrders({
        dayKey,
        globalEntityId: params.globalEntityId,
        activeOrderIds: activeRows.map((row) => row.orderId),
      });
      phaseFetchedAt.push(active.fetchedAt);
      upsertEntitySyncState(dayKey, params.globalEntityId, {
        ...state,
        lastActiveSyncAt: active.fetchedAt,
      });
      state = getEntitySyncState(dayKey, params.globalEntityId);

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

    const latestFetchedAt = phaseFetchedAt.length
      ? phaseFetchedAt.reduce((latest, current) => (toMillis(current) > toMillis(latest) ? current : latest))
      : resolveFetchedAt(state) ?? nowIso;

    markEntitySyncSuccess(dayKey, params.globalEntityId, latestFetchedAt, {
      ...state,
      bootstrapCompletedAt: state?.bootstrapCompletedAt ?? latestFetchedAt,
    });

    await enrichTransportTypes(dayKey, params.globalEntityId, params.token);
    await enrichCancellationOwners(dayKey, params.globalEntityId, params.token);

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

function buildPickerFallbackName(shopperId: number, shopperFirstName: string | null) {
  return shopperFirstName && shopperFirstName.trim().length ? shopperFirstName.trim() : `Picker ${shopperId}`;
}

export function getMirrorBranchDetail(params: {
  globalEntityId: string;
  vendorId: OrdersVendorId;
  ordersRefreshSeconds: number;
  includePickerItems?: boolean;
  dayKey?: string;
}): MirrorOrdersDetail {
  const dayKey = params.dayKey ?? getCairoDayKey();
  const entityStatus = buildEntityStatus(dayKey, params.globalEntityId, params.ordersRefreshSeconds);
  const fetchedAt = entityStatus.fetchedAt;
  const cacheState = entityStatus.cacheState;
  const nowIso = nowUtcIso();
  const nowMs = Date.now();
  const recentActiveStartIso = new Date(nowMs - PICKER_RECENT_ACTIVE_WINDOW_MS).toISOString();

  const rows = db.prepare<[string, string, number], OrdersMirrorRow>(`
    SELECT
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
      lastActiveSeenAt,
      cancellationOwner,
      cancellationOwnerLookupAt,
      cancellationOwnerLookupError
    FROM orders_mirror
    WHERE dayKey = ? AND globalEntityId = ? AND vendorId = ?
  `).all(dayKey, params.globalEntityId, params.vendorId);

  const metrics = rows.length
    ? rows.reduce<OrdersMetrics>((current, row) => {
        current.totalToday += 1;
        if (row.isCancelled === 1) current.cancelledToday += 1;
        if (row.isCompleted === 1) current.doneToday += 1;
        if (row.isActiveNow === 1) {
          current.activeNow += 1;
          if (row.isUnassigned === 1) current.unassignedNow += 1;
          if (row.pickupAt && isPastPickup(nowIso, row.pickupAt)) current.lateNow += 1;
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

  const pickerCountRow = db.prepare<[string, string, string, string, number], {
    todayCount: number;
    activePreparingCount: number;
    recentActiveCount: number;
  }>(`
    SELECT
      COUNT(DISTINCT CASE WHEN shopperId IS NOT NULL THEN shopperId END) AS todayCount,
      COUNT(DISTINCT CASE WHEN shopperId IS NOT NULL AND isActiveNow = 1 AND isUnassigned = 0 THEN shopperId END) AS activePreparingCount,
      COUNT(DISTINCT CASE WHEN shopperId IS NOT NULL AND lastActiveSeenAt IS NOT NULL AND lastActiveSeenAt <= ? AND lastActiveSeenAt >= ? THEN shopperId END) AS recentActiveCount
    FROM orders_mirror
    WHERE dayKey = ? AND globalEntityId = ? AND vendorId = ?
  `).get(nowIso, recentActiveStartIso, dayKey, params.globalEntityId, params.vendorId) ?? {
    todayCount: 0,
    activePreparingCount: 0,
    recentActiveCount: 0,
  };

  let items: BranchPickerSummaryItem[] = [];
  if (params.includePickerItems !== false) {
    const pickerRows = db.prepare<[string, string, string, string, number], {
      shopperId: number;
      shopperFirstName: string | null;
      ordersToday: number;
      firstPickupAt: string | null;
      lastPickupAt: string | null;
      recentlyActive: number;
    }>(`
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
        MAX(CASE WHEN lastActiveSeenAt IS NOT NULL AND lastActiveSeenAt <= ? AND lastActiveSeenAt >= ? THEN 1 ELSE 0 END) AS recentlyActive
      FROM orders_mirror mirror
      WHERE dayKey = ? AND globalEntityId = ? AND vendorId = ? AND shopperId IS NOT NULL
      GROUP BY shopperId
      ORDER BY ordersToday DESC,
        CASE WHEN lastPickupAt IS NULL THEN 1 ELSE 0 END ASC,
        lastPickupAt DESC,
        LOWER(COALESCE(shopperFirstName, '')) ASC
    `).all(nowIso, recentActiveStartIso, dayKey, params.globalEntityId, params.vendorId);

    items = pickerRows.map((row) => ({
      shopperId: row.shopperId,
      shopperFirstName: buildPickerFallbackName(row.shopperId, row.shopperFirstName),
      ordersToday: row.ordersToday,
      firstPickupAt: row.firstPickupAt,
      lastPickupAt: row.lastPickupAt,
      recentlyActive: row.recentlyActive === 1,
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
      recentActiveCount: pickerCountRow.recentActiveCount ?? 0,
      items,
    },
    cacheState,
  };
}

export function getMirrorBranchPickers(params: {
  globalEntityId: string;
  vendorId: OrdersVendorId;
  ordersRefreshSeconds: number;
  dayKey?: string;
}) {
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

async function runRuntimeCycle() {
  const settings = getSettings();
  await syncOrdersMirror({
    token: settings.ordersToken,
    branches: listResolvedBranches(),
    ordersRefreshSeconds: settings.ordersRefreshSeconds,
  });
}

function clearRuntimeTimer() {
  if (!runtimeTimer) return;
  clearTimeout(runtimeTimer);
  runtimeTimer = null;
}

function scheduleRuntime(delayMs: number) {
  clearRuntimeTimer();
  runtimeTimer = setTimeout(async () => {
    runtimeTimer = null;
    try {
      await runRuntimeCycle();
    } catch {
      // Keep the runtime alive; state is already recorded in the sync table.
    } finally {
      if (runtimeStarted) {
        const settings = getSettings();
        scheduleRuntime(Math.max(5_000, settings.ordersRefreshSeconds * 1000));
      }
    }
  }, delayMs);
}

export function startOrdersMirrorRuntime() {
  if (runtimeStarted) return;
  runtimeStarted = true;
  scheduleRuntime(0);
}

export function stopOrdersMirrorRuntime() {
  runtimeStarted = false;
  clearRuntimeTimer();
}

export async function refreshOrdersMirrorNow() {
  const settings = getSettings();
  return syncOrdersMirror({
    token: settings.ordersToken,
    branches: listResolvedBranches(),
    ordersRefreshSeconds: settings.ordersRefreshSeconds,
    force: true,
  });
}
