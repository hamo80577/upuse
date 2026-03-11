import { db } from "../config/db.js";
import type { AvailabilityState, BranchCatalogResolveStatus, BranchCatalogSyncState } from "../types/models.js";

interface BranchCatalogRow {
  availabilityVendorId: string;
  ordersVendorId: number | null;
  name: string | null;
  globalEntityId: string;
  availabilityState: AvailabilityState;
  changeable: number;
  presentInSource: number;
  resolveStatus: BranchCatalogResolveStatus;
  lastSeenAt: string | null;
  resolvedAt: string | null;
  lastError: string | null;
}

interface BranchCatalogSyncRow {
  globalEntityId: string;
  syncState: BranchCatalogSyncState;
  lastAttemptedAt: string | null;
  lastSyncedAt: string | null;
  lastError: string | null;
}

export interface StoredBranchCatalogItem {
  availabilityVendorId: string;
  ordersVendorId: number | null;
  name: string | null;
  globalEntityId: string;
  availabilityState: AvailabilityState;
  changeable: boolean;
  presentInSource: boolean;
  resolveStatus: BranchCatalogResolveStatus;
  lastSeenAt: string | null;
  resolvedAt: string | null;
  lastError: string | null;
}

export interface StoredBranchCatalogSyncState {
  globalEntityId: string;
  syncState: BranchCatalogSyncState;
  lastAttemptedAt: string | null;
  lastSyncedAt: string | null;
  lastError: string | null;
}

function mapBranchCatalogRow(row: BranchCatalogRow): StoredBranchCatalogItem {
  return {
    availabilityVendorId: row.availabilityVendorId,
    ordersVendorId: row.ordersVendorId,
    name: row.name,
    globalEntityId: row.globalEntityId,
    availabilityState: row.availabilityState,
    changeable: !!row.changeable,
    presentInSource: !!row.presentInSource,
    resolveStatus: row.resolveStatus,
    lastSeenAt: row.lastSeenAt,
    resolvedAt: row.resolvedAt,
    lastError: row.lastError,
  };
}

function mapSyncRow(row: BranchCatalogSyncRow | undefined, globalEntityId: string): StoredBranchCatalogSyncState {
  return {
    globalEntityId,
    syncState: row?.syncState ?? "stale",
    lastAttemptedAt: row?.lastAttemptedAt ?? null,
    lastSyncedAt: row?.lastSyncedAt ?? null,
    lastError: row?.lastError ?? null,
  };
}

export function listBranchCatalog(globalEntityId?: string): StoredBranchCatalogItem[] {
  const rows = globalEntityId
    ? db.prepare<[string], BranchCatalogRow>("SELECT * FROM branch_catalog WHERE globalEntityId = ? ORDER BY COALESCE(name, availabilityVendorId) ASC").all(globalEntityId)
    : db.prepare<[], BranchCatalogRow>("SELECT * FROM branch_catalog ORDER BY COALESCE(name, availabilityVendorId) ASC").all();
  return rows.map(mapBranchCatalogRow);
}

export function getBranchCatalogItem(availabilityVendorId: string): StoredBranchCatalogItem | null {
  const row = db
    .prepare<[string], BranchCatalogRow>("SELECT * FROM branch_catalog WHERE availabilityVendorId = ?")
    .get(availabilityVendorId);
  return row ? mapBranchCatalogRow(row) : null;
}

export function getBranchCatalogSyncState(globalEntityId: string): StoredBranchCatalogSyncState {
  const row = db
    .prepare<[string], BranchCatalogSyncRow>("SELECT * FROM branch_catalog_sync_state WHERE globalEntityId = ?")
    .get(globalEntityId);
  return mapSyncRow(row, globalEntityId);
}

export function setBranchCatalogSyncState(input: StoredBranchCatalogSyncState) {
  db.prepare(`
    INSERT INTO branch_catalog_sync_state (
      globalEntityId,
      syncState,
      lastAttemptedAt,
      lastSyncedAt,
      lastError
    )
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(globalEntityId) DO UPDATE SET
      syncState = excluded.syncState,
      lastAttemptedAt = excluded.lastAttemptedAt,
      lastSyncedAt = excluded.lastSyncedAt,
      lastError = excluded.lastError
  `).run(
    input.globalEntityId,
    input.syncState,
    input.lastAttemptedAt,
    input.lastSyncedAt,
    input.lastError,
  );
}

export function upsertBranchCatalogSources(items: Array<{
  availabilityVendorId: string;
  globalEntityId: string;
  availabilityState: AvailabilityState;
  changeable: boolean;
  lastSeenAt: string;
}>) {
  const run = db.transaction((rows: typeof items) => {
    const statement = db.prepare(`
      INSERT INTO branch_catalog (
        availabilityVendorId,
        ordersVendorId,
        name,
        globalEntityId,
        availabilityState,
        changeable,
        presentInSource,
        resolveStatus,
        lastSeenAt,
        resolvedAt,
        lastError
      )
      VALUES (
        @availabilityVendorId,
        NULL,
        NULL,
        @globalEntityId,
        @availabilityState,
        @changeable,
        1,
        'unresolved',
        @lastSeenAt,
        NULL,
        NULL
      )
      ON CONFLICT(availabilityVendorId) DO UPDATE SET
        globalEntityId = excluded.globalEntityId,
        availabilityState = excluded.availabilityState,
        changeable = excluded.changeable,
        presentInSource = 1,
        lastSeenAt = excluded.lastSeenAt
    `);

    for (const row of rows) {
      statement.run({
        ...row,
        changeable: row.changeable ? 1 : 0,
      });
    }
  });

  run(items);
}

export function markBranchCatalogMissing(globalEntityId: string, seenAvailabilityVendorIds: string[]) {
  const run = db.transaction((vendorIds: string[]) => {
    if (!vendorIds.length) {
      db.prepare("UPDATE branch_catalog SET presentInSource = 0 WHERE globalEntityId = ?").run(globalEntityId);
      return;
    }

    const placeholders = vendorIds.map(() => "?").join(", ");
    db.prepare(
      `UPDATE branch_catalog
       SET presentInSource = 0
       WHERE globalEntityId = ?
         AND availabilityVendorId NOT IN (${placeholders})`,
    ).run(globalEntityId, ...vendorIds);
  });

  run(seenAvailabilityVendorIds);
}

export function updateBranchCatalogResolution(input: {
  availabilityVendorId: string;
  ordersVendorId: number | null;
  name: string | null;
  resolveStatus: BranchCatalogResolveStatus;
  resolvedAt: string | null;
  lastError: string | null;
}) {
  db.prepare(`
    UPDATE branch_catalog
    SET ordersVendorId = ?,
        name = ?,
        resolveStatus = ?,
        resolvedAt = ?,
        lastError = ?
    WHERE availabilityVendorId = ?
  `).run(
    input.ordersVendorId,
    input.name,
    input.resolveStatus,
    input.resolvedAt,
    input.lastError,
    input.availabilityVendorId,
  );
}

export function clearMissingBranchCatalogRows(globalEntityId: string) {
  db.prepare("DELETE FROM branch_catalog WHERE globalEntityId = ? AND presentInSource = 0").run(globalEntityId);
}
