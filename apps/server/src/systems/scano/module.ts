import type { ServerSystemModule } from "../../core/systems/types.js";
import { resolveStartupConfig } from "../../config/startup.js";
import { initializeScanoMasterProductEnrichmentRuntime } from "../../services/scanoMasterProductEnrichmentRuntime.js";
import { initializeScanoRunnerSessionStore } from "../../services/scanoRunnerSessionStore.js";
import { syncVendorCatalogFromCsv } from "../../services/vendorCatalogStore.js";
import { applyScanoSchemaMigrations, ensureDefaultScanoSettingsRow } from "./db/migrations.js";
import { buildScanoSchemaSql, resetLegacyScanoTaskData } from "./db/schema.js";
import { hasScanoAccess } from "./policies/access.js";
import { registerScanoRoutes } from "./routes/registerRoutes.js";
import {
  scanoUserAccessAssignmentResolver,
  scanoUserAccessSynchronizer,
  scanoUserProjection,
} from "./services/userAccessSynchronizer.js";

export const scanoSystemModule: ServerSystemModule = {
  id: "scano",
  auth: {
    canAccessUser: hasScanoAccess,
    userAccessAssignmentResolvers: [scanoUserAccessAssignmentResolver],
    userAccessSynchronizers: [scanoUserAccessSynchronizer],
    userProjections: [scanoUserProjection],
  },
  db: {
    buildSchemaSql: buildScanoSchemaSql,
    runLegacyRepairs: resetLegacyScanoTaskData,
    applyMigrations: applyScanoSchemaMigrations,
    seedDefaults: ({ db, cryptoBox }) => {
      ensureDefaultScanoSettingsRow({
        db,
        cryptoBox: cryptoBox as { encrypt(value: string): string },
      });
    },
  },
  start: () => {
    initializeScanoRunnerSessionStore();
    initializeScanoMasterProductEnrichmentRuntime();

    const startupConfig = resolveStartupConfig();
    if (startupConfig.syncVendorCatalogOnStartup && startupConfig.vendorCatalogCsvPath) {
      syncVendorCatalogFromCsv(startupConfig.vendorCatalogCsvPath);
    }
  },
  registerRoutes: registerScanoRoutes,
};
