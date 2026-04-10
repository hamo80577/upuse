import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockSearchScanoBranches,
  mockSearchScanoProductsByBarcode,
  mockListScanoProductAssignments,
} = vi.hoisted(() => ({
  mockSearchScanoBranches: vi.fn(),
  mockSearchScanoProductsByBarcode: vi.fn(),
  mockListScanoProductAssignments: vi.fn(),
}));

vi.mock("../config/db.js", async () => {
  const Database = (await import("better-sqlite3")).default;
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  return { db };
});

vi.mock("./scanoCatalogClient.js", () => ({
  searchScanoBranches: mockSearchScanoBranches,
  searchScanoProductsByBarcode: mockSearchScanoProductsByBarcode,
  listScanoProductAssignments: mockListScanoProductAssignments,
  normalizeBarcodeForExternalLookup: (value: string) => {
    const trimmed = value.trim();
    if (!trimmed || !/^\d+$/.test(trimmed)) {
      return trimmed;
    }
    return trimmed.length >= 14 ? trimmed : trimmed.padStart(14, "0");
  },
  ScanoCatalogClientError: class ScanoCatalogClientError extends Error {
    status: number;
    code?: string;
    errorOrigin?: "integration";
    integration?: "scano_catalog";
    exposeMessage?: boolean;

    constructor(
      message: string,
      status = 500,
      options?: {
        code?: string;
        errorOrigin?: "integration";
        integration?: "scano_catalog";
        exposeMessage?: boolean;
      },
    ) {
      super(message);
      this.name = "ScanoCatalogClientError";
      this.status = status;
      this.code = options?.code;
      this.errorOrigin = options?.errorOrigin;
      this.integration = options?.integration;
      this.exposeMessage = options?.exposeMessage;
    }
  },
}));

import { db as testDb } from "../config/db.js";
import { ScanoCatalogClientError } from "./scanoCatalogClient.js";
import { ScanoMasterProductEnrichmentRuntime } from "./scanoMasterProductEnrichmentRuntime.js";

function resetDb() {
  testDb.exec(`
    DROP TABLE IF EXISTS scano_master_product_enrichment_barcodes;
    DROP TABLE IF EXISTS scano_master_product_enrichment_entries;
    DROP TABLE IF EXISTS scano_master_products;

    CREATE TABLE scano_master_products (
      chainId INTEGER PRIMARY KEY,
      chainName TEXT NOT NULL,
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
      updatedAt TEXT NOT NULL
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

    CREATE TABLE scano_master_product_enrichment_barcodes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      entryId INTEGER NOT NULL,
      chainId INTEGER NOT NULL,
      importRevision INTEGER NOT NULL,
      barcode TEXT NOT NULL,
      normalizedBarcode TEXT NOT NULL,
      createdAt TEXT NOT NULL,
      FOREIGN KEY (entryId) REFERENCES scano_master_product_enrichment_entries(id) ON DELETE CASCADE,
      FOREIGN KEY (chainId) REFERENCES scano_master_products(chainId) ON DELETE CASCADE
    );
  `);
}

function insertChain(params: {
  chainId: number;
  queuedAt: string;
  importRevision?: number;
  enrichmentStatus?: "queued" | "running" | "completed" | "paused_auth";
}) {
  testDb.prepare(`
    INSERT INTO scano_master_products (
      chainId,
      chainName,
      productCount,
      importRevision,
      enrichmentStatus,
      enrichmentQueuedAt,
      updatedAt
    ) VALUES (?, ?, 1, ?, ?, ?, ?)
  `).run(
    params.chainId,
    `Chain ${params.chainId}`,
    params.importRevision ?? 1,
    params.enrichmentStatus ?? "queued",
    params.queuedAt,
    params.queuedAt,
  );
}

function insertEntry(params: {
  chainId: number;
  barcode: string;
  rowNumber: number;
  importRevision?: number;
  status?: string;
  attemptCount?: number;
  nextAttemptAt?: string | null;
}) {
  const normalizedBarcode = /^\d+$/.test(params.barcode.trim())
    ? params.barcode.trim().padStart(14, "0")
    : params.barcode.trim();
  testDb.prepare(`
    INSERT INTO scano_master_product_enrichment_entries (
      chainId,
      importRevision,
      rowNumber,
      sourceBarcode,
      normalizedBarcode,
      status,
      attemptCount,
      nextAttemptAt,
      createdAt,
      updatedAt
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, '2026-04-09T10:00:00.000Z', '2026-04-09T10:00:00.000Z')
  `).run(
    params.chainId,
    params.importRevision ?? 1,
    params.rowNumber,
    params.barcode,
    normalizedBarcode,
    params.status ?? "pending",
    params.attemptCount ?? 0,
    params.nextAttemptAt ?? null,
  );
}

