import path from "node:path";
import { fileURLToPath } from "node:url";

export interface ResolvePathOptions {
  env?: NodeJS.ProcessEnv;
  serverRootDir?: string;
}

const DEFAULT_DB_FILE_NAME = "upuse.sqlite";

export function resolveServerRootDir() {
  return path.resolve(fileURLToPath(new URL("../../", import.meta.url)));
}

export function resolveDataDir(options: ResolvePathOptions = {}) {
  const serverRootDir = options.serverRootDir ?? resolveServerRootDir();
  const raw = options.env?.UPUSE_DATA_DIR?.trim();
  if (!raw) {
    return path.join(serverRootDir, "data");
  }

  return path.isAbsolute(raw)
    ? raw
    : path.resolve(serverRootDir, raw);
}

export function resolveDbFilePath(options: ResolvePathOptions = {}) {
  return path.join(resolveDataDir(options), DEFAULT_DB_FILE_NAME);
}
