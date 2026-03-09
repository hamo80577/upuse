import { db } from "../../config/db.js";
import { buildActionEventsCsvContent } from "./actionsCsv.js";
import { resolveReportRange } from "./range.js";
export function recordMonitorCloseAction(params) {
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
      unassignedNow
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
      @unassignedNow
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
    });
    return Number(info.lastInsertRowid);
}
export function markCloseEventReopened(params) {
    if (!params.eventId)
        return;
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
export function buildActionEventsCsv(params) {
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
      unassignedNow
    FROM action_events
    WHERE ts >= ? AND ts < ?
    ORDER BY ts ASC, branchName ASC
  `).all(range.fromIso, range.toIso);
    return buildActionEventsCsvContent({
        rows,
        fileSuffix: range.fileSuffix,
    });
}
