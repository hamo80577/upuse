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
    DROP TABLE IF EXISTS scano_master_product_enrichment_candidates;
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
      status TEXT NOT NULL DEFAULT 'pending_search',
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

    CREATE TABLE scano_master_product_enrichment_candidates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      entryId INTEGER NOT NULL,
      chainId INTEGER NOT NULL,
      importRevision INTEGER NOT NULL,
      rowNumber INTEGER NOT NULL,
      externalProductId TEXT NOT NULL,
      barcode TEXT NOT NULL,
      barcodesJson TEXT NOT NULL,
      itemNameEn TEXT,
      itemNameAr TEXT,
      image TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      attemptCount INTEGER NOT NULL DEFAULT 0,
      nextAttemptAt TEXT,
      lastError TEXT,
      sku TEXT,
      price TEXT,
      chainFlag TEXT,
      vendorFlag TEXT,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL,
      FOREIGN KEY (entryId) REFERENCES scano_master_product_enrichment_entries(id) ON DELETE CASCADE,
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
  productCount?: number;
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
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    params.chainId,
    `Chain ${params.chainId}`,
    params.productCount ?? 1,
    params.importRevision ?? 1,
    params.enrichmentStatus ?? "queued",
    params.queuedAt,
    params.queuedAt,
  );
}

