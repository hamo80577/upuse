import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../config/db.js", async () => {
  const Database = (await import("better-sqlite3")).default;
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  return {
    db,
  };
});

import { db } from "../../../config/db.js";
import { hashSessionToken } from "../../../services/auth/passwords.js";
import {
  getSessionUserByToken,
  initializeSessionStore,
  stopSessionStore,
} from "./sessionStore.js";

function resetSchema() {
  db.exec(`
    DROP TABLE IF EXISTS sessions;
    DROP TABLE IF EXISTS scano_team_members;
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

    CREATE TABLE sessions (
      token TEXT PRIMARY KEY,
      userId INTEGER NOT NULL,
      expiresAt TEXT NOT NULL,
      createdAt TEXT NOT NULL,
      FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE
    );
  `);

  db.prepare(`
    INSERT INTO users (id, email, name, role, passwordHash, active, createdAt, upuseAccess, isPrimaryAdmin)
    VALUES (1, 'admin@example.com', 'Admin', 'admin', 'hash-admin', 1, '2026-04-12T08:00:00.000Z', 1, 1)
  `).run();
}

function insertSession(token: string, expiresAt: string) {
  db.prepare(`
    INSERT INTO sessions (token, userId, expiresAt, createdAt)
    VALUES (?, 1, ?, '2026-04-12T08:30:00.000Z')
  `).run(hashSessionToken(token), expiresAt);
}

describe("sessionStore pruning", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-12T12:00:00.000Z"));
    stopSessionStore();
    resetSchema();
  });

  afterEach(() => {
    stopSessionStore();
    vi.useRealTimers();
  });

  afterAll(() => {
    db.close();
  });

  it("rejects expired sessions without pruning them during lookup", () => {
    insertSession("expired-session", "2026-04-12T11:59:00.000Z");

    expect(getSessionUserByToken("expired-session")).toBeNull();
    expect(db.prepare("SELECT COUNT(*) AS count FROM sessions").get()).toEqual({ count: 1 });
  });

  it("prunes expired sessions when session maintenance starts at startup", () => {
    insertSession("expired-session", "2026-04-12T11:59:00.000Z");
    insertSession("active-session", "2026-04-12T12:30:00.000Z");

    initializeSessionStore({ pruneIntervalMs: 60_000 });

    expect(db.prepare("SELECT COUNT(*) AS count FROM sessions WHERE expiresAt <= '2026-04-12T12:00:00.000Z'").get()).toEqual({ count: 0 });
    expect(getSessionUserByToken("active-session")?.user.id).toBe(1);
  });

  it("continues pruning expired sessions on the background interval", () => {
    initializeSessionStore({ pruneIntervalMs: 1_000 });
    insertSession("later-expired-session", "2026-04-12T11:59:59.000Z");

    vi.advanceTimersByTime(1_000);

    expect(db.prepare("SELECT COUNT(*) AS count FROM sessions").get()).toEqual({ count: 0 });
  });
});
