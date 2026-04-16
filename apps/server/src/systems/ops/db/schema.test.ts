import Database from "better-sqlite3";
import { describe, expect, it, vi } from "vitest";
import { buildSharedSchemaSql } from "../../../shared/db/schema/sharedSchema.js";
import { opsSystemModule } from "../module.js";
import { applyOpsSchemaMigrations } from "./migrations.js";
import { buildOpsSchemaSql } from "./schema.js";

vi.mock("../../../config/db.js", async () => {
  const BetterSqlite3 = (await import("better-sqlite3")).default;
  const db = new BetterSqlite3(":memory:");
  db.pragma("foreign_keys = ON");
  return {
    db,
    cryptoBox: {
      encrypt: (value: string) => value,
      decrypt: (value: string) => value,
    },
  };
});

function listTables(db: Database.Database) {
  return db.prepare<[], { name: string }>(`
    SELECT name
    FROM sqlite_master
    WHERE type = 'table'
    ORDER BY name ASC
  `).all().map((row) => row.name);
}

describe("Ops schema", () => {
  it("is exposed through the Ops system DB hooks", () => {
    expect(opsSystemModule.db?.buildSchemaSql).toBe(buildOpsSchemaSql);
    expect(opsSystemModule.db?.applyMigrations).toBe(applyOpsSchemaMigrations);
  });

  it("creates the Ops-owned tables after the shared schema", () => {
    const database = new Database(":memory:");
    database.pragma("foreign_keys = ON");

    database.exec(buildSharedSchemaSql());
    database.exec(buildOpsSchemaSql());

    expect(listTables(database)).toEqual(expect.arrayContaining([
      "ops_sessions",
      "ops_events",
      "ops_errors",
      "ops_metric_snapshots",
    ]));
  });

  it("can be applied repeatedly without mutating existing data", () => {
    const database = new Database(":memory:");
    database.pragma("foreign_keys = ON");

    database.exec(buildSharedSchemaSql());
    applyOpsSchemaMigrations(database);
    database.prepare(`
      INSERT INTO users (id, email, name, role, passwordHash, active, createdAt, upuseAccess, isPrimaryAdmin)
      VALUES (1, 'primary@example.com', 'Primary', 'admin', 'hash', 1, '2026-04-16T00:00:00.000Z', 1, 1)
    `).run();
    database.prepare(`
      INSERT INTO ops_sessions (
        id, userId, userEmail, userName, currentSystem, currentPath, firstSeenAt,
        lastSeenAt, lastActiveAt, state, createdAt, updatedAt
      ) VALUES (
        '11111111-1111-4111-8111-111111111111', 1, 'primary@example.com', 'Primary',
        'ops', '/ops', '2026-04-16T00:00:00.000Z', '2026-04-16T00:00:00.000Z',
        '2026-04-16T00:00:00.000Z', 'active', '2026-04-16T00:00:00.000Z',
        '2026-04-16T00:00:00.000Z'
      )
    `).run();

    applyOpsSchemaMigrations(database);
    applyOpsSchemaMigrations(database);

    expect(database.prepare<[], { count: number }>("SELECT COUNT(*) AS count FROM ops_sessions").get()).toEqual({
      count: 1,
    });
  });
});
