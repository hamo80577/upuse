import type Database from "better-sqlite3";

export function migrateBranchesTableToLocalCatalogShape(db: Database.Database) {
  const branchColumns = db.prepare("PRAGMA table_info(branches)").all() as Array<{ name: string }>;
  const expectedColumns = new Set([
    "id",
    "availabilityVendorId",
    "chainName",
    "enabled",
    "lateThresholdOverride",
    "lateReopenThresholdOverride",
    "unassignedThresholdOverride",
    "unassignedReopenThresholdOverride",
    "readyThresholdOverride",
    "readyReopenThresholdOverride",
    "capacityRuleEnabledOverride",
    "capacityPerHourEnabledOverride",
    "capacityPerHourLimitOverride",
  ]);
  const hasLateReopenThresholdOverride = branchColumns.some((column) => column.name === "lateReopenThresholdOverride");
  const hasUnassignedReopenThresholdOverride = branchColumns.some((column) => column.name === "unassignedReopenThresholdOverride");
  const hasReadyThresholdOverride = branchColumns.some((column) => column.name === "readyThresholdOverride");
  const hasReadyReopenThresholdOverride = branchColumns.some((column) => column.name === "readyReopenThresholdOverride");
  const hasCapacityRuleEnabledOverride = branchColumns.some((column) => column.name === "capacityRuleEnabledOverride");
  const hasCapacityPerHourEnabledOverride = branchColumns.some((column) => column.name === "capacityPerHourEnabledOverride");
  const hasCapacityPerHourLimitOverride = branchColumns.some((column) => column.name === "capacityPerHourLimitOverride");

  const requiresRebuild =
    branchColumns.length !== expectedColumns.size ||
    branchColumns.some((column) => !expectedColumns.has(column.name));

  if (!requiresRebuild) {
    db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_branches_availabilityVendorId ON branches(availabilityVendorId)");
    db.exec("DROP INDEX IF EXISTS idx_branches_ordersVendorId");
    return;
  }

  const runMigration = db.transaction(() => {
    db.exec(`
      DROP INDEX IF EXISTS idx_branches_ordersVendorId;
      DROP INDEX IF EXISTS idx_branches_availabilityVendorId;
      DROP TABLE IF EXISTS branches_next;

      CREATE TABLE branches_next (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        availabilityVendorId TEXT NOT NULL,
        chainName TEXT NOT NULL DEFAULT '',
        enabled INTEGER NOT NULL DEFAULT 1,
        lateThresholdOverride INTEGER,
        lateReopenThresholdOverride INTEGER,
        unassignedThresholdOverride INTEGER,
        unassignedReopenThresholdOverride INTEGER,
        readyThresholdOverride INTEGER,
        readyReopenThresholdOverride INTEGER,
        capacityRuleEnabledOverride INTEGER,
        capacityPerHourEnabledOverride INTEGER,
        capacityPerHourLimitOverride INTEGER
      );

      INSERT INTO branches_next (
        id,
        availabilityVendorId,
        chainName,
        enabled,
        lateThresholdOverride,
        lateReopenThresholdOverride,
        unassignedThresholdOverride,
        unassignedReopenThresholdOverride,
        readyThresholdOverride,
        readyReopenThresholdOverride,
        capacityRuleEnabledOverride,
        capacityPerHourEnabledOverride,
        capacityPerHourLimitOverride
      )
      SELECT
        id,
        availabilityVendorId,
        COALESCE(chainName, ''),
        CASE WHEN enabled IS NULL THEN 1 ELSE enabled END,
        lateThresholdOverride,
        ${hasLateReopenThresholdOverride ? "lateReopenThresholdOverride" : "NULL"},
        unassignedThresholdOverride,
        ${hasUnassignedReopenThresholdOverride ? "unassignedReopenThresholdOverride" : "NULL"},
        ${hasReadyThresholdOverride ? "readyThresholdOverride" : "NULL"},
        ${hasReadyReopenThresholdOverride ? "readyReopenThresholdOverride" : "NULL"},
        ${hasCapacityRuleEnabledOverride ? "capacityRuleEnabledOverride" : "NULL"},
        ${hasCapacityPerHourEnabledOverride ? "capacityPerHourEnabledOverride" : "NULL"},
        ${hasCapacityPerHourLimitOverride ? "capacityPerHourLimitOverride" : "NULL"}
      FROM branches;

      DROP TABLE branches;
      ALTER TABLE branches_next RENAME TO branches;

      CREATE UNIQUE INDEX idx_branches_availabilityVendorId ON branches(availabilityVendorId);
    `);
  });

  db.pragma("foreign_keys = OFF");
  try {
    runMigration();
  } finally {
    db.pragma("foreign_keys = ON");
  }
}
