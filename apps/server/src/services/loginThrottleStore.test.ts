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
  it("creates persisted state on the first failed attempt", () => {
    const database = createTestDb();
    const store = createSqliteLoginThrottleStore(database, { maxKeys: 10 });

    expect(store.registerFailedLoginAttempt("127.0.0.1:admin@example.com", Date.parse("2026-04-10T08:00:00.000Z"))).toEqual({
      count: 1,
      blockedUntilMs: null,
    });
    expect(
      database.prepare("SELECT key, count, blockedUntil FROM login_attempts WHERE key = ?").get("127.0.0.1:admin@example.com"),
    ).toEqual({
      key: "127.0.0.1:admin@example.com",
      count: 1,
      blockedUntil: null,
    });
    database.close();
  });

  it("increments repeated failures within the same window", () => {
    const database = createTestDb();
    const store = createSqliteLoginThrottleStore(database, { maxKeys: 10 });
    const nowMs = Date.parse("2026-04-10T08:00:00.000Z");

    store.registerFailedLoginAttempt("127.0.0.1:admin@example.com", nowMs);
    expect(store.registerFailedLoginAttempt("127.0.0.1:admin@example.com", nowMs + 60_000)).toEqual({
      count: 2,
      blockedUntilMs: null,
    });
    expect(
      database.prepare("SELECT count FROM login_attempts WHERE key = ?").get("127.0.0.1:admin@example.com"),
    ).toEqual({ count: 2 });
    database.close();
  });

  it("sets blockedUntil after the fifth failed attempt", () => {
    const database = createTestDb();
    const store = createSqliteLoginThrottleStore(database, { maxKeys: 10 });
    const nowMs = Date.parse("2026-04-10T08:00:00.000Z");

    for (let attempt = 1; attempt <= 4; attempt += 1) {
      expect(store.registerFailedLoginAttempt("127.0.0.1:admin@example.com", nowMs + attempt)).toEqual({
        count: attempt,
        blockedUntilMs: null,
      });
    }

    const blockedState = store.registerFailedLoginAttempt("127.0.0.1:admin@example.com", nowMs + 5);
    expect(blockedState.count).toBe(5);
    expect(blockedState.blockedUntilMs).toBe(nowMs + 5 + (15 * 60 * 1000));
    database.close();
  });

  it("clears expired blocked state on read", () => {
    const database = createTestDb();
    const store = createSqliteLoginThrottleStore(database, { maxKeys: 10 });
    const nowMs = Date.parse("2026-04-10T08:00:00.000Z");

    for (let attempt = 1; attempt <= 5; attempt += 1) {
      store.registerFailedLoginAttempt("127.0.0.1:admin@example.com", nowMs + attempt);
    }

    expect(store.getBlockedUntil("127.0.0.1:admin@example.com", nowMs + (15 * 60 * 1000) + 10)).toBeNull();
    expect(database.prepare("SELECT COUNT(*) AS count FROM login_attempts WHERE key = ?").get("127.0.0.1:admin@example.com")).toEqual({
      count: 0,
    });
    database.close();
  });

  it("resets the attempt count when a new window starts", () => {
    const database = createTestDb();
    const store = createSqliteLoginThrottleStore(database, { maxKeys: 10 });
    const nowMs = Date.parse("2026-04-10T08:00:00.000Z");

    store.registerFailedLoginAttempt("127.0.0.1:admin@example.com", nowMs);
    expect(
      store.registerFailedLoginAttempt("127.0.0.1:admin@example.com", nowMs + (10 * 60 * 1000) + 1),
    ).toEqual({
      count: 1,
      blockedUntilMs: null,
    });
    database.close();
  });

  it("clears persisted login attempts for a key", () => {
    const database = createTestDb();
    const store = createSqliteLoginThrottleStore(database, { maxKeys: 10 });
    const nowMs = Date.parse("2026-04-10T08:00:00.000Z");

    store.registerFailedLoginAttempt("127.0.0.1:admin@example.com", nowMs);
    store.clearLoginAttempts("127.0.0.1:admin@example.com");

    expect(database.prepare("SELECT COUNT(*) AS count FROM login_attempts").get()).toEqual({ count: 0 });
    database.close();
  });

  it("prunes expired rows", () => {
    const database = createTestDb();
    const store = createSqliteLoginThrottleStore(database, { maxKeys: 10 });
    const nowMs = Date.parse("2026-04-10T08:00:00.000Z");

    store.registerFailedLoginAttempt("127.0.0.1:old@example.com", nowMs);
    store.pruneLoginAttempts(nowMs + (10 * 60 * 1000) + 1);

    expect(database.prepare("SELECT COUNT(*) AS count FROM login_attempts").get()).toEqual({ count: 0 });
    database.close();
  });

  it("prunes the oldest keys when the persisted throttle table exceeds capacity", () => {
    const database = createTestDb();
    const store = createSqliteLoginThrottleStore(database, {
      maxKeys: 2,
    });

    store.registerFailedLoginAttempt("k1", Date.parse("2026-04-10T08:00:00.000Z"));
    store.registerFailedLoginAttempt("k2", Date.parse("2026-04-10T08:00:01.000Z"));
    store.registerFailedLoginAttempt("k3", Date.parse("2026-04-10T08:00:02.000Z"));

    const keys = (database.prepare("SELECT key FROM login_attempts ORDER BY key ASC").all() as Array<{ key: string }>).map((row) => row.key);
    expect(keys).toEqual(["k2", "k3"]);
    database.close();
  });

  it("persists blocked login state across store instances backed by the same database", () => {
    const database = createTestDb();
    const nowMs = Date.parse("2026-04-10T08:00:00.000Z");

    const firstStore = createSqliteLoginThrottleStore(database, { maxKeys: 10 });

    for (let attempt = 1; attempt <= 5; attempt += 1) {
      firstStore.registerFailedLoginAttempt("127.0.0.1:admin@example.com", nowMs + attempt);
    }

    const restartedStore = createSqliteLoginThrottleStore(database, {
      maxKeys: 10,
    });

    expect(restartedStore.getBlockedUntil("127.0.0.1:admin@example.com", nowMs + 1_000)).toBeGreaterThan(nowMs + 1_000);
    database.close();
  });

  it("prunes expired rows during initialization so stale state does not survive startup", () => {
    const database = createTestDb();
    const nowMs = Date.parse("2026-04-10T08:00:00.000Z");

    const firstStore = createSqliteLoginThrottleStore(database, { maxKeys: 10 });
    firstStore.registerFailedLoginAttempt("127.0.0.1:old@example.com", nowMs);

    const restartedStore = createSqliteLoginThrottleStore(database, {
      maxKeys: 10,
    });
    restartedStore.initialize();
    restartedStore.pruneLoginAttempts(nowMs + (10 * 60 * 1000) + 1);

    expect(database.prepare("SELECT COUNT(*) AS count FROM login_attempts").get()).toEqual({ count: 0 });
    database.close();
  });
});
