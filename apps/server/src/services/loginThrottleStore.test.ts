import Database from "better-sqlite3";
import { describe, expect, it, vi } from "vitest";

vi.mock("../config/db.js", async () => {
  const BetterSqlite3 = (await import("better-sqlite3")).default;
  return {
    db: new BetterSqlite3(":memory:"),
  };
});

import { createSqliteLoginThrottleStore } from "./loginThrottleStore.js";

function createTestDb() {
  const database = new Database(":memory:");
  database.exec(`
    CREATE TABLE login_attempts (
      key TEXT PRIMARY KEY,
      count INTEGER NOT NULL,
      windowStartedAt TEXT NOT NULL,
      blockedUntil TEXT,
      updatedAt TEXT NOT NULL
    );

    CREATE INDEX idx_login_attempts_updated
      ON login_attempts(updatedAt, key);
  `);
  return database;
}

describe("loginThrottleStore", () => {
  it("persists blocked login state across store instances backed by the same database", () => {
    const database = createTestDb();
    let nowMs = Date.parse("2026-04-10T08:00:00.000Z");

    const firstStore = createSqliteLoginThrottleStore(database, {
      maxKeys: 10,
      now: () => nowMs,
    });

    for (let attempt = 1; attempt <= 5; attempt += 1) {
      firstStore.registerFailedAttempt("127.0.0.1:admin@example.com");
    }

    nowMs += 1_000;

    const restartedStore = createSqliteLoginThrottleStore(database, {
      maxKeys: 10,
      now: () => nowMs,
    });

    expect(restartedStore.getBlockedUntilMs("127.0.0.1:admin@example.com")).toBeGreaterThan(nowMs);
    database.close();
  });

  it("prunes expired rows during initialization so stale state does not survive startup", () => {
    const database = createTestDb();
    let nowMs = Date.parse("2026-04-10T08:00:00.000Z");

    const firstStore = createSqliteLoginThrottleStore(database, {
      maxKeys: 10,
      now: () => nowMs,
    });
    firstStore.registerFailedAttempt("127.0.0.1:old@example.com");

    nowMs += (10 * 60 * 1000) + 1;

    const restartedStore = createSqliteLoginThrottleStore(database, {
      maxKeys: 10,
      now: () => nowMs,
    });
    restartedStore.initialize();

    expect(database.prepare("SELECT COUNT(*) AS count FROM login_attempts").get()).toEqual({ count: 0 });
    database.close();
  });

  it("prunes the oldest keys when the persisted throttle table exceeds capacity", () => {
    const database = createTestDb();
    let nowMs = Date.parse("2026-04-10T08:00:00.000Z");

    const store = createSqliteLoginThrottleStore(database, {
      maxKeys: 2,
      now: () => nowMs,
    });

    store.registerFailedAttempt("k1");
    nowMs += 1_000;
    store.registerFailedAttempt("k2");
    nowMs += 1_000;
    store.registerFailedAttempt("k3");

    const keys = (database.prepare("SELECT key FROM login_attempts ORDER BY key ASC").all() as Array<{ key: string }>).map((row) => row.key);
    expect(keys).toEqual(["k2", "k3"]);
    database.close();
  });
});
