import Database from "better-sqlite3";
import { describe, expect, it, vi } from "vitest";

vi.mock("../config/db.js", async () => {
  const BetterSqlite3 = (await import("better-sqlite3")).default;
  return {
    db: new BetterSqlite3(":memory:"),
  };
});

import { createSqliteScanoRunnerSessionStore } from "./scanoRunnerSessionStore.js";

const TASK_ID = "11111111-1111-4111-8111-111111111111";

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

  return database;
}

describe("scanoRunnerSessionStore", () => {
  it("persists runner sessions across store instances backed by the same database", () => {
    const database = createTestDb();
    let nowMs = Date.parse("2026-04-10T08:00:00.000Z");

    const firstStore = createSqliteScanoRunnerSessionStore(database, {
      now: () => nowMs,
    });
    const session = firstStore.createSession({
      taskId: TASK_ID,
      actorUserId: 2,
      teamMemberId: 11,
      chainId: 1037,
      vendorId: 4594,
      globalEntityId: "TB_EG",
    });

    nowMs += 1_000;

    const restartedStore = createSqliteScanoRunnerSessionStore(database, {
      now: () => nowMs,
    });
    const restoredSession = restartedStore.readSession(TASK_ID, 2, session.token);

    expect(restoredSession).toMatchObject({
      token: session.token,
      taskId: TASK_ID,
      actorUserId: 2,
      teamMemberId: 11,
      chainId: 1037,
      vendorId: 4594,
      globalEntityId: "TB_EG",
    });
    expect(Date.parse(restoredSession!.expiresAt)).toBeGreaterThan(nowMs);
    database.close();
  });

  it("prunes expired runner sessions during initialization so stale tokens do not survive startup", () => {
    const database = createTestDb();
    let nowMs = Date.parse("2026-04-10T08:00:00.000Z");

    const firstStore = createSqliteScanoRunnerSessionStore(database, {
      now: () => nowMs,
      sessionTtlMs: 1_000,
    });
    firstStore.createSession({
      taskId: TASK_ID,
      actorUserId: 2,
      teamMemberId: 11,
      chainId: 1037,
      vendorId: 4594,
      globalEntityId: "TB_EG",
    });

    nowMs += 2_000;

    const restartedStore = createSqliteScanoRunnerSessionStore(database, {
      now: () => nowMs,
      sessionTtlMs: 1_000,
    });
    restartedStore.initialize();

    expect(database.prepare("SELECT COUNT(*) AS count FROM scano_runner_sessions").get()).toEqual({ count: 0 });
    database.close();
  });

  it("rejects persisted sessions when the actor or task does not match", () => {
    const database = createTestDb();
    const store = createSqliteScanoRunnerSessionStore(database);
    const session = store.createSession({
      taskId: TASK_ID,
      actorUserId: 2,
      teamMemberId: 11,
      chainId: 1037,
      vendorId: 4594,
      globalEntityId: "TB_EG",
    });

    expect(store.readSession(TASK_ID, 3, session.token)).toBeNull();
    expect(store.readSession("22222222-2222-4222-8222-222222222222", 2, session.token)).toBeNull();
    database.close();
  });
});
