import { db } from "../../../../config/db.js";
import type {
  BranchPickerSummaryItem,
  BranchPickersSummary,
  OrdersMetrics,
  OrdersVendorId,
} from "../../../../types/models.js";
import {
  accumulateCanonicalOrdersMetrics,
  classifyCanonicalOrderMetrics,
  createEmptyCanonicalOrdersMetrics,
  toCanonicalLiveOrder,
} from "../../../../services/orders/canonicalMetrics.js";
import { nowUtcIso } from "../../../../utils/time.js";
import type {
  MirrorOrdersDetail,
  OrdersMirrorEntitySyncStatus,
  OrdersMirrorRow,
} from "./types.js";
import { PICKER_RECENT_ACTIVE_WINDOW_MS } from "./types.js";
import { getCairoDayKey, toMillis } from "./timeWindows.js";

function emptyMetrics(): OrdersMetrics {
  return createEmptyCanonicalOrdersMetrics();
}

function emptyPickers(): BranchPickersSummary {
  return {
    todayCount: 0,
    activePreparingCount: 0,
    recentActiveCount: 0,
    items: [],
  };
}

function resolveSnapshotVersion(fetchedAt: string | null | undefined) {
  if (!fetchedAt) return null;
  return fetchedAt;
}

function resolveStaleAgeSeconds(fetchedAt: string | null | undefined, cacheState: MirrorOrdersDetail["cacheState"]) {
  if (!fetchedAt || cacheState !== "stale") return null;
  const ageMs = Date.now() - toMillis(fetchedAt);
  if (!Number.isFinite(ageMs) || ageMs < 0) return null;
  return Math.floor(ageMs / 1000);
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
  resolveEntityStatus: (dayKey: string, globalEntityId: string, ordersRefreshSeconds: number) => OrdersMirrorEntitySyncStatus;
}): MirrorOrdersDetail {
  const dayKey = params.dayKey ?? getCairoDayKey();
  const entityStatus = params.resolveEntityStatus(dayKey, params.globalEntityId, params.ordersRefreshSeconds);
  const fetchedAt = entityStatus.fetchedAt;
  const cacheState = entityStatus.cacheState;
  const snapshotVersion = resolveSnapshotVersion(entityStatus.lastSuccessfulSyncAt ?? fetchedAt);
  const staleAgeSeconds = resolveStaleAgeSeconds(fetchedAt, cacheState);
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
  const classifiedRows = rows.map((row) => {
    const metrics = classifyCanonicalOrderMetrics({
      orderId: row.orderId,
      externalId: row.externalId,
      status: row.status,
      isCompleted: row.isCompleted,
      isCancelled: row.isCancelled,
      isActiveNow: row.isActiveNow,
      pickupAt: row.pickupAt,
      isUnassigned: row.isUnassigned,
      shopperId: row.shopperId,
      customerFirstName: row.customerFirstName,
      shopperFirstName: row.shopperFirstName,
      placedAt: row.placedAt,
    }, nowIso);

    return {
      row,
      metrics,
      liveOrder: toCanonicalLiveOrder(row, metrics),
    };
  });

  const metrics = classifiedRows.length
      ? classifiedRows.reduce<OrdersMetrics>((current, { row, metrics: rowMetrics }) => (
        accumulateCanonicalOrdersMetrics(current, row, rowMetrics)
      ), emptyMetrics())
    : emptyMetrics();

  const unassignedOrders = classifiedRows
    .filter(({ metrics: rowMetrics }) => rowMetrics.isUnassigned)
    .sort((left, right) => toMillis(left.row.placedAt) - toMillis(right.row.placedAt))
    .map(({ liveOrder }) => liveOrder);

  const preparingOrders = classifiedRows
    .filter(({ metrics: rowMetrics }) => rowMetrics.isInPrep)
    .sort((left, right) => toMillis(left.row.pickupAt) - toMillis(right.row.pickupAt))
    .map(({ liveOrder }) => liveOrder);

  const readyToPickupOrders = classifiedRows
    .filter(({ metrics: rowMetrics }) => rowMetrics.isReadyToPickup)
    .sort((left, right) => toMillis(left.row.pickupAt) - toMillis(right.row.pickupAt))
    .map(({ liveOrder }) => liveOrder);

  const pickerSummaryById = new Map<number, {
    shopperId: number;
    shopperFirstName: string;
    ordersToday: number;
    firstPickupAt: string | null;
    lastPickupAt: string | null;
    recentlyActive: boolean;
    activePreparing: boolean;
  }>();

  for (const { row, metrics: rowMetrics } of classifiedRows) {
    if (row.shopperId == null) continue;

    const existing = pickerSummaryById.get(row.shopperId) ?? {
      shopperId: row.shopperId,
      shopperFirstName: buildPickerFallbackName(row.shopperId, row.shopperFirstName),
      ordersToday: 0,
      firstPickupAt: null,
      lastPickupAt: null,
      recentlyActive: false,
      activePreparing: false,
    };

    existing.ordersToday += 1;
    if (row.shopperFirstName?.trim()) {
      existing.shopperFirstName = row.shopperFirstName.trim();
    }
    if (row.pickupAt) {
      if (!existing.firstPickupAt || toMillis(row.pickupAt) < toMillis(existing.firstPickupAt)) {
        existing.firstPickupAt = row.pickupAt;
      }
      if (!existing.lastPickupAt || toMillis(row.pickupAt) > toMillis(existing.lastPickupAt)) {
        existing.lastPickupAt = row.pickupAt;
      }
    }
    existing.activePreparing = existing.activePreparing || rowMetrics.isInPrep;
    if (row.lastActiveSeenAt) {
      const lastActiveSeenAtMs = toMillis(row.lastActiveSeenAt);
      const recentActiveStartMs = toMillis(recentActiveStartIso);
      const nowMs = toMillis(nowIso);
      if (
        Number.isFinite(lastActiveSeenAtMs) &&
        Number.isFinite(recentActiveStartMs) &&
        Number.isFinite(nowMs) &&
        lastActiveSeenAtMs >= recentActiveStartMs &&
        lastActiveSeenAtMs <= nowMs
      ) {
        existing.recentlyActive = true;
      }
    }

    pickerSummaryById.set(row.shopperId, existing);
  }

  let items: BranchPickerSummaryItem[] = [];
  const pickerSummaries = Array.from(pickerSummaryById.values())
    .sort((left, right) =>
      right.ordersToday - left.ordersToday ||
      (left.lastPickupAt ? 0 : 1) - (right.lastPickupAt ? 0 : 1) ||
      toMillis(right.lastPickupAt) - toMillis(left.lastPickupAt) ||
      left.shopperFirstName.localeCompare(right.shopperFirstName)
    );

  if (params.includePickerItems !== false) {
    items = pickerSummaries.map((row) => ({
      shopperId: row.shopperId,
      shopperFirstName: row.shopperFirstName,
      ordersToday: row.ordersToday,
      firstPickupAt: row.firstPickupAt,
      lastPickupAt: row.lastPickupAt,
      recentlyActive: row.recentlyActive,
    }));
  }

  return {
    metrics,
    fetchedAt,
    snapshotVersion,
    staleAgeSeconds,
    unassignedOrders,
    preparingOrders,
    readyToPickupOrders,
    pickers: {
      todayCount: pickerSummaries.length,
      activePreparingCount: pickerSummaries.reduce((count, row) => count + (row.activePreparing ? 1 : 0), 0),
      recentActiveCount: pickerSummaries.reduce((count, row) => count + (row.recentlyActive ? 1 : 0), 0),
      items,
    },
    cacheState,
  };
}

export function getMirrorBranchPickers(params: Omit<Parameters<typeof getMirrorBranchDetail>[0], "includePickerItems">) {
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
