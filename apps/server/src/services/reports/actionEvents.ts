import { db } from "../../config/db.js";
import type { CloseReason, DashboardOperationCounts, OrdersMetrics, ResolvedBranchMapping } from "../../types/models.js";
import { buildActionEventsCsvContent, type ActionEventRow } from "./actionsCsv.js";
import { resolveReportRange } from "./range.js";

type ReopenMode = "MONITOR_RECOVERED" | "EXTERNAL_OPEN" | "SOURCE_TIMER";
type MonitorActionType = "TEMP_CLOSE" | "HIGH_DEMAND";

interface MonitorOperationCountRow {
  branchId: number;
  actionType: MonitorActionType;
  count: number;
}

function emptyOperationCounts(): DashboardOperationCounts {
  return {
    upuseTempClose: 0,
    upuseHighDemand: 0,
  };
}

function assignOperationCount(counts: DashboardOperationCounts, actionType: string, count: number) {
  if (actionType === "TEMP_CLOSE") {
    counts.upuseTempClose = count;
    return;
  }

  if (actionType === "HIGH_DEMAND") {
    counts.upuseHighDemand = count;
  }
}

export function recordMonitorCloseAction(params: {
  branch: ResolvedBranchMapping;
  at: string;
  reason: CloseReason;
  metrics: OrdersMetrics;
  closedUntil?: string;
  note?: string;
}) {
  const info = db.prepare(`
    INSERT INTO action_events (
      branchId,
      branchName,
      chainName,
      ordersVendorId,
      availabilityVendorId,
      source,
      actionType,
      ts,
      reason,
      note,
      closedUntil,
      totalToday,
      cancelledToday,
      doneToday,
      activeNow,
      lateNow,
      unassignedNow,
      onHoldNow
    )
    VALUES (
      @branchId,
      @branchName,
      @chainName,
      @ordersVendorId,
      @availabilityVendorId,
      'MONITOR',
      'TEMP_CLOSE',
      @ts,
      @reason,
      @note,
      @closedUntil,
      @totalToday,
      @cancelledToday,
      @doneToday,
      @activeNow,
      @lateNow,
      @unassignedNow,
      @onHoldNow
    )
  `).run({
    branchId: params.branch.id,
    branchName: params.branch.name,
    chainName: params.branch.chainName ?? "",
    ordersVendorId: params.branch.ordersVendorId,
    availabilityVendorId: params.branch.availabilityVendorId,
    ts: params.at,
    reason: params.reason,
    note: params.note ?? null,
    closedUntil: params.closedUntil ?? null,
    totalToday: params.metrics.totalToday,
    cancelledToday: params.metrics.cancelledToday,
    doneToday: params.metrics.doneToday,
    activeNow: params.metrics.activeNow,
    lateNow: params.metrics.lateNow,
    unassignedNow: params.metrics.unassignedNow,
    onHoldNow: params.metrics.onHoldNow ?? 0,
  });

  return Number(info.lastInsertRowid);
}

export function recordMonitorHighDemandAction(params: {
  branch: ResolvedBranchMapping;
  at: string;
  metrics: OrdersMetrics;
  highDemandUntil?: string | null;
  note?: string;
}) {
  db.prepare(`
    INSERT INTO action_events (
      branchId,
      branchName,
      chainName,
      ordersVendorId,
      availabilityVendorId,
      source,
      actionType,
      ts,
      reason,
      note,
      closedUntil,
      totalToday,
      cancelledToday,
      doneToday,
      activeNow,
      lateNow,
      unassignedNow,
      onHoldNow
    )
    VALUES (
      @branchId,
      @branchName,
      @chainName,
      @ordersVendorId,
      @availabilityVendorId,
      'MONITOR',
      'HIGH_DEMAND',
      @ts,
      NULL,
      @note,
      @highDemandUntil,
      @totalToday,
      @cancelledToday,
      @doneToday,
      @activeNow,
      @lateNow,
      @unassignedNow,
      @onHoldNow
    )
  `).run({
    branchId: params.branch.id,
    branchName: params.branch.name,
    chainName: params.branch.chainName ?? "",
    ordersVendorId: params.branch.ordersVendorId,
    availabilityVendorId: params.branch.availabilityVendorId,
    ts: params.at,
    note: params.note ?? null,
    highDemandUntil: params.highDemandUntil ?? null,
    totalToday: params.metrics.totalToday,
    cancelledToday: params.metrics.cancelledToday,
    doneToday: params.metrics.doneToday,
    activeNow: params.metrics.activeNow,
    lateNow: params.metrics.lateNow,
    unassignedNow: params.metrics.unassignedNow,
    onHoldNow: params.metrics.onHoldNow ?? 0,
  });
}