function normalizeBarcode(barcode: string) {
  const trimmed = barcode.trim();
  if (!trimmed || !/^\d+$/.test(trimmed)) {
    return trimmed;
  }
  return trimmed.length >= 14 ? trimmed : trimmed.padStart(14, "0");
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
  const normalizedBarcode = normalizeBarcode(params.barcode);
  return Number(testDb.prepare(`
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
    params.status ?? "pending_search",
    params.attemptCount ?? 0,
    params.nextAttemptAt ?? null,
  ).lastInsertRowid);
}

function insertCandidate(params: {
  entryId: number;
  chainId: number;
  rowNumber: number;
  productId: string;
  barcode: string;
  barcodes?: string[];
  importRevision?: number;
  status?: string;
  attemptCount?: number;
  nextAttemptAt?: string | null;
}) {
  return Number(testDb.prepare(`
    INSERT INTO scano_master_product_enrichment_candidates (
      entryId,
      chainId,
      importRevision,
      rowNumber,
      externalProductId,
      barcode,
      barcodesJson,
      status,
      attemptCount,
      nextAttemptAt,
      createdAt,
      updatedAt
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '2026-04-09T10:00:00.000Z', '2026-04-09T10:00:00.000Z')
  `).run(
    params.entryId,
    params.chainId,
    params.importRevision ?? 1,
    params.rowNumber,
    params.productId,
    params.barcode,
    JSON.stringify(params.barcodes ?? [params.barcode]),
    params.status ?? "pending",
    params.attemptCount ?? 0,
    params.nextAttemptAt ?? null,
  ).lastInsertRowid);
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
      searchConcurrency: 1,
      assignmentConcurrency: 1,
      assignmentBacklogLimit: 20,
    });
    runtime.start();
  });

  afterEach(() => {
    runtime.stop();
    vi.useRealTimers();
  });

  it("processes queued chains in FIFO order without interleaving them", async () => {
    runtime.stop();
    runtime = new ScanoMasterProductEnrichmentRuntime({
      baseDelayPerCallMs: 1,
      maxDelayMs: 60_000,
      searchConcurrency: 2,
      assignmentConcurrency: 2,
      assignmentBacklogLimit: 20,
    });
    runtime.start();

    insertChain({ chainId: 1037, queuedAt: "2026-04-09T10:00:00.000Z", productCount: 2 });
    insertChain({ chainId: 1038, queuedAt: "2026-04-09T10:05:00.000Z", productCount: 1 });
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
    expect(testDb.prepare("SELECT enrichmentStatus FROM scano_master_products WHERE chainId = 1037").get()).toEqual({
      enrichmentStatus: "running",
    });
    expect(testDb.prepare("SELECT enrichmentStatus FROM scano_master_products WHERE chainId = 1038").get()).toEqual({
      enrichmentStatus: "queued",
    });

    await runtime.runCycleOnce();
    expect(testDb.prepare("SELECT enrichmentStatus, enrichedCount FROM scano_master_products WHERE chainId = 1037").get()).toEqual({
      enrichmentStatus: "completed",
      enrichedCount: 2,
    });
    expect(testDb.prepare("SELECT enrichmentStatus FROM scano_master_products WHERE chainId = 1038").get()).toEqual({
      enrichmentStatus: "queued",
    });

    await runtime.runCycleOnce();
    await runtime.runCycleOnce();

    expect(testDb.prepare("SELECT enrichmentStatus, enrichedCount FROM scano_master_products WHERE chainId = 1038").get()).toEqual({
      enrichmentStatus: "completed",
      enrichedCount: 1,
    });
  });

  it("marks ambiguous exact matches as terminal rows without storing local lookup barcodes", async () => {
    runtime.stop();
    runtime = new ScanoMasterProductEnrichmentRuntime({
      baseDelayPerCallMs: 1,
      maxDelayMs: 60_000,
      searchConcurrency: 1,
      assignmentConcurrency: 2,
      assignmentBacklogLimit: 20,
    });
    runtime.start();

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
    await runtime.runCycleOnce();

    expect(testDb.prepare("SELECT status, lastError FROM scano_master_product_enrichment_entries WHERE chainId = 1037").get()).toEqual({
      status: "ambiguous",
      lastError: "Multiple exact external products were assigned to this chain.",
    });
    expect(testDb.prepare("SELECT COUNT(*) AS count FROM scano_master_product_enrichment_barcodes").get()).toEqual({
      count: 0,
    });
    expect(testDb.prepare("SELECT COUNT(*) AS count FROM scano_master_product_enrichment_candidates WHERE entryId = 1").get()).toEqual({
      count: 2,
    });
  });

  it("runs search and assignment pools in parallel for the same chain", async () => {
    insertChain({ chainId: 1037, queuedAt: "2026-04-09T10:00:00.000Z", productCount: 2 });
    const assignmentEntryId = insertEntry({
      chainId: 1037,
      barcode: "111",
      rowNumber: 1,
      status: "pending_assignment",
      attemptCount: 1,
    });
    insertCandidate({
      entryId: assignmentEntryId,
      chainId: 1037,
      rowNumber: 1,
      productId: "product-111",
      barcode: "111",
    });
    insertEntry({ chainId: 1037, barcode: "222", rowNumber: 2 });

    const releases = new Map<string, () => void>();
    mockSearchScanoProductsByBarcode.mockImplementation(({ barcode }: { barcode: string }) => new Promise((resolve) => {
      releases.set(`search:${barcode}`, () => resolve([
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
    mockListScanoProductAssignments.mockImplementation((productId: string) => new Promise((resolve) => {
      releases.set(`assignment:${productId}`, () => resolve([
        {
          vendorId: 1,
          chainId: 1037,
          sku: "SKU-1",
          price: "100",
        },
      ]));
    }));

    const cyclePromise = runtime.runCycleOnce();
    for (let index = 0; index < 20; index += 1) {
      await Promise.resolve();
      if (mockSearchScanoProductsByBarcode.mock.calls.length === 1 && mockListScanoProductAssignments.mock.calls.length === 1) {
        break;
      }
    }

    expect(mockSearchScanoProductsByBarcode).toHaveBeenCalledTimes(1);
    expect(mockListScanoProductAssignments).toHaveBeenCalledTimes(1);

    releases.get("search:222")?.();
    await Promise.resolve();
    releases.get("assignment:product-111")?.();
    await cyclePromise;

    expect(testDb.prepare("SELECT status FROM scano_master_product_enrichment_entries WHERE id = ?").get(assignmentEntryId)).toEqual({
      status: "enriched",
    });
    expect(testDb.prepare("SELECT status FROM scano_master_product_enrichment_entries WHERE rowNumber = 2").get()).toEqual({
      status: "pending_assignment",
    });
  });

  it("checks assignments for every exact match before finalizing the entry", async () => {
    runtime.stop();
    runtime = new ScanoMasterProductEnrichmentRuntime({
      baseDelayPerCallMs: 1,
      maxDelayMs: 60_000,
      searchConcurrency: 1,
      assignmentConcurrency: 2,
      assignmentBacklogLimit: 20,
    });
    runtime.start();

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
    mockListScanoProductAssignments.mockImplementation(async (productId: string) => (
      productId === "product-a"
        ? [{
          vendorId: 1,
          chainId: 1037,
          sku: "SKU-1",
          price: "100",
        }]
        : [{
          vendorId: 1,
          chainId: 9999,
          sku: "SKU-2",
          price: "100",
        }]
    ));

    await runtime.runCycleOnce();
    await runtime.runCycleOnce();

    expect(mockListScanoProductAssignments).toHaveBeenCalledTimes(2);
    expect(mockListScanoProductAssignments.mock.calls.map(([productId]) => productId).sort()).toEqual(["product-a", "product-b"]);
    expect(testDb.prepare("SELECT status, externalProductId FROM scano_master_product_enrichment_entries WHERE chainId = 1037").get()).toEqual({
      status: "enriched",
      externalProductId: "product-a",
    });
  });

  it("throttles search when assignment backlog reaches the configured limit", async () => {
    runtime.stop();
    runtime = new ScanoMasterProductEnrichmentRuntime({
      baseDelayPerCallMs: 1,
      maxDelayMs: 60_000,
      searchConcurrency: 1,
      assignmentConcurrency: 1,
      assignmentBacklogLimit: 1,
    });
    runtime.start();

    insertChain({ chainId: 1037, queuedAt: "2026-04-09T10:00:00.000Z", productCount: 3 });
    const entryId = insertEntry({
      chainId: 1037,
      barcode: "111",
      rowNumber: 1,
      status: "pending_assignment",
      attemptCount: 1,
    });
    insertCandidate({
      entryId,
      chainId: 1037,
      rowNumber: 1,
      productId: "product-111",
      barcode: "111",
    });
    insertCandidate({
      entryId,
      chainId: 1037,
      rowNumber: 1,
      productId: "product-112",
      barcode: "112",
    });
    insertEntry({ chainId: 1037, barcode: "222", rowNumber: 2 });

    const releaseAssignment = vi.fn();
    mockListScanoProductAssignments.mockImplementation(() => new Promise((resolve) => {
      releaseAssignment.mockImplementationOnce(() => resolve([
        {
          vendorId: 1,
          chainId: 1037,
          sku: "SKU-1",
          price: "100",
        },
      ]));
    }));

    const cyclePromise = runtime.runCycleOnce();
    for (let index = 0; index < 10 && mockListScanoProductAssignments.mock.calls.length < 1; index += 1) {
      await Promise.resolve();
    }

    expect(mockListScanoProductAssignments).toHaveBeenCalledTimes(1);
    expect(mockSearchScanoProductsByBarcode).not.toHaveBeenCalled();

    releaseAssignment();
    await cyclePromise;
  });

  it("keeps staged search candidates across auth pause and resumes from assignment stage", async () => {
    insertChain({ chainId: 1037, queuedAt: "2026-04-09T10:00:00.000Z" });
    insertEntry({ chainId: 1037, barcode: "111", rowNumber: 1 });

    mockSearchScanoProductsByBarcode.mockResolvedValue([
      {
        id: "product-111",
        barcode: "111",
        barcodes: ["111"],
        itemNameEn: "Item 111",
        itemNameAr: null,
        image: null,
      },
    ]);
    mockListScanoProductAssignments
      .mockRejectedValueOnce(new ScanoCatalogClientError("Scano catalog token is invalid.", 502, {
        code: "SCANO_UPSTREAM_AUTH_REJECTED",
        errorOrigin: "integration",
        integration: "scano_catalog",
        exposeMessage: true,
      }))
      .mockResolvedValueOnce([
        {
          vendorId: 1,
          chainId: 1037,
          sku: "SKU-1",
          price: "100",
        },
      ]);

    await runtime.runCycleOnce();
    expect(testDb.prepare("SELECT status FROM scano_master_product_enrichment_entries WHERE chainId = 1037").get()).toEqual({
      status: "pending_assignment",
    });
    expect(testDb.prepare("SELECT COUNT(*) AS count FROM scano_master_product_enrichment_candidates WHERE chainId = 1037").get()).toEqual({
      count: 1,
    });

    await runtime.runCycleOnce();
    expect(testDb.prepare("SELECT enrichmentStatus, warningCode FROM scano_master_products WHERE chainId = 1037").get()).toEqual({
      enrichmentStatus: "paused_auth",
      warningCode: "SCANO_MASTER_ENRICHMENT_AUTH_PAUSED",
    });
    expect(testDb.prepare("SELECT status FROM scano_master_product_enrichment_candidates WHERE chainId = 1037").get()).toEqual({
      status: "pending",
    });

    runtime.notifyConfigChanged();
    await runtime.runCycleOnce();

    expect(testDb.prepare("SELECT enrichmentStatus, enrichedCount FROM scano_master_products WHERE chainId = 1037").get()).toEqual({
      enrichmentStatus: "completed",
      enrichedCount: 1,
    });
  });
});
