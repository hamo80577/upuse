import { LEGACY_DEV_SECRET } from "./secret.js";
import { resolveVendorCatalogCsvPath, type ResolvePathOptions } from "./paths.js";

export interface StartupConfig {
  syncVendorCatalogOnStartup: boolean;
  vendorCatalogCsvPath: string | null;
}

function isProductionEnv(env: NodeJS.ProcessEnv) {
  return env.NODE_ENV?.trim().toLowerCase() === "production";
}

function parseBooleanEnv(name: string, value: string | undefined) {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return false;
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  throw new Error(`${name} must be one of: 1, true, yes, on, 0, false, no, off.`);
}

export function resolveStartupConfig(options: ResolvePathOptions = {}): StartupConfig {
  const env = options.env ?? process.env;
  const production = isProductionEnv(env);
  const secret = env.UPUSE_SECRET?.trim() ?? "";

  if (production) {
    if (!secret) {
      throw new Error("UPUSE_SECRET is required in production.");
    }
    if (secret === LEGACY_DEV_SECRET) {
      throw new Error("UPUSE_SECRET must not use the legacy development secret in production.");
    }
  }

  const syncVendorCatalogOnStartup = parseBooleanEnv(
    "UPUSE_SYNC_VENDOR_CATALOG_ON_STARTUP",
    env.UPUSE_SYNC_VENDOR_CATALOG_ON_STARTUP,
  );

  if (!syncVendorCatalogOnStartup) {
    return {
      syncVendorCatalogOnStartup: false,
      vendorCatalogCsvPath: null,
    };
  }

  if (production && !env.UPUSE_VENDOR_CATALOG_CSV_PATH?.trim()) {
    throw new Error(
      "UPUSE_VENDOR_CATALOG_CSV_PATH is required when UPUSE_SYNC_VENDOR_CATALOG_ON_STARTUP is enabled in production.",
    );
  }

  return {
    syncVendorCatalogOnStartup: true,
    vendorCatalogCsvPath: resolveVendorCatalogCsvPath(options),
  };
}
