import { DateTime } from "luxon";
import { db } from "../../../../config/db.js";
import type { OrdersVendorId } from "../../../../types/models.js";
import { cairoHourWindowUtc } from "../../../../utils/time.js";
import {
  getMirrorBranchDetail as readMirrorBranchDetail,
  getMirrorBranchPickers as readMirrorBranchPickers,
} from "./branchDetail.js";
import { buildEntityStatus } from "./syncState.js";
import { getCairoDayKey } from "./timeWindows.js";
import type { MirrorOrdersDetail, OrdersMirrorVendorSyncStatus } from "./types.js";

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
