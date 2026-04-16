import { OPS_EVENT_SEVERITIES, OPS_EVENT_SOURCES, OPS_EVENT_TYPES, OPS_SESSION_STATES, OPS_SYSTEM_IDS } from "../types/telemetry.js";

function sqlList(values: readonly string[]) {
  return values.map((value) => `'${value}'`).join(", ");
}

export function buildOpsSchemaSql() {
  const systems = sqlList(OPS_SYSTEM_IDS);
  const sessionStates = sqlList(OPS_SESSION_STATES);
  const eventTypes = sqlList(OPS_EVENT_TYPES);
  const sources = sqlList(OPS_EVENT_SOURCES);
  const severities = sqlList(OPS_EVENT_SEVERITIES);

  return `
    CREATE TABLE IF NOT EXISTS ops_sessions (
      id TEXT PRIMARY KEY,
      userId INTEGER,
      userEmail TEXT,
      userName TEXT,
      currentSystem TEXT NOT NULL DEFAULT 'unknown' CHECK (currentSystem IN (${systems})),
      currentPath TEXT,
      referrer TEXT,
      source TEXT,
      firstSeenAt TEXT NOT NULL,
      lastSeenAt TEXT NOT NULL,
      lastActiveAt TEXT,
      endedAt TEXT,
      state TEXT NOT NULL DEFAULT 'active' CHECK (state IN (${sessionStates})),
      userAgentSummary TEXT,
      browserSummary TEXT,
      deviceSummary TEXT,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL,
      FOREIGN KEY (userId) REFERENCES users(id) ON DELETE SET NULL
    );

    CREATE INDEX IF NOT EXISTS idx_ops_sessions_state_seen
      ON ops_sessions(state, lastSeenAt DESC);
    CREATE INDEX IF NOT EXISTS idx_ops_sessions_user_seen
      ON ops_sessions(userId, lastSeenAt DESC);
    CREATE INDEX IF NOT EXISTS idx_ops_sessions_system_seen
      ON ops_sessions(currentSystem, lastSeenAt DESC);
    CREATE INDEX IF NOT EXISTS idx_ops_sessions_last_active
      ON ops_sessions(lastActiveAt DESC);

    CREATE TABLE IF NOT EXISTS ops_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sessionId TEXT,
      userId INTEGER,
      eventType TEXT NOT NULL CHECK (eventType IN (${eventTypes})),
      category TEXT NOT NULL,
      system TEXT NOT NULL DEFAULT 'unknown' CHECK (system IN (${systems})),
      path TEXT,
      routePattern TEXT,
      pageTitle TEXT,
      endpoint TEXT,
      method TEXT,
      statusCode INTEGER,
      durationMs INTEGER,
      success INTEGER CHECK (success IN (0, 1) OR success IS NULL),
      source TEXT NOT NULL DEFAULT 'unknown' CHECK (source IN (${sources})),
      severity TEXT NOT NULL DEFAULT 'info' CHECK (severity IN (${severities})),
      occurredAt TEXT NOT NULL,
      createdAt TEXT NOT NULL,
      metadataJson TEXT NOT NULL DEFAULT '{}',
      FOREIGN KEY (sessionId) REFERENCES ops_sessions(id) ON DELETE SET NULL,
      FOREIGN KEY (userId) REFERENCES users(id) ON DELETE SET NULL
    );

    CREATE INDEX IF NOT EXISTS idx_ops_events_occurred
      ON ops_events(occurredAt DESC, id DESC);
    CREATE INDEX IF NOT EXISTS idx_ops_events_type_occurred
      ON ops_events(eventType, occurredAt DESC);
    CREATE INDEX IF NOT EXISTS idx_ops_events_session_occurred
      ON ops_events(sessionId, occurredAt DESC);
    CREATE INDEX IF NOT EXISTS idx_ops_events_system_path
      ON ops_events(system, path, occurredAt DESC);
    CREATE INDEX IF NOT EXISTS idx_ops_events_endpoint_occurred
      ON ops_events(endpoint, occurredAt DESC);
    CREATE INDEX IF NOT EXISTS idx_ops_events_user_occurred
      ON ops_events(userId, occurredAt DESC);

    CREATE TABLE IF NOT EXISTS ops_errors (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      signature TEXT NOT NULL UNIQUE,
      source TEXT NOT NULL DEFAULT 'unknown' CHECK (source IN (${sources})),
      severity TEXT NOT NULL DEFAULT 'error' CHECK (severity IN (${severities})),
      system TEXT NOT NULL DEFAULT 'unknown' CHECK (system IN (${systems})),
      path TEXT,
      routePattern TEXT,
      message TEXT NOT NULL,
      code TEXT,
      statusCode INTEGER,
      stackFingerprint TEXT,
      firstSeenAt TEXT NOT NULL,
      lastSeenAt TEXT NOT NULL,
      count INTEGER NOT NULL DEFAULT 1,
      lastEventId INTEGER,
      lastSessionId TEXT,
      lastUserId INTEGER,
      sampleMetadataJson TEXT NOT NULL DEFAULT '{}',
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL,
      FOREIGN KEY (lastEventId) REFERENCES ops_events(id) ON DELETE SET NULL,
      FOREIGN KEY (lastSessionId) REFERENCES ops_sessions(id) ON DELETE SET NULL,
      FOREIGN KEY (lastUserId) REFERENCES users(id) ON DELETE SET NULL
    );

    CREATE INDEX IF NOT EXISTS idx_ops_errors_last_seen
      ON ops_errors(lastSeenAt DESC);
    CREATE INDEX IF NOT EXISTS idx_ops_errors_severity_source
      ON ops_errors(severity, source, lastSeenAt DESC);
    CREATE INDEX IF NOT EXISTS idx_ops_errors_system_path
      ON ops_errors(system, path, lastSeenAt DESC);

    CREATE TABLE IF NOT EXISTS ops_metric_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      capturedAt TEXT NOT NULL,
      windowStartAt TEXT NOT NULL,
      windowEndAt TEXT NOT NULL,
      onlineUsers INTEGER NOT NULL DEFAULT 0,
      activeUsers INTEGER NOT NULL DEFAULT 0,
      sessionsToday INTEGER NOT NULL DEFAULT 0,
      pageViewsToday INTEGER NOT NULL DEFAULT 0,
      errorCountToday INTEGER NOT NULL DEFAULT 0,
      apiRequestCount INTEGER NOT NULL DEFAULT 0,
      apiFailureCount INTEGER NOT NULL DEFAULT 0,
      dashboardHealth TEXT,
      performanceHealth TEXT,
      payloadJson TEXT NOT NULL DEFAULT '{}'
    );

    CREATE INDEX IF NOT EXISTS idx_ops_metric_snapshots_captured
      ON ops_metric_snapshots(capturedAt DESC);
    CREATE INDEX IF NOT EXISTS idx_ops_metric_snapshots_window
      ON ops_metric_snapshots(windowStartAt, windowEndAt);
  `;
}

