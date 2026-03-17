import path from "node:path";
import { fileURLToPath } from "node:url";

export interface ResolvePathOptions {
  env?: NodeJS.ProcessEnv;
  serverRootDir?: string;
}

const DEFAULT_VENDOR_CATALOG_FILE_NAME = "vendors.csv";

export function resolveServerRootDir() {
  return path.resolve(fileURLToPath(new URL("../../", import.meta.url)));
}

export function resolveWorkspaceRootDir(serverRootDir = resolveServerRootDir()) {
  return path.resolve(serverRootDir, "..", "..");
}

export function resolveWebDistDir(serverRootDir = resolveServerRootDir()) {
  return path.join(resolveWorkspaceRootDir(serverRootDir), "apps", "web", "dist");
}

export function resolveVendorCatalogCsvPath(options: ResolvePathOptions = {}) {
  const serverRootDir = options.serverRootDir ?? resolveServerRootDir();
  const workspaceRootDir = resolveWorkspaceRootDir(serverRootDir);
  const raw = options.env?.UPUSE_VENDOR_CATALOG_CSV_PATH?.trim();
  if (!raw) {
    return path.join(workspaceRootDir, DEFAULT_VENDOR_CATALOG_FILE_NAME);
  }

  return path.isAbsolute(raw)
    ? raw
    : path.resolve(workspaceRootDir, raw);
}
