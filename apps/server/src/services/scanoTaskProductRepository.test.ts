import Database from "better-sqlite3";
import { describe, expect, it, vi } from "vitest";

vi.mock("../config/db.js", async () => {
  const BetterSqlite3 = (await import("better-sqlite3")).default;
  return {
    db: new BetterSqlite3(":memory:"),
  };
});

import { backfillScanoTaskProductCanonicalRows } from "./scanoTaskProductMutations.js";
import { createScanoTaskProductRepository } from "./scanoTaskProductRepository.js";

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

    CREATE TABLE scano_task_scans (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      taskId TEXT NOT NULL,
      teamMemberId INTEGER NOT NULL,
      barcode TEXT NOT NULL,
      source TEXT NOT NULL,
      lookupStatus TEXT NOT NULL,
      outcome TEXT NOT NULL DEFAULT 'manual_only',
      taskProductId TEXT,
      resolvedProductJson TEXT,
      scannedAt TEXT NOT NULL,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL,
      FOREIGN KEY (taskId) REFERENCES scano_tasks(id) ON DELETE CASCADE,
      FOREIGN KEY (teamMemberId) REFERENCES scano_team_members(id) ON DELETE CASCADE
    );

    CREATE TABLE scano_task_products (
      id TEXT PRIMARY KEY,
      taskId TEXT NOT NULL,
      createdByTeamMemberId INTEGER NOT NULL,
      sourceType TEXT NOT NULL,
      externalProductId TEXT,
      previewImageUrl TEXT,
      sku TEXT NOT NULL,
      price TEXT,
      barcode TEXT NOT NULL,
      itemNameEn TEXT NOT NULL,
      itemNameAr TEXT,
      chainFlag TEXT NOT NULL,
      vendorFlag TEXT NOT NULL,
      masterfileFlag TEXT NOT NULL,
      newFlag TEXT NOT NULL,
      edited INTEGER NOT NULL DEFAULT 0,
      confirmedAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL,
      FOREIGN KEY (taskId) REFERENCES scano_tasks(id) ON DELETE CASCADE,
      FOREIGN KEY (createdByTeamMemberId) REFERENCES scano_team_members(id) ON DELETE CASCADE
    );

    CREATE TABLE scano_task_product_barcodes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      productId TEXT NOT NULL,
      barcode TEXT NOT NULL,
      createdAt TEXT NOT NULL,
      FOREIGN KEY (productId) REFERENCES scano_task_products(id) ON DELETE CASCADE
    );

    CREATE TABLE scano_task_product_images (
      id TEXT PRIMARY KEY,
      productId TEXT NOT NULL,
      fileName TEXT NOT NULL,
      storageKind TEXT NOT NULL,
      filePath TEXT,
      externalUrl TEXT,
      mimeType TEXT,
      sortOrder INTEGER NOT NULL DEFAULT 0,
      createdAt TEXT NOT NULL,
      FOREIGN KEY (productId) REFERENCES scano_task_products(id) ON DELETE CASCADE
    );

    CREATE TABLE scano_task_exports (
      id TEXT PRIMARY KEY,
      taskId TEXT NOT NULL,
      fileName TEXT NOT NULL,
      filePath TEXT NOT NULL,
      createdAt TEXT NOT NULL,
      confirmedDownloadAt TEXT,
      imagesPurgedAt TEXT,
      FOREIGN KEY (taskId) REFERENCES scano_tasks(id) ON DELETE CASCADE
    );
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

