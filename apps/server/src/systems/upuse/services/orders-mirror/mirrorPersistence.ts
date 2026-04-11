import type { Statement } from "better-sqlite3";
import { db } from "../../../../config/db.js";
import type { DroppedActiveOrderCandidate, NormalizedMirrorOrder } from "./types.js";

let upsertMirrorOrderStatement: Statement<any[]> | null = null;

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

export function upsertMirrorOrders(rows: NormalizedMirrorOrder[]) {
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

export function replaceActiveOrders(params: {
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

export function listDroppedActiveOrderCandidates(params: {
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
