import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

interface UserRow {
  id: number;
  email: string;
  name: string;
  role: string;
  passwordHash: string;
  active: number;
  createdAt: string;
}

interface PerformanceUserStateRow {
  userId: number;
  stateJson: string;
  updatedAt: string;
}

interface PerformanceUserGroupRow {
  id: number;
  userId: number;
  name: string;
  vendorIdsJson: string;
  createdAt: string;
  updatedAt: string;
}

interface PerformanceUserViewRow {
  id: number;
  userId: number;
  name: string;
  stateJson: string;
  createdAt: string;
  updatedAt: string;
}

export interface UserDataBackupSnapshot {
  backupFormatVersion: 1;
  createdAt: string;
  source: {
    app: "upuse";
    purpose: "one_time_pre_update_user_backup";
    dbFilePath: string;
    includedTables: Array<"users" | "performance_user_state" | "performance_user_groups" | "performance_user_views">;
    excludedTables: ["sessions"];
  };
  counts: {
    users: number;
    performanceStates: number;
    performanceGroups: number;
    performanceViews: number;
    bundledUsers: number;
  };
  users: Array<{
    user: UserRow;
    performanceState: (PerformanceUserStateRow & { parsedState: unknown | null }) | null;
    performanceGroups: Array<PerformanceUserGroupRow & { parsedVendorIds: unknown | null }>;
    performanceViews: Array<PerformanceUserViewRow & { parsedState: unknown | null }>;
  }>;
}

export interface WriteUserDataBackupResult {
  filePath: string;
  checksumFilePath: string;
  checksumSha256: string;
  snapshot: UserDataBackupSnapshot;
}

const INCLUDED_TABLES: UserDataBackupSnapshot["source"]["includedTables"] = [
  "users",
  "performance_user_state",
  "performance_user_groups",
  "performance_user_views",
];

const EXCLUDED_TABLES: UserDataBackupSnapshot["source"]["excludedTables"] = ["sessions"];

function nowIso() {
  return new Date().toISOString();
}

function parseJsonSafely(value: string) {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function sanitizeLabel(value: string | undefined) {
  const normalized = (value ?? "").trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/-+/g, "-");
  return normalized.replace(/^-|-$/g, "");
}

function createTimestampToken(createdAt: string) {
  const [datePart, rawTimePart = ""] = createdAt.split("T");
  const timePart = rawTimePart.replace(/\.\d+Z$/i, "Z").replace(/:/g, "");
  return `${datePart.replace(/-/g, "")}T${timePart}`;
}

function assertRequiredTables(database: Database.Database) {
  const rows = database
    .prepare<[], { name: string }>("SELECT name FROM sqlite_master WHERE type = 'table'")
    .all();
  const names = new Set(rows.map((row) => row.name));
  const missing = INCLUDED_TABLES.filter((tableName) => !names.has(tableName));
  if (missing.length) {
    throw new Error(`Cannot create user data backup because required tables are missing: ${missing.join(", ")}`);
  }
}

export function createUserDataBackupSnapshot(database: Database.Database, dbFilePath: string): UserDataBackupSnapshot {
  assertRequiredTables(database);

  const users = database
    .prepare<[], UserRow>(`
      SELECT id, email, name, role, passwordHash, active, createdAt
      FROM users
      ORDER BY id ASC
    `)
    .all();

  const states = database
    .prepare<[], PerformanceUserStateRow>(`
      SELECT userId, stateJson, updatedAt
      FROM performance_user_state
      ORDER BY userId ASC
    `)
    .all();

  const groups = database
    .prepare<[], PerformanceUserGroupRow>(`
      SELECT id, userId, name, vendorIdsJson, createdAt, updatedAt
      FROM performance_user_groups
      ORDER BY userId ASC, updatedAt DESC, id DESC
    `)
    .all();

  const views = database
    .prepare<[], PerformanceUserViewRow>(`
      SELECT id, userId, name, stateJson, createdAt, updatedAt
      FROM performance_user_views
      ORDER BY userId ASC, updatedAt DESC, id DESC
    `)
    .all();

  const statesByUserId = new Map(states.map((row) => [row.userId, row] as const));
  const groupsByUserId = new Map<number, PerformanceUserGroupRow[]>();
  const viewsByUserId = new Map<number, PerformanceUserViewRow[]>();

  for (const group of groups) {
    const existing = groupsByUserId.get(group.userId);
    if (existing) {
      existing.push(group);
    } else {
      groupsByUserId.set(group.userId, [group]);
    }
  }

  for (const view of views) {
    const existing = viewsByUserId.get(view.userId);
    if (existing) {
      existing.push(view);
    } else {
      viewsByUserId.set(view.userId, [view]);
    }
  }

  const createdAt = nowIso();

  return {
    backupFormatVersion: 1,
    createdAt,
    source: {
      app: "upuse",
      purpose: "one_time_pre_update_user_backup",
      dbFilePath,
      includedTables: INCLUDED_TABLES,
      excludedTables: EXCLUDED_TABLES,
    },
    counts: {
      users: users.length,
      performanceStates: states.length,
      performanceGroups: groups.length,
      performanceViews: views.length,
      bundledUsers: users.length,
    },
    users: users.map((user) => {
      const performanceState = statesByUserId.get(user.id);

      return {
        user,
        performanceState: performanceState
          ? {
              ...performanceState,
              parsedState: parseJsonSafely(performanceState.stateJson),
            }
          : null,
        performanceGroups: (groupsByUserId.get(user.id) ?? []).map((group) => ({
          ...group,
          parsedVendorIds: parseJsonSafely(group.vendorIdsJson),
        })),
        performanceViews: (viewsByUserId.get(user.id) ?? []).map((view) => ({
          ...view,
          parsedState: parseJsonSafely(view.stateJson),
        })),
      };
    }),
  };
}

export function readUserDataBackupSnapshot(input: { dbFilePath: string }) {
  const database = new Database(input.dbFilePath, {
    readonly: true,
    fileMustExist: true,
  });

  try {
    database.pragma("query_only = 1");
    return createUserDataBackupSnapshot(database, input.dbFilePath);
  } finally {
    database.close();
  }
}

export function writeUserDataBackupSnapshot(input: {
  dbFilePath: string;
  outputDir: string;
  label?: string;
}): WriteUserDataBackupResult {
  const snapshot = readUserDataBackupSnapshot({ dbFilePath: input.dbFilePath });
  const label = sanitizeLabel(input.label);
  const timestampToken = createTimestampToken(snapshot.createdAt);
  const fileName = `user-data-backup-${timestampToken}${label ? `-${label}` : ""}.json`;
  const filePath = path.join(input.outputDir, fileName);
  const checksumFilePath = `${filePath}.sha256`;
  const content = `${JSON.stringify(snapshot, null, 2)}\n`;
  const checksumSha256 = crypto.createHash("sha256").update(content).digest("hex");

  fs.mkdirSync(input.outputDir, { recursive: true, mode: 0o700 });
  fs.writeFileSync(filePath, content, { encoding: "utf8", mode: 0o600 });
  fs.writeFileSync(checksumFilePath, `${checksumSha256}  ${path.basename(filePath)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });

  return {
    filePath,
    checksumFilePath,
    checksumSha256,
    snapshot,
  };
}
