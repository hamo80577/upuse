import type Database from "better-sqlite3";

export function applyOrdersMirrorSchemaMigrations(db: Database.Database) {
  const ordersSyncStateColumns = db.prepare("PRAGMA table_info(orders_sync_state)").all() as Array<{ name: string }>;
  if (!ordersSyncStateColumns.some((column) => column.name === "lastSuccessfulSyncAt")) {
    db.exec("ALTER TABLE orders_sync_state ADD COLUMN lastSuccessfulSyncAt TEXT");
  }
  if (!ordersSyncStateColumns.some((column) => column.name === "lastHistoryCursorAt")) {
    db.exec("ALTER TABLE orders_sync_state ADD COLUMN lastHistoryCursorAt TEXT");
  }
  if (!ordersSyncStateColumns.some((column) => column.name === "consecutiveFailures")) {
    db.exec("ALTER TABLE orders_sync_state ADD COLUMN consecutiveFailures INTEGER NOT NULL DEFAULT 0");
  }
  if (!ordersSyncStateColumns.some((column) => column.name === "lastErrorAt")) {
    db.exec("ALTER TABLE orders_sync_state ADD COLUMN lastErrorAt TEXT");
  }
  if (!ordersSyncStateColumns.some((column) => column.name === "lastErrorCode")) {
    db.exec("ALTER TABLE orders_sync_state ADD COLUMN lastErrorCode TEXT");
  }
  if (!ordersSyncStateColumns.some((column) => column.name === "lastErrorMessage")) {
    db.exec("ALTER TABLE orders_sync_state ADD COLUMN lastErrorMessage TEXT");
  }
  if (!ordersSyncStateColumns.some((column) => column.name === "staleSince")) {
    db.exec("ALTER TABLE orders_sync_state ADD COLUMN staleSince TEXT");
  }
  if (!ordersSyncStateColumns.some((column) => column.name === "quarantinedUntil")) {
    db.exec("ALTER TABLE orders_sync_state ADD COLUMN quarantinedUntil TEXT");
  }

  const ordersMirrorColumns = db.prepare("PRAGMA table_info(orders_mirror)").all() as Array<{ name: string }>;
  if (!ordersMirrorColumns.some((column) => column.name === "vendorName")) {
    db.exec("ALTER TABLE orders_mirror ADD COLUMN vendorName TEXT");
  }
  if (!ordersMirrorColumns.some((column) => column.name === "transportType")) {
    db.exec("ALTER TABLE orders_mirror ADD COLUMN transportType TEXT");
  }
  if (!ordersMirrorColumns.some((column) => column.name === "cancellationOwner")) {
    db.exec("ALTER TABLE orders_mirror ADD COLUMN cancellationOwner TEXT");
  }
  if (!ordersMirrorColumns.some((column) => column.name === "cancellationReason")) {
    db.exec("ALTER TABLE orders_mirror ADD COLUMN cancellationReason TEXT");
  }
  if (!ordersMirrorColumns.some((column) => column.name === "cancellationStage")) {
    db.exec("ALTER TABLE orders_mirror ADD COLUMN cancellationStage TEXT");
  }
  if (!ordersMirrorColumns.some((column) => column.name === "cancellationSource")) {
    db.exec("ALTER TABLE orders_mirror ADD COLUMN cancellationSource TEXT");
  }
  if (!ordersMirrorColumns.some((column) => column.name === "cancellationCreatedAt")) {
    db.exec("ALTER TABLE orders_mirror ADD COLUMN cancellationCreatedAt TEXT");
  }
  if (!ordersMirrorColumns.some((column) => column.name === "cancellationUpdatedAt")) {
    db.exec("ALTER TABLE orders_mirror ADD COLUMN cancellationUpdatedAt TEXT");
  }
  if (!ordersMirrorColumns.some((column) => column.name === "cancellationOwnerLookupAt")) {
    db.exec("ALTER TABLE orders_mirror ADD COLUMN cancellationOwnerLookupAt TEXT");
  }
  if (!ordersMirrorColumns.some((column) => column.name === "cancellationOwnerLookupError")) {
    db.exec("ALTER TABLE orders_mirror ADD COLUMN cancellationOwnerLookupError TEXT");
  }
  if (!ordersMirrorColumns.some((column) => column.name === "transportTypeLookupAt")) {
    db.exec("ALTER TABLE orders_mirror ADD COLUMN transportTypeLookupAt TEXT");
  }
  if (!ordersMirrorColumns.some((column) => column.name === "transportTypeLookupError")) {
    db.exec("ALTER TABLE orders_mirror ADD COLUMN transportTypeLookupError TEXT");
  }

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_orders_mirror_status
      ON orders_mirror(dayKey, globalEntityId, vendorId, status);
    CREATE INDEX IF NOT EXISTS idx_orders_mirror_cancelled_lookup
      ON orders_mirror(dayKey, globalEntityId, isCancelled, cancellationOwner, cancellationOwnerLookupAt);
    CREATE INDEX IF NOT EXISTS idx_orders_mirror_transport_lookup
      ON orders_mirror(dayKey, globalEntityId, transportType, transportTypeLookupAt);
  `);

  const ordersEntitySyncStateColumns = db.prepare("PRAGMA table_info(orders_entity_sync_state)").all() as Array<{ name: string }>;
  if (!ordersEntitySyncStateColumns.some((column) => column.name === "lastSuccessfulSyncAt")) {
    db.exec("ALTER TABLE orders_entity_sync_state ADD COLUMN lastSuccessfulSyncAt TEXT");
  }
  if (!ordersEntitySyncStateColumns.some((column) => column.name === "lastHistoryCursorAt")) {
    db.exec("ALTER TABLE orders_entity_sync_state ADD COLUMN lastHistoryCursorAt TEXT");
  }
  if (!ordersEntitySyncStateColumns.some((column) => column.name === "consecutiveFailures")) {
    db.exec("ALTER TABLE orders_entity_sync_state ADD COLUMN consecutiveFailures INTEGER NOT NULL DEFAULT 0");
  }
  if (!ordersEntitySyncStateColumns.some((column) => column.name === "lastErrorAt")) {
    db.exec("ALTER TABLE orders_entity_sync_state ADD COLUMN lastErrorAt TEXT");
  }
  if (!ordersEntitySyncStateColumns.some((column) => column.name === "lastErrorCode")) {
    db.exec("ALTER TABLE orders_entity_sync_state ADD COLUMN lastErrorCode TEXT");
  }
  if (!ordersEntitySyncStateColumns.some((column) => column.name === "lastErrorMessage")) {
    db.exec("ALTER TABLE orders_entity_sync_state ADD COLUMN lastErrorMessage TEXT");
  }
  if (!ordersEntitySyncStateColumns.some((column) => column.name === "staleSince")) {
    db.exec("ALTER TABLE orders_entity_sync_state ADD COLUMN staleSince TEXT");
  }
  if (!ordersEntitySyncStateColumns.some((column) => column.name === "bootstrapCompletedAt")) {
    db.exec("ALTER TABLE orders_entity_sync_state ADD COLUMN bootstrapCompletedAt TEXT");
  }
}
