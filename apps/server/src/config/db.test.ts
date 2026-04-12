import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const originalEnv = {
  UPUSE_DATA_DIR: process.env.UPUSE_DATA_DIR,
  UPUSE_SECRET: process.env.UPUSE_SECRET,
  UPUSE_SECRET_PREVIOUS: process.env.UPUSE_SECRET_PREVIOUS,
  UPUSE_BOOTSTRAP_GLOBAL_ENTITY_ID: process.env.UPUSE_BOOTSTRAP_GLOBAL_ENTITY_ID,
  UPUSE_BOOTSTRAP_ADMIN_EMAIL: process.env.UPUSE_BOOTSTRAP_ADMIN_EMAIL,
  UPUSE_BOOTSTRAP_ADMIN_PASSWORD: process.env.UPUSE_BOOTSTRAP_ADMIN_PASSWORD,
  UPUSE_BOOTSTRAP_ADMIN_NAME: process.env.UPUSE_BOOTSTRAP_ADMIN_NAME,
};

const loadedModules: Array<{ db?: { close?: () => void } }> = [];
const tempDirs: string[] = [];

async function loadDbModule() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "upuse-db-test-"));
  tempDirs.push(tempDir);

  process.env.UPUSE_DATA_DIR = tempDir;
  process.env.UPUSE_SECRET = "0123456789abcdef0123456789abcdef";
  delete process.env.UPUSE_SECRET_PREVIOUS;
  process.env.UPUSE_BOOTSTRAP_GLOBAL_ENTITY_ID = "TB_EG";
  delete process.env.UPUSE_BOOTSTRAP_ADMIN_EMAIL;
  delete process.env.UPUSE_BOOTSTRAP_ADMIN_PASSWORD;
  delete process.env.UPUSE_BOOTSTRAP_ADMIN_NAME;

  vi.resetModules();
  const module = await import("./db.js");
  loadedModules.push(module);
  return module;
}

function createCurrentUsersTable(db: { exec: (sql: string) => void }) {
  db.exec(`
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

    INSERT INTO users (id, email, name, role, passwordHash, active, createdAt, upuseAccess, isPrimaryAdmin)
    VALUES
      (1, 'admin@example.com', 'Admin', 'admin', 'hash-admin', 1, '2026-04-08T08:00:00.000Z', 1, 1),
      (2, 'scanner@example.com', 'Scanner User', 'user', 'hash-user', 1, '2026-04-08T08:05:00.000Z', 1, 0);
  `);
}

afterEach(() => {
  vi.restoreAllMocks();

  for (const module of loadedModules.splice(0)) {
    module.db?.close?.();
  }
  for (const tempDir of tempDirs.splice(0)) {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }

  if (typeof originalEnv.UPUSE_DATA_DIR === "string") process.env.UPUSE_DATA_DIR = originalEnv.UPUSE_DATA_DIR;
  else delete process.env.UPUSE_DATA_DIR;
  if (typeof originalEnv.UPUSE_SECRET === "string") process.env.UPUSE_SECRET = originalEnv.UPUSE_SECRET;
  else delete process.env.UPUSE_SECRET;
  if (typeof originalEnv.UPUSE_SECRET_PREVIOUS === "string") process.env.UPUSE_SECRET_PREVIOUS = originalEnv.UPUSE_SECRET_PREVIOUS;
  else delete process.env.UPUSE_SECRET_PREVIOUS;
  if (typeof originalEnv.UPUSE_BOOTSTRAP_GLOBAL_ENTITY_ID === "string") process.env.UPUSE_BOOTSTRAP_GLOBAL_ENTITY_ID = originalEnv.UPUSE_BOOTSTRAP_GLOBAL_ENTITY_ID;
  else delete process.env.UPUSE_BOOTSTRAP_GLOBAL_ENTITY_ID;
  if (typeof originalEnv.UPUSE_BOOTSTRAP_ADMIN_EMAIL === "string") process.env.UPUSE_BOOTSTRAP_ADMIN_EMAIL = originalEnv.UPUSE_BOOTSTRAP_ADMIN_EMAIL;
  else delete process.env.UPUSE_BOOTSTRAP_ADMIN_EMAIL;
  if (typeof originalEnv.UPUSE_BOOTSTRAP_ADMIN_PASSWORD === "string") process.env.UPUSE_BOOTSTRAP_ADMIN_PASSWORD = originalEnv.UPUSE_BOOTSTRAP_ADMIN_PASSWORD;
  else delete process.env.UPUSE_BOOTSTRAP_ADMIN_PASSWORD;
  if (typeof originalEnv.UPUSE_BOOTSTRAP_ADMIN_NAME === "string") process.env.UPUSE_BOOTSTRAP_ADMIN_NAME = originalEnv.UPUSE_BOOTSTRAP_ADMIN_NAME;
  else delete process.env.UPUSE_BOOTSTRAP_ADMIN_NAME;
});

