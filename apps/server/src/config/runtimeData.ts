import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { resolveServerRootDir, resolveWorkspaceRootDir, type ResolvePathOptions } from "./paths.js";
import { DEV_SECRET_FILE_NAME } from "./secret.js";

export const RUNTIME_DATABASE_FILE_NAME = "upuse.sqlite";

const APP_RUNTIME_DIR_NAME = "UPuse";
const DEV_RUNTIME_DIR_NAME = ".upuse-data";
const RUNTIME_MIGRATION_FILE_ORDER = [
  `${RUNTIME_DATABASE_FILE_NAME}-wal`,
  `${RUNTIME_DATABASE_FILE_NAME}-shm`,
  DEV_SECRET_FILE_NAME,
  RUNTIME_DATABASE_FILE_NAME,
] as const;

interface RuntimeDataOptions extends ResolvePathOptions {
  homeDir?: string;
  platform?: NodeJS.Platform;
}

interface PrepareRuntimeDataOptions extends RuntimeDataOptions {
  log?: (message: string) => void;
  warn?: (message: string) => void;
}

export interface PreparedRuntimeData {
  dataDir: string;
  dbFilePath: string;
  migratedFrom: string | null;
}

interface LegacyRuntimeDataCandidate {
  description: string;
  dir: string;
}

function isProductionEnv(env: NodeJS.ProcessEnv) {
  return env.NODE_ENV?.trim().toLowerCase() === "production";
}

