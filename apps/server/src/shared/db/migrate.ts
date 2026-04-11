import { applyOrdersMirrorSchemaMigrations } from "./migrations/ordersMirrorMigrations.js";
import { applySharedSchemaMigrations } from "./migrations/sharedMigrations.js";
import { rotateStoredSettingsSecretsToPrimary, cryptoBox } from "./crypto.js";
import { migrateBranchesTableToLocalCatalogShape } from "./legacy/branchSchemaRepair.js";
import { ensurePrimaryAdminUser, migrateLegacyUserRoles } from "./legacy/userRepairs.js";
import { maybeSeedBootstrapAdmin } from "./seed/bootstrapAdmin.js";
import { backfillLegacyChainThresholds, ensureDefaultSettingsRow } from "./seed/defaultSettings.js";
import { buildSharedSchemaSql } from "./schema/sharedSchema.js";
import { db } from "./connection.js";
import { getServerSystems } from "../../core/systems/registry/index.js";

function dropLegacyBranchCatalogTables() {
  db.exec(`
    DROP TABLE IF EXISTS branch_catalog;
    DROP TABLE IF EXISTS branch_catalog_sync_state;
  `);
}

export function migrate() {
  db.exec(buildSharedSchemaSql());
  for (const system of getServerSystems()) {
    const schemaSql = system.db?.buildSchemaSql?.();
    if (schemaSql) {
      db.exec(schemaSql);
    }
  }

  migrateLegacyUserRoles(db);
  migrateBranchesTableToLocalCatalogShape(db);
  for (const system of getServerSystems()) {
    system.db?.runLegacyRepairs?.(db);
  }
  dropLegacyBranchCatalogTables();

  applySharedSchemaMigrations(db);
  ensurePrimaryAdminUser(db);

  for (const system of getServerSystems()) {
    system.db?.applyMigrations?.(db);
  }
  applyOrdersMirrorSchemaMigrations(db);

  ensureDefaultSettingsRow({
    db,
    cryptoBox,
    env: process.env,
  });
  for (const system of getServerSystems()) {
    system.db?.seedDefaults?.({
      db,
      cryptoBox,
      env: process.env,
    });
  }

  rotateStoredSettingsSecretsToPrimary();
  backfillLegacyChainThresholds(db);

  maybeSeedBootstrapAdmin(db, process.env);
  ensurePrimaryAdminUser(db);
}
