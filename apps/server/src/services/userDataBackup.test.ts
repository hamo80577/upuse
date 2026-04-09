import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { createUserDataBackupSnapshot, writeUserDataBackupSnapshot } from "./userDataBackup.js";

function createTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "upuse-user-backup-"));
}

function seedSchema(database: Database.Database) {
  database.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      role TEXT NOT NULL,
      passwordHash TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 1,
      createdAt TEXT NOT NULL
    );

    CREATE TABLE sessions (
      token TEXT PRIMARY KEY,
      userId INTEGER NOT NULL,
      expiresAt TEXT NOT NULL,
      createdAt TEXT NOT NULL
    );

    CREATE TABLE performance_user_state (
      userId INTEGER PRIMARY KEY,
      stateJson TEXT NOT NULL,
      updatedAt TEXT NOT NULL
    );

    CREATE TABLE performance_user_groups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      userId INTEGER NOT NULL,
      name TEXT NOT NULL,
      vendorIdsJson TEXT NOT NULL,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL
    );

    CREATE TABLE performance_user_views (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      userId INTEGER NOT NULL,
      name TEXT NOT NULL,
      stateJson TEXT NOT NULL,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL
    );
  `);
}

describe("userDataBackup", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    while (tempDirs.length) {
      const dirPath = tempDirs.pop();
      if (dirPath) {
        fs.rmSync(dirPath, { recursive: true, force: true });
      }
    }
  });

  it("captures users and their saved performance preferences in one snapshot", () => {
    const database = new Database(":memory:");
    seedSchema(database);

    database.prepare(`
      INSERT INTO users (id, email, name, role, passwordHash, active, createdAt)
      VALUES
        (1, 'admin@example.com', 'Admin', 'admin', 'hash-admin', 1, '2026-04-08T08:00:00.000Z'),
        (2, 'user@example.com', 'User', 'user', 'hash-user', 0, '2026-04-08T09:00:00.000Z')
    `).run();

    database.prepare(`
      INSERT INTO performance_user_state (userId, stateJson, updatedAt)
      VALUES (?, ?, ?)
    `).run(
      1,
      JSON.stringify({
        searchQuery: "nasr",
        selectedVendorIds: [10, 11],
        selectedDeliveryTypes: ["logistics"],
      }),
      "2026-04-08T10:00:00.000Z",
    );

    database.prepare(`
      INSERT INTO performance_user_groups (id, userId, name, vendorIdsJson, createdAt, updatedAt)
      VALUES
        (100, 1, 'Morning', '[10,11]', '2026-04-08T10:05:00.000Z', '2026-04-08T10:15:00.000Z'),
        (101, 2, 'Night', '[25]', '2026-04-08T10:05:00.000Z', '2026-04-08T10:20:00.000Z')
    `).run();

    database.prepare(`
      INSERT INTO performance_user_views (id, userId, name, stateJson, createdAt, updatedAt)
      VALUES
        (200, 1, 'Late focus', '{"selectedBranchFilters":["late"]}', '2026-04-08T10:05:00.000Z', '2026-04-08T10:25:00.000Z')
    `).run();

    const snapshot = createUserDataBackupSnapshot(database, "/tmp/upuse.sqlite");

    expect(snapshot.source.includedTables).toEqual([
      "users",
      "performance_user_state",
      "performance_user_groups",
      "performance_user_views",
    ]);
    expect(snapshot.source.excludedTables).toEqual(["sessions"]);
    expect(snapshot.counts).toMatchObject({
      users: 2,
      performanceStates: 1,
      performanceGroups: 2,
      performanceViews: 1,
      bundledUsers: 2,
    });
    expect(snapshot.users).toHaveLength(2);
    expect(snapshot.users[0]).toMatchObject({
      user: {
        id: 1,
        email: "admin@example.com",
      },
      performanceState: {
        userId: 1,
        parsedState: {
          searchQuery: "nasr",
          selectedVendorIds: [10, 11],
        },
      },
      performanceGroups: [
        {
          id: 100,
          parsedVendorIds: [10, 11],
        },
      ],
      performanceViews: [
        {
          id: 200,
          parsedState: {
            selectedBranchFilters: ["late"],
          },
        },
      ],
    });
    expect(snapshot.users[1]).toMatchObject({
      user: {
        id: 2,
        active: 0,
      },
      performanceState: null,
      performanceGroups: [
        {
          id: 101,
          parsedVendorIds: [25],
        },
      ],
      performanceViews: [],
    });

    database.close();
  });

  it("writes a json snapshot and sha256 manifest for later one-time restore work", () => {
    const tempDir = createTempDir();
    tempDirs.push(tempDir);
    const dbFilePath = path.join(tempDir, "upuse.sqlite");
    const database = new Database(dbFilePath);
    seedSchema(database);

    database.prepare(`
      INSERT INTO users (id, email, name, role, passwordHash, active, createdAt)
      VALUES (1, 'admin@example.com', 'Admin', 'admin', 'hash-admin', 1, '2026-04-08T08:00:00.000Z')
    `).run();

    database.close();

    const outputDir = path.join(tempDir, "backups");
    const result = writeUserDataBackupSnapshot({
      dbFilePath,
      outputDir,
      label: "before-update",
    });

    expect(path.basename(result.filePath)).toMatch(/^user-data-backup-\d{8}T\d{6}Z-before-update\.json$/);
    expect(fs.existsSync(result.filePath)).toBe(true);
    expect(fs.existsSync(result.checksumFilePath)).toBe(true);

    const parsed = JSON.parse(fs.readFileSync(result.filePath, "utf8")) as { counts: { users: number } };
    expect(parsed.counts.users).toBe(1);

    const checksumManifest = fs.readFileSync(result.checksumFilePath, "utf8");
    expect(checksumManifest).toContain(result.checksumSha256);
    expect(checksumManifest).toContain(path.basename(result.filePath));
  });
});
