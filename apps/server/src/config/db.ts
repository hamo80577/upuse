import Database from "better-sqlite3";
import fs from "node:fs";
import crypto from "node:crypto";
import { resolveDataDir, resolveDbFilePath } from "./paths.js";
import { resolveEncryptionSecret } from "./secret.js";
import { hashPassword, normalizeEmail } from "../services/auth/passwords.js";

function isProduction() {
  return process.env.NODE_ENV?.trim().toLowerCase() === "production";
}

function resolveBootstrapAdmin(env: NodeJS.ProcessEnv) {
  const email = env.UPUSE_BOOTSTRAP_ADMIN_EMAIL?.trim() || "";
  const password = env.UPUSE_BOOTSTRAP_ADMIN_PASSWORD?.trim() || "";
  const name = env.UPUSE_BOOTSTRAP_ADMIN_NAME?.trim() || "Administrator";
  const hasAnyValue = [email, password, env.UPUSE_BOOTSTRAP_ADMIN_NAME?.trim() || ""].some((value) => value.length > 0);

  if (!hasAnyValue) return null;
  if (!email || !password) {
    throw new Error(
      "UPUSE_BOOTSTRAP_ADMIN_EMAIL and UPUSE_BOOTSTRAP_ADMIN_PASSWORD must both be set when bootstrapping the first admin user.",
    );
  }
  if (password.length < 12) {
    throw new Error("UPUSE_BOOTSTRAP_ADMIN_PASSWORD must be at least 12 characters long.");
  }

  return {
    email: normalizeEmail(email),
    password,
    name,
    role: "admin" as const,
  };
}

function maybeSeedBootstrapAdmin() {
  const usersCountRow = db.prepare("SELECT COUNT(*) AS count FROM users").get() as { count: number };
  const bootstrapAdmin = resolveBootstrapAdmin(process.env);

  if (!bootstrapAdmin) {
    if (!usersCountRow.count) {
      const message =
        "No application users exist. Set UPUSE_BOOTSTRAP_ADMIN_EMAIL and UPUSE_BOOTSTRAP_ADMIN_PASSWORD to create the first admin account.";
      if (isProduction()) {
        throw new Error(message);
      }
      console.warn(`WARNING: ${message}`);
    }
    return;
  }

  const existingUser = db
    .prepare<[string], { id: number }>("SELECT id FROM users WHERE email = ?")
    .get(bootstrapAdmin.email);
  if (existingUser) return;

  db.prepare(`
    INSERT INTO users (email, name, role, passwordHash, active, createdAt)
    VALUES (?, ?, ?, ?, 1, ?)
  `).run(
    bootstrapAdmin.email,
    bootstrapAdmin.name,
    bootstrapAdmin.role,
    hashPassword(bootstrapAdmin.password),
    new Date().toISOString(),
  );

  console.warn(`Created bootstrap admin user for ${bootstrapAdmin.email}. Rotate bootstrap credentials after first use.`);
}

export const dataDir = resolveDataDir({ env: process.env });
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

export const dbFilePath = resolveDbFilePath({ env: process.env });
export const db = new Database(dbFilePath);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

const secret = resolveEncryptionSecret({
  env: process.env,
  dataDir,
  existingEncryptedSettings: readExistingEncryptedSettings(),
});
const key = crypto.createHash("sha256").update(secret).digest(); // 32 bytes
const ivLen = 12;

function encrypt(plain: string) {
  const iv = crypto.randomBytes(ivLen);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString("base64");
}

function decrypt(payload: string) {
  const buf = Buffer.from(payload, "base64");
  const iv = buf.subarray(0, ivLen);
  const tag = buf.subarray(ivLen, ivLen + 16);
  const enc = buf.subarray(ivLen + 16);
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  const dec = Buffer.concat([decipher.update(enc), decipher.final()]);
  return dec.toString("utf8");
}

export const cryptoBox = { encrypt, decrypt };

function readExistingEncryptedSettings() {
  const hasSettingsTable = db
    .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'settings' LIMIT 1")
    .get();

  if (!hasSettingsTable) return [];

  const row = db.prepare("SELECT ordersTokenEnc, availabilityTokenEnc FROM settings WHERE id = 1").get() as
    | { ordersTokenEnc?: string; availabilityTokenEnc?: string }
    | undefined;

  if (!row) return [];

  return [row.ordersTokenEnc, row.availabilityTokenEnc].filter(
    (value): value is string => typeof value === "string" && value.trim().length > 0,
  );
}

