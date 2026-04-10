import type Database from "better-sqlite3";

export function buildScanoTaskDomainSchemaSql() {
  return `
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
  `;
}

export function buildScanoSchemaSql() {
  return `
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

    ${buildScanoTaskDomainSchemaSql()}

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
      importRevision INTEGER NOT NULL DEFAULT 1,
      enrichmentStatus TEXT NOT NULL DEFAULT 'queued',
      enrichmentQueuedAt TEXT,
      enrichmentStartedAt TEXT,
      enrichmentPausedAt TEXT,
      enrichmentCompletedAt TEXT,
      enrichedCount INTEGER NOT NULL DEFAULT 0,
      processedCount INTEGER NOT NULL DEFAULT 0,
      warningCode TEXT,
      warningMessage TEXT,
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

    CREATE TABLE IF NOT EXISTS scano_master_product_enrichment_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chainId INTEGER NOT NULL,
      importRevision INTEGER NOT NULL,
      rowNumber INTEGER NOT NULL,
      sourceBarcode TEXT NOT NULL,
      normalizedBarcode TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      attemptCount INTEGER NOT NULL DEFAULT 0,
      nextAttemptAt TEXT,
      lastError TEXT,
      externalProductId TEXT,
      sku TEXT,
      price TEXT,
      itemNameEn TEXT,
      itemNameAr TEXT,
      image TEXT,
      chainFlag TEXT,
      vendorFlag TEXT,
      enrichedAt TEXT,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL,
      FOREIGN KEY (chainId) REFERENCES scano_master_products(chainId) ON DELETE CASCADE
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_scano_master_product_enrichment_entry_unique
      ON scano_master_product_enrichment_entries(chainId, importRevision, normalizedBarcode);

    CREATE INDEX IF NOT EXISTS idx_scano_master_product_enrichment_entry_queue
      ON scano_master_product_enrichment_entries(chainId, importRevision, status, nextAttemptAt, rowNumber, id);

    CREATE TABLE IF NOT EXISTS scano_master_product_enrichment_barcodes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      entryId INTEGER NOT NULL,
      chainId INTEGER NOT NULL,
      importRevision INTEGER NOT NULL,
      barcode TEXT NOT NULL,
      normalizedBarcode TEXT NOT NULL,
      createdAt TEXT NOT NULL,
      FOREIGN KEY (entryId) REFERENCES scano_master_product_enrichment_entries(id) ON DELETE CASCADE,
      FOREIGN KEY (chainId) REFERENCES scano_master_products(chainId) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_scano_master_product_enrichment_barcodes_lookup
      ON scano_master_product_enrichment_barcodes(chainId, normalizedBarcode, importRevision, entryId);
  `;
}

export function resetLegacyScanoTaskData(db: Database.Database) {
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
    db.exec(buildScanoTaskDomainSchemaSql());
  });

  db.pragma("foreign_keys = OFF");
  try {
    runReset();
  } finally {
    db.pragma("foreign_keys = ON");
  }
}
