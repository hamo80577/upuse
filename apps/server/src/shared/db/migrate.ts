import { applyOrdersMirrorSchemaMigrations } from "./migrations/ordersMirrorMigrations.js";
import { applySharedSchemaMigrations } from "./migrations/sharedMigrations.js";
import { rotateStoredSettingsSecretsToPrimary, cryptoBox } from "./crypto.js";
import { migrateBranchesTableToLocalCatalogShape } from "./legacy/branchSchemaRepair.js";
import { ensurePrimaryAdminUser, migrateLegacyUserRoles } from "./legacy/userRepairs.js";
import { maybeSeedBootstrapAdmin } from "./seed/bootstrapAdmin.js";
import { backfillLegacyChainThresholds, ensureDefaultSettingsRow } from "./seed/defaultSettings.js";
import { buildSharedSchemaSql } from "./schema/sharedSchema.js";
import { db } from "./connection.js";
import { applyScanoSchemaMigrations, ensureDefaultScanoSettingsRow } from "../../systems/scano/db/migrations.js";
import { buildScanoSchemaSql, resetLegacyScanoTaskData } from "../../systems/scano/db/schema.js";

function dropLegacyBranchCatalogTables() {
  db.exec(`
    DROP TABLE IF EXISTS branch_catalog;
    DROP TABLE IF EXISTS branch_catalog_sync_state;
  `);
}

export function migrate() {
  db.exec(buildSharedSchemaSql());
  db.exec(buildScanoSchemaSql());

  migrateLegacyUserRoles(db);
  migrateBranchesTableToLocalCatalogShape(db);
  resetLegacyScanoTaskData(db);
  dropLegacyBranchCatalogTables();

  applySharedSchemaMigrations(db);
  ensurePrimaryAdminUser(db);

  applyScanoSchemaMigrations(db);
  applyOrdersMirrorSchemaMigrations(db);

  ensureDefaultSettingsRow({
    db,
    cryptoBox,
    env: process.env,
  });
  ensureDefaultScanoSettingsRow({
    db,
    cryptoBox,
  });

  rotateStoredSettingsSecretsToPrimary();
  backfillLegacyChainThresholds(db);

  maybeSeedBootstrapAdmin(db, process.env);
  ensurePrimaryAdminUser(db);
}
