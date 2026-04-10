import Database from "better-sqlite3";
import { describe, expect, it, vi } from "vitest";

vi.mock("../config/db.js", async () => {
  const BetterSqlite3 = (await import("better-sqlite3")).default;
  return {
    db: new BetterSqlite3(":memory:"),
  };
});

import { createSqliteScanoRunnerSessionStore } from "./scanoRunnerSessionStore.js";
import { hashSessionToken } from "./auth/passwords.js";

const TASK_ID = "11111111-1111-4111-8111-111111111111";
const TASK_ID_2 = "22222222-2222-4222-8222-222222222222";

function createTestDb() {
  const database = new Database(":memory:");
  database.pragma("foreign_keys = ON");
  database.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY,
      email TEXT NOT NULL,
      name TEXT NOT NULL,
      role TEXT NOT NULL,
      passwordHash TEXT NOT NULL DEFAULT 'hash',
      active INTEGER NOT NULL DEFAULT 1,
      createdAt TEXT NOT NULL,
      upuseAccess INTEGER NOT NULL DEFAULT 1,
      isPrimaryAdmin INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE scano_team_members (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      linkedUserId INTEGER NOT NULL UNIQUE,
      role TEXT NOT NULL DEFAULT 'scanner',
      active INTEGER NOT NULL DEFAULT 1,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL,
      FOREIGN KEY (linkedUserId) REFERENCES users(id) ON DELETE CASCADE
    );

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
      status TEXT NOT NULL,
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

    CREATE INDEX idx_scano_runner_sessions_expires
      ON scano_runner_sessions(expiresAt);
  `);

  database.prepare(`
    INSERT INTO users (id, email, name, role, createdAt)
    VALUES (2, 'scanner@example.com', 'Scanner', 'user', '2026-04-10T08:00:00.000Z')
  `).run();
  database.prepare(`
    INSERT INTO scano_team_members (id, name, linkedUserId, role, createdAt, updatedAt)
    VALUES (11, 'Ali', 2, 'scanner', '2026-04-10T08:00:00.000Z', '2026-04-10T08:00:00.000Z')
  `).run();
  database.prepare(`
    INSERT INTO scano_tasks (
      id, chainId, chainName, branchId, branchGlobalId, branchName, globalEntityId, countryCode, additionalRemoteId,
      scheduledAt, status, createdByUserId, createdAt, updatedAt
    ) VALUES (
      ?, 1037, 'Carrefour', 4594, 'branch-4594', 'Nasr City', 'TB_EG', 'EG', 'branch-4594',
      '2026-04-10T08:00:00.000Z', 'in_progress', 2, '2026-04-10T08:00:00.000Z', '2026-04-10T08:00:00.000Z'
    )
  `).run(TASK_ID);
  database.prepare(`
    INSERT INTO scano_tasks (
      id, chainId, chainName, branchId, branchGlobalId, branchName, globalEntityId, countryCode, additionalRemoteId,
      scheduledAt, status, createdByUserId, createdAt, updatedAt
    ) VALUES (
      ?, 1038, 'Carrefour', 4595, 'branch-4595', 'Maadi', 'TB_EG', 'EG', 'branch-4595',
      '2026-04-10T09:00:00.000Z', 'in_progress', 2, '2026-04-10T09:00:00.000Z', '2026-04-10T09:00:00.000Z'
    )
  `).run(TASK_ID_2);

  return database;
}

describe("scanoRunnerSessionStore", () => {
  it("persists newly created runner sessions hashed at rest", () => {
    const database = createTestDb();
    const store = createSqliteScanoRunnerSessionStore(database);

    const session = store.createRunnerSession({
      taskId: TASK_ID,
      actorUserId: 2,
      teamMemberId: 11,
      chainId: 1037,
      vendorId: 4594,
      globalEntityId: "TB_EG",
    }, Date.parse("2026-04-10T08:00:00.000Z"));

    expect(
      database.prepare("SELECT token, taskId, actorUserId, teamMemberId FROM scano_runner_sessions WHERE token = ?").get(hashSessionToken(session.token)),
    ).toEqual({
      token: hashSessionToken(session.token),
      taskId: TASK_ID,
      actorUserId: 2,
      teamMemberId: 11,
    });
    database.close();
  });

  it("reads a valid persisted runner session", () => {
    const database = createTestDb();
    const store = createSqliteScanoRunnerSessionStore(database);
    const nowMs = Date.parse("2026-04-10T08:00:00.000Z");
    const session = store.createRunnerSession({
      taskId: TASK_ID,
      actorUserId: 2,
      teamMemberId: 11,
      chainId: 1037,
      vendorId: 4594,
      globalEntityId: "TB_EG",
    }, nowMs);
    const restoredSession = store.readRunnerSession(TASK_ID, 2, session.token, nowMs + 1_000);

    expect(restoredSession).toMatchObject({
      token: session.token,
      taskId: TASK_ID,
      actorUserId: 2,
      teamMemberId: 11,
      chainId: 1037,
      vendorId: 4594,
      globalEntityId: "TB_EG",
    });
    expect(restoredSession!.expiresAt).toBeGreaterThan(nowMs + 1_000);
    database.close();
  });

  it("returns null for the wrong token", () => {
    const database = createTestDb();
    const store = createSqliteScanoRunnerSessionStore(database);
    store.createRunnerSession({
      taskId: TASK_ID,
      actorUserId: 2,
      teamMemberId: 11,
      chainId: 1037,
      vendorId: 4594,
      globalEntityId: "TB_EG",
    }, Date.parse("2026-04-10T08:00:00.000Z"));

    expect(store.readRunnerSession(TASK_ID, 2, "missing-token", Date.parse("2026-04-10T08:01:00.000Z"))).toBeNull();
    database.close();
  });

  it("returns null for the wrong actorUserId", () => {
    const database = createTestDb();
    const store = createSqliteScanoRunnerSessionStore(database);
    const session = store.createRunnerSession({
      taskId: TASK_ID,
      actorUserId: 2,
      teamMemberId: 11,
      chainId: 1037,
      vendorId: 4594,
      globalEntityId: "TB_EG",
    }, Date.parse("2026-04-10T08:00:00.000Z"));

    expect(store.readRunnerSession(TASK_ID, 3, session.token, Date.parse("2026-04-10T08:01:00.000Z"))).toBeNull();
    database.close();
  });

  it("returns null for the wrong taskId", () => {
    const database = createTestDb();
    const store = createSqliteScanoRunnerSessionStore(database);
    const session = store.createRunnerSession({
      taskId: TASK_ID,
      actorUserId: 2,
      teamMemberId: 11,
      chainId: 1037,
      vendorId: 4594,
      globalEntityId: "TB_EG",
    }, Date.parse("2026-04-10T08:00:00.000Z"));

    expect(store.readRunnerSession(TASK_ID_2, 2, session.token, Date.parse("2026-04-10T08:01:00.000Z"))).toBeNull();
    database.close();
  });

  it("extends the ttl on successful reads", () => {
    const database = createTestDb();
    const store = createSqliteScanoRunnerSessionStore(database, {
      sessionTtlMs: 30 * 60 * 1000,
    });
    const createdAtMs = Date.parse("2026-04-10T08:00:00.000Z");
    const session = store.createRunnerSession({
      taskId: TASK_ID,
      actorUserId: 2,
      teamMemberId: 11,
      chainId: 1037,
      vendorId: 4594,
      globalEntityId: "TB_EG",
    }, createdAtMs);

    const refreshedSession = store.readRunnerSession(TASK_ID, 2, session.token, createdAtMs + 60_000);

    expect(refreshedSession!.expiresAt).toBeGreaterThan(session.expiresAt);
    expect(
      database.prepare("SELECT expiresAt FROM scano_runner_sessions WHERE token = ?").get(hashSessionToken(session.token)),
    ).toEqual({
      expiresAt: new Date(createdAtMs + 60_000 + (30 * 60 * 1000)).toISOString(),
    });
    database.close();
  });

  it("prunes expired sessions", () => {
    const database = createTestDb();
    const store = createSqliteScanoRunnerSessionStore(database, {
      sessionTtlMs: 1_000,
    });
    const nowMs = Date.parse("2026-04-10T08:00:00.000Z");
    store.createRunnerSession({
      taskId: TASK_ID,
      actorUserId: 2,
      teamMemberId: 11,
      chainId: 1037,
      vendorId: 4594,
      globalEntityId: "TB_EG",
    }, nowMs);

    store.pruneRunnerSessions(nowMs + 2_000);

    expect(database.prepare("SELECT COUNT(*) AS count FROM scano_runner_sessions").get()).toEqual({ count: 0 });
    database.close();
  });

  it("clears runner sessions only for the matching task", () => {
    const database = createTestDb();
    const store = createSqliteScanoRunnerSessionStore(database);
    store.createRunnerSession({
      taskId: TASK_ID,
      actorUserId: 2,
      teamMemberId: 11,
      chainId: 1037,
      vendorId: 4594,
      globalEntityId: "TB_EG",
    }, Date.parse("2026-04-10T08:00:00.000Z"));
    const otherSession = store.createRunnerSession({
      taskId: TASK_ID_2,
      actorUserId: 2,
      teamMemberId: 11,
      chainId: 1038,
      vendorId: 4595,
      globalEntityId: "TB_EG",
    }, Date.parse("2026-04-10T08:01:00.000Z"));

    store.clearRunnerSessionsForTask(TASK_ID);

    expect(database.prepare("SELECT COUNT(*) AS count FROM scano_runner_sessions WHERE taskId = ?").get(TASK_ID)).toEqual({ count: 0 });
    expect(
      database.prepare("SELECT token, taskId FROM scano_runner_sessions WHERE token = ?").get(hashSessionToken(otherSession.token)),
    ).toEqual({
      token: hashSessionToken(otherSession.token),
      taskId: TASK_ID_2,
    });
    database.close();
  });

  it("persists runner sessions across store instances backed by the same database", () => {
    const database = createTestDb();
    const nowMs = Date.parse("2026-04-10T08:00:00.000Z");

    const firstStore = createSqliteScanoRunnerSessionStore(database);
    const session = firstStore.createRunnerSession({
      taskId: TASK_ID,
      actorUserId: 2,
      teamMemberId: 11,
      chainId: 1037,
      vendorId: 4594,
      globalEntityId: "TB_EG",
    }, nowMs);

    const restartedStore = createSqliteScanoRunnerSessionStore(database);
    const restoredSession = restartedStore.readRunnerSession(TASK_ID, 2, session.token, nowMs + 1_000);

    expect(restoredSession).toMatchObject({
      token: session.token,
      taskId: TASK_ID,
      actorUserId: 2,
      teamMemberId: 11,
      chainId: 1037,
      vendorId: 4594,
      globalEntityId: "TB_EG",
    });
    database.close();
  });

  it("prunes expired runner sessions during initialization so stale tokens do not survive startup", () => {
    const database = createTestDb();
    const nowMs = Date.parse("2026-04-10T08:00:00.000Z");

    const firstStore = createSqliteScanoRunnerSessionStore(database, {
      sessionTtlMs: 1_000,
    });
    firstStore.createRunnerSession({
      taskId: TASK_ID,
      actorUserId: 2,
      teamMemberId: 11,
      chainId: 1037,
      vendorId: 4594,
      globalEntityId: "TB_EG",
    }, nowMs);

    const restartedStore = createSqliteScanoRunnerSessionStore(database, {
      sessionTtlMs: 1_000,
      now: () => nowMs + 2_000,
    });
    restartedStore.initialize();

    expect(database.prepare("SELECT COUNT(*) AS count FROM scano_runner_sessions").get()).toEqual({ count: 0 });
    database.close();
  });

  it("rewrites legacy raw runner tokens to hashed storage on successful reads", () => {
    const database = createTestDb();
    const store = createSqliteScanoRunnerSessionStore(database);
    const nowMs = Date.parse("2026-04-10T08:00:00.000Z");
    const legacyToken = "legacy-runner-token";

    database.prepare(`
      INSERT INTO scano_runner_sessions (
        token,
        taskId,
        actorUserId,
        teamMemberId,
        chainId,
        vendorId,
        globalEntityId,
        expiresAt,
        createdAt,
        updatedAt
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      legacyToken,
      TASK_ID,
      2,
      11,
      1037,
      4594,
      "TB_EG",
      new Date(nowMs + (30 * 60 * 1000)).toISOString(),
      new Date(nowMs).toISOString(),
      new Date(nowMs).toISOString(),
    );

    const restoredSession = store.readRunnerSession(TASK_ID, 2, legacyToken, nowMs + 1_000);

    expect(restoredSession).toMatchObject({
      token: legacyToken,
      taskId: TASK_ID,
      actorUserId: 2,
      teamMemberId: 11,
    });
    expect(database.prepare("SELECT COUNT(*) AS count FROM scano_runner_sessions WHERE token = ?").get(legacyToken)).toEqual({
      count: 0,
    });
    expect(
      database.prepare("SELECT token FROM scano_runner_sessions WHERE token = ?").get(hashSessionToken(legacyToken)),
    ).toEqual({
      token: hashSessionToken(legacyToken),
    });
    database.close();
  });
});