export function markCloseEventReopened(params: {
  eventId?: number | null;
  reopenedAt: string;
  mode: ReopenMode;
  note?: string;
}) {
  if (!params.eventId) return;

  db.prepare(`
    UPDATE action_events
    SET reopenedAt = COALESCE(reopenedAt, @reopenedAt),
        reopenMode = COALESCE(reopenMode, @reopenMode),
        note = CASE
          WHEN @note IS NULL OR @note = '' THEN note
          WHEN note IS NULL OR note = '' THEN @note
          ELSE note || ' | ' || @note
        END
    WHERE id = @id
  `).run({
    id: params.eventId,
    reopenedAt: params.reopenedAt,
    reopenMode: params.mode,
    note: params.note ?? null,
  });
}

export function buildActionEventsCsv(params: {
  preset: "today" | "yesterday" | "last7" | "last30" | "day";
  day?: string;
}) {
  const range = resolveReportRange(params);
  const rows = db.prepare(`
    SELECT
      branchName,
      chainName,
      ordersVendorId,
      availabilityVendorId,
      ts,
      reason,
      note,
      closedUntil,
      reopenedAt,
      reopenMode,
      totalToday,
      cancelledToday,
      doneToday,
      activeNow,
      lateNow,
      unassignedNow,
      onHoldNow
    FROM action_events
    WHERE source = 'MONITOR'
      AND actionType = 'TEMP_CLOSE'
      AND ts >= ? AND ts < ?
    ORDER BY ts ASC, branchName ASC
  `).all(range.fromIso, range.toIso) as ActionEventRow[];

  return buildActionEventsCsvContent({
    rows,
    fileSuffix: range.fileSuffix,
  });
}

export function listTodayMonitorOperationCountsByBranch(branchIds: readonly number[]) {
  const uniqueBranchIds = Array.from(new Set(
    branchIds.filter((branchId) => Number.isInteger(branchId) && branchId > 0),
  ));
  const countsByBranch = new Map<number, DashboardOperationCounts>();

  for (const branchId of uniqueBranchIds) {
    countsByBranch.set(branchId, emptyOperationCounts());
  }

  if (!uniqueBranchIds.length) {
    return countsByBranch;
  }

  const range = resolveReportRange({ preset: "today" });
  const placeholders = uniqueBranchIds.map(() => "?").join(", ");
  const rows = db.prepare(`
    SELECT branchId, actionType, COUNT(*) AS count
    FROM action_events
    WHERE source = 'MONITOR'
      AND actionType IN ('TEMP_CLOSE', 'HIGH_DEMAND')
      AND ts >= ? AND ts < ?
      AND branchId IN (${placeholders})
    GROUP BY branchId, actionType
  `).all(range.fromIso, range.toIso, ...uniqueBranchIds) as MonitorOperationCountRow[];

  for (const row of rows) {
    const counts = countsByBranch.get(row.branchId) ?? emptyOperationCounts();
    assignOperationCount(counts, row.actionType, Number(row.count) || 0);
    countsByBranch.set(row.branchId, counts);
  }

  return countsByBranch;
}