function insertTaskProductRecord(
  database: Database.Database,
  params: {
    productId: string;
    taskId?: string;
    teamMemberId?: number;
    sourceType?: "vendor" | "chain" | "master" | "manual";
    externalProductId?: string | null;
    previewImageUrl?: string | null;
    barcode: string;
    sku: string;
    price?: string | null;
    itemNameEn: string;
    itemNameAr?: string | null;
    chainFlag?: "yes" | "no";
    vendorFlag?: "yes" | "no";
    masterfileFlag?: "yes" | "no";
    newFlag?: "yes" | "no";
    edited?: boolean;
    confirmedAt?: string;
    updatedAt?: string;
  },
) {
  database.prepare(`
    INSERT INTO scano_task_products (
      id,
      taskId,
      createdByTeamMemberId,
      sourceType,
      externalProductId,
      previewImageUrl,
      sku,
      price,
      barcode,
      itemNameEn,
      itemNameAr,
      chainFlag,
      vendorFlag,
      masterfileFlag,
      newFlag,
      edited,
      confirmedAt,
      updatedAt
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    params.productId,
    params.taskId ?? TASK_ID,
    params.teamMemberId ?? 11,
    params.sourceType ?? "manual",
    params.externalProductId ?? null,
    params.previewImageUrl ?? null,
    params.sku,
    params.price ?? null,
    params.barcode,
    params.itemNameEn,
    params.itemNameAr ?? null,
    params.chainFlag ?? "no",
    params.vendorFlag ?? "no",
    params.masterfileFlag ?? "no",
    params.newFlag ?? "yes",
    params.edited ? 1 : 0,
    params.confirmedAt ?? "2026-04-10T08:30:00.000Z",
    params.updatedAt ?? "2026-04-10T08:30:00.000Z",
  );
}

function insertTaskProductBarcodeRecord(
  database: Database.Database,
  productId: string,
  barcode: string,
  createdAt = "2026-04-10T08:30:00.000Z",
) {
  database.prepare(`
    INSERT INTO scano_task_product_barcodes (productId, barcode, createdAt)
    VALUES (?, ?, ?)
  `).run(productId, barcode, createdAt);
}

function insertTaskProductImageRecord(
  database: Database.Database,
  params: {
    imageId: string;
    productId: string;
    fileName: string;
    storageKind?: "local" | "external";
    filePath?: string | null;
    externalUrl?: string | null;
    mimeType?: string | null;
    sortOrder?: number;
  },
) {
  database.prepare(`
    INSERT INTO scano_task_product_images (
      id,
      productId,
      fileName,
      storageKind,
      filePath,
      externalUrl,
      mimeType,
      sortOrder,
      createdAt
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, '2026-04-10T08:30:00.000Z')
  `).run(
    params.imageId,
    params.productId,
    params.fileName,
    params.storageKind ?? "external",
    params.filePath ?? null,
    params.externalUrl ?? null,
    params.mimeType ?? "image/jpeg",
    params.sortOrder ?? 0,
  );
}

function insertResolvedProductSnapshotScan(
  database: Database.Database,
  params: {
    taskProductId: string;
    barcode: string;
    resolvedProductJson: string;
    taskId?: string;
    teamMemberId?: number;
    scannedAt?: string;
  },
) {
  const scannedAt = params.scannedAt ?? "2026-04-10T08:31:00.000Z";
  database.prepare(`
    INSERT INTO scano_task_scans (
      taskId,
      teamMemberId,
      barcode,
      source,
      lookupStatus,
      outcome,
      taskProductId,
      resolvedProductJson,
      scannedAt,
      createdAt,
      updatedAt
    ) VALUES (?, ?, ?, 'manual', 'pending_integration', 'manual_only', ?, ?, ?, ?, ?)
  `).run(
    params.taskId ?? TASK_ID,
    params.teamMemberId ?? 11,
    params.barcode,
    params.taskProductId,
    params.resolvedProductJson,
    scannedAt,
    scannedAt,
    scannedAt,
  );
}

describe("scanoTaskProductRepository", () => {
  it("uses canonical product rows for list, detail, page, and export reads even when scan snapshots are stale", () => {
    const database = createTestDb();
    const repository = createScanoTaskProductRepository(database);

    insertTaskProductRecord(database, {
      productId: "product-1",
      sourceType: "manual",
      previewImageUrl: "https://images.example.com/canonical-preview.jpg",
      barcode: "111111",
      sku: "SKU-CANON",
      price: "19.99",
      itemNameEn: "Canonical Product",
      itemNameAr: "منتج أصلي",
    });
    insertTaskProductBarcodeRecord(database, "product-1", "111111");
    insertTaskProductBarcodeRecord(database, "product-1", "222222");
    insertTaskProductImageRecord(database, {
      imageId: "image-1",
      productId: "product-1",
      fileName: "canonical.jpg",
      externalUrl: "https://images.example.com/canonical.jpg",
    });
    insertResolvedProductSnapshotScan(database, {
      taskProductId: "product-1",
      barcode: "stale-barcode",
      resolvedProductJson: JSON.stringify({
        sourceType: "vendor",
        externalProductId: "STALE-EXT",
        previewImageUrl: "https://images.example.com/stale-preview.jpg",
        barcode: "999999",
        barcodes: ["999999", "888888"],
        sku: "SKU-STALE",
        price: "5.00",
        itemNameEn: "Stale Snapshot Product",
        itemNameAr: "منتج قديم",
        chain: "yes",
        vendor: "yes",
        masterfile: "no",
        new: "no",
        images: [{
          id: "snapshot-image",
          fileName: "stale.jpg",
          url: "https://images.example.com/stale.jpg",
        }],
        createdBy: {
          id: 11,
          name: "Ali",
          linkedUserId: 2,
        },
        confirmedAt: "2026-04-10T08:20:00.000Z",
        updatedAt: "2026-04-10T08:20:00.000Z",
      }),
    });

    expect(repository.listTaskProducts(TASK_ID, true)).toEqual([
      expect.objectContaining({
        id: "product-1",
        barcode: "111111",
        barcodes: ["111111", "222222"],
        sku: "SKU-CANON",
        price: "19.99",
        itemNameEn: "Canonical Product",
        previewImageUrl: "https://images.example.com/canonical-preview.jpg",
        images: [{
          id: "image-1",
          fileName: "canonical.jpg",
          url: "https://images.example.com/canonical.jpg",
        }],
      }),
    ]);

    expect(repository.getTaskProductById(TASK_ID, "product-1", true)).toMatchObject({
      id: "product-1",
      barcode: "111111",
      barcodes: ["111111", "222222"],
      sku: "SKU-CANON",
      itemNameEn: "Canonical Product",
    });

    expect(repository.listTaskProductPage({
      taskId: TASK_ID,
      page: 1,
      pageSize: 10,
      query: "Canonical Product",
      canEdit: true,
    }).items).toHaveLength(1);
    expect(repository.listTaskProductPage({
      taskId: TASK_ID,
      page: 1,
      pageSize: 10,
      query: "Stale Snapshot Product",
      canEdit: true,
    }).items).toHaveLength(0);

    expect(repository.getStoredTaskProductsForExport(TASK_ID)).toEqual([
      expect.objectContaining({
        id: "product-1",
        barcode: "111111",
        barcodes: ["111111", "222222"],
        sku: "SKU-CANON",
        itemNameEn: "Canonical Product",
        images: [{
          id: "image-1",
          fileName: "canonical.jpg",
          url: "https://images.example.com/canonical.jpg",
          filePath: null,
          mimeType: "image/jpeg",
        }],
      }),
    ]);

    database.close();
  });

  it("uses canonical barcode rows for duplicate lookup instead of stale scan snapshots", () => {
    const database = createTestDb();
    const repository = createScanoTaskProductRepository(database);

    insertTaskProductRecord(database, {
      productId: "product-1",
      barcode: "111111",
      sku: "SKU-CANON",
      itemNameEn: "Canonical Product",
    });
    insertTaskProductBarcodeRecord(database, "product-1", "111111");
    insertTaskProductBarcodeRecord(database, "product-1", "222222");
    insertResolvedProductSnapshotScan(database, {
      taskProductId: "product-1",
      barcode: "snapshot-only",
      resolvedProductJson: JSON.stringify({
        sourceType: "manual",
        externalProductId: null,
        previewImageUrl: null,
        barcode: "999999",
        barcodes: ["999999"],
        sku: "SKU-STALE",
        price: "5.00",
        itemNameEn: "Snapshot Only",
        itemNameAr: null,
        chain: "no",
        vendor: "no",
        masterfile: "no",
        new: "yes",
        images: [],
        createdBy: {
          id: 11,
          name: "Ali",
          linkedUserId: 2,
        },
        confirmedAt: "2026-04-10T08:20:00.000Z",
        updatedAt: "2026-04-10T08:20:00.000Z",
      }),
    });

    expect(repository.findDuplicateTaskProduct(TASK_ID, "222222", {
      canEdit: false,
    })?.id).toBe("product-1");
    expect(repository.findDuplicateTaskProduct(TASK_ID, "999999", {
      canEdit: false,
    })).toBeNull();

    database.close();
  });

  it("backfills missing canonical product rows from historical scan snapshots", () => {
    const database = createTestDb();

    insertResolvedProductSnapshotScan(database, {
      taskProductId: "product-backfill",
      barcode: "555555",
      resolvedProductJson: JSON.stringify({
        sourceType: "manual",
        externalProductId: null,
        previewImageUrl: "https://images.example.com/backfill-preview.jpg",
        barcode: "555555",
        barcodes: ["555555", "666666"],
        sku: "SKU-BACKFILL",
        price: "20.00",
        itemNameEn: "Backfilled Product",
        itemNameAr: "منتج مسترجع",
        chain: "no",
        vendor: "no",
        masterfile: "no",
        new: "yes",
        images: [{
          id: "backfill-image",
          fileName: "backfill.jpg",
          url: "https://images.example.com/backfill.jpg",
        }],
        createdBy: {
          id: 11,
          name: "Ali",
          linkedUserId: 2,
        },
        confirmedAt: "2026-04-10T08:40:00.000Z",
        updatedAt: "2026-04-10T08:41:00.000Z",
      }),
      scannedAt: "2026-04-10T08:42:00.000Z",
    });

    backfillScanoTaskProductCanonicalRows(database);

    expect(database.prepare(`
      SELECT id, barcode, sku, itemNameEn, previewImageUrl
      FROM scano_task_products
      WHERE id = 'product-backfill'
    `).get()).toEqual({
      id: "product-backfill",
      barcode: "555555",
      sku: "SKU-BACKFILL",
      itemNameEn: "Backfilled Product",
      previewImageUrl: "https://images.example.com/backfill-preview.jpg",
    });
    expect(
      (database.prepare("SELECT barcode FROM scano_task_product_barcodes WHERE productId = ? ORDER BY id ASC").all("product-backfill") as Array<{ barcode: string }>).map((row) => row.barcode),
    ).toEqual(["555555", "666666"]);
    expect(database.prepare(`
      SELECT fileName, storageKind, externalUrl
      FROM scano_task_product_images
      WHERE productId = ?
    `).get("product-backfill")).toEqual({
      fileName: "backfill.jpg",
      storageKind: "external",
      externalUrl: "https://images.example.com/backfill.jpg",
    });

    database.close();
  });

  it("backfills missing canonical child rows without overwriting existing canonical parent data", () => {
    const database = createTestDb();

    insertTaskProductRecord(database, {
      productId: "product-partial",
      sourceType: "chain",
      previewImageUrl: "https://images.example.com/canonical-preview.jpg",
      barcode: "111111",
      sku: "SKU-CANON",
      price: "14.50",
      itemNameEn: "Canonical Parent",
      chainFlag: "yes",
      vendorFlag: "no",
      masterfileFlag: "no",
      newFlag: "no",
    });
    insertResolvedProductSnapshotScan(database, {
      taskProductId: "product-partial",
      barcode: "snapshot-barcode",
      resolvedProductJson: JSON.stringify({
        sourceType: "vendor",
        externalProductId: "STALE-EXT",
        previewImageUrl: "https://images.example.com/stale-preview.jpg",
        barcode: "999999",
        barcodes: ["999999", "888888"],
        sku: "SKU-STALE",
        price: "5.00",
        itemNameEn: "Stale Snapshot Product",
        itemNameAr: null,
        chain: "yes",
        vendor: "yes",
        masterfile: "no",
        new: "no",
        images: [{
          id: "partial-image",
          fileName: "partial.jpg",
          url: "https://images.example.com/partial.jpg",
        }],
        createdBy: {
          id: 11,
          name: "Ali",
          linkedUserId: 2,
        },
        confirmedAt: "2026-04-10T08:20:00.000Z",
        updatedAt: "2026-04-10T08:20:00.000Z",
      }),
    });

    backfillScanoTaskProductCanonicalRows(database);

    expect(database.prepare(`
      SELECT sourceType, externalProductId, previewImageUrl, barcode, sku, itemNameEn
      FROM scano_task_products
      WHERE id = ?
    `).get("product-partial")).toEqual({
      sourceType: "chain",
      externalProductId: null,
      previewImageUrl: "https://images.example.com/canonical-preview.jpg",
      barcode: "111111",
      sku: "SKU-CANON",
      itemNameEn: "Canonical Parent",
    });
    expect(
      (database.prepare("SELECT barcode FROM scano_task_product_barcodes WHERE productId = ? ORDER BY id ASC").all("product-partial") as Array<{ barcode: string }>).map((row) => row.barcode),
    ).toEqual(["999999", "888888"]);
    expect(database.prepare(`
      SELECT fileName, externalUrl
      FROM scano_task_product_images
      WHERE productId = ?
    `).get("product-partial")).toEqual({
      fileName: "partial.jpg",
      externalUrl: "https://images.example.com/partial.jpg",
    });

    database.close();
  });

  it("logs and skips malformed scan snapshots during backfill", () => {
    const database = createTestDb();
    const logger = {
      warn: vi.fn(),
    };

    insertResolvedProductSnapshotScan(database, {
      taskProductId: "product-malformed",
      barcode: "broken",
      resolvedProductJson: "{\"broken\":",
    });

    backfillScanoTaskProductCanonicalRows(database, logger);

    expect(database.prepare("SELECT COUNT(*) AS count FROM scano_task_products").get()).toEqual({ count: 0 });
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("taskProductId=product-malformed"));

    database.close();
  });
});