describe("db Scano task migration", () => {
  it("hard-resets only incompatible legacy task schemas while preserving team, settings, and master products", { timeout: 15_000 }, async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { db, migrate } = await loadDbModule();

    createCurrentUsersTable(db);
    db.exec(`
      CREATE TABLE scano_team_members (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        linkedUserId INTEGER NOT NULL UNIQUE,
        role TEXT NOT NULL DEFAULT 'scanner' CHECK (role IN ('team_lead', 'scanner')),
        active INTEGER NOT NULL DEFAULT 1,
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL,
        FOREIGN KEY (linkedUserId) REFERENCES users(id) ON DELETE CASCADE
      );

      CREATE TABLE scano_settings (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        catalogBaseUrl TEXT NOT NULL DEFAULT '',
        catalogTokenEnc TEXT NOT NULL DEFAULT '',
        updatedAt TEXT NOT NULL
      );

      CREATE TABLE scano_master_products (
        chainId INTEGER PRIMARY KEY,
        chainName TEXT NOT NULL,
        mappingJson TEXT NOT NULL,
        productCount INTEGER NOT NULL DEFAULT 0,
        updatedAt TEXT NOT NULL,
        updatedByUserId INTEGER NOT NULL,
        createdAt TEXT NOT NULL,
        FOREIGN KEY (updatedByUserId) REFERENCES users(id) ON DELETE RESTRICT
      );

      CREATE TABLE scano_master_product_rows (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        chainId INTEGER NOT NULL,
        rowNumber INTEGER NOT NULL,
        sku TEXT,
        barcode TEXT,
        price TEXT,
        itemNameEn TEXT,
        itemNameAr TEXT,
        image TEXT,
        FOREIGN KEY (chainId) REFERENCES scano_master_products(chainId) ON DELETE CASCADE
      );

      CREATE TABLE scano_tasks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        chainId INTEGER NOT NULL,
        chainName TEXT NOT NULL,
        scheduledAt TEXT NOT NULL,
        status TEXT NOT NULL,
        createdAt TEXT NOT NULL
      );

      CREATE TABLE scano_task_assignees (
        taskId INTEGER NOT NULL,
        teamMemberId INTEGER NOT NULL
      );

      CREATE TABLE scano_task_participants (
        taskId INTEGER NOT NULL,
        teamMemberId INTEGER NOT NULL,
        startedAt TEXT,
        endedAt TEXT
      );

      CREATE TABLE scano_task_scans (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        taskId INTEGER NOT NULL,
        teamMemberId INTEGER NOT NULL,
        barcode TEXT NOT NULL,
        scannedAt TEXT NOT NULL
      );

      INSERT INTO scano_team_members (id, name, linkedUserId, role, active, createdAt, updatedAt)
      VALUES (11, 'Scanner User', 2, 'scanner', 1, '2026-04-08T08:05:00.000Z', '2026-04-08T08:05:00.000Z');

      INSERT INTO scano_settings (id, catalogBaseUrl, catalogTokenEnc, updatedAt)
      VALUES (1, 'https://catalog.example.com', 'enc-token', '2026-04-08T08:10:00.000Z');

      INSERT INTO scano_master_products (chainId, chainName, mappingJson, productCount, updatedAt, updatedByUserId, createdAt)
      VALUES (1037, 'Carrefour', '{"sku":"item number"}', 1, '2026-04-08T08:20:00.000Z', 1, '2026-04-08T08:15:00.000Z');

      INSERT INTO scano_master_product_rows (chainId, rowNumber, sku, barcode, itemNameEn)
      VALUES (1037, 2, 'SKU-1', '111', 'Milk');

      INSERT INTO scano_tasks (id, chainId, chainName, scheduledAt, status, createdAt)
      VALUES (1, 1037, 'Carrefour', '2026-04-10T08:00:00.000Z', 'pending', '2026-04-08T09:00:00.000Z');

      INSERT INTO scano_task_assignees (taskId, teamMemberId)
      VALUES (1, 11);
    `);

    await migrate();

    const taskSql = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'scano_tasks'").get() as { sql: string };
    const taskCount = db.prepare("SELECT COUNT(*) AS count FROM scano_tasks").get() as { count: number };
    const assigneeCount = db.prepare("SELECT COUNT(*) AS count FROM scano_task_assignees").get() as { count: number };
    const teamCount = db.prepare("SELECT COUNT(*) AS count FROM scano_team_members").get() as { count: number };
    const settingsCount = db.prepare("SELECT COUNT(*) AS count FROM scano_settings").get() as { count: number };
    const masterCount = db.prepare("SELECT COUNT(*) AS count FROM scano_master_products").get() as { count: number };
    const masterRowsCount = db.prepare("SELECT COUNT(*) AS count FROM scano_master_product_rows").get() as { count: number };

    expect(taskSql.sql).toContain("id TEXT PRIMARY KEY");
    expect(taskSql.sql).toContain("'awaiting_review'");
    expect(taskSql.sql).toContain("'completed'");
    expect(taskCount.count).toBe(0);
    expect(assigneeCount.count).toBe(0);
    expect(teamCount.count).toBe(1);
    expect(settingsCount.count).toBe(1);
    expect(masterCount.count).toBe(1);
    expect(masterRowsCount.count).toBe(1);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("Resetting legacy Scano task data because an incompatible schema was detected."));
  });

  it("keeps current compatible Scano task schemas and data intact on re-run", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { db, migrate } = await loadDbModule();

    createCurrentUsersTable(db);
    await migrate();

    db.exec(`
      INSERT INTO scano_team_members (id, name, linkedUserId, role, active, createdAt, updatedAt)
      VALUES (11, 'Scanner User', 2, 'scanner', 1, '2026-04-08T08:05:00.000Z', '2026-04-08T08:05:00.000Z');

      INSERT INTO scano_tasks (
        id,
        chainId,
        chainName,
        branchId,
        branchGlobalId,
        branchName,
        globalEntityId,
        countryCode,
        additionalRemoteId,
        scheduledAt,
        status,
        createdByUserId,
        startedAt,
        startedByUserId,
        startedByTeamMemberId,
        createdAt,
        updatedAt
      )
      VALUES (
        'task-1',
        1037,
        'Carrefour',
        4594,
        'vendor-global-4594',
        'Nasr City',
        'TB_EG',
        'EG',
        'branch-4594',
        '2026-04-10T08:00:00.000Z',
        'pending',
        1,
        NULL,
        NULL,
        NULL,
        '2026-04-08T09:00:00.000Z',
        '2026-04-08T09:00:00.000Z'
      );

      INSERT INTO scano_task_assignees (taskId, teamMemberId, assignedAt)
      VALUES ('task-1', 11, '2026-04-08T09:05:00.000Z');
    `);

    warnSpy.mockClear();
    await migrate();

    const taskCount = db.prepare("SELECT COUNT(*) AS count FROM scano_tasks WHERE id = 'task-1'").get() as { count: number };
    const assigneeCount = db.prepare("SELECT COUNT(*) AS count FROM scano_task_assignees WHERE taskId = 'task-1'").get() as { count: number };

    expect(taskCount.count).toBe(1);
    expect(assigneeCount.count).toBe(1);
    expect(warnSpy).not.toHaveBeenCalledWith(expect.stringContaining("Resetting legacy Scano task data"));
  });

  it("normalizes legacy master enrichment statuses and creates the candidate staging table", { timeout: 15_000 }, async () => {
    const { db, migrate } = await loadDbModule();

    createCurrentUsersTable(db);
    db.exec(`
      CREATE TABLE scano_master_products (
        chainId INTEGER PRIMARY KEY,
        chainName TEXT NOT NULL,
        mappingJson TEXT NOT NULL,
        productCount INTEGER NOT NULL DEFAULT 0,
        importRevision INTEGER NOT NULL DEFAULT 1,
        enrichmentStatus TEXT NOT NULL DEFAULT 'queued',
        enrichmentQueuedAt TEXT,
        enrichmentStartedAt TEXT,
        enrichmentPausedAt TEXT,
        enrichmentCompletedAt TEXT,
        enrichedCount INTEGER NOT NULL DEFAULT 0,
        processedCount INTEGER NOT NULL DEFAULT 0,
        warningCode TEXT,
        warningMessage TEXT,
        updatedAt TEXT NOT NULL,
        updatedByUserId INTEGER NOT NULL,
        createdAt TEXT NOT NULL,
        FOREIGN KEY (updatedByUserId) REFERENCES users(id) ON DELETE RESTRICT
      );

      CREATE TABLE scano_master_product_enrichment_entries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        chainId INTEGER NOT NULL,
        importRevision INTEGER NOT NULL,
        rowNumber INTEGER NOT NULL,
        sourceBarcode TEXT NOT NULL,
        normalizedBarcode TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        attemptCount INTEGER NOT NULL DEFAULT 0,
        nextAttemptAt TEXT,
        lastError TEXT,
        externalProductId TEXT,
        sku TEXT,
        price TEXT,
        itemNameEn TEXT,
        itemNameAr TEXT,
        image TEXT,
        chainFlag TEXT,
        vendorFlag TEXT,
        enrichedAt TEXT,
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL,
        FOREIGN KEY (chainId) REFERENCES scano_master_products(chainId) ON DELETE CASCADE
      );

      INSERT INTO scano_master_products (
        chainId,
        chainName,
        mappingJson,
        productCount,
        importRevision,
        enrichmentStatus,
        enrichmentQueuedAt,
        updatedAt,
        updatedByUserId,
        createdAt
      ) VALUES (
        1037,
        'Carrefour',
        '{"barcode":"barcode"}',
        1,
        3,
        'queued',
        '2026-04-08T08:20:00.000Z',
        '2026-04-08T08:20:00.000Z',
        1,
        '2026-04-08T08:15:00.000Z'
      );

      INSERT INTO scano_master_product_enrichment_entries (
        chainId,
        importRevision,
        rowNumber,
        sourceBarcode,
        normalizedBarcode,
        status,
        attemptCount,
        createdAt,
        updatedAt
      ) VALUES
      (1037, 3, 1, '111', '00000000000111', 'pending', 0, '2026-04-08T08:21:00.000Z', '2026-04-08T08:21:00.000Z'),
      (1037, 3, 2, '222', '00000000000222', 'running', 1, '2026-04-08T08:22:00.000Z', '2026-04-08T08:22:00.000Z');
    `);

    await migrate();

    const statuses = db.prepare(`
      SELECT rowNumber, status
      FROM scano_master_product_enrichment_entries
      ORDER BY rowNumber ASC
    `).all() as Array<{ rowNumber: number; status: string }>;
    const candidateTable = db.prepare(`
      SELECT name
      FROM sqlite_master
      WHERE type = 'table'
        AND name = 'scano_master_product_enrichment_candidates'
    `).get() as { name: string } | undefined;

    expect(statuses).toEqual([
      { rowNumber: 1, status: "pending_search" },
      { rowNumber: 2, status: "pending_search" },
    ]);
    expect(candidateTable?.name).toBe("scano_master_product_enrichment_candidates");
  });
});