function normalizePathForComparison(value: string) {
  const resolved = path.resolve(value);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function isSamePath(left: string, right: string) {
  return normalizePathForComparison(left) === normalizePathForComparison(right);
}

function isPathInside(parentDir: string, candidateDir: string) {
  const relativePath = path.relative(
    normalizePathForComparison(parentDir),
    normalizePathForComparison(candidateDir),
  );

  return relativePath === "" || (!relativePath.startsWith("..") && !path.isAbsolute(relativePath));
}

function resolveProductionBaseDataDir(options: RuntimeDataOptions = {}) {
  const env = options.env ?? process.env;
  const homeDir = options.homeDir ?? os.homedir();
  const platform = options.platform ?? process.platform;

  if (platform === "win32") {
    return env.LOCALAPPDATA?.trim() || env.APPDATA?.trim() || path.join(homeDir, "AppData", "Local");
  }

  if (platform === "darwin") {
    return path.join(homeDir, "Library", "Application Support");
  }

  return env.XDG_DATA_HOME?.trim() || path.join(homeDir, ".local", "share");
}

function resolveDefaultRuntimeDataDir(options: RuntimeDataOptions = {}) {
  const env = options.env ?? process.env;
  const serverRootDir = options.serverRootDir ?? resolveServerRootDir();

  if (isProductionEnv(env)) {
    return path.join(resolveProductionBaseDataDir(options), APP_RUNTIME_DIR_NAME);
  }

  return path.join(resolveWorkspaceRootDir(serverRootDir), DEV_RUNTIME_DIR_NAME);
}

export function resolveRuntimeDataDir(options: RuntimeDataOptions = {}) {
  const env = options.env ?? process.env;
  const serverRootDir = options.serverRootDir ?? resolveServerRootDir();
  const explicit = env.UPUSE_DATA_DIR?.trim();

  if (!explicit) {
    return resolveDefaultRuntimeDataDir({ ...options, env, serverRootDir });
  }

  return path.resolve(path.isAbsolute(explicit) ? explicit : path.resolve(serverRootDir, explicit));
}

export function resolveRuntimeDbFilePath(options: RuntimeDataOptions = {}) {
  return path.join(resolveRuntimeDataDir(options), RUNTIME_DATABASE_FILE_NAME);
}

export function resolveLegacyRuntimeDataDirs(options: ResolvePathOptions = {}) {
  const serverRootDir = options.serverRootDir ?? resolveServerRootDir();
  const workspaceRootDir = resolveWorkspaceRootDir(serverRootDir);
  const candidates: LegacyRuntimeDataCandidate[] = [
    {
      description: "legacy server runtime data directory",
      dir: path.join(serverRootDir, "data"),
    },
    {
      description: "older workspace runtime data directory",
      dir: path.join(workspaceRootDir, "data"),
    },
  ];

  return candidates.filter((candidate, index) =>
    candidates.findIndex((entry) => isSamePath(entry.dir, candidate.dir)) === index,
  );
}

function assertSafeProductionRuntimeDataDir(options: RuntimeDataOptions & { dataDir: string }) {
  const env = options.env ?? process.env;
  if (!isProductionEnv(env)) return;

  const serverRootDir = options.serverRootDir ?? resolveServerRootDir();
  const workspaceRootDir = resolveWorkspaceRootDir(serverRootDir);
  if (!isPathInside(workspaceRootDir, options.dataDir)) return;

  const safeDefaultDir = path.join(resolveProductionBaseDataDir(options), APP_RUNTIME_DIR_NAME);
  throw new Error(
    [
      `Resolved runtime data directory "${options.dataDir}" is inside the repo checkout "${workspaceRootDir}".`,
      "This is unsafe in production because git operations can touch live SQLite files.",
      `Set UPUSE_DATA_DIR to an external directory such as "${safeDefaultDir}", or unset UPUSE_DATA_DIR to use the default external runtime data directory.`,
    ].join(" "),
  );
}

function findLegacyRuntimeSource(options: RuntimeDataOptions & { dataDir: string }) {
  const candidates = resolveLegacyRuntimeDataDirs(options)
    .filter((candidate) => !isSamePath(candidate.dir, options.dataDir))
    .filter((candidate) => fs.existsSync(path.join(candidate.dir, RUNTIME_DATABASE_FILE_NAME)));

  return {
    selected: candidates[0] ?? null,
    additional: candidates.slice(1),
  };
}

function copyFileIfMissing(sourcePath: string, targetPath: string) {
  if (!fs.existsSync(sourcePath) || fs.existsSync(targetPath)) {
    return false;
  }

  const tempPath = `${targetPath}.migrating-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  fs.copyFileSync(sourcePath, tempPath, fs.constants.COPYFILE_EXCL);

  try {
    fs.renameSync(tempPath, targetPath);
    return true;
  } catch (error) {
    try {
      if (fs.existsSync(tempPath)) {
        fs.unlinkSync(tempPath);
      }
    } catch {
      // Ignore cleanup failures; preserve the original rename error.
    }

    if (fs.existsSync(targetPath)) {
      return false;
    }

    throw error;
  }
}

function migrateLegacyRuntimeFiles(sourceDir: string, targetDir: string) {
  const copiedFiles: string[] = [];

  for (const fileName of RUNTIME_MIGRATION_FILE_ORDER) {
    const sourcePath = path.join(sourceDir, fileName);
    const targetPath = path.join(targetDir, fileName);

    if (copyFileIfMissing(sourcePath, targetPath)) {
      copiedFiles.push(fileName);
    }
  }

  return copiedFiles;
}

function maybeCopyLegacyDevSecret(
  options: RuntimeDataOptions & { dataDir: string },
  preferredSourceDir: string | null = null,
) {
  const env = options.env ?? process.env;
  if (env.UPUSE_SECRET?.trim()) return null;

  const targetSecretPath = path.join(options.dataDir, DEV_SECRET_FILE_NAME);
  if (fs.existsSync(targetSecretPath)) return null;

  const candidates = resolveLegacyRuntimeDataDirs(options)
    .filter((candidate) => !isSamePath(candidate.dir, options.dataDir))
    .filter((candidate) => fs.existsSync(path.join(candidate.dir, RUNTIME_DATABASE_FILE_NAME)));
  const source = preferredSourceDir
    ? candidates.find((candidate) => isSamePath(candidate.dir, preferredSourceDir))
    : candidates.find((candidate) => fs.existsSync(path.join(candidate.dir, DEV_SECRET_FILE_NAME)));

  if (!source || !fs.existsSync(path.join(source.dir, DEV_SECRET_FILE_NAME))) return null;

  if (!copyFileIfMissing(path.join(source.dir, DEV_SECRET_FILE_NAME), targetSecretPath)) {
    return null;
  }

  return source.dir;
}

export function prepareRuntimeDataDir(options: PrepareRuntimeDataOptions = {}): PreparedRuntimeData {
  const serverRootDir = options.serverRootDir ?? resolveServerRootDir();
  const dataDir = resolveRuntimeDataDir({ ...options, serverRootDir });
  const dbFilePath = path.join(dataDir, RUNTIME_DATABASE_FILE_NAME);
  const log = options.log ?? console.info;
  const warn = options.warn ?? console.warn;

  assertSafeProductionRuntimeDataDir({ ...options, serverRootDir, dataDir });

  log(`[startup] Runtime data directory: ${dataDir}`);

  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  let migratedFrom: string | null = null;
  if (!fs.existsSync(dbFilePath)) {
    const migrationSource = findLegacyRuntimeSource({ ...options, serverRootDir, dataDir });
    if (migrationSource.selected) {
      if (migrationSource.additional.length > 0) {
        warn(
          `[startup] Multiple legacy repo-local runtime data directories were detected. Using ${migrationSource.selected.dir} (${migrationSource.selected.description}) and leaving ${migrationSource.additional.map((candidate) => candidate.dir).join(", ")} untouched.`,
        );
      }

      const copiedFiles = migrateLegacyRuntimeFiles(migrationSource.selected.dir, dataDir);
      if (copiedFiles.length > 0) {
        migratedFrom = migrationSource.selected.dir;
        log(
          `[startup] Migrated runtime data from ${migrationSource.selected.dir} to ${dataDir}. Copied: ${copiedFiles.join(", ")}. Source files were left in place.`,
        );
      }
    }
  }

  const copiedSecretFrom = maybeCopyLegacyDevSecret({ ...options, serverRootDir, dataDir }, migratedFrom);
  if (copiedSecretFrom) {
    log(
      `[startup] Copied ${DEV_SECRET_FILE_NAME} from ${copiedSecretFrom} to ${dataDir} so development token decryption keeps working after the runtime-data move.`,
    );
  }

  return {
    dataDir,
    dbFilePath,
    migratedFrom,
  };
}
