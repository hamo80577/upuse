import Database from "better-sqlite3";
import fs from "node:fs";
import { resolveDataDir, resolveDbFilePath } from "./paths.js";
import { DEFAULT_GLOBAL_ENTITY_ID } from "./constants.js";
import { createCryptoBox, createEncryptionKeyring, parseEncryptionSecretList } from "./encryption.js";
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

const existingEncryptedSettings = readExistingEncryptedSettings();
const secret = resolveEncryptionSecret({
  env: process.env,
  dataDir,
  existingEncryptedSettings,
});
const previousSecrets = parseEncryptionSecretList(process.env.UPUSE_SECRET_PREVIOUS);
const cryptoBox = createCryptoBox(createEncryptionKeyring(secret, previousSecrets));
cryptoBox.assertCanDecryptAll(existingEncryptedSettings);

export { cryptoBox };

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

function rotateStoredSettingsSecretsToPrimary() {
  const row = db.prepare("SELECT ordersTokenEnc, availabilityTokenEnc FROM settings WHERE id = 1").get() as
    | { ordersTokenEnc?: string; availabilityTokenEnc?: string }
    | undefined;

  if (!row?.ordersTokenEnc || !row.availabilityTokenEnc) return;

  const orders = cryptoBox.decryptWithMetadata(row.ordersTokenEnc);
  const availability = cryptoBox.decryptWithMetadata(row.availabilityTokenEnc);
  if (!orders.needsReencrypt && !availability.needsReencrypt) {
    return;
  }

  db.prepare(`
    UPDATE settings
    SET ordersTokenEnc = ?, availabilityTokenEnc = ?
    WHERE id = 1
  `).run(
    orders.needsReencrypt ? cryptoBox.encrypt(orders.value) : row.ordersTokenEnc,
    availability.needsReencrypt ? cryptoBox.encrypt(availability.value) : row.availabilityTokenEnc,
  );

  console.warn(
    "Re-encrypted stored settings tokens with the current UPUSE_SECRET. After verifying startup, you can remove old secrets from UPUSE_SECRET_PREVIOUS.",
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

function migrateBranchesTableToLocalCatalogShape() {
  const branchColumns = db.prepare("PRAGMA table_info(branches)").all() as Array<{ name: string }>;
  const expectedColumns = new Set([
    "id",
    "availabilityVendorId",
    "chainName",
    "enabled",
    "lateThresholdOverride",
    "unassignedThresholdOverride",
  ]);

  const requiresRebuild =
    branchColumns.length !== expectedColumns.size ||
    branchColumns.some((column) => !expectedColumns.has(column.name));

  if (!requiresRebuild) {
    db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_branches_availabilityVendorId ON branches(availabilityVendorId)");
    db.exec("DROP INDEX IF EXISTS idx_branches_ordersVendorId");
    return;
  }

  const runMigration = db.transaction(() => {
    db.exec(`
      DROP INDEX IF EXISTS idx_branches_ordersVendorId;
      DROP INDEX IF EXISTS idx_branches_availabilityVendorId;
      DROP TABLE IF EXISTS branches_next;

      CREATE TABLE branches_next (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        availabilityVendorId TEXT NOT NULL,
        chainName TEXT NOT NULL DEFAULT '',
        enabled INTEGER NOT NULL DEFAULT 1,
        lateThresholdOverride INTEGER,
        unassignedThresholdOverride INTEGER
      );

      INSERT INTO branches_next (
        id,
        availabilityVendorId,
        chainName,
        enabled,
        lateThresholdOverride,
        unassignedThresholdOverride
      )
      SELECT
        id,
        availabilityVendorId,
        COALESCE(chainName, ''),
        CASE WHEN enabled IS NULL THEN 1 ELSE enabled END,
        lateThresholdOverride,
        unassignedThresholdOverride
      FROM branches;

      DROP TABLE branches;
      ALTER TABLE branches_next RENAME TO branches;

      CREATE UNIQUE INDEX idx_branches_availabilityVendorId ON branches(availabilityVendorId);
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
      availabilityVendorId TEXT NOT NULL,
      chainName TEXT NOT NULL DEFAULT '',
      enabled INTEGER NOT NULL DEFAULT 1,
      lateThresholdOverride INTEGER,
      unassignedThresholdOverride INTEGER
    );

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
      lastSuccessfulSyncAt TEXT,
      lastHistoryCursorAt TEXT,
      consecutiveFailures INTEGER NOT NULL DEFAULT 0,
      lastErrorAt TEXT,
      lastErrorCode TEXT,
      lastErrorMessage TEXT,
      staleSince TEXT,
      quarantinedUntil TEXT,
      PRIMARY KEY (dayKey, globalEntityId, vendorId)
    );

    CREATE TABLE IF NOT EXISTS settings_token_test_jobs (
      id TEXT PRIMARY KEY,
      status TEXT NOT NULL,
      createdAt TEXT NOT NULL,
      startedAt TEXT,
      completedAt TEXT,
      availabilityConfigured INTEGER NOT NULL DEFAULT 0,
      availabilityOk INTEGER NOT NULL DEFAULT 0,
      availabilityStatus INTEGER,
      availabilityMessage TEXT,
      ordersConfigured INTEGER NOT NULL DEFAULT 0,
      ordersConfigValid INTEGER NOT NULL DEFAULT 0,
      ordersConfigMessage TEXT,
      ordersProbeOk INTEGER NOT NULL DEFAULT 0,
      ordersProbeStatus INTEGER,
      ordersProbeMessage TEXT,
      totalBranches INTEGER NOT NULL DEFAULT 0,
      processedBranches INTEGER NOT NULL DEFAULT 0,
      passedBranches INTEGER NOT NULL DEFAULT 0,
      failedBranches INTEGER NOT NULL DEFAULT 0
    );

    CREATE INDEX IF NOT EXISTS idx_settings_token_test_jobs_created
      ON settings_token_test_jobs(createdAt DESC);

    CREATE TABLE IF NOT EXISTS settings_token_test_results (
      jobId TEXT NOT NULL,
      branchId INTEGER NOT NULL,
      name TEXT NOT NULL,
      ordersVendorId INTEGER NOT NULL,
      ok INTEGER NOT NULL DEFAULT 0,
      status INTEGER,
      message TEXT,
      sampleVendorName TEXT,
      processedAt TEXT NOT NULL,
      PRIMARY KEY (jobId, branchId),
      FOREIGN KEY (jobId) REFERENCES settings_token_test_jobs(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_settings_token_test_results_job
      ON settings_token_test_results(jobId, processedAt DESC);

    CREATE TABLE IF NOT EXISTS vendor_catalog (
      availabilityVendorId TEXT PRIMARY KEY,
      ordersVendorId INTEGER NOT NULL UNIQUE,
      name TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_vendor_catalog_name
      ON vendor_catalog(name);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_vendor_catalog_orders_vendor
      ON vendor_catalog(ordersVendorId);

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
  migrateBranchesTableToLocalCatalogShape();

  db.exec(`
    DROP TABLE IF EXISTS branch_catalog;
    DROP TABLE IF EXISTS branch_catalog_sync_state;
  `);

  const settingsColumns = db.prepare("PRAGMA table_info(settings)").all() as Array<{ name: string }>;
  if (!settingsColumns.some((column) => column.name === "chainNamesJson")) {
    db.exec("ALTER TABLE settings ADD COLUMN chainNamesJson TEXT NOT NULL DEFAULT '[]'");
  }
  if (!settingsColumns.some((column) => column.name === "chainThresholdsJson")) {
    db.exec("ALTER TABLE settings ADD COLUMN chainThresholdsJson TEXT NOT NULL DEFAULT '[]'");
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
  const ordersSyncStateColumns = db.prepare("PRAGMA table_info(orders_sync_state)").all() as Array<{ name: string }>;
  if (!ordersSyncStateColumns.some((column) => column.name === "lastSuccessfulSyncAt")) {
    db.exec("ALTER TABLE orders_sync_state ADD COLUMN lastSuccessfulSyncAt TEXT");
  }
  if (!ordersSyncStateColumns.some((column) => column.name === "lastHistoryCursorAt")) {
    db.exec("ALTER TABLE orders_sync_state ADD COLUMN lastHistoryCursorAt TEXT");
  }
  if (!ordersSyncStateColumns.some((column) => column.name === "consecutiveFailures")) {
    db.exec("ALTER TABLE orders_sync_state ADD COLUMN consecutiveFailures INTEGER NOT NULL DEFAULT 0");
  }
  if (!ordersSyncStateColumns.some((column) => column.name === "lastErrorAt")) {
    db.exec("ALTER TABLE orders_sync_state ADD COLUMN lastErrorAt TEXT");
  }
  if (!ordersSyncStateColumns.some((column) => column.name === "lastErrorCode")) {
    db.exec("ALTER TABLE orders_sync_state ADD COLUMN lastErrorCode TEXT");
  }
  if (!ordersSyncStateColumns.some((column) => column.name === "lastErrorMessage")) {
    db.exec("ALTER TABLE orders_sync_state ADD COLUMN lastErrorMessage TEXT");
  }
  if (!ordersSyncStateColumns.some((column) => column.name === "staleSince")) {
    db.exec("ALTER TABLE orders_sync_state ADD COLUMN staleSince TEXT");
  }
  if (!ordersSyncStateColumns.some((column) => column.name === "quarantinedUntil")) {
    db.exec("ALTER TABLE orders_sync_state ADD COLUMN quarantinedUntil TEXT");
  }

  const row = db.prepare("SELECT id FROM settings WHERE id=1").get();
  if (!row) {
    const defaultSettings = {
      ordersTokenEnc: cryptoBox.encrypt(""),
      availabilityTokenEnc: cryptoBox.encrypt(""),
      globalEntityId: DEFAULT_GLOBAL_ENTITY_ID,
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

  rotateStoredSettingsSecretsToPrimary();

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
