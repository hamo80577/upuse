export function buildSharedSchemaSql() {
  return `
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
  `;
}
