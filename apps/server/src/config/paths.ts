import path from "node:path";
import { fileURLToPath } from "node:url";

export interface ResolvePathOptions {
  env?: NodeJS.ProcessEnv;
  serverRootDir?: string;
}

const DEFAULT_DB_FILE_NAME = "upuse.sqlite";
const DEFAULT_VENDOR_CATALOG_FILE_NAME = "vendors.csv";

function isCrossPlatformAbsolutePath(value: string) {
  return path.isAbsolute(value) || /^[A-Za-z]:[\\/]/.test(value) || /^\\\\[^\\]+\\[^\\]+/.test(value);
}

function resolvePathFlavor(basePath: string) {
  return /^[A-Za-z]:[\\/]/.test(basePath) || /^\\\\[^\\]+\\[^\\]+/.test(basePath)
    ? path.win32
    : path;
}

export function resolveServerRootDir() {
  return path.resolve(fileURLToPath(new URL("../../", import.meta.url)));
}

export function resolveWorkspaceRootDir(serverRootDir = resolveServerRootDir()) {
  const pathFlavor = resolvePathFlavor(serverRootDir);
  return pathFlavor.resolve(serverRootDir, "..", "..");
}

export function resolveWebDistDir(serverRootDir = resolveServerRootDir()) {
  const workspaceRootDir = resolveWorkspaceRootDir(serverRootDir);
  return resolvePathFlavor(workspaceRootDir).join(workspaceRootDir, "apps", "web", "dist");
}

export function resolveVendorCatalogCsvPath(options: ResolvePathOptions = {}) {
  const serverRootDir = options.serverRootDir ?? resolveServerRootDir();
  const workspaceRootDir = resolveWorkspaceRootDir(serverRootDir);
  const pathFlavor = resolvePathFlavor(workspaceRootDir);
  const raw = options.env?.UPUSE_VENDOR_CATALOG_CSV_PATH?.trim();
  if (!raw) {
    return pathFlavor.join(workspaceRootDir, DEFAULT_VENDOR_CATALOG_FILE_NAME);
  }

  return isCrossPlatformAbsolutePath(raw)
    ? raw
    : pathFlavor.resolve(workspaceRootDir, raw);
}

export function resolveDataDir(options: ResolvePathOptions = {}) {
  const serverRootDir = options.serverRootDir ?? resolveServerRootDir();
  const pathFlavor = resolvePathFlavor(serverRootDir);
  const raw = options.env?.UPUSE_DATA_DIR?.trim();
  if (!raw) {
    return pathFlavor.join(serverRootDir, "data");
  }

  return isCrossPlatformAbsolutePath(raw)
    ? raw
    : pathFlavor.resolve(serverRootDir, raw);
}

export function resolveDbFilePath(options: ResolvePathOptions = {}) {
  const dataDir = resolveDataDir(options);
  return resolvePathFlavor(dataDir).join(dataDir, DEFAULT_DB_FILE_NAME);
}
