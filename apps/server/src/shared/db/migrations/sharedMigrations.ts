import type Database from "better-sqlite3";

export function applySharedSchemaMigrations(db: Database.Database) {
  const settingsColumns = db.prepare("PRAGMA table_info(settings)").all() as Array<{ name: string }>;
  const userColumns = db.prepare("PRAGMA table_info(users)").all() as Array<{ name: string }>;

  if (!userColumns.some((column) => column.name === "upuseAccess")) {
    db.exec("ALTER TABLE users ADD COLUMN upuseAccess INTEGER NOT NULL DEFAULT 1");
  }
  if (!userColumns.some((column) => column.name === "isPrimaryAdmin")) {
    db.exec("ALTER TABLE users ADD COLUMN isPrimaryAdmin INTEGER NOT NULL DEFAULT 0");
  }

  db.exec("UPDATE users SET upuseAccess = 1 WHERE upuseAccess IS NULL");
  db.exec("UPDATE users SET isPrimaryAdmin = 0 WHERE isPrimaryAdmin IS NULL");

  if (!settingsColumns.some((column) => column.name === "chainNamesJson")) {
    db.exec("ALTER TABLE settings ADD COLUMN chainNamesJson TEXT NOT NULL DEFAULT '[]'");
  }
  if (!settingsColumns.some((column) => column.name === "chainThresholdsJson")) {
    db.exec("ALTER TABLE settings ADD COLUMN chainThresholdsJson TEXT NOT NULL DEFAULT '[]'");
  }
  if (!settingsColumns.some((column) => column.name === "readyThreshold")) {
    db.exec("ALTER TABLE settings ADD COLUMN readyThreshold INTEGER NOT NULL DEFAULT 0");
  }
  if (!settingsColumns.some((column) => column.name === "lateReopenThreshold")) {
    db.exec("ALTER TABLE settings ADD COLUMN lateReopenThreshold INTEGER NOT NULL DEFAULT 0");
  }
  if (!settingsColumns.some((column) => column.name === "unassignedReopenThreshold")) {
    db.exec("ALTER TABLE settings ADD COLUMN unassignedReopenThreshold INTEGER NOT NULL DEFAULT 0");
  }
  if (!settingsColumns.some((column) => column.name === "readyReopenThreshold")) {
    db.exec("ALTER TABLE settings ADD COLUMN readyReopenThreshold INTEGER NOT NULL DEFAULT 0");
  }

  const branchRuntimeColumns = db.prepare("PRAGMA table_info(branch_runtime)").all() as Array<{ name: string }>;
  if (!branchRuntimeColumns.some((column) => column.name === "lastExternalCloseUntil")) {
    db.exec("ALTER TABLE branch_runtime ADD COLUMN lastExternalCloseUntil TEXT");
  }
  if (!branchRuntimeColumns.some((column) => column.name === "lastExternalCloseAt")) {
    db.exec("ALTER TABLE branch_runtime ADD COLUMN lastExternalCloseAt TEXT");
  }
  if (!branchRuntimeColumns.some((column) => column.name === "lastUpuseCloseEventId")) {
    db.exec("ALTER TABLE branch_runtime ADD COLUMN lastUpuseCloseEventId INTEGER");
  }
  if (!branchRuntimeColumns.some((column) => column.name === "closureOwner")) {
    db.exec("ALTER TABLE branch_runtime ADD COLUMN closureOwner TEXT");
  }
  if (!branchRuntimeColumns.some((column) => column.name === "closureObservedUntil")) {
    db.exec("ALTER TABLE branch_runtime ADD COLUMN closureObservedUntil TEXT");
  }
  if (!branchRuntimeColumns.some((column) => column.name === "closureObservedAt")) {
    db.exec("ALTER TABLE branch_runtime ADD COLUMN closureObservedAt TEXT");
  }

  const branchesColumns = db.prepare("PRAGMA table_info(branches)").all() as Array<{ name: string }>;
  if (!branchesColumns.some((column) => column.name === "lateReopenThresholdOverride")) {
    db.exec("ALTER TABLE branches ADD COLUMN lateReopenThresholdOverride INTEGER");
  }
  if (!branchesColumns.some((column) => column.name === "unassignedReopenThresholdOverride")) {
    db.exec("ALTER TABLE branches ADD COLUMN unassignedReopenThresholdOverride INTEGER");
  }
  if (!branchesColumns.some((column) => column.name === "readyThresholdOverride")) {
    db.exec("ALTER TABLE branches ADD COLUMN readyThresholdOverride INTEGER");
  }
  if (!branchesColumns.some((column) => column.name === "readyReopenThresholdOverride")) {
    db.exec("ALTER TABLE branches ADD COLUMN readyReopenThresholdOverride INTEGER");
  }
  if (!branchesColumns.some((column) => column.name === "capacityPerHourEnabledOverride")) {
    db.exec("ALTER TABLE branches ADD COLUMN capacityPerHourEnabledOverride INTEGER");
  }
  if (!branchesColumns.some((column) => column.name === "capacityPerHourLimitOverride")) {
    db.exec("ALTER TABLE branches ADD COLUMN capacityPerHourLimitOverride INTEGER");
  }
}
