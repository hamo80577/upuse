import { migrate } from "../../config/db.js";
import { resolveSecurityConfig } from "../../config/security.js";
import { resolveStartupConfig } from "../../config/startup.js";
import { MonitorEngine } from "../../services/monitorEngine.js";
import { initializeLoginThrottleStore } from "../../services/loginThrottleStore.js";
import { startOrdersMirrorRuntime } from "../../services/ordersMirrorStore.js";
import { initializeScanoMasterProductEnrichmentRuntime } from "../../services/scanoMasterProductEnrichmentRuntime.js";
import { initializeScanoRunnerSessionStore } from "../../services/scanoRunnerSessionStore.js";
import { getSettings } from "../../services/settingsStore.js";
import { syncVendorCatalogFromCsv } from "../../services/vendorCatalogStore.js";

export function initializeRuntime() {
  migrate();
  initializeLoginThrottleStore();
  initializeScanoRunnerSessionStore();
  initializeScanoMasterProductEnrichmentRuntime();

  const startupConfig = resolveStartupConfig();
  if (startupConfig.syncVendorCatalogOnStartup && startupConfig.vendorCatalogCsvPath) {
    syncVendorCatalogFromCsv(startupConfig.vendorCatalogCsvPath);
  }

  getSettings();
  startOrdersMirrorRuntime();

  return {
    engine: new MonitorEngine(),
    securityConfig: resolveSecurityConfig(),
  };
}
