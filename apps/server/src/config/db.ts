import Database from "better-sqlite3";
import fs from "node:fs";
import { resolveDataDir, resolveDbFilePath } from "./paths.js";
import { createCryptoBox, createEncryptionKeyring, parseEncryptionSecretList } from "./encryption.js";
import { resolveBootstrapGlobalEntityId } from "./globalEntityId.js";
import { resolveEncryptionSecret } from "./secret.js";
import { hashPassword, normalizeEmail } from "../services/auth/passwords.js";
import { backfillScanoTaskProductCanonicalRows } from "../services/scanoTaskProductMutations.js";

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
    INSERT INTO users (email, name, role, passwordHash, active, createdAt, upuseAccess, isPrimaryAdmin)
    VALUES (?, ?, ?, ?, 1, ?, 1, ?)
  `).run(
    bootstrapAdmin.email,
    bootstrapAdmin.name,
    bootstrapAdmin.role,
    hashPassword(bootstrapAdmin.password),
    new Date().toISOString(),
    usersCountRow.count === 0 ? 1 : 0,
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
        createdAt TEXT NOT NULL,
        upuseAccess INTEGER NOT NULL DEFAULT 1,
        isPrimaryAdmin INTEGER NOT NULL DEFAULT 0
      );

      INSERT INTO users_next (id, email, name, role, passwordHash, active, createdAt, upuseAccess, isPrimaryAdmin)
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
        createdAt,
        1,
        0
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

function ensurePrimaryAdminUser() {
  const primaryRows = db.prepare(`
    SELECT id
    FROM users
    WHERE isPrimaryAdmin = 1
    ORDER BY datetime(createdAt) ASC, id ASC
  `).all() as Array<{ id: number }>;

  const keepPrimaryId = primaryRows[0]?.id ?? (
    db.prepare(`
      SELECT id
      FROM users
      WHERE LOWER(TRIM(role)) = 'admin' AND active = 1 AND upuseAccess = 1
      ORDER BY datetime(createdAt) ASC, id ASC
      LIMIT 1
    `).get() as { id: number } | undefined
  )?.id;

  if (typeof keepPrimaryId !== "number") {
    return;
  }

  db.prepare(`
    UPDATE users
    SET
      isPrimaryAdmin = CASE WHEN id = ? THEN 1 ELSE 0 END,
      upuseAccess = CASE WHEN id = ? THEN 1 ELSE upuseAccess END,
      role = CASE WHEN id = ? THEN 'admin' ELSE role END
  `).run(keepPrimaryId, keepPrimaryId, keepPrimaryId);
}

function migrateBranchesTableToLocalCatalogShape() {
  const branchColumns = db.prepare("PRAGMA table_info(branches)").all() as Array<{ name: string }>;
  const expectedColumns = new Set([
    "id",
    "availabilityVendorId",
    "chainName",
    "enabled",
    "lateThresholdOverride",
    "lateReopenThresholdOverride",
    "unassignedThresholdOverride",
    "unassignedReopenThresholdOverride",
    "readyThresholdOverride",
    "readyReopenThresholdOverride",
    "capacityRuleEnabledOverride",
    "capacityPerHourEnabledOverride",
    "capacityPerHourLimitOverride",
  ]);
  const hasLateReopenThresholdOverride = branchColumns.some((column) => column.name === "lateReopenThresholdOverride");
  const hasUnassignedReopenThresholdOverride = branchColumns.some((column) => column.name === "unassignedReopenThresholdOverride");
  const hasReadyThresholdOverride = branchColumns.some((column) => column.name === "readyThresholdOverride");
  const hasReadyReopenThresholdOverride = branchColumns.some((column) => column.name === "readyReopenThresholdOverride");
  const hasCapacityRuleEnabledOverride = branchColumns.some((column) => column.name === "capacityRuleEnabledOverride");
  const hasCapacityPerHourEnabledOverride = branchColumns.some((column) => column.name === "capacityPerHourEnabledOverride");
  const hasCapacityPerHourLimitOverride = branchColumns.some((column) => column.name === "capacityPerHourLimitOverride");

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
        lateReopenThresholdOverride INTEGER,
        unassignedThresholdOverride INTEGER,
        unassignedReopenThresholdOverride INTEGER,
        readyThresholdOverride INTEGER,
        readyReopenThresholdOverride INTEGER,
        capacityRuleEnabledOverride INTEGER,
        capacityPerHourEnabledOverride INTEGER,
        capacityPerHourLimitOverride INTEGER
      );

      INSERT INTO branches_next (
        id,
        availabilityVendorId,
        chainName,
        enabled,
        lateThresholdOverride,
        lateReopenThresholdOverride,
        unassignedThresholdOverride,
        unassignedReopenThresholdOverride,
        readyThresholdOverride,
        readyReopenThresholdOverride,
        capacityRuleEnabledOverride,
        capacityPerHourEnabledOverride,
        capacityPerHourLimitOverride
      )
      SELECT
        id,
        availabilityVendorId,
        COALESCE(chainName, ''),
        CASE WHEN enabled IS NULL THEN 1 ELSE enabled END,
        lateThresholdOverride,
        ${hasLateReopenThresholdOverride ? "lateReopenThresholdOverride" : "NULL"},
        unassignedThresholdOverride,
        ${hasUnassignedReopenThresholdOverride ? "unassignedReopenThresholdOverride" : "NULL"},
        ${hasReadyThresholdOverride ? "readyThresholdOverride" : "NULL"},
        ${hasReadyReopenThresholdOverride ? "readyReopenThresholdOverride" : "NULL"},
        ${hasCapacityRuleEnabledOverride ? "capacityRuleEnabledOverride" : "NULL"},
        ${hasCapacityPerHourEnabledOverride ? "capacityPerHourEnabledOverride" : "NULL"},
        ${hasCapacityPerHourLimitOverride ? "capacityPerHourLimitOverride" : "NULL"}
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

function buildCurrentScanoTaskDomainSchemaSql() {
  return `
    CREATE TABLE scano_tasks (
      id TEXT PRIMARY KEY,
      chainId INTEGER NOT NULL,
      chainName TEXT NOT NULL,
      branchId INTEGER NOT NULL,
      branchGlobalId TEXT NOT NULL,
      branchName TEXT NOT NULL,
      globalEntityId TEXT NOT NULL,
      countryCode TEXT NOT NULL,
      additionalRemoteId TEXT NOT NULL,
      scheduledAt TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('pending', 'in_progress', 'awaiting_review', 'completed')),
      createdByUserId INTEGER NOT NULL,
      startedAt TEXT,
      startedByUserId INTEGER,
      startedByTeamMemberId INTEGER,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL,
      FOREIGN KEY (createdByUserId) REFERENCES users(id) ON DELETE RESTRICT,
      FOREIGN KEY (startedByUserId) REFERENCES users(id) ON DELETE SET NULL,
      FOREIGN KEY (startedByTeamMemberId) REFERENCES scano_team_members(id) ON DELETE SET NULL
    );

    CREATE INDEX IF NOT EXISTS idx_scano_tasks_scheduled_at
      ON scano_tasks(scheduledAt, createdAt DESC, id DESC);

    CREATE TABLE scano_task_assignees (
      taskId TEXT NOT NULL,
      teamMemberId INTEGER NOT NULL,
      assignedAt TEXT NOT NULL,
      PRIMARY KEY (taskId, teamMemberId),
      FOREIGN KEY (taskId) REFERENCES scano_tasks(id) ON DELETE CASCADE,
      FOREIGN KEY (teamMemberId) REFERENCES scano_team_members(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_scano_task_assignees_member
      ON scano_task_assignees(teamMemberId, taskId);

    CREATE TABLE scano_task_participants (
      taskId TEXT NOT NULL,
      teamMemberId INTEGER NOT NULL,
      startedAt TEXT,
      lastEnteredAt TEXT,
      endedAt TEXT,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL,
      PRIMARY KEY (taskId, teamMemberId),
      FOREIGN KEY (taskId) REFERENCES scano_tasks(id) ON DELETE CASCADE,
      FOREIGN KEY (teamMemberId) REFERENCES scano_team_members(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_scano_task_participants_task
      ON scano_task_participants(taskId, startedAt, endedAt);

    CREATE TABLE scano_task_scans (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      taskId TEXT NOT NULL,
      teamMemberId INTEGER NOT NULL,
      barcode TEXT NOT NULL,
      source TEXT NOT NULL CHECK (source IN ('manual', 'scanner', 'camera')),
      lookupStatus TEXT NOT NULL CHECK (lookupStatus IN ('pending_integration')),
      outcome TEXT NOT NULL DEFAULT 'manual_only' CHECK (outcome IN ('matched_external', 'matched_master', 'manual_only', 'duplicate_blocked')),
      taskProductId TEXT,
      resolvedProductJson TEXT,
      scannedAt TEXT NOT NULL,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL,
      FOREIGN KEY (taskId) REFERENCES scano_tasks(id) ON DELETE CASCADE,
      FOREIGN KEY (teamMemberId) REFERENCES scano_team_members(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_scano_task_scans_task_scanned
      ON scano_task_scans(taskId, scannedAt DESC, id DESC);

    CREATE TABLE scano_task_products (
      id TEXT PRIMARY KEY,
      taskId TEXT NOT NULL,
      createdByTeamMemberId INTEGER NOT NULL,
      sourceType TEXT NOT NULL CHECK (sourceType IN ('vendor', 'chain', 'master', 'manual')),
      externalProductId TEXT,
      barcode TEXT NOT NULL,
      sku TEXT NOT NULL,
      price TEXT,
      itemNameEn TEXT NOT NULL,
      itemNameAr TEXT,
      previewImageUrl TEXT,
      chainFlag TEXT NOT NULL CHECK (chainFlag IN ('yes', 'no')),
      vendorFlag TEXT NOT NULL CHECK (vendorFlag IN ('yes', 'no')),
      masterfileFlag TEXT NOT NULL CHECK (masterfileFlag IN ('yes', 'no')),
      newFlag TEXT NOT NULL CHECK (newFlag IN ('yes', 'no')),
      edited INTEGER NOT NULL DEFAULT 0,
      confirmedAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL,
      FOREIGN KEY (taskId) REFERENCES scano_tasks(id) ON DELETE CASCADE,
      FOREIGN KEY (createdByTeamMemberId) REFERENCES scano_team_members(id) ON DELETE RESTRICT
    );

    CREATE INDEX IF NOT EXISTS idx_scano_task_products_task_confirmed
      ON scano_task_products(taskId, confirmedAt DESC, id DESC);

    CREATE INDEX IF NOT EXISTS idx_scano_task_products_task_barcode
      ON scano_task_products(taskId, barcode COLLATE NOCASE);

    CREATE INDEX IF NOT EXISTS idx_scano_task_products_task_sku
      ON scano_task_products(taskId, sku COLLATE NOCASE);

    CREATE INDEX IF NOT EXISTS idx_scano_task_products_task_external_product
      ON scano_task_products(taskId, externalProductId COLLATE NOCASE);

    CREATE TABLE scano_task_product_barcodes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      productId TEXT NOT NULL,
      barcode TEXT NOT NULL,
      createdAt TEXT NOT NULL,
      FOREIGN KEY (productId) REFERENCES scano_task_products(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_scano_task_product_barcodes_product
      ON scano_task_product_barcodes(productId, id);

    CREATE INDEX IF NOT EXISTS idx_scano_task_product_barcodes_barcode
      ON scano_task_product_barcodes(barcode COLLATE NOCASE);

    CREATE TABLE scano_task_product_images (
      id TEXT PRIMARY KEY,
      productId TEXT NOT NULL,
      fileName TEXT NOT NULL,
      storageKind TEXT NOT NULL CHECK (storageKind IN ('local', 'external')),
      filePath TEXT,
      externalUrl TEXT,
      mimeType TEXT,
      sortOrder INTEGER NOT NULL DEFAULT 0,
      createdAt TEXT NOT NULL,
      FOREIGN KEY (productId) REFERENCES scano_task_products(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_scano_task_product_images_product
      ON scano_task_product_images(productId, sortOrder, id);

    CREATE TABLE scano_task_product_edits (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      productId TEXT NOT NULL,
      editedByTeamMemberId INTEGER NOT NULL,
      beforeJson TEXT NOT NULL,
      afterJson TEXT NOT NULL,
      editedAt TEXT NOT NULL,
      FOREIGN KEY (productId) REFERENCES scano_task_products(id) ON DELETE CASCADE,
      FOREIGN KEY (editedByTeamMemberId) REFERENCES scano_team_members(id) ON DELETE RESTRICT
    );

    CREATE INDEX IF NOT EXISTS idx_scano_task_product_edits_product
      ON scano_task_product_edits(productId, editedAt DESC, id DESC);

    CREATE TABLE scano_task_exports (
      id TEXT PRIMARY KEY,
      taskId TEXT NOT NULL,
      fileName TEXT NOT NULL,
      filePath TEXT NOT NULL,
      createdAt TEXT NOT NULL,
      confirmedDownloadAt TEXT,
      imagesPurgedAt TEXT,
      FOREIGN KEY (taskId) REFERENCES scano_tasks(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_scano_task_exports_task_created
      ON scano_task_exports(taskId, createdAt DESC, id DESC);

    CREATE TABLE scano_runner_sessions (
      token TEXT PRIMARY KEY,
      taskId TEXT NOT NULL,
      actorUserId INTEGER NOT NULL,
      teamMemberId INTEGER NOT NULL,
      chainId INTEGER NOT NULL,
      vendorId INTEGER NOT NULL,
      globalEntityId TEXT NOT NULL,
      expiresAt TEXT NOT NULL,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL,
      FOREIGN KEY (taskId) REFERENCES scano_tasks(id) ON DELETE CASCADE,
      FOREIGN KEY (actorUserId) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (teamMemberId) REFERENCES scano_team_members(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_scano_runner_sessions_expires
      ON scano_runner_sessions(expiresAt);

    CREATE INDEX IF NOT EXISTS idx_scano_runner_sessions_task
      ON scano_runner_sessions(taskId, updatedAt DESC, token);
  `;
}

function resetLegacyScanoTaskData() {
  const scanoTasksTable = db
    .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'scano_tasks' LIMIT 1")
    .get() as { sql?: string } | undefined;

  if (!scanoTasksTable?.sql) {
    return;
  }

  const taskAssigneesTable = db
    .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'scano_task_assignees' LIMIT 1")
    .get() as { sql?: string } | undefined;
  const taskParticipantsTable = db
    .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'scano_task_participants' LIMIT 1")
    .get() as { sql?: string } | undefined;
  const taskScansTable = db
    .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'scano_task_scans' LIMIT 1")
    .get() as { sql?: string } | undefined;

  const requiresReset =
    !scanoTasksTable.sql.includes("id TEXT PRIMARY KEY") ||
    !scanoTasksTable.sql.includes("'awaiting_review'") ||
    !scanoTasksTable.sql.includes("'completed'") ||
    !taskAssigneesTable?.sql?.includes("taskId TEXT NOT NULL") ||
    !taskParticipantsTable?.sql?.includes("taskId TEXT NOT NULL") ||
    !taskScansTable?.sql?.includes("taskId TEXT NOT NULL");

  if (!requiresReset) {
    db.exec("CREATE INDEX IF NOT EXISTS idx_scano_tasks_scheduled_at ON scano_tasks(scheduledAt, createdAt DESC, id DESC)");
    return;
  }

  console.warn("Resetting legacy Scano task data because an incompatible schema was detected. Existing Scano tasks and task history will be deleted.");

  const runReset = db.transaction(() => {
    db.exec(`
      DROP TABLE IF EXISTS scano_runner_sessions;
      DROP TABLE IF EXISTS scano_task_exports;
      DROP TABLE IF EXISTS scano_task_product_edits;
      DROP TABLE IF EXISTS scano_task_product_images;
      DROP TABLE IF EXISTS scano_task_product_barcodes;
      DROP TABLE IF EXISTS scano_task_products;
      DROP TABLE IF EXISTS scano_task_scans;
      DROP TABLE IF EXISTS scano_task_participants;
      DROP TABLE IF EXISTS scano_task_assignees;
      DROP TABLE IF EXISTS scano_tasks;
    `);
    db.exec(buildCurrentScanoTaskDomainSchemaSql());
  });

  db.pragma("foreign_keys = OFF");
  try {
    runReset();
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
      lateReopenThreshold INTEGER NOT NULL DEFAULT 0,
      unassignedThreshold INTEGER NOT NULL,
      unassignedReopenThreshold INTEGER NOT NULL DEFAULT 0,
      readyThreshold INTEGER NOT NULL DEFAULT 0,
      readyReopenThreshold INTEGER NOT NULL DEFAULT 0,
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
      lateReopenThresholdOverride INTEGER,
      unassignedThresholdOverride INTEGER,
      unassignedReopenThresholdOverride INTEGER,
      readyThresholdOverride INTEGER,
      readyReopenThresholdOverride INTEGER,
      capacityRuleEnabledOverride INTEGER,
      capacityPerHourEnabledOverride INTEGER,
      capacityPerHourLimitOverride INTEGER
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
      closureOwner TEXT,
      closureObservedUntil TEXT,
      closureObservedAt TEXT,
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
      vendorName TEXT,
      orderId TEXT NOT NULL,
      externalId TEXT NOT NULL,
      status TEXT NOT NULL,
      transportType TEXT,
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
      cancellationOwner TEXT,
      cancellationReason TEXT,
      cancellationStage TEXT,
      cancellationSource TEXT,
      cancellationCreatedAt TEXT,
      cancellationUpdatedAt TEXT,
      cancellationOwnerLookupAt TEXT,
      cancellationOwnerLookupError TEXT,
      transportTypeLookupAt TEXT,
      transportTypeLookupError TEXT,
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
    CREATE INDEX IF NOT EXISTS idx_orders_mirror_placed
      ON orders_mirror(dayKey, globalEntityId, vendorId, placedAt);

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

    CREATE TABLE IF NOT EXISTS orders_entity_sync_state (
      dayKey TEXT NOT NULL,
      globalEntityId TEXT NOT NULL,
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
      bootstrapCompletedAt TEXT,
      PRIMARY KEY (dayKey, globalEntityId)
    );

    CREATE INDEX IF NOT EXISTS idx_orders_entity_sync_state_latest
      ON orders_entity_sync_state(globalEntityId, dayKey);

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
      createdAt TEXT NOT NULL,
      upuseAccess INTEGER NOT NULL DEFAULT 1,
      isPrimaryAdmin INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      userId INTEGER NOT NULL,
      expiresAt TEXT NOT NULL,
      createdAt TEXT NOT NULL,
      FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_sessions_expiresAt ON sessions(expiresAt);

    CREATE TABLE IF NOT EXISTS login_attempts (
      key TEXT PRIMARY KEY,
      count INTEGER NOT NULL,
      windowStartedAt TEXT NOT NULL,
      blockedUntil TEXT,
      updatedAt TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_login_attempts_updated
      ON login_attempts(updatedAt, key);

    CREATE TABLE IF NOT EXISTS performance_user_state (
      userId INTEGER PRIMARY KEY,
      stateJson TEXT NOT NULL,
      updatedAt TEXT NOT NULL,
      FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS performance_user_groups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      userId INTEGER NOT NULL,
      name TEXT NOT NULL COLLATE NOCASE,
      vendorIdsJson TEXT NOT NULL,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL,
      FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_performance_user_groups_user_name
      ON performance_user_groups(userId, name);

    CREATE INDEX IF NOT EXISTS idx_performance_user_groups_user_updated
      ON performance_user_groups(userId, updatedAt DESC, id DESC);

    CREATE TABLE IF NOT EXISTS performance_user_views (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      userId INTEGER NOT NULL,
      name TEXT NOT NULL COLLATE NOCASE,
      stateJson TEXT NOT NULL,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL,
      FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_performance_user_views_user_name
      ON performance_user_views(userId, name);

    CREATE INDEX IF NOT EXISTS idx_performance_user_views_user_updated
      ON performance_user_views(userId, updatedAt DESC, id DESC);

    CREATE TABLE IF NOT EXISTS scano_team_members (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      linkedUserId INTEGER NOT NULL UNIQUE,
      role TEXT NOT NULL DEFAULT 'scanner' CHECK (role IN ('team_lead', 'scanner')),
      active INTEGER NOT NULL DEFAULT 1,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL,
      FOREIGN KEY (linkedUserId) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_scano_team_members_active_name
      ON scano_team_members(active, name COLLATE NOCASE);

    CREATE TABLE IF NOT EXISTS scano_tasks (
      id TEXT PRIMARY KEY,
      chainId INTEGER NOT NULL,
      chainName TEXT NOT NULL,
      branchId INTEGER NOT NULL,
      branchGlobalId TEXT NOT NULL,
      branchName TEXT NOT NULL,
      globalEntityId TEXT NOT NULL,
      countryCode TEXT NOT NULL,
      additionalRemoteId TEXT NOT NULL,
      scheduledAt TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('pending', 'in_progress', 'awaiting_review', 'completed')),
      createdByUserId INTEGER NOT NULL,
      startedAt TEXT,
      startedByUserId INTEGER,
      startedByTeamMemberId INTEGER,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL,
      FOREIGN KEY (createdByUserId) REFERENCES users(id) ON DELETE RESTRICT,
      FOREIGN KEY (startedByUserId) REFERENCES users(id) ON DELETE SET NULL,
      FOREIGN KEY (startedByTeamMemberId) REFERENCES scano_team_members(id) ON DELETE SET NULL
    );

    CREATE INDEX IF NOT EXISTS idx_scano_tasks_scheduled_at
      ON scano_tasks(scheduledAt, createdAt DESC, id DESC);

    CREATE TABLE IF NOT EXISTS scano_task_assignees (
      taskId TEXT NOT NULL,
      teamMemberId INTEGER NOT NULL,
      assignedAt TEXT NOT NULL,
      PRIMARY KEY (taskId, teamMemberId),
      FOREIGN KEY (taskId) REFERENCES scano_tasks(id) ON DELETE CASCADE,
      FOREIGN KEY (teamMemberId) REFERENCES scano_team_members(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_scano_task_assignees_member
      ON scano_task_assignees(teamMemberId, taskId);

    CREATE TABLE IF NOT EXISTS scano_task_participants (
      taskId TEXT NOT NULL,
      teamMemberId INTEGER NOT NULL,
      startedAt TEXT,
      lastEnteredAt TEXT,
      endedAt TEXT,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL,
      PRIMARY KEY (taskId, teamMemberId),
      FOREIGN KEY (taskId) REFERENCES scano_tasks(id) ON DELETE CASCADE,
      FOREIGN KEY (teamMemberId) REFERENCES scano_team_members(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_scano_task_participants_task
      ON scano_task_participants(taskId, startedAt, endedAt);

    CREATE TABLE IF NOT EXISTS scano_task_scans (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      taskId TEXT NOT NULL,
      teamMemberId INTEGER NOT NULL,
      barcode TEXT NOT NULL,
      source TEXT NOT NULL CHECK (source IN ('manual', 'scanner', 'camera')),
      lookupStatus TEXT NOT NULL CHECK (lookupStatus IN ('pending_integration')),
      outcome TEXT NOT NULL DEFAULT 'manual_only' CHECK (outcome IN ('matched_external', 'matched_master', 'manual_only', 'duplicate_blocked')),
      taskProductId TEXT,
      resolvedProductJson TEXT,
      scannedAt TEXT NOT NULL,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL,
      FOREIGN KEY (taskId) REFERENCES scano_tasks(id) ON DELETE CASCADE,
      FOREIGN KEY (teamMemberId) REFERENCES scano_team_members(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_scano_task_scans_task_scanned
      ON scano_task_scans(taskId, scannedAt DESC, id DESC);

    CREATE TABLE IF NOT EXISTS scano_task_products (
      id TEXT PRIMARY KEY,
      taskId TEXT NOT NULL,
      createdByTeamMemberId INTEGER NOT NULL,
      sourceType TEXT NOT NULL CHECK (sourceType IN ('vendor', 'chain', 'master', 'manual')),
      externalProductId TEXT,
      barcode TEXT NOT NULL,
      sku TEXT NOT NULL,
      price TEXT,
      itemNameEn TEXT NOT NULL,
      itemNameAr TEXT,
      previewImageUrl TEXT,
      chainFlag TEXT NOT NULL CHECK (chainFlag IN ('yes', 'no')),
      vendorFlag TEXT NOT NULL CHECK (vendorFlag IN ('yes', 'no')),
      masterfileFlag TEXT NOT NULL CHECK (masterfileFlag IN ('yes', 'no')),
      newFlag TEXT NOT NULL CHECK (newFlag IN ('yes', 'no')),
      edited INTEGER NOT NULL DEFAULT 0,
      confirmedAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL,
      FOREIGN KEY (taskId) REFERENCES scano_tasks(id) ON DELETE CASCADE,
      FOREIGN KEY (createdByTeamMemberId) REFERENCES scano_team_members(id) ON DELETE RESTRICT
    );

    CREATE INDEX IF NOT EXISTS idx_scano_task_products_task_confirmed
      ON scano_task_products(taskId, confirmedAt DESC, id DESC);

    CREATE INDEX IF NOT EXISTS idx_scano_task_products_task_barcode
      ON scano_task_products(taskId, barcode COLLATE NOCASE);

    CREATE INDEX IF NOT EXISTS idx_scano_task_products_task_sku
      ON scano_task_products(taskId, sku COLLATE NOCASE);

    CREATE INDEX IF NOT EXISTS idx_scano_task_products_task_external_product
      ON scano_task_products(taskId, externalProductId COLLATE NOCASE);

    CREATE TABLE IF NOT EXISTS scano_task_product_barcodes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      productId TEXT NOT NULL,
      barcode TEXT NOT NULL,
      createdAt TEXT NOT NULL,
      FOREIGN KEY (productId) REFERENCES scano_task_products(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_scano_task_product_barcodes_product
      ON scano_task_product_barcodes(productId, id);

    CREATE INDEX IF NOT EXISTS idx_scano_task_product_barcodes_barcode
      ON scano_task_product_barcodes(barcode COLLATE NOCASE);

    CREATE TABLE IF NOT EXISTS scano_task_product_images (
      id TEXT PRIMARY KEY,
      productId TEXT NOT NULL,
      fileName TEXT NOT NULL,
      storageKind TEXT NOT NULL CHECK (storageKind IN ('local', 'external')),
      filePath TEXT,
      externalUrl TEXT,
      mimeType TEXT,
      sortOrder INTEGER NOT NULL DEFAULT 0,
      createdAt TEXT NOT NULL,
      FOREIGN KEY (productId) REFERENCES scano_task_products(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_scano_task_product_images_product
      ON scano_task_product_images(productId, sortOrder, id);

    CREATE TABLE IF NOT EXISTS scano_task_product_edits (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      productId TEXT NOT NULL,
      editedByTeamMemberId INTEGER NOT NULL,
      beforeJson TEXT NOT NULL,
      afterJson TEXT NOT NULL,
      editedAt TEXT NOT NULL,
      FOREIGN KEY (productId) REFERENCES scano_task_products(id) ON DELETE CASCADE,
      FOREIGN KEY (editedByTeamMemberId) REFERENCES scano_team_members(id) ON DELETE RESTRICT
    );

    CREATE INDEX IF NOT EXISTS idx_scano_task_product_edits_product
      ON scano_task_product_edits(productId, editedAt DESC, id DESC);

    CREATE TABLE IF NOT EXISTS scano_task_exports (
      id TEXT PRIMARY KEY,
      taskId TEXT NOT NULL,
      fileName TEXT NOT NULL,
      filePath TEXT NOT NULL,
      createdAt TEXT NOT NULL,
      confirmedDownloadAt TEXT,
      imagesPurgedAt TEXT,
      FOREIGN KEY (taskId) REFERENCES scano_tasks(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_scano_task_exports_task_created
      ON scano_task_exports(taskId, createdAt DESC, id DESC);

    CREATE TABLE IF NOT EXISTS scano_runner_sessions (
      token TEXT PRIMARY KEY,
      taskId TEXT NOT NULL,
      actorUserId INTEGER NOT NULL,
      teamMemberId INTEGER NOT NULL,
      chainId INTEGER NOT NULL,
      vendorId INTEGER NOT NULL,
      globalEntityId TEXT NOT NULL,
      expiresAt TEXT NOT NULL,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL,
      FOREIGN KEY (taskId) REFERENCES scano_tasks(id) ON DELETE CASCADE,
      FOREIGN KEY (actorUserId) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (teamMemberId) REFERENCES scano_team_members(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_scano_runner_sessions_expires
      ON scano_runner_sessions(expiresAt);

    CREATE INDEX IF NOT EXISTS idx_scano_runner_sessions_task
      ON scano_runner_sessions(taskId, updatedAt DESC, token);

    CREATE TABLE IF NOT EXISTS scano_settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      catalogBaseUrl TEXT NOT NULL DEFAULT '',
      catalogTokenEnc TEXT NOT NULL DEFAULT '',
      updatedAt TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS scano_master_products (
      chainId INTEGER PRIMARY KEY,
      chainName TEXT NOT NULL,
      mappingJson TEXT NOT NULL,
      productCount INTEGER NOT NULL DEFAULT 0,
      updatedAt TEXT NOT NULL,
      updatedByUserId INTEGER NOT NULL,
      createdAt TEXT NOT NULL,
      FOREIGN KEY (updatedByUserId) REFERENCES users(id) ON DELETE RESTRICT
    );

    CREATE INDEX IF NOT EXISTS idx_scano_master_products_updated
      ON scano_master_products(updatedAt DESC, chainName COLLATE NOCASE);

    CREATE TABLE IF NOT EXISTS scano_master_product_rows (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chainId INTEGER NOT NULL,
      rowNumber INTEGER NOT NULL,
      sku TEXT,
      barcode TEXT,
      price TEXT,
      itemNameEn TEXT,
      itemNameAr TEXT,
      image TEXT,
      FOREIGN KEY (chainId) REFERENCES scano_master_products(chainId) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_scano_master_product_rows_chain_row
      ON scano_master_product_rows(chainId, rowNumber, id);
  `);

  migrateLegacyUserRoles();
  migrateBranchesTableToLocalCatalogShape();
  resetLegacyScanoTaskData();

  db.exec(`
    DROP TABLE IF EXISTS branch_catalog;
    DROP TABLE IF EXISTS branch_catalog_sync_state;
  `);

  const settingsColumns = db.prepare("PRAGMA table_info(settings)").all() as Array<{ name: string }>;
  const userColumns = db.prepare("PRAGMA table_info(users)").all() as Array<{ name: string }>;
  if (!userColumns.some((column) => column.name === "upuseAccess")) {
    db.exec("ALTER TABLE users ADD COLUMN upuseAccess INTEGER NOT NULL DEFAULT 1");
  }
  if (!userColumns.some((column) => column.name === "isPrimaryAdmin")) {
    db.exec("ALTER TABLE users ADD COLUMN isPrimaryAdmin INTEGER NOT NULL DEFAULT 0");
  }
  db.exec("UPDATE users SET upuseAccess = 1 WHERE upuseAccess IS NULL");
  db.exec("UPDATE users SET isPrimaryAdmin = 0 WHERE isPrimaryAdmin IS NULL");
  ensurePrimaryAdminUser();
  if (!settingsColumns.some((column) => column.name === "chainNamesJson")) {
    db.exec("ALTER TABLE settings ADD COLUMN chainNamesJson TEXT NOT NULL DEFAULT '[]'");
  }
  if (!settingsColumns.some((column) => column.name === "chainThresholdsJson")) {
    db.exec("ALTER TABLE settings ADD COLUMN chainThresholdsJson TEXT NOT NULL DEFAULT '[]'");
  }
  if (!settingsColumns.some((column) => column.name === "readyThreshold")) {
    db.exec("ALTER TABLE settings ADD COLUMN readyThreshold INTEGER NOT NULL DEFAULT 0");
  }
  if (!settingsColumns.some((column) => column.name === "lateReopenThreshold")) {
    db.exec("ALTER TABLE settings ADD COLUMN lateReopenThreshold INTEGER NOT NULL DEFAULT 0");
  }
  if (!settingsColumns.some((column) => column.name === "unassignedReopenThreshold")) {
    db.exec("ALTER TABLE settings ADD COLUMN unassignedReopenThreshold INTEGER NOT NULL DEFAULT 0");
  }
  if (!settingsColumns.some((column) => column.name === "readyReopenThreshold")) {
    db.exec("ALTER TABLE settings ADD COLUMN readyReopenThreshold INTEGER NOT NULL DEFAULT 0");
  }
  const scanoTeamColumns = db.prepare("PRAGMA table_info(scano_team_members)").all() as Array<{ name: string }>;
  if (!scanoTeamColumns.some((column) => column.name === "role")) {
    db.exec("ALTER TABLE scano_team_members ADD COLUMN role TEXT NOT NULL DEFAULT 'scanner'");
    db.exec("UPDATE scano_team_members SET role = 'scanner' WHERE TRIM(role) = '' OR role IS NULL");
  }
  const scanoTaskScanColumns = db.prepare("PRAGMA table_info(scano_task_scans)").all() as Array<{ name: string }>;
  if (!scanoTaskScanColumns.some((column) => column.name === "outcome")) {
    db.exec("ALTER TABLE scano_task_scans ADD COLUMN outcome TEXT NOT NULL DEFAULT 'manual_only'");
    db.exec("UPDATE scano_task_scans SET outcome = 'manual_only' WHERE outcome IS NULL OR TRIM(outcome) = ''");
  }
  if (!scanoTaskScanColumns.some((column) => column.name === "taskProductId")) {
    db.exec("ALTER TABLE scano_task_scans ADD COLUMN taskProductId TEXT");
  }
  const scanoTaskProductColumns = db.prepare("PRAGMA table_info(scano_task_products)").all() as Array<{ name: string }>;
  if (!scanoTaskProductColumns.some((column) => column.name === "previewImageUrl")) {
    db.exec("ALTER TABLE scano_task_products ADD COLUMN previewImageUrl TEXT");
  }
  backfillScanoTaskProductCanonicalRows(db);
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
  if (!branchRuntimeColumns.some((column) => column.name === "closureOwner")) {
    db.exec("ALTER TABLE branch_runtime ADD COLUMN closureOwner TEXT");
  }
  if (!branchRuntimeColumns.some((column) => column.name === "closureObservedUntil")) {
    db.exec("ALTER TABLE branch_runtime ADD COLUMN closureObservedUntil TEXT");
  }
  if (!branchRuntimeColumns.some((column) => column.name === "closureObservedAt")) {
    db.exec("ALTER TABLE branch_runtime ADD COLUMN closureObservedAt TEXT");
  }
  const branchesColumns = db.prepare("PRAGMA table_info(branches)").all() as Array<{ name: string }>;
  if (!branchesColumns.some((column) => column.name === "lateReopenThresholdOverride")) {
    db.exec("ALTER TABLE branches ADD COLUMN lateReopenThresholdOverride INTEGER");
  }
  if (!branchesColumns.some((column) => column.name === "unassignedReopenThresholdOverride")) {
    db.exec("ALTER TABLE branches ADD COLUMN unassignedReopenThresholdOverride INTEGER");
  }
  if (!branchesColumns.some((column) => column.name === "readyThresholdOverride")) {
    db.exec("ALTER TABLE branches ADD COLUMN readyThresholdOverride INTEGER");
  }
  if (!branchesColumns.some((column) => column.name === "readyReopenThresholdOverride")) {
    db.exec("ALTER TABLE branches ADD COLUMN readyReopenThresholdOverride INTEGER");
  }
  if (!branchesColumns.some((column) => column.name === "capacityPerHourEnabledOverride")) {
    db.exec("ALTER TABLE branches ADD COLUMN capacityPerHourEnabledOverride INTEGER");
  }
  if (!branchesColumns.some((column) => column.name === "capacityPerHourLimitOverride")) {
    db.exec("ALTER TABLE branches ADD COLUMN capacityPerHourLimitOverride INTEGER");
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
  const ordersMirrorColumns = db.prepare("PRAGMA table_info(orders_mirror)").all() as Array<{ name: string }>;
  if (!ordersMirrorColumns.some((column) => column.name === "vendorName")) {
    db.exec("ALTER TABLE orders_mirror ADD COLUMN vendorName TEXT");
  }
  if (!ordersMirrorColumns.some((column) => column.name === "transportType")) {
    db.exec("ALTER TABLE orders_mirror ADD COLUMN transportType TEXT");
  }
  if (!ordersMirrorColumns.some((column) => column.name === "cancellationOwner")) {
    db.exec("ALTER TABLE orders_mirror ADD COLUMN cancellationOwner TEXT");
  }
  if (!ordersMirrorColumns.some((column) => column.name === "cancellationReason")) {
    db.exec("ALTER TABLE orders_mirror ADD COLUMN cancellationReason TEXT");
  }
  if (!ordersMirrorColumns.some((column) => column.name === "cancellationStage")) {
    db.exec("ALTER TABLE orders_mirror ADD COLUMN cancellationStage TEXT");
  }
  if (!ordersMirrorColumns.some((column) => column.name === "cancellationSource")) {
    db.exec("ALTER TABLE orders_mirror ADD COLUMN cancellationSource TEXT");
  }
  if (!ordersMirrorColumns.some((column) => column.name === "cancellationCreatedAt")) {
    db.exec("ALTER TABLE orders_mirror ADD COLUMN cancellationCreatedAt TEXT");
  }
  if (!ordersMirrorColumns.some((column) => column.name === "cancellationUpdatedAt")) {
    db.exec("ALTER TABLE orders_mirror ADD COLUMN cancellationUpdatedAt TEXT");
  }
  if (!ordersMirrorColumns.some((column) => column.name === "cancellationOwnerLookupAt")) {
    db.exec("ALTER TABLE orders_mirror ADD COLUMN cancellationOwnerLookupAt TEXT");
  }
  if (!ordersMirrorColumns.some((column) => column.name === "cancellationOwnerLookupError")) {
    db.exec("ALTER TABLE orders_mirror ADD COLUMN cancellationOwnerLookupError TEXT");
  }
  if (!ordersMirrorColumns.some((column) => column.name === "transportTypeLookupAt")) {
    db.exec("ALTER TABLE orders_mirror ADD COLUMN transportTypeLookupAt TEXT");
  }
  if (!ordersMirrorColumns.some((column) => column.name === "transportTypeLookupError")) {
    db.exec("ALTER TABLE orders_mirror ADD COLUMN transportTypeLookupError TEXT");
  }
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_orders_mirror_status
      ON orders_mirror(dayKey, globalEntityId, vendorId, status);
    CREATE INDEX IF NOT EXISTS idx_orders_mirror_cancelled_lookup
      ON orders_mirror(dayKey, globalEntityId, isCancelled, cancellationOwner, cancellationOwnerLookupAt);
    CREATE INDEX IF NOT EXISTS idx_orders_mirror_transport_lookup
      ON orders_mirror(dayKey, globalEntityId, transportType, transportTypeLookupAt);
  `);

  const ordersEntitySyncStateColumns = db.prepare("PRAGMA table_info(orders_entity_sync_state)").all() as Array<{ name: string }>;
  if (!ordersEntitySyncStateColumns.some((column) => column.name === "lastSuccessfulSyncAt")) {
    db.exec("ALTER TABLE orders_entity_sync_state ADD COLUMN lastSuccessfulSyncAt TEXT");
  }
  if (!ordersEntitySyncStateColumns.some((column) => column.name === "lastHistoryCursorAt")) {
    db.exec("ALTER TABLE orders_entity_sync_state ADD COLUMN lastHistoryCursorAt TEXT");
  }
  if (!ordersEntitySyncStateColumns.some((column) => column.name === "consecutiveFailures")) {
    db.exec("ALTER TABLE orders_entity_sync_state ADD COLUMN consecutiveFailures INTEGER NOT NULL DEFAULT 0");
  }
  if (!ordersEntitySyncStateColumns.some((column) => column.name === "lastErrorAt")) {
    db.exec("ALTER TABLE orders_entity_sync_state ADD COLUMN lastErrorAt TEXT");
  }
  if (!ordersEntitySyncStateColumns.some((column) => column.name === "lastErrorCode")) {
    db.exec("ALTER TABLE orders_entity_sync_state ADD COLUMN lastErrorCode TEXT");
  }
  if (!ordersEntitySyncStateColumns.some((column) => column.name === "lastErrorMessage")) {
    db.exec("ALTER TABLE orders_entity_sync_state ADD COLUMN lastErrorMessage TEXT");
  }
  if (!ordersEntitySyncStateColumns.some((column) => column.name === "staleSince")) {
    db.exec("ALTER TABLE orders_entity_sync_state ADD COLUMN staleSince TEXT");
  }
  if (!ordersEntitySyncStateColumns.some((column) => column.name === "bootstrapCompletedAt")) {
    db.exec("ALTER TABLE orders_entity_sync_state ADD COLUMN bootstrapCompletedAt TEXT");
  }

  const row = db.prepare("SELECT id FROM settings WHERE id=1").get();
  if (!row) {
    const defaultSettings = {
      ordersTokenEnc: cryptoBox.encrypt(""),
      availabilityTokenEnc: cryptoBox.encrypt(""),
      globalEntityId: resolveBootstrapGlobalEntityId(process.env),
      chainNamesJson: "[]",
      chainThresholdsJson: "[]",
      lateThreshold: 5,
      lateReopenThreshold: 0,
      unassignedThreshold: 5,
      unassignedReopenThreshold: 0,
      readyThreshold: 0,
      readyReopenThreshold: 0,
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
        lateThreshold, lateReopenThreshold, unassignedThreshold, unassignedReopenThreshold, readyThreshold, readyReopenThreshold, tempCloseMinutes, graceMinutes,
        ordersRefreshSeconds, availabilityRefreshSeconds, maxVendorsPerOrdersRequest
      ) VALUES (
        1, @ordersTokenEnc, @availabilityTokenEnc, @globalEntityId,
        @chainNamesJson, @chainThresholdsJson,
        @lateThreshold, @lateReopenThreshold, @unassignedThreshold, @unassignedReopenThreshold, @readyThreshold, @readyReopenThreshold, @tempCloseMinutes, @graceMinutes,
        @ordersRefreshSeconds, @availabilityRefreshSeconds, @maxVendorsPerOrdersRequest
      )
    `).run(defaultSettings);
  }

  const scanoSettingsRow = db.prepare("SELECT id FROM scano_settings WHERE id = 1").get();
  if (!scanoSettingsRow) {
    db.prepare(`
      INSERT INTO scano_settings (
        id,
        catalogBaseUrl,
        catalogTokenEnc,
        updatedAt
      ) VALUES (1, '', ?, ?)
    `).run(
      cryptoBox.encrypt(""),
      new Date().toISOString(),
    );
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
              lateReopenThreshold: 0,
              unassignedThreshold: 5,
              unassignedReopenThreshold: 0,
              readyThreshold: 0,
              readyReopenThreshold: 0,
              capacityRuleEnabled: true,
              capacityPerHourEnabled: false,
              capacityPerHourLimit: null,
            })),
          ),
          JSON.stringify(chainNames),
        );
      }
    }
  }

  maybeSeedBootstrapAdmin();
  ensurePrimaryAdminUser();
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