function migrateLegacyUserRoles() {
  const usersTable = db
    .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'users' LIMIT 1")
    .get() as { sql?: string } | undefined;

  if (!usersTable) return;

  const hasLegacyConstraint = typeof usersTable.sql === "string" && usersTable.sql.includes("'viewer'");
  const hasUnsupportedRoles = Boolean(
    db.prepare("SELECT 1 FROM users WHERE LOWER(TRIM(role)) NOT IN ('admin', 'user') LIMIT 1").get(),
  );

  if (!hasLegacyConstraint && !hasUnsupportedRoles) return;

  const runMigration = db.transaction(() => {
    db.exec(`
      DROP TABLE IF EXISTS users_next;

      CREATE TABLE users_next (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        role TEXT NOT NULL CHECK (role IN ('admin', 'user')),
        passwordHash TEXT NOT NULL,
        active INTEGER NOT NULL DEFAULT 1,
        createdAt TEXT NOT NULL
      );

      INSERT INTO users_next (id, email, name, role, passwordHash, active, createdAt)
      SELECT
        id,
        email,
        name,
        CASE
          WHEN LOWER(TRIM(role)) = 'admin' THEN 'admin'
          ELSE 'user'
        END,
        passwordHash,
        active,
        createdAt
      FROM users;

      DROP TABLE users;
      ALTER TABLE users_next RENAME TO users;
    `);
  });

  db.pragma("foreign_keys = OFF");
  try {
    runMigration();
  } finally {
    db.pragma("foreign_keys = ON");
  }
}

