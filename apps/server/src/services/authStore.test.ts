import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../config/db.js", async () => {
  const Database = (await import("better-sqlite3")).default;
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  return {
    db,
  };
});

import { db } from "../config/db.js";
import { AuthStoreError, deleteUserById, updateUser } from "./authStore.js";

function resetSchema() {
  db.exec(`
    DROP TABLE IF EXISTS scano_task_assignees;
    DROP TABLE IF EXISTS scano_tasks;
    DROP TABLE IF EXISTS scano_team_members;
    DROP TABLE IF EXISTS sessions;
    DROP TABLE IF EXISTS users;

    CREATE TABLE users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      role TEXT NOT NULL,
      passwordHash TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 1,
      createdAt TEXT NOT NULL,
      upuseAccess INTEGER NOT NULL DEFAULT 1,
      isPrimaryAdmin INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE sessions (
      token TEXT PRIMARY KEY,
      userId INTEGER NOT NULL,
      expiresAt TEXT NOT NULL,
      createdAt TEXT NOT NULL,
      FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE scano_team_members (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      linkedUserId INTEGER NOT NULL UNIQUE,
      role TEXT NOT NULL CHECK (role IN ('team_lead', 'scanner')),
      active INTEGER NOT NULL DEFAULT 1,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL,
      FOREIGN KEY (linkedUserId) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE scano_tasks (
      id TEXT PRIMARY KEY,
      status TEXT NOT NULL CHECK (status IN ('pending', 'in_progress', 'awaiting_review', 'completed'))
    );

    CREATE TABLE scano_task_assignees (
      taskId TEXT NOT NULL,
      teamMemberId INTEGER NOT NULL,
      assignedAt TEXT NOT NULL,
      PRIMARY KEY (taskId, teamMemberId),
      FOREIGN KEY (taskId) REFERENCES scano_tasks(id) ON DELETE CASCADE,
      FOREIGN KEY (teamMemberId) REFERENCES scano_team_members(id) ON DELETE CASCADE
    );
  `);

  db.prepare(`
    INSERT INTO users (id, email, name, role, passwordHash, active, createdAt, upuseAccess, isPrimaryAdmin)
    VALUES
      (1, 'admin@example.com', 'Admin', 'admin', 'hash-admin', 1, '2026-04-08T08:00:00.000Z', 1, 1),
      (2, 'scanner@example.com', 'Scanner User', 'user', 'hash-user', 1, '2026-04-08T08:05:00.000Z', 1, 0)
  `).run();

  db.prepare(`
    INSERT INTO scano_team_members (id, name, linkedUserId, role, active, createdAt, updatedAt)
    VALUES (11, 'Scanner User', 2, 'scanner', 1, '2026-04-08T08:05:00.000Z', '2026-04-08T08:05:00.000Z')
  `).run();
}

function insertTask(taskId: string, status: "pending" | "in_progress" | "awaiting_review" | "completed") {
  db.prepare(`
    INSERT INTO scano_tasks (id, status)
    VALUES (?, ?)
  `).run(taskId, status);
}

function assignTask(taskId: string, teamMemberId: number) {
  db.prepare(`
    INSERT INTO scano_task_assignees (taskId, teamMemberId, assignedAt)
    VALUES (?, ?, '2026-04-08T09:00:00.000Z')
  `).run(taskId, teamMemberId);
}

function expectAuthStoreError(action: () => unknown, expectedCode: string) {
  try {
    action();
    throw new Error("Expected AuthStoreError");
  } catch (error) {
    expect(error).toBeInstanceOf(AuthStoreError);
    expect((error as AuthStoreError).status).toBe(409);
    expect((error as AuthStoreError).code).toBe(expectedCode);
  }
}

describe("authStore Scano access guards", () => {
  beforeEach(() => {
    resetSchema();
  });

  it("blocks Scano access removal while the linked user is assigned to a pending task", () => {
    insertTask("task-pending", "pending");
    assignTask("task-pending", 11);

    expectAuthStoreError(() => updateUser({
      id: 2,
      email: "scanner@example.com",
      name: "Scanner User",
      upuseAccess: true,
      upuseRole: "user",
      scanoAccessRole: undefined,
      actorUserId: 1,
    }), "SCANO_ACCESS_ACTIVE_TASKS");
  });

  it("allows Scano access removal after all assigned tasks are completed", () => {
    insertTask("task-completed", "completed");
    assignTask("task-completed", 11);

    const updated = updateUser({
      id: 2,
      email: "scanner@example.com",
      name: "Scanner User",
      upuseAccess: true,
      upuseRole: "user",
      scanoAccessRole: undefined,
      actorUserId: 1,
    });

    const memberRow = db.prepare("SELECT active FROM scano_team_members WHERE linkedUserId = 2").get() as { active: number };
    expect(updated.scanoRole).toBeUndefined();
    expect(memberRow.active).toBe(0);
  });

  it("blocks archiving users who are still assigned to awaiting-review tasks", () => {
    insertTask("task-review", "awaiting_review");
    assignTask("task-review", 11);

    expectAuthStoreError(() => deleteUserById({
      id: 2,
      actorUserId: 1,
    }), "USER_ARCHIVE_ACTIVE_TASKS");
  });

  it("archives the user, disables linked Scano access, clears sessions, and preserves completed history", () => {
    insertTask("task-history", "completed");
    assignTask("task-history", 11);
    db.prepare(`
      INSERT INTO sessions (token, userId, expiresAt, createdAt)
      VALUES ('session-1', 2, '2026-04-08T20:00:00.000Z', '2026-04-08T08:30:00.000Z')
    `).run();

    const archived = deleteUserById({
      id: 2,
      actorUserId: 1,
    });

    const userRow = db.prepare("SELECT active, upuseAccess FROM users WHERE id = 2").get() as { active: number; upuseAccess: number };
    const memberRow = db.prepare("SELECT active FROM scano_team_members WHERE linkedUserId = 2").get() as { active: number };
    const sessionsRow = db.prepare("SELECT COUNT(*) AS count FROM sessions WHERE userId = 2").get() as { count: number };
    const assignmentsRow = db.prepare("SELECT COUNT(*) AS count FROM scano_task_assignees WHERE teamMemberId = 11").get() as { count: number };
    const tasksRow = db.prepare("SELECT COUNT(*) AS count FROM scano_tasks WHERE id = 'task-history'").get() as { count: number };

    expect(archived).toBe(true);
    expect(userRow).toEqual({ active: 0, upuseAccess: 0 });
    expect(memberRow.active).toBe(0);
    expect(sessionsRow.count).toBe(0);
    expect(assignmentsRow.count).toBe(1);
    expect(tasksRow.count).toBe(1);
  });
});