describe("ScanoMasterProductEnrichmentRuntime", () => {
  let runtime: ScanoMasterProductEnrichmentRuntime;

  beforeEach(() => {
    vi.useFakeTimers();
    resetDb();
    mockSearchScanoBranches.mockReset();
    mockSearchScanoProductsByBarcode.mockReset();
    mockListScanoProductAssignments.mockReset();
    mockSearchScanoBranches.mockResolvedValue({
      items: [{
        id: 1,
        globalId: "branch-1",
        name: "Branch 1",
        chainId: 1037,
        chainName: "Chain",
        globalEntityId: "TB_EG",
        countryCode: "EG",
        additionalRemoteId: "remote-1",
      }],
      pageIndex: 1,
      totalPages: 1,
      totalRecords: 1,
    });
    runtime = new ScanoMasterProductEnrichmentRuntime({
      baseDelayPerCallMs: 1,
      maxDelayMs: 60_000,
      maxConcurrentEntries: 1,
    });
    runtime.start();
  });

  afterEach(() => {
    runtime.stop();
    vi.useRealTimers();
  });

  it("processes queued chains in FIFO order without interleaving them", async () => {
    insertChain({ chainId: 1037, queuedAt: "2026-04-09T10:00:00.000Z" });
    insertChain({ chainId: 1038, queuedAt: "2026-04-09T10:05:00.000Z" });
    insertEntry({ chainId: 1037, barcode: "111", rowNumber: 1 });
    insertEntry({ chainId: 1037, barcode: "112", rowNumber: 2 });
    insertEntry({ chainId: 1038, barcode: "221", rowNumber: 1 });

    mockSearchScanoProductsByBarcode.mockImplementation(async ({ barcode }: { barcode: string }) => ([
      {
        id: `product-${barcode}`,
        barcode,
        barcodes: [barcode],
        itemNameEn: `Item ${barcode}`,
        itemNameAr: null,
        image: `https://img/${barcode}.jpg`,
      },
    ]));
    mockListScanoProductAssignments.mockImplementation(async (productId: string) => [
      {
        vendorId: 1,
        chainId: productId === "product-221" ? 1038 : 1037,
        sku: "SKU-1",
        price: "100",
      },
    ]);

    await runtime.runCycleOnce();
    await runtime.runCycleOnce();

    expect(testDb.prepare("SELECT enrichmentStatus FROM scano_master_products WHERE chainId = 1037").get()).toEqual({
      enrichmentStatus: "completed",
    });
    expect(testDb.prepare("SELECT enrichmentStatus FROM scano_master_products WHERE chainId = 1038").get()).toEqual({
      enrichmentStatus: "queued",
    });

    await runtime.runCycleOnce();

    expect(testDb.prepare("SELECT enrichmentStatus, enrichedCount FROM scano_master_products WHERE chainId = 1038").get()).toEqual({
      enrichmentStatus: "completed",
      enrichedCount: 1,
    });
    expect(testDb.prepare("SELECT COUNT(*) AS count FROM scano_master_product_enrichment_barcodes WHERE chainId = 1037").get()).toEqual({
      count: 2,
    });
  });

  it("marks ambiguous exact matches as terminal rows without storing local lookup barcodes", async () => {
    insertChain({ chainId: 1037, queuedAt: "2026-04-09T10:00:00.000Z" });
    insertEntry({ chainId: 1037, barcode: "111", rowNumber: 1 });

    mockSearchScanoProductsByBarcode.mockResolvedValue([
      {
        id: "product-a",
        barcode: "111",
        barcodes: ["111"],
        itemNameEn: "Item A",
        itemNameAr: null,
        image: null,
      },
      {
        id: "product-b",
        barcode: "111",
        barcodes: ["111"],
        itemNameEn: "Item B",
        itemNameAr: null,
        image: null,
      },
    ]);
    mockListScanoProductAssignments.mockResolvedValue([
      {
        vendorId: 1,
        chainId: 1037,
        sku: "SKU-1",
        price: "100",
      },
    ]);

    await runtime.runCycleOnce();

    expect(testDb.prepare("SELECT status, lastError FROM scano_master_product_enrichment_entries WHERE chainId = 1037").get()).toEqual({
      status: "ambiguous",
      lastError: "Multiple exact external products were assigned to this chain.",
    });
    expect(testDb.prepare("SELECT COUNT(*) AS count FROM scano_master_product_enrichment_barcodes").get()).toEqual({
      count: 0,
    });
    expect(testDb.prepare("SELECT enrichmentStatus, processedCount FROM scano_master_products WHERE chainId = 1037").get()).toEqual({
      enrichmentStatus: "completed",
      processedCount: 1,
    });
  });

  it("processes multiple entries from the same chain in parallel when concurrency is enabled", async () => {
    runtime.stop();
    runtime = new ScanoMasterProductEnrichmentRuntime({
      baseDelayPerCallMs: 1,
      maxDelayMs: 60_000,
      maxConcurrentEntries: 2,
    });
    runtime.start();

    insertChain({ chainId: 1037, queuedAt: "2026-04-09T10:00:00.000Z" });
    insertEntry({ chainId: 1037, barcode: "111", rowNumber: 1 });
    insertEntry({ chainId: 1037, barcode: "112", rowNumber: 2 });

    const releases = new Map<string, () => void>();
    mockSearchScanoProductsByBarcode.mockImplementation(({ barcode }: { barcode: string }) => new Promise((resolve) => {
      releases.set(barcode, () => resolve([
        {
          id: `product-${barcode}`,
          barcode,
          barcodes: [barcode],
          itemNameEn: `Item ${barcode}`,
          itemNameAr: null,
          image: null,
        },
      ]));
    }));
    mockListScanoProductAssignments.mockImplementation(async () => [
      {
        vendorId: 1,
        chainId: 1037,
        sku: "SKU-1",
        price: "100",
      },
    ]);

    const cyclePromise = runtime.runCycleOnce();
    for (let index = 0; index < 6; index += 1) {
      await Promise.resolve();
    }

    expect(mockSearchScanoProductsByBarcode).toHaveBeenCalledTimes(2);
    expect(mockSearchScanoProductsByBarcode.mock.calls.map(([input]) => input.barcode).sort()).toEqual(["111", "112"]);

    releases.get("111")?.();
    await Promise.resolve();
    releases.get("112")?.();
    await cyclePromise;

    expect(testDb.prepare("SELECT status FROM scano_master_product_enrichment_entries WHERE chainId = 1037 ORDER BY rowNumber ASC").all()).toEqual([
      { status: "enriched" },
      { status: "enriched" },
    ]);
  });

  it("retries transient failures and resumes successfully on a later cycle", async () => {
    insertChain({ chainId: 1037, queuedAt: "2026-04-09T10:00:00.000Z" });
    insertEntry({ chainId: 1037, barcode: "111", rowNumber: 1 });

    mockSearchScanoProductsByBarcode
      .mockRejectedValueOnce(new ScanoCatalogClientError("Temporary upstream failure", 502, {
        code: "SCANO_UPSTREAM_REQUEST_FAILED",
        errorOrigin: "integration",
        integration: "scano_catalog",
        exposeMessage: true,
      }))
      .mockResolvedValueOnce([
        {
          id: "product-111",
          barcode: "111",
          barcodes: ["111"],
          itemNameEn: "Item 111",
          itemNameAr: null,
          image: null,
        },
      ]);
    mockListScanoProductAssignments.mockResolvedValue([
      {
        vendorId: 1,
        chainId: 1037,
        sku: "SKU-1",
        price: "100",
      },
    ]);

    await runtime.runCycleOnce();

    expect(testDb.prepare("SELECT status, attemptCount FROM scano_master_product_enrichment_entries WHERE chainId = 1037").get()).toEqual({
      status: "pending",
      attemptCount: 1,
    });

    testDb.exec("UPDATE scano_master_product_enrichment_entries SET nextAttemptAt = '2026-04-01T00:00:00.000Z' WHERE chainId = 1037");
    await runtime.runCycleOnce();

    expect(testDb.prepare("SELECT status, attemptCount FROM scano_master_product_enrichment_entries WHERE chainId = 1037").get()).toEqual({
      status: "enriched",
      attemptCount: 2,
    });
  });

  it("pauses on auth errors and resumes from the same pending row after config updates", async () => {
    insertChain({ chainId: 1037, queuedAt: "2026-04-09T10:00:00.000Z" });
    insertEntry({ chainId: 1037, barcode: "111", rowNumber: 1 });

    mockSearchScanoProductsByBarcode
      .mockRejectedValueOnce(new ScanoCatalogClientError("Scano catalog token is invalid.", 502, {
        code: "SCANO_UPSTREAM_AUTH_REJECTED",
        errorOrigin: "integration",
        integration: "scano_catalog",
        exposeMessage: true,
      }))
      .mockResolvedValueOnce([
        {
          id: "product-111",
          barcode: "111",
          barcodes: ["111"],
          itemNameEn: "Item 111",
          itemNameAr: null,
          image: null,
        },
      ]);
    mockListScanoProductAssignments.mockResolvedValue([
      {
        vendorId: 1,
        chainId: 1037,
        sku: "SKU-1",
        price: "100",
      },
    ]);

    await runtime.runCycleOnce();

    expect(testDb.prepare("SELECT enrichmentStatus, warningCode FROM scano_master_products WHERE chainId = 1037").get()).toEqual({
      enrichmentStatus: "paused_auth",
      warningCode: "SCANO_MASTER_ENRICHMENT_AUTH_PAUSED",
    });
    expect(testDb.prepare("SELECT status, attemptCount FROM scano_master_product_enrichment_entries WHERE chainId = 1037").get()).toEqual({
      status: "pending",
      attemptCount: 0,
    });

    runtime.notifyConfigChanged();
    await runtime.runCycleOnce();

    expect(testDb.prepare("SELECT enrichmentStatus, enrichedCount FROM scano_master_products WHERE chainId = 1037").get()).toEqual({
      enrichmentStatus: "completed",
      enrichedCount: 1,
    });
  });
});