export function migrate() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      ordersTokenEnc TEXT NOT NULL,
      availabilityTokenEnc TEXT NOT NULL,
      globalEntityId TEXT NOT NULL,
      chainNamesJson TEXT NOT NULL DEFAULT '[]',
      chainThresholdsJson TEXT NOT NULL DEFAULT '[]',
      lateThreshold INTEGER NOT NULL,
      unassignedThreshold INTEGER NOT NULL,
      tempCloseMinutes INTEGER NOT NULL,
      graceMinutes INTEGER NOT NULL,
      ordersRefreshSeconds INTEGER NOT NULL,
      availabilityRefreshSeconds INTEGER NOT NULL,
      maxVendorsPerOrdersRequest INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS branches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      chainName TEXT NOT NULL DEFAULT '',
      ordersVendorId INTEGER NOT NULL,
      availabilityVendorId TEXT NOT NULL,
      globalEntityId TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      lateThresholdOverride INTEGER,
      unassignedThresholdOverride INTEGER
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_branches_ordersVendorId ON branches(ordersVendorId);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_branches_availabilityVendorId ON branches(availabilityVendorId);

    CREATE TABLE IF NOT EXISTS branch_runtime (
      branchId INTEGER PRIMARY KEY,
      lastUpuseCloseUntil TEXT,
      lastUpuseCloseReason TEXT,
      lastUpuseCloseAt TEXT,
      lastUpuseCloseEventId INTEGER,
      lastExternalCloseUntil TEXT,
      lastExternalCloseAt TEXT,
      externalOpenDetectedAt TEXT,
      lastActionAt TEXT,
      FOREIGN KEY (branchId) REFERENCES branches(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      branchId INTEGER,
      ts TEXT NOT NULL,
      level TEXT NOT NULL,
      message TEXT NOT NULL,
      FOREIGN KEY (branchId) REFERENCES branches(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_logs_branch_ts ON logs(branchId, ts);

    CREATE TABLE IF NOT EXISTS action_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      branchId INTEGER NOT NULL,
      branchName TEXT NOT NULL,
      chainName TEXT NOT NULL DEFAULT '',
      ordersVendorId INTEGER NOT NULL,
      availabilityVendorId TEXT NOT NULL,
      source TEXT NOT NULL,
      actionType TEXT NOT NULL,
      ts TEXT NOT NULL,
      reason TEXT,
      note TEXT,
      closedUntil TEXT,
      reopenedAt TEXT,
      reopenMode TEXT,
      totalToday INTEGER NOT NULL DEFAULT 0,
      cancelledToday INTEGER NOT NULL DEFAULT 0,
      doneToday INTEGER NOT NULL DEFAULT 0,
      activeNow INTEGER NOT NULL DEFAULT 0,
      lateNow INTEGER NOT NULL DEFAULT 0,
      unassignedNow INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (branchId) REFERENCES branches(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_action_events_ts ON action_events(ts);
    CREATE INDEX IF NOT EXISTS idx_action_events_branch_ts ON action_events(branchId, ts);

    CREATE TABLE IF NOT EXISTS orders_mirror (
      dayKey TEXT NOT NULL,
      globalEntityId TEXT NOT NULL,
      vendorId INTEGER NOT NULL,
      orderId TEXT NOT NULL,
      externalId TEXT NOT NULL,
      status TEXT NOT NULL,
      isCompleted INTEGER NOT NULL DEFAULT 0,
      isCancelled INTEGER NOT NULL DEFAULT 0,
      isUnassigned INTEGER NOT NULL DEFAULT 0,
      placedAt TEXT,
      pickupAt TEXT,
      customerFirstName TEXT,
      shopperId INTEGER,
      shopperFirstName TEXT,
      isActiveNow INTEGER NOT NULL DEFAULT 0,
      lastSeenAt TEXT NOT NULL,
      lastActiveSeenAt TEXT,
      PRIMARY KEY (dayKey, globalEntityId, vendorId, orderId)
    );

    CREATE INDEX IF NOT EXISTS idx_orders_mirror_branch
      ON orders_mirror(dayKey, globalEntityId, vendorId);
    CREATE INDEX IF NOT EXISTS idx_orders_mirror_active
      ON orders_mirror(dayKey, globalEntityId, vendorId, isActiveNow);
    CREATE INDEX IF NOT EXISTS idx_orders_mirror_picker
      ON orders_mirror(dayKey, globalEntityId, vendorId, shopperId);
    CREATE INDEX IF NOT EXISTS idx_orders_mirror_pickup
      ON orders_mirror(dayKey, pickupAt);

    CREATE TABLE IF NOT EXISTS orders_sync_state (
      dayKey TEXT NOT NULL,
      globalEntityId TEXT NOT NULL,
      vendorId INTEGER NOT NULL,
      lastBootstrapSyncAt TEXT,
      lastActiveSyncAt TEXT,
      lastHistorySyncAt TEXT,
      lastFullHistorySweepAt TEXT,
      PRIMARY KEY (dayKey, globalEntityId, vendorId)
    );

    CREATE TABLE IF NOT EXISTS branch_catalog (
      availabilityVendorId TEXT PRIMARY KEY,
      ordersVendorId INTEGER,
      name TEXT,
      globalEntityId TEXT NOT NULL,
      availabilityState TEXT NOT NULL DEFAULT 'CLOSED',
      changeable INTEGER NOT NULL DEFAULT 0,
      presentInSource INTEGER NOT NULL DEFAULT 1,
      resolveStatus TEXT NOT NULL DEFAULT 'unresolved',
      lastSeenAt TEXT,
      resolvedAt TEXT,
      lastError TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_branch_catalog_name
      ON branch_catalog(name);
    CREATE INDEX IF NOT EXISTS idx_branch_catalog_entity_present
      ON branch_catalog(globalEntityId, presentInSource);
    CREATE INDEX IF NOT EXISTS idx_branch_catalog_orders_vendor
      ON branch_catalog(ordersVendorId);

    CREATE TABLE IF NOT EXISTS branch_catalog_sync_state (
      globalEntityId TEXT PRIMARY KEY,
      syncState TEXT NOT NULL DEFAULT 'stale',
      lastAttemptedAt TEXT,
      lastSyncedAt TEXT,
      lastError TEXT
    );

    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('admin', 'user')),
      passwordHash TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 1,
      createdAt TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      userId INTEGER NOT NULL,
      expiresAt TEXT NOT NULL,
      createdAt TEXT NOT NULL,
      FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_sessions_expiresAt ON sessions(expiresAt);
  `);

  migrateLegacyUserRoles();

  const settingsColumns = db.prepare("PRAGMA table_info(settings)").all() as Array<{ name: string }>;
  if (!settingsColumns.some((column) => column.name === "chainNamesJson")) {
    db.exec("ALTER TABLE settings ADD COLUMN chainNamesJson TEXT NOT NULL DEFAULT '[]'");
  }
  if (!settingsColumns.some((column) => column.name === "chainThresholdsJson")) {
    db.exec("ALTER TABLE settings ADD COLUMN chainThresholdsJson TEXT NOT NULL DEFAULT '[]'");
  }

  const branchColumns = db.prepare("PRAGMA table_info(branches)").all() as Array<{ name: string }>;
  if (!branchColumns.some((column) => column.name === "chainName")) {
    db.exec("ALTER TABLE branches ADD COLUMN chainName TEXT NOT NULL DEFAULT ''");
  }
  if (!branchColumns.some((column) => column.name === "lateThresholdOverride")) {
    db.exec("ALTER TABLE branches ADD COLUMN lateThresholdOverride INTEGER");
  }
  if (!branchColumns.some((column) => column.name === "unassignedThresholdOverride")) {
    db.exec("ALTER TABLE branches ADD COLUMN unassignedThresholdOverride INTEGER");
  }

  const branchRuntimeColumns = db.prepare("PRAGMA table_info(branch_runtime)").all() as Array<{ name: string }>;
  if (!branchRuntimeColumns.some((column) => column.name === "lastExternalCloseUntil")) {
    db.exec("ALTER TABLE branch_runtime ADD COLUMN lastExternalCloseUntil TEXT");
  }
  if (!branchRuntimeColumns.some((column) => column.name === "lastExternalCloseAt")) {
    db.exec("ALTER TABLE branch_runtime ADD COLUMN lastExternalCloseAt TEXT");
  }
  if (!branchRuntimeColumns.some((column) => column.name === "lastUpuseCloseEventId")) {
    db.exec("ALTER TABLE branch_runtime ADD COLUMN lastUpuseCloseEventId INTEGER");
  }

  const row = db.prepare("SELECT id FROM settings WHERE id=1").get();
  if (!row) {
    const defaultSettings = {
      ordersTokenEnc: cryptoBox.encrypt(""),
      availabilityTokenEnc: cryptoBox.encrypt(""),
      globalEntityId: "HF_EG",
      chainNamesJson: "[]",
      chainThresholdsJson: "[]",
      lateThreshold: 5,
      unassignedThreshold: 5,
      tempCloseMinutes: 30,
      graceMinutes: 5,
      ordersRefreshSeconds: 30,
      availabilityRefreshSeconds: 30,
      maxVendorsPerOrdersRequest: 50,
    };
    db.prepare(`
      INSERT INTO settings (
        id, ordersTokenEnc, availabilityTokenEnc, globalEntityId,
        chainNamesJson, chainThresholdsJson,
        lateThreshold, unassignedThreshold, tempCloseMinutes, graceMinutes,
        ordersRefreshSeconds, availabilityRefreshSeconds, maxVendorsPerOrdersRequest
      ) VALUES (
        1, @ordersTokenEnc, @availabilityTokenEnc, @globalEntityId,
        @chainNamesJson, @chainThresholdsJson,
        @lateThreshold, @unassignedThreshold, @tempCloseMinutes, @graceMinutes,
        @ordersRefreshSeconds, @availabilityRefreshSeconds, @maxVendorsPerOrdersRequest
      )
    `).run(defaultSettings);
  }

  const settingsRow = db.prepare("SELECT chainNamesJson, chainThresholdsJson FROM settings WHERE id=1").get() as any;
  if (settingsRow) {
    const rawThresholds = typeof settingsRow.chainThresholdsJson === "string" ? settingsRow.chainThresholdsJson.trim() : "";
    if (!rawThresholds || rawThresholds === "[]") {
      let chainNames: string[] = [];

      try {
        const parsedNames = JSON.parse(settingsRow.chainNamesJson || "[]");
        if (Array.isArray(parsedNames)) {
          chainNames = parsedNames
            .filter((value): value is string => typeof value === "string")
            .map((value) => value.trim())
            .filter((value, index, values) => value && values.findIndex((item) => item.toLowerCase() === value.toLowerCase()) === index);
        }
      } catch {}

      if (!chainNames.length) {
        chainNames = (db
          .prepare("SELECT DISTINCT chainName FROM branches WHERE TRIM(chainName) <> '' ORDER BY chainName ASC")
          .all() as Array<{ chainName: string }>)
          .map((rowItem) => rowItem.chainName.trim())
          .filter(Boolean);
      }

      if (chainNames.length) {
        db.prepare("UPDATE settings SET chainThresholdsJson = ?, chainNamesJson = ? WHERE id = 1").run(
          JSON.stringify(
            chainNames.map((name) => ({
              name,
              lateThreshold: 5,
              unassignedThreshold: 5,
            })),
          ),
          JSON.stringify(chainNames),
        );
      }
    }
  }

  maybeSeedBootstrapAdmin();
}

export function pruneLogs(branchId: number | null, keep: number) {
  if (branchId === null) {
    // Keep global logs (branchId NULL)
    db.prepare(`
      DELETE FROM logs WHERE id NOT IN (
        SELECT id FROM logs WHERE branchId IS NULL ORDER BY id DESC LIMIT ?
      ) AND branchId IS NULL
    `).run(keep);
    return;
  }
  db.prepare(`
    DELETE FROM logs WHERE id NOT IN (
      SELECT id FROM logs WHERE branchId = ? ORDER BY id DESC LIMIT ?
    ) AND branchId = ?
  `).run(branchId, keep, branchId);
}
