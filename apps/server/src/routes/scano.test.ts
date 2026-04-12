import fs from "node:fs";
import type { Server } from "node:http";
import path from "node:path";
import ExcelJS from "exceljs";
import express from "express";
import JSZip from "jszip";
import { ZodError } from "zod";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ScanoMasterProductDetail, ScanoMasterProductListItem } from "../types/models.js";
import { resolveDataDir } from "../config/paths.js";
import { hashSessionToken } from "../services/auth/passwords.js";

const {
  mockSearchScanoBranches,
  mockSearchScanoChains,
  mockSearchScanoProductsByBarcode,
  mockGetScanoProductDetail,
  mockGetScanoProductAssignmentCheck,
  mockListScanoProductAssignments,
  mockTestScanoCatalogConnection,
} = vi.hoisted(() => ({
  mockSearchScanoBranches: vi.fn(),
  mockSearchScanoChains: vi.fn(),
  mockSearchScanoProductsByBarcode: vi.fn(),
  mockGetScanoProductDetail: vi.fn(),
  mockGetScanoProductAssignmentCheck: vi.fn(),
  mockListScanoProductAssignments: vi.fn(),
  mockTestScanoCatalogConnection: vi.fn(),
}));

vi.mock("../config/db.js", async () => {
  const Database = (await import("better-sqlite3")).default;
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  return {
    db,
    cryptoBox: {
      encrypt: (value: string) => `enc:${value}`,
      decrypt: (value: string) => value.startsWith("enc:") ? value.slice(4) : value,
    },
  };
});

vi.mock("../services/scanoCatalogClient.js", () => ({
  searchScanoBranches: mockSearchScanoBranches,
  searchScanoChains: mockSearchScanoChains,
  searchScanoProductsByBarcode: mockSearchScanoProductsByBarcode,
  getScanoProductDetail: mockGetScanoProductDetail,
  getScanoProductAssignmentCheck: mockGetScanoProductAssignmentCheck,
  listScanoProductAssignments: mockListScanoProductAssignments,
  testScanoCatalogConnection: mockTestScanoCatalogConnection,
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

import multer from "multer";
import { requireAuthenticatedApi } from "../shared/http/auth/sessionAuth.js";
import { requireScanoAccess, requireScanoAdmin, requireScanoLeadAccess, requireScanoTaskManager } from "../systems/scano/policies/access.js";
import { db as testDb } from "../config/db.js";
import {
  confirmScanoTaskExportDownloadRoute,
  completeScanoTaskRoute,
  createScanoMasterProductRoute,
  createScanoTaskRoute,
  createScanoTaskExportRoute,
  createScanoTaskProductRoute,
  createScanoTaskScanRoute,
  createScanoTeamRoute,
  deleteScanoTaskRoute,
  deleteScanoMasterProductRoute,
  deleteScanoTeamRoute,
  downloadScanoTaskExportRoute,
  endScanoTaskRoute,
  getScanoRunnerBootstrapRoute,
  getScanoSettingsRoute,
  getScanoMasterProductRoute,
  getScanoTaskDetailRoute,
  getScanoTaskProductImageRoute,
  getScanoTaskProductRoute,
  hydrateScanoRunnerExternalProductRoute,
  listScanoBranchesRoute,
  listScanoChainsRoute,
  listScanoMasterProductsRoute,
  listScanoTaskProductsRoute,
  listScanoTaskScansRoute,
  listScanoTasksRoute,
  listScanoTeamRoute,
  previewScanoMasterProductsRoute,
  resumeScanoMasterProductRoute,
  resumeScanoTaskRoute,
  searchScanoRunnerExternalProductsRoute,
  scanoMasterProductUpload,
  scanoTaskProductImagesUpload,
  startScanoTaskRoute,
  testScanoSettingsRoute,
  updateScanoMasterProductRoute,
  updateScanoTaskAssigneesRoute,
  updateScanoTaskProductRoute,
  updateScanoTaskRoute,
  updateScanoSettingsRoute,
  updateScanoTeamRoute,
} from "./scano.js";

const TASK_1 = "11111111-1111-4111-8111-111111111111";
const TASK_2 = "22222222-2222-4222-8222-222222222222";
const TINY_PNG_BYTES = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO7ZfV8AAAAASUVORK5CYII=",
  "base64",
);
const TOO_LARGE_UPLOAD_BYTES = Buffer.alloc((5 * 1024 * 1024) + 1, 0x61);
const TEST_SCANO_STORAGE_DIR = path.join(resolveDataDir(), "scano");

function createApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const roleHeader = req.header("x-role");
    if (roleHeader === "admin" || roleHeader === "user") {
      const idHeader = Number(req.header("x-user-id") ?? (roleHeader === "admin" ? "1" : "2"));
      const scanoRoleHeader = req.header("x-scano-role");
      const primaryAdminHeader = req.header("x-primary-admin");
      req.authUser = {
        id: Number.isFinite(idHeader) ? idHeader : roleHeader === "admin" ? 1 : 2,
        email: `${roleHeader}@example.com`,
        name: roleHeader,
        role: roleHeader,
        active: true,
        createdAt: "2026-04-04T10:00:00.000Z",
        upuseAccess: true,
        isPrimaryAdmin: primaryAdminHeader === "true" || roleHeader === "admin",
        scanoRole: scanoRoleHeader === "team_lead" || scanoRoleHeader === "scanner" ? scanoRoleHeader : undefined,
      };
    }
    next();
  });
  app.use(requireAuthenticatedApi());
  app.get("/api/scano/chains", requireScanoLeadAccess(), listScanoChainsRoute);
  app.get("/api/scano/branches", requireScanoTaskManager(), listScanoBranchesRoute);
  app.get("/api/scano/master-products", requireScanoLeadAccess(), listScanoMasterProductsRoute);
  app.post("/api/scano/master-products/preview", requireScanoLeadAccess(), scanoMasterProductUpload, previewScanoMasterProductsRoute);
  app.post("/api/scano/master-products", requireScanoLeadAccess(), scanoMasterProductUpload, createScanoMasterProductRoute);
  app.get("/api/scano/master-products/:chainId", requireScanoLeadAccess(), getScanoMasterProductRoute);
  app.post("/api/scano/master-products/:chainId/resume", requireScanoLeadAccess(), resumeScanoMasterProductRoute);
  app.put("/api/scano/master-products/:chainId", requireScanoLeadAccess(), scanoMasterProductUpload, updateScanoMasterProductRoute);
  app.delete("/api/scano/master-products/:chainId", requireScanoLeadAccess(), deleteScanoMasterProductRoute);
  app.get("/api/scano/tasks", requireScanoAccess(), listScanoTasksRoute);
  app.get("/api/scano/tasks/:id", requireScanoAccess(), getScanoTaskDetailRoute);
  app.get("/api/scano/tasks/:id/runner/bootstrap", requireScanoAccess(), getScanoRunnerBootstrapRoute);
  app.post("/api/scano/tasks/:id/runner/search", requireScanoAccess(), searchScanoRunnerExternalProductsRoute);
  app.post("/api/scano/tasks/:id/runner/hydrate", requireScanoAccess(), hydrateScanoRunnerExternalProductRoute);
  app.get("/api/scano/tasks/:id/products", requireScanoAccess(), listScanoTaskProductsRoute);
  app.get("/api/scano/tasks/:id/scans", requireScanoAccess(), listScanoTaskScansRoute);
  app.post("/api/scano/tasks", requireScanoTaskManager(), createScanoTaskRoute);
  app.patch("/api/scano/tasks/:id", requireScanoTaskManager(), updateScanoTaskRoute);
  app.delete("/api/scano/tasks/:id", requireScanoLeadAccess(), deleteScanoTaskRoute);
  app.patch("/api/scano/tasks/:id/assignees", requireScanoTaskManager(), updateScanoTaskAssigneesRoute);
  app.post("/api/scano/tasks/:id/start", requireScanoAccess(), startScanoTaskRoute);
  app.post("/api/scano/tasks/:id/end", requireScanoAccess(), endScanoTaskRoute);
  app.post("/api/scano/tasks/:id/resume", requireScanoAccess(), resumeScanoTaskRoute);
  app.post("/api/scano/tasks/:id/complete", requireScanoLeadAccess(), completeScanoTaskRoute);
  app.post("/api/scano/tasks/:id/scans/resolve", requireScanoAccess(), createScanoTaskScanRoute);
  app.post("/api/scano/tasks/:id/products", requireScanoAccess(), scanoTaskProductImagesUpload, createScanoTaskProductRoute);
  app.patch("/api/scano/tasks/:id/products/:productId", requireScanoAccess(), scanoTaskProductImagesUpload, updateScanoTaskProductRoute);
  app.get("/api/scano/tasks/:id/products/:productId", requireScanoAccess(), getScanoTaskProductRoute);
  app.get("/api/scano/tasks/:id/products/:productId/images/:imageId", requireScanoAccess(), getScanoTaskProductImageRoute);
  app.post("/api/scano/tasks/:id/exports", requireScanoLeadAccess(), createScanoTaskExportRoute);
  app.get("/api/scano/tasks/:id/exports/:exportId/download", requireScanoLeadAccess(), downloadScanoTaskExportRoute);
  app.post("/api/scano/tasks/:id/exports/:exportId/confirm-download", requireScanoLeadAccess(), confirmScanoTaskExportDownloadRoute);
  app.get("/api/scano/team", requireScanoTaskManager(), listScanoTeamRoute);
  app.post("/api/scano/team", requireScanoAdmin(), createScanoTeamRoute);
  app.patch("/api/scano/team/:id", requireScanoAdmin(), updateScanoTeamRoute);
  app.delete("/api/scano/team/:id", requireScanoAdmin(), deleteScanoTeamRoute);
  app.get("/api/scano/settings", requireScanoAdmin(), getScanoSettingsRoute);
  app.put("/api/scano/settings", requireScanoAdmin(), updateScanoSettingsRoute);
  app.post("/api/scano/settings/test", requireScanoAdmin(), testScanoSettingsRoute);
  app.use((error: unknown, _req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (res.headersSent) {
      next(error);
      return;
    }

    if (error instanceof ZodError) {
      res.status(400).json({
        ok: false,
        message: "Invalid request payload",
        issues: error.issues.map((issue) => issue.message),
      });
      return;
    }

    if (error instanceof multer.MulterError) {
      res.status(400).json({
        ok: false,
        message: error.message || "Invalid uploaded file",
        code: "UPLOAD_ERROR",
        errorOrigin: "validation",
      });
      return;
    }

    const typedError = error as {
      status?: unknown;
      message?: unknown;
      code?: unknown;
      errorOrigin?: unknown;
      integration?: unknown;
      exposeMessage?: unknown;
    };
    const status =
      typeof typedError.status === "number" &&
      typedError.status >= 400 &&
      typedError.status < 600
        ? typedError.status
        : 500;
    const errorOrigin =
      typedError.errorOrigin === "session" ||
      typedError.errorOrigin === "authorization" ||
      typedError.errorOrigin === "integration" ||
      typedError.errorOrigin === "validation" ||
      typedError.errorOrigin === "server"
        ? typedError.errorOrigin
        : status === 401
          ? "session"
          : status === 403
            ? "authorization"
            : "server";

    res.status(status).json({
      ok: false,
      message:
        status >= 500 && typedError.exposeMessage !== true
          ? "Internal server error"
          : (typeof typedError.message === "string" && typedError.message.length
            ? typedError.message
            : "Request failed"),
      ...(typeof typedError.code === "string" ? { code: typedError.code } : {}),
      ...(errorOrigin ? { errorOrigin } : {}),
      ...(typeof typedError.integration === "string" ? { integration: typedError.integration } : {}),
    });
  });
  return app;
}

async function startServer() {
  const app = createApp();
  const server = await new Promise<Server>((resolve) => {
    const nextServer = app.listen(0, () => resolve(nextServer));
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Failed to resolve Scano test server address");
  }

  return {
    server,
    baseUrl: `http://127.0.0.1:${address.port}`,
  };
}

function resetDb() {
  fs.rmSync(TEST_SCANO_STORAGE_DIR, { recursive: true, force: true });
  testDb.exec(`
    PRAGMA foreign_keys = OFF;
    DROP TABLE IF EXISTS scano_runner_sessions;
    DROP TABLE IF EXISTS scano_task_scans;
    DROP TABLE IF EXISTS scano_task_exports;
    DROP TABLE IF EXISTS scano_task_product_edits;
    DROP TABLE IF EXISTS scano_task_product_images;
    DROP TABLE IF EXISTS scano_task_product_barcodes;
    DROP TABLE IF EXISTS scano_task_products;
    DROP TABLE IF EXISTS scano_task_participants;
    DROP TABLE IF EXISTS scano_task_assignees;
    DROP TABLE IF EXISTS scano_tasks;
    DROP TABLE IF EXISTS scano_master_product_enrichment_barcodes;
    DROP TABLE IF EXISTS scano_master_product_enrichment_entries;
    DROP TABLE IF EXISTS scano_master_product_rows;
    DROP TABLE IF EXISTS scano_master_products;
    DROP TABLE IF EXISTS scano_team_members;
    DROP TABLE IF EXISTS scano_settings;
    DROP TABLE IF EXISTS users;

    CREATE TABLE users (
      id INTEGER PRIMARY KEY,
      email TEXT NOT NULL,
      name TEXT NOT NULL,
      role TEXT NOT NULL,
      passwordHash TEXT NOT NULL DEFAULT 'x',
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

    CREATE TABLE scano_settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      catalogBaseUrl TEXT NOT NULL,
      catalogTokenEnc TEXT NOT NULL,
      updatedAt TEXT NOT NULL
    );

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

    CREATE TABLE scano_task_assignees (
      taskId TEXT NOT NULL,
      teamMemberId INTEGER NOT NULL,
      assignedAt TEXT NOT NULL,
      PRIMARY KEY (taskId, teamMemberId),
      FOREIGN KEY (taskId) REFERENCES scano_tasks(id) ON DELETE CASCADE,
      FOREIGN KEY (teamMemberId) REFERENCES scano_team_members(id) ON DELETE CASCADE
    );

    CREATE TABLE scano_task_participants (
      taskId TEXT NOT NULL,
      teamMemberId INTEGER NOT NULL,
      startedAt TEXT,
      lastEnteredAt TEXT,
      endedAt TEXT,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL,
      PRIMARY KEY (taskId, teamMemberId),
      FOREIGN KEY (taskId) REFERENCES scano_tasks(id) ON DELETE CASCADE,
      FOREIGN KEY (teamMemberId) REFERENCES scano_team_members(id) ON DELETE CASCADE
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
      sku TEXT,
      price TEXT,
      barcode TEXT,
      itemNameEn TEXT,
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

    CREATE TABLE scano_task_product_edits (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      productId TEXT NOT NULL,
      editedByTeamMemberId INTEGER NOT NULL,
      beforeJson TEXT NOT NULL,
      afterJson TEXT NOT NULL,
      editedAt TEXT NOT NULL,
      FOREIGN KEY (productId) REFERENCES scano_task_products(id) ON DELETE CASCADE,
      FOREIGN KEY (editedByTeamMemberId) REFERENCES scano_team_members(id) ON DELETE CASCADE
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

    CREATE TABLE scano_runner_sessions (
      token TEXT PRIMARY KEY,
      taskId TEXT NOT NULL,
      actorUserId INTEGER NOT NULL,
      teamMemberId INTEGER NOT NULL,
      chainId INTEGER NOT NULL,
      vendorId INTEGER NOT NULL,
      globalEntityId TEXT NOT NULL,
      expiresAt TEXT NOT NULL,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL,
      FOREIGN KEY (taskId) REFERENCES scano_tasks(id) ON DELETE CASCADE,
      FOREIGN KEY (actorUserId) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (teamMemberId) REFERENCES scano_team_members(id) ON DELETE CASCADE
    );

    PRAGMA foreign_keys = ON;
  `);

  const insertUser = testDb.prepare(`
    INSERT INTO users (id, email, name, role, passwordHash, active, createdAt, upuseAccess, isPrimaryAdmin)
    VALUES (?, ?, ?, ?, 'hash', 1, '2026-04-04T10:00:00.000Z', 1, ?)
  `);

  insertUser.run(1, "admin@example.com", "Admin", "admin", 1);
  insertUser.run(2, "assigned@example.com", "Assigned User", "user", 0);
  insertUser.run(3, "other@example.com", "Other User", "user", 0);
  insertUser.run(4, "helper@example.com", "Helper User", "user", 0);
  testDb.prepare(`
    INSERT INTO scano_settings (id, catalogBaseUrl, catalogTokenEnc, updatedAt)
    VALUES (1, 'https://catalog.example.com', 'enc:test-token', '2026-04-04T10:00:00.000Z')
  `).run();
}

function insertTeamMember(params: {
  id: number;
  name: string;
  linkedUserId: number;
  role?: "team_lead" | "scanner";
  active?: boolean;
}) {
  testDb.prepare(`
    INSERT INTO scano_team_members (id, name, linkedUserId, role, active, createdAt, updatedAt)
    VALUES (?, ?, ?, ?, ?, '2026-04-04T10:00:00.000Z', '2026-04-04T10:00:00.000Z')
  `).run(params.id, params.name, params.linkedUserId, params.role ?? "scanner", params.active === false ? 0 : 1);
}

function insertMasterProduct(params: {
  chainId: number;
  chainName: string;
  mappingJson?: string;
  productCount?: number;
  importRevision?: number;
  enrichmentStatus?: "queued" | "running" | "completed" | "paused_auth";
  enrichmentQueuedAt?: string | null;
  enrichmentStartedAt?: string | null;
  enrichmentPausedAt?: string | null;
  enrichmentCompletedAt?: string | null;
  enrichedCount?: number;
  processedCount?: number;
  warningCode?: string | null;
  warningMessage?: string | null;
  updatedAt?: string;
}) {
  testDb.prepare(`
    INSERT INTO scano_master_products (
      chainId,
      chainName,
      mappingJson,
      productCount,
      importRevision,
      enrichmentStatus,
      enrichmentQueuedAt,
      enrichmentStartedAt,
      enrichmentPausedAt,
      enrichmentCompletedAt,
      enrichedCount,
      processedCount,
      warningCode,
      warningMessage,
      updatedAt,
      updatedByUserId,
      createdAt
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, '2026-04-04T10:00:00.000Z')
  `).run(
    params.chainId,
    params.chainName,
    params.mappingJson ?? JSON.stringify({
      sku: "item number",
      barcode: "barcode value",
      price: null,
      itemNameEn: "english name",
      itemNameAr: null,
      image: null,
    }),
    params.productCount ?? 2,
    params.importRevision ?? 1,
    params.enrichmentStatus ?? "completed",
    params.enrichmentQueuedAt ?? "2026-04-05T12:00:00.000Z",
    params.enrichmentStartedAt ?? "2026-04-05T12:01:00.000Z",
    params.enrichmentPausedAt ?? null,
    params.enrichmentCompletedAt ?? "2026-04-05T12:10:00.000Z",
    params.enrichedCount ?? (params.productCount ?? 2),
    params.processedCount ?? (params.productCount ?? 2),
    params.warningCode ?? null,
    params.warningMessage ?? null,
    params.updatedAt ?? "2026-04-05T12:00:00.000Z",
  );
}

function insertMasterProductRow(params: {
  chainId: number;
  rowNumber: number;
  sku?: string | null;
  barcode?: string | null;
  price?: string | null;
  itemNameEn?: string | null;
  itemNameAr?: string | null;
  image?: string | null;
}) {
  testDb.prepare(`
    INSERT INTO scano_master_product_rows (
      chainId,
      rowNumber,
      sku,
      barcode,
      price,
      itemNameEn,
      itemNameAr,
      image
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    params.chainId,
    params.rowNumber,
    params.sku ?? null,
    params.barcode ?? null,
    params.price ?? null,
    params.itemNameEn ?? null,
    params.itemNameAr ?? null,
    params.image ?? null,
  );
}

function normalizeTestBarcode(value: string) {
  const trimmed = value.trim();
  if (!trimmed || !/^\d+$/.test(trimmed)) {
    return trimmed;
  }
  return trimmed.length >= 14 ? trimmed : trimmed.padStart(14, "0");
}

function insertMasterProductEnrichmentEntry(params: {
  id?: number;
  chainId: number;
  importRevision?: number;
  rowNumber: number;
  sourceBarcode: string;
  normalizedBarcode?: string;
  status?: "pending_search" | "searching" | "pending_assignment" | "checking_assignment" | "enriched" | "failed" | "ambiguous";
  attemptCount?: number;
  externalProductId?: string | null;
  sku?: string | null;
  price?: string | null;
  itemNameEn?: string | null;
  itemNameAr?: string | null;
  image?: string | null;
  chainFlag?: "yes" | "no" | null;
  vendorFlag?: "yes" | "no" | null;
}) {
  const result = testDb.prepare(`
    INSERT INTO scano_master_product_enrichment_entries (
      ${params.id != null ? "id," : ""}
      chainId,
      importRevision,
      rowNumber,
      sourceBarcode,
      normalizedBarcode,
      status,
      attemptCount,
      nextAttemptAt,
      lastError,
      externalProductId,
      sku,
      price,
      itemNameEn,
      itemNameAr,
      image,
      chainFlag,
      vendorFlag,
      enrichedAt,
      createdAt,
      updatedAt
    ) VALUES (
      ${params.id != null ? "?," : ""}
      ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?, ?, ?, ?, ?, ?, '2026-04-05T12:05:00.000Z', '2026-04-05T12:00:00.000Z', '2026-04-05T12:05:00.000Z'
    )
  `).run(
    ...(params.id != null ? [params.id] : []),
    params.chainId,
    params.importRevision ?? 1,
    params.rowNumber,
    params.sourceBarcode,
    params.normalizedBarcode ?? normalizeTestBarcode(params.sourceBarcode),
    params.status ?? "enriched",
    params.attemptCount ?? 1,
    params.externalProductId ?? null,
    params.sku ?? null,
    params.price ?? null,
    params.itemNameEn ?? null,
    params.itemNameAr ?? null,
    params.image ?? null,
    params.chainFlag ?? null,
    params.vendorFlag ?? null,
  );

  return params.id ?? Number(result.lastInsertRowid);
}

function insertMasterProductEnrichmentCandidate(params: {
  entryId: number;
  chainId: number;
  rowNumber: number;
  productId: string;
  barcode: string;
  barcodes?: string[];
  importRevision?: number;
  status?: "pending" | "checking" | "matched" | "rejected" | "failed";
  attemptCount?: number;
  sku?: string | null;
  price?: string | null;
  chainFlag?: "yes" | "no" | null;
  vendorFlag?: "yes" | "no" | null;
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
      lastError,
      sku,
      price,
      chainFlag,
      vendorFlag,
      createdAt,
      updatedAt
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?, ?, '2026-04-05T12:00:00.000Z', '2026-04-05T12:05:00.000Z')
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
    params.sku ?? null,
    params.price ?? null,
    params.chainFlag ?? null,
    params.vendorFlag ?? null,
  ).lastInsertRowid);
}

function insertMasterProductEnrichmentBarcode(params: {
  entryId: number;
  chainId: number;
  importRevision?: number;
  barcode: string;
  normalizedBarcode?: string;
}) {
  testDb.prepare(`
    INSERT INTO scano_master_product_enrichment_barcodes (
      entryId,
      chainId,
      importRevision,
      barcode,
      normalizedBarcode,
      createdAt
    ) VALUES (?, ?, ?, ?, ?, '2026-04-05T12:05:00.000Z')
  `).run(
    params.entryId,
    params.chainId,
    params.importRevision ?? 1,
    params.barcode,
    params.normalizedBarcode ?? normalizeTestBarcode(params.barcode),
  );
}

function insertTask(params: {
  id: string;
  scheduledAt: string;
  status?: "pending" | "in_progress" | "awaiting_review" | "completed";
  startedByUserId?: number | null;
  startedByTeamMemberId?: number | null;
}) {
  testDb.prepare(`
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
    ) VALUES (?, 1037, 'Carrefour', 4594, 'vendor-global-4594', 'Nasr City', 'TB_EG', 'EG', 'branch-4594', ?, ?, 1, ?, ?, ?, '2026-04-04T10:00:00.000Z', '2026-04-04T10:00:00.000Z')
  `).run(
    params.id,
    params.scheduledAt,
    params.status ?? "pending",
    params.status === "in_progress" ? "2026-04-04T11:00:00.000Z" : null,
    params.startedByUserId ?? null,
    params.startedByTeamMemberId ?? null,
  );
}

function assignTask(taskId: string, teamMemberId: number) {
  testDb.prepare(`
    INSERT INTO scano_task_assignees (taskId, teamMemberId, assignedAt)
    VALUES (?, ?, '2026-04-04T10:00:00.000Z')
  `).run(taskId, teamMemberId);
}

function insertParticipant(params: {
  taskId: string;
  teamMemberId: number;
  startedAt?: string | null;
  lastEnteredAt?: string | null;
  endedAt?: string | null;
}) {
  testDb.prepare(`
    INSERT INTO scano_task_participants (taskId, teamMemberId, startedAt, lastEnteredAt, endedAt, createdAt, updatedAt)
    VALUES (?, ?, ?, ?, ?, '2026-04-04T10:00:00.000Z', '2026-04-04T10:00:00.000Z')
  `).run(
    params.taskId,
    params.teamMemberId,
    params.startedAt ?? "2026-04-04T11:00:00.000Z",
    params.lastEnteredAt ?? "2026-04-04T11:00:00.000Z",
    params.endedAt ?? null,
  );
}

function insertScan(params: {
  taskId: string;
  teamMemberId: number;
  barcode: string;
  source?: "manual" | "scanner" | "camera";
  outcome?: "matched_external" | "matched_master" | "manual_only" | "duplicate_blocked";
}) {
  testDb.prepare(`
    INSERT INTO scano_task_scans (taskId, teamMemberId, barcode, source, lookupStatus, outcome, taskProductId, resolvedProductJson, scannedAt, createdAt, updatedAt)
    VALUES (?, ?, ?, ?, 'pending_integration', ?, NULL, NULL, '2026-04-04T11:15:00.000Z', '2026-04-04T11:15:00.000Z', '2026-04-04T11:15:00.000Z')
  `).run(params.taskId, params.teamMemberId, params.barcode, params.source ?? "manual", params.outcome ?? "manual_only");
}

function insertTaskProductRecord(params: {
  productId: string;
  taskId: string;
  teamMemberId: number;
  sourceType?: "vendor" | "chain" | "master" | "manual";
  externalProductId?: string | null;
  previewImageUrl?: string | null;
  barcode: string;
  sku: string;
  price?: string | null;
  itemNameEn: string;
  itemNameAr?: string | null;
  edited?: boolean;
  confirmedAt?: string;
  updatedAt?: string;
}) {
  testDb.prepare(`
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
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'no', 'no', 'no', 'yes', ?, ?, ?)
  `).run(
    params.productId,
    params.taskId,
    params.teamMemberId,
    params.sourceType ?? "manual",
    params.externalProductId ?? null,
    params.previewImageUrl ?? null,
    params.sku,
    params.price ?? null,
    params.barcode,
    params.itemNameEn,
    params.itemNameAr ?? null,
    params.edited ? 1 : 0,
    params.confirmedAt ?? "2026-04-04T11:30:00.000Z",
    params.updatedAt ?? "2026-04-04T11:30:00.000Z",
  );
}

function insertTaskProductImageRecord(params: {
  imageId: string;
  productId: string;
  fileName: string;
  filePath: string;
}) {
  testDb.prepare(`
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
    ) VALUES (?, ?, ?, 'local', ?, NULL, 'image/png', 0, '2026-04-04T11:30:00.000Z')
  `).run(params.imageId, params.productId, params.fileName, params.filePath);
}

function insertTaskProductBarcodeRecord(params: {
  productId: string;
  barcode: string;
  createdAt?: string;
}) {
  testDb.prepare(`
    INSERT INTO scano_task_product_barcodes (productId, barcode, createdAt)
    VALUES (?, ?, ?)
  `).run(
    params.productId,
    params.barcode,
    params.createdAt ?? "2026-04-04T11:30:00.000Z",
  );
}

function insertResolvedProductSnapshotScan(params: {
  taskId: string;
  teamMemberId: number;
  taskProductId: string;
  barcode: string;
  resolvedProductJson: string;
  scannedAt?: string;
}) {
  const scannedAt = params.scannedAt ?? "2026-04-04T11:35:00.000Z";
  testDb.prepare(`
    INSERT INTO scano_task_scans (taskId, teamMemberId, barcode, source, lookupStatus, outcome, taskProductId, resolvedProductJson, scannedAt, createdAt, updatedAt)
    VALUES (?, ?, ?, 'manual', 'pending_integration', 'manual_only', ?, ?, ?, ?, ?)
  `).run(
    params.taskId,
    params.teamMemberId,
    params.barcode,
    params.taskProductId,
    params.resolvedProductJson,
    scannedAt,
    scannedAt,
    scannedAt,
  );
}

function createProductFormData(payload: {
  externalProductId: string | null;
  barcode: string;
  barcodes: string[];
  sku: string;
  price: string | null;
  itemNameEn: string;
  itemNameAr: string | null;
  sourceMeta: {
    sourceType: "vendor" | "chain" | "master" | "manual";
    chain: "yes" | "no";
    vendor: "yes" | "no";
    masterfile: "yes" | "no";
    new: "yes" | "no";
  };
  imageUrls?: string[];
  existingImageIds?: string[];
}) {
  const formData = new FormData();
  formData.set("payloadJson", JSON.stringify({
    ...payload,
    imageUrls: payload.imageUrls ?? [],
    existingImageIds: payload.existingImageIds ?? [],
  }));
  return formData;
}

describe("scano routes", () => {
  let server: Server | null = null;
  let baseUrl = "";

  beforeEach(async () => {
    mockSearchScanoBranches.mockReset();
    mockSearchScanoChains.mockReset();
    mockSearchScanoProductsByBarcode.mockReset();
    mockGetScanoProductDetail.mockReset();
    mockGetScanoProductAssignmentCheck.mockReset();
    mockListScanoProductAssignments.mockReset();
    mockTestScanoCatalogConnection.mockReset();
    mockSearchScanoProductsByBarcode.mockResolvedValue([]);
    mockGetScanoProductDetail.mockResolvedValue({
      id: "QAR4F19C",
      sku: "SKU-1",
      price: "100",
      barcode: "99887766",
      barcodes: ["99887766"],
      itemNameEn: "Imported Product",
      itemNameAr: null,
      images: [],
    });
    mockGetScanoProductAssignmentCheck.mockResolvedValue({
      chain: "yes",
      vendor: "yes",
      sku: "SKU-1",
      price: "100",
    });
    mockListScanoProductAssignments.mockResolvedValue([
      {
        vendorId: 4594,
        chainId: 1037,
        sku: "SKU-1",
        price: "100",
      },
    ]);
    resetDb();

    const started = await startServer();
    server = started.server;
    baseUrl = started.baseUrl;
  });

  afterEach(async () => {
    await new Promise<void>((resolve, reject) => {
      if (!server) {
        resolve();
        return;
      }
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
    server = null;
  });

  it("returns Scano chain and branch search to task managers while blocking scanners", async () => {
    mockSearchScanoChains.mockResolvedValue({
      items: [{ id: 1037, active: true, name: "Carrefour", globalId: "chain-global-1037", type: "chain" }],
      pageIndex: 1,
      totalPages: 1,
      totalRecords: 1,
    });
    mockSearchScanoBranches.mockResolvedValue({
      items: [{ id: 4594, globalId: "vendor-global-4594", name: "Nasr City", chainId: 1037, chainName: "Carrefour", globalEntityId: "TB_EG", countryCode: "EG", additionalRemoteId: "branch-4594" }],
      pageIndex: 1,
      totalPages: 1,
      totalRecords: 1,
    });

    const forbiddenResponse = await fetch(`${baseUrl}/api/scano/chains?query=car`, {
      headers: { "x-role": "user" },
    });
    expect(forbiddenResponse.status).toBe(403);

    const teamLeadChainsResponse = await fetch(`${baseUrl}/api/scano/chains?query=car`, {
      headers: {
        "x-role": "user",
        "x-user-id": "4",
        "x-scano-role": "team_lead",
      },
    });
    const chainsResponse = await fetch(`${baseUrl}/api/scano/chains?query=car`, {
      headers: {
        "x-role": "admin",
        "x-primary-admin": "true",
      },
    });
    const teamLeadBranchesResponse = await fetch(`${baseUrl}/api/scano/branches?chainId=1037&query=nasr`, {
      headers: {
        "x-role": "user",
        "x-user-id": "4",
        "x-scano-role": "team_lead",
      },
    });
    const scannerBranchesResponse = await fetch(`${baseUrl}/api/scano/branches?chainId=1037&query=nasr`, {
      headers: {
        "x-role": "user",
        "x-user-id": "2",
        "x-scano-role": "scanner",
      },
    });
    const adminBranchesResponse = await fetch(`${baseUrl}/api/scano/branches?chainId=1037&query=nasr`, {
      headers: {
        "x-role": "admin",
        "x-primary-admin": "true",
      },
    });

    expect(teamLeadChainsResponse.status).toBe(200);
    expect(chainsResponse.status).toBe(200);
    expect(teamLeadBranchesResponse.status).toBe(200);
    expect(scannerBranchesResponse.status).toBe(403);
    expect(adminBranchesResponse.status).toBe(200);
    expect(mockSearchScanoChains).toHaveBeenCalledWith("car");
    expect(mockSearchScanoBranches).toHaveBeenCalledWith({
      chainId: 1037,
      query: "nasr",
    });
  });

  it("lets team leads preview and save master product csv imports while blocking scanners", async () => {
    const forbiddenListResponse = await fetch(`${baseUrl}/api/scano/master-products`, {
      headers: {
        "x-role": "user",
        "x-user-id": "2",
        "x-scano-role": "scanner",
      },
    });
    expect(forbiddenListResponse.status).toBe(403);

    const previewFormData = new FormData();
    previewFormData.set("file", new Blob(["item number,barcode value,english name\nSKU-1,111,Milk"], { type: "text/csv" }), "products.csv");
    const previewResponse = await fetch(`${baseUrl}/api/scano/master-products/preview`, {
      method: "POST",
      headers: {
        "x-role": "user",
        "x-user-id": "4",
        "x-scano-role": "team_lead",
      },
      body: previewFormData,
    });
    const previewBody = await previewResponse.json() as {
      headers: string[];
      suggestedMapping: { sku: string | null; barcode: string | null; itemNameEn: string | null };
      sampleRows: Array<Record<string, string>>;
    };

    expect(previewResponse.status).toBe(200);
    expect(previewBody.headers).toEqual(["item number", "barcode value", "english name"]);
    expect(previewBody.suggestedMapping.sku).toBe("item number");
    expect(previewBody.suggestedMapping.barcode).toBe("barcode value");
    expect(previewBody.suggestedMapping.itemNameEn).toBe("english name");
    expect(previewBody.sampleRows).toHaveLength(1);

    const createFormData = new FormData();
    createFormData.set("chainId", "1037");
    createFormData.set("chainName", "Carrefour");
    createFormData.set("mappingJson", JSON.stringify({
      sku: "item number",
      barcode: "barcode value",
      itemNameEn: "english name",
      price: null,
      itemNameAr: null,
      image: null,
    }));
    createFormData.set("file", new Blob([
      "item number,barcode value,english name,sell price\nSKU-1,111,Milk,55\nSKU-1,999,Milk second,99\nSKU-2,222,Bread,33",
    ], { type: "text/csv" }), "products.csv");

    const createResponse = await fetch(`${baseUrl}/api/scano/master-products`, {
      method: "POST",
      headers: {
        "x-role": "user",
        "x-user-id": "4",
        "x-scano-role": "team_lead",
      },
      body: createFormData,
    });
    const createBody = await createResponse.json() as { item: ScanoMasterProductListItem };

    expect(createResponse.status).toBe(201);
    expect(createBody.item.chainId).toBe(1037);
    expect(createBody.item.productCount).toBe(2);

    const detailResponse = await fetch(`${baseUrl}/api/scano/master-products/1037`, {
      headers: {
        "x-role": "admin",
        "x-primary-admin": "true",
      },
    });
    const detailBody = await detailResponse.json() as { item: ScanoMasterProductDetail };

    expect(detailResponse.status).toBe(200);
    expect(detailBody.item.exampleRows).toHaveLength(2);
    expect(detailBody.item.exampleRows[0]?.sku).toBe("SKU-1");
    expect(detailBody.item.exampleRows[1]?.sku).toBe("SKU-2");
  });

  it("rejects non-csv master-product uploads with a clear 400 response", async () => {
    const previewFormData = new FormData();
    previewFormData.set("file", new Blob([TINY_PNG_BYTES], { type: "image/png" }), "products.png");

    const response = await fetch(`${baseUrl}/api/scano/master-products/preview`, {
      method: "POST",
      headers: {
        "x-role": "user",
        "x-user-id": "4",
        "x-scano-role": "team_lead",
      },
      body: previewFormData,
    });
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toMatchObject({
      ok: false,
      message: "Only CSV files are supported.",
      code: "SCANO_MASTER_PRODUCT_FILE_INVALID",
      errorOrigin: "validation",
    });
  });

  it("rejects oversized master-product csv uploads with a clear 400 response", async () => {
    const previewFormData = new FormData();
    previewFormData.set("file", new Blob([TOO_LARGE_UPLOAD_BYTES], { type: "text/csv" }), "products.csv");

    const response = await fetch(`${baseUrl}/api/scano/master-products/preview`, {
      method: "POST",
      headers: {
        "x-role": "admin",
        "x-primary-admin": "true",
      },
      body: previewFormData,
    });
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toMatchObject({
      ok: false,
      message: "File too large",
      code: "UPLOAD_ERROR",
      errorOrigin: "validation",
    });
  });

  it("rejects invalid master product mappings and replaces existing chain imports atomically", async () => {
    insertMasterProduct({
      chainId: 1037,
      chainName: "Carrefour",
      productCount: 1,
    });
    insertMasterProductRow({
      chainId: 1037,
      rowNumber: 2,
      sku: "SKU-OLD",
      barcode: "111",
      itemNameEn: "Old Milk",
    });

    const invalidFormData = new FormData();
    invalidFormData.set("chainId", "1037");
    invalidFormData.set("chainName", "Carrefour");
    invalidFormData.set("mappingJson", JSON.stringify({
      sku: "item number",
      barcode: null,
      itemNameEn: "english name",
      price: null,
      itemNameAr: null,
      image: null,
    }));
    invalidFormData.set("file", new Blob(["item number,english name\nSKU-1,Milk"], { type: "text/csv" }), "invalid.csv");

    const invalidResponse = await fetch(`${baseUrl}/api/scano/master-products`, {
      method: "POST",
      headers: {
        "x-role": "admin",
        "x-primary-admin": "true",
      },
      body: invalidFormData,
    });
    expect(invalidResponse.status).toBe(400);

    const replaceFormData = new FormData();
    replaceFormData.set("chainId", "1037");
    replaceFormData.set("chainName", "Carrefour Express");
    replaceFormData.set("mappingJson", JSON.stringify({
      sku: "item number",
      barcode: "barcode value",
      itemNameEn: "english name",
      price: null,
      itemNameAr: null,
      image: null,
    }));
    replaceFormData.set("file", new Blob([
      "item number,barcode value,english name\nSKU-9,999,Cheese\nSKU-10,888,Butter",
    ], { type: "text/csv" }), "replace.csv");

    const replaceResponse = await fetch(`${baseUrl}/api/scano/master-products/1037`, {
      method: "PUT",
      headers: {
        "x-role": "admin",
        "x-primary-admin": "true",
      },
      body: replaceFormData,
    });
    expect(replaceResponse.status).toBe(200);

    const listResponse = await fetch(`${baseUrl}/api/scano/master-products`, {
      headers: {
        "x-role": "user",
        "x-user-id": "4",
        "x-scano-role": "team_lead",
      },
    });
    const listBody = await listResponse.json() as { items: ScanoMasterProductListItem[] };
    expect(listBody.items[0]?.chainName).toBe("Carrefour Express");
    expect(listBody.items[0]?.productCount).toBe(2);

    const detailResponse = await fetch(`${baseUrl}/api/scano/master-products/1037`, {
      headers: {
        "x-role": "admin",
        "x-primary-admin": "true",
      },
    });
    const detailBody = await detailResponse.json() as { item: ScanoMasterProductDetail };
    expect(detailBody.item.exampleRows[0]?.sku).toBe("SKU-9");
    expect(detailBody.item.exampleRows.some((row) => row.sku === "SKU-OLD")).toBe(false);
  });

  it("resumes master product enrichment from the current import without clearing enriched rows", async () => {
    insertMasterProduct({
      chainId: 1037,
      chainName: "Carrefour",
      importRevision: 3,
      enrichmentStatus: "paused_auth",
      enrichmentPausedAt: "2026-04-05T12:11:00.000Z",
      enrichmentCompletedAt: null,
      enrichedCount: 1,
      processedCount: 3,
      warningCode: "SCANO_MASTER_ENRICHMENT_AUTH_PAUSED",
      warningMessage: "Scano catalog token is invalid.",
    });
    insertMasterProductEnrichmentEntry({
      chainId: 1037,
      importRevision: 3,
      rowNumber: 1,
      sourceBarcode: "111",
      status: "enriched",
      attemptCount: 1,
      externalProductId: "product-111",
      sku: "SKU-1",
      price: "55",
      itemNameEn: "Milk",
      chainFlag: "yes",
      vendorFlag: "yes",
    });
    insertMasterProductEnrichmentEntry({
      chainId: 1037,
      importRevision: 3,
      rowNumber: 2,
      sourceBarcode: "222",
      status: "failed",
      attemptCount: 3,
    });
    const ambiguousEntryId = insertMasterProductEnrichmentEntry({
      chainId: 1037,
      importRevision: 3,
      rowNumber: 3,
      sourceBarcode: "333",
      status: "ambiguous",
      attemptCount: 2,
    });
    insertMasterProductEnrichmentCandidate({
      entryId: ambiguousEntryId,
      chainId: 1037,
      importRevision: 3,
      rowNumber: 3,
      productId: "product-333-a",
      barcode: "333",
      status: "matched",
      attemptCount: 1,
      sku: "SKU-333-A",
      price: "66",
      chainFlag: "yes",
      vendorFlag: "yes",
    });
    insertMasterProductEnrichmentCandidate({
      entryId: ambiguousEntryId,
      chainId: 1037,
      importRevision: 3,
      rowNumber: 3,
      productId: "product-333-b",
      barcode: "333",
      status: "matched",
      attemptCount: 1,
      sku: "SKU-333-B",
      price: "67",
      chainFlag: "yes",
      vendorFlag: "yes",
    });

    const response = await fetch(`${baseUrl}/api/scano/master-products/1037/resume`, {
      method: "POST",
      headers: {
        "x-role": "user",
        "x-user-id": "4",
        "x-scano-role": "team_lead",
      },
    });
    const body = await response.json() as { ok: true; item: ScanoMasterProductListItem };

    expect(response.status).toBe(200);
    expect(body.item).toMatchObject({
      chainId: 1037,
      enrichmentStatus: "queued",
      enrichedCount: 1,
      processedCount: 1,
      canResumeEnrichment: true,
      warningCode: null,
      warningMessage: null,
    });
    expect(testDb.prepare(`
      SELECT status, attemptCount
      FROM scano_master_product_enrichment_entries
      WHERE chainId = 1037 AND importRevision = 3
      ORDER BY rowNumber ASC
    `).all()).toEqual([
      { status: "enriched", attemptCount: 1 },
      { status: "pending_search", attemptCount: 0 },
      { status: "pending_assignment", attemptCount: 0 },
    ]);
    expect(testDb.prepare(`
      SELECT status, attemptCount, sku, price, chainFlag, vendorFlag
      FROM scano_master_product_enrichment_candidates
      WHERE entryId = ?
      ORDER BY externalProductId ASC
    `).all(ambiguousEntryId)).toEqual([
      { status: "pending", attemptCount: 0, sku: null, price: null, chainFlag: null, vendorFlag: null },
      { status: "pending", attemptCount: 0, sku: null, price: null, chainFlag: null, vendorFlag: null },
    ]);
  });

  it("deletes master product chains and their normalized rows", async () => {
    insertMasterProduct({
      chainId: 1037,
      chainName: "Carrefour",
      productCount: 2,
    });
    insertMasterProductRow({
      chainId: 1037,
      rowNumber: 2,
      sku: "SKU-1",
      barcode: "111",
      itemNameEn: "Milk",
    });

    const deleteResponse = await fetch(`${baseUrl}/api/scano/master-products/1037`, {
      method: "DELETE",
      headers: {
        "x-role": "admin",
        "x-primary-admin": "true",
      },
    });
    expect(deleteResponse.status).toBe(200);

    const listResponse = await fetch(`${baseUrl}/api/scano/master-products`, {
      headers: {
        "x-role": "admin",
        "x-primary-admin": "true",
      },
    });
    const listBody = await listResponse.json() as { items: ScanoMasterProductListItem[] };
    expect(listBody.items).toHaveLength(0);

    const rowCount = testDb.prepare("SELECT COUNT(*) AS count FROM scano_master_product_rows").get() as { count: number };
    expect(rowCount.count).toBe(0);
  });

  it("supports Scano team CRUD for admins and blocks non-admin writes", async () => {
    const forbiddenResponse = await fetch(`${baseUrl}/api/scano/team`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-role": "user",
      },
      body: JSON.stringify({
        linkedUserId: 2,
        role: "scanner",
        active: true,
      }),
    });
    expect(forbiddenResponse.status).toBe(403);

    const createResponse = await fetch(`${baseUrl}/api/scano/team`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-role": "admin",
        "x-primary-admin": "true",
      },
      body: JSON.stringify({
        linkedUserId: 2,
        role: "scanner",
        active: true,
      }),
    });
    const createdBody = await createResponse.json();

    expect(createResponse.status).toBe(201);
    expect(createdBody.item).toMatchObject({
      name: "Assigned User",
      linkedUserId: 2,
      role: "scanner",
      active: true,
    });

    const teamLeadListResponse = await fetch(`${baseUrl}/api/scano/team`, {
      headers: {
        "x-role": "user",
        "x-user-id": "4",
        "x-scano-role": "team_lead",
      },
    });
    const teamLeadListBody = await teamLeadListResponse.json();
    expect(teamLeadListResponse.status).toBe(200);
    expect(teamLeadListBody.items).toHaveLength(1);

    const listResponse = await fetch(`${baseUrl}/api/scano/team`, {
      headers: {
        "x-role": "admin",
        "x-primary-admin": "true",
      },
    });
    const listBody = await listResponse.json();
    expect(listResponse.status).toBe(200);
    expect(listBody.items).toHaveLength(1);

    const updateResponse = await fetch(`${baseUrl}/api/scano/team/${createdBody.item.id}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        "x-role": "admin",
        "x-primary-admin": "true",
      },
      body: JSON.stringify({
        linkedUserId: 4,
        role: "team_lead",
        active: false,
      }),
    });
    const updatedBody = await updateResponse.json();
    expect(updateResponse.status).toBe(200);
    expect(updatedBody.item).toMatchObject({
      name: "Helper User",
      linkedUserId: 4,
      role: "team_lead",
      active: false,
    });

    const deleteResponse = await fetch(`${baseUrl}/api/scano/team/${createdBody.item.id}`, {
      method: "DELETE",
      headers: { "x-role": "admin", "x-primary-admin": "true" },
    });
    expect(deleteResponse.status).toBe(200);
  });

  it("validates create task payloads and creates tasks for task managers", async () => {
    insertTeamMember({ id: 11, name: "Ali", linkedUserId: 2 });

    const invalidResponse = await fetch(`${baseUrl}/api/scano/tasks`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-role": "admin",
        "x-primary-admin": "true",
      },
      body: JSON.stringify({
        chainId: 1037,
        chainName: "Carrefour",
        branch: {
          id: 4594,
          globalId: "vendor-global-4594",
          name: "Nasr City",
          globalEntityId: "TB_EG",
          countryCode: "EG",
          additionalRemoteId: "branch-4594",
        },
        assigneeIds: [],
        scheduledAt: "2026-04-10T08:00:00.000Z",
      }),
    });
    expect(invalidResponse.status).toBe(400);

    const createResponse = await fetch(`${baseUrl}/api/scano/tasks`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-role": "user",
        "x-user-id": "4",
        "x-scano-role": "team_lead",
      },
      body: JSON.stringify({
        chainId: 1037,
        chainName: "Carrefour",
        branch: {
          id: 4594,
          globalId: "vendor-global-4594",
          name: "Nasr City",
          globalEntityId: "TB_EG",
          countryCode: "EG",
          additionalRemoteId: "branch-4594",
        },
        assigneeIds: [11],
        scheduledAt: "2026-04-10T08:00:00.000Z",
      }),
    });
    const createdBody = await createResponse.json();

    expect(createResponse.status).toBe(201);
    expect(createdBody.item).toMatchObject({
      chainName: "Carrefour",
      branchName: "Nasr City",
      status: "pending",
    });
    expect(createdBody.item.assignees).toEqual([
      {
        id: 11,
        name: "Ali",
        linkedUserId: 2,
      },
    ]);
  });

  it("updates pending tasks and rejects editing tasks that already started", async () => {
    insertTeamMember({ id: 11, name: "Ali", linkedUserId: 2 });
    insertTeamMember({ id: 12, name: "Sara", linkedUserId: 4 });
    insertTask({ id: TASK_1, scheduledAt: "2026-04-10T08:00:00.000Z", status: "pending" });
    assignTask(TASK_1, 11);
    insertTask({ id: TASK_2, scheduledAt: "2026-04-11T08:00:00.000Z", status: "in_progress", startedByUserId: 2, startedByTeamMemberId: 11 });
    assignTask(TASK_2, 11);

    const updateResponse = await fetch(`${baseUrl}/api/scano/tasks/${TASK_1}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        "x-role": "user",
        "x-user-id": "4",
        "x-scano-role": "team_lead",
      },
      body: JSON.stringify({
        chainId: 1037,
        chainName: "Carrefour",
        branch: {
          id: 4594,
          globalId: "vendor-global-4594",
          name: "Nasr City Updated",
          globalEntityId: "TB_EG",
          countryCode: "EG",
          additionalRemoteId: "branch-4594",
        },
        assigneeIds: [12],
        scheduledAt: "2026-04-10T09:00:00.000Z",
      }),
    });
    const updatedBody = await updateResponse.json();

    expect(updateResponse.status).toBe(200);
    expect(updatedBody.item).toMatchObject({
      branchName: "Nasr City Updated",
      scheduledAt: "2026-04-10T09:00:00.000Z",
    });
    expect(updatedBody.item.assignees).toEqual([
      {
        id: 12,
        name: "Sara",
        linkedUserId: 4,
      },
    ]);

    const rejectedResponse = await fetch(`${baseUrl}/api/scano/tasks/${TASK_2}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        "x-role": "admin",
        "x-primary-admin": "true",
      },
      body: JSON.stringify({
        chainId: 1037,
        chainName: "Carrefour",
        branch: {
          id: 4594,
          globalId: "vendor-global-4594",
          name: "Blocked Edit",
          globalEntityId: "TB_EG",
          countryCode: "EG",
          additionalRemoteId: "branch-4594",
        },
        assigneeIds: [11],
        scheduledAt: "2026-04-11T09:00:00.000Z",
      }),
    });
    expect(rejectedResponse.status).toBe(409);
  });

  it("allows only assigned linked users to start pending tasks", async () => {
    insertTeamMember({ id: 11, name: "Ali", linkedUserId: 2 });
    insertTeamMember({ id: 12, name: "Sara", linkedUserId: 4, role: "team_lead" });
    insertTask({ id: TASK_1, scheduledAt: "2026-04-10T08:00:00.000Z", status: "pending" });
    assignTask(TASK_1, 11);
    insertTask({ id: TASK_2, scheduledAt: "2026-04-11T08:00:00.000Z", status: "pending" });
    assignTask(TASK_2, 11);

    const allowedResponse = await fetch(`${baseUrl}/api/scano/tasks/${TASK_1}/start`, {
      method: "POST",
      headers: {
        "x-role": "user",
        "x-user-id": "2",
        "x-scano-role": "scanner",
      },
    });
    const allowedBody = await allowedResponse.json();

    expect(allowedResponse.status).toBe(200);
    expect(allowedBody.item).toMatchObject({
      id: TASK_1,
      status: "in_progress",
    });
    expect(allowedBody.item.permissions).toMatchObject({
      canEdit: false,
      canStart: false,
    });

    const rejectedResponse = await fetch(`${baseUrl}/api/scano/tasks/${TASK_2}/start`, {
      method: "POST",
      headers: {
        "x-role": "user",
        "x-user-id": "4",
        "x-scano-role": "team_lead",
      },
    });
    expect(rejectedResponse.status).toBe(403);
  });

  it("filters the Scano task list by date range for assigned scanners", async () => {
    insertTeamMember({ id: 11, name: "Ali", linkedUserId: 2 });
    insertTask({ id: TASK_1, scheduledAt: "2026-04-01T08:00:00.000Z", status: "pending" });
    insertTask({ id: TASK_2, scheduledAt: "2026-04-10T08:00:00.000Z", status: "pending" });
    assignTask(TASK_1, 11);
    assignTask(TASK_2, 11);

    const response = await fetch(`${baseUrl}/api/scano/tasks?from=2026-04-05T00:00:00.000Z&to=2026-04-12T00:00:00.000Z`, {
      headers: {
        "x-role": "user",
        "x-user-id": "2",
        "x-scano-role": "scanner",
      },
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.items).toHaveLength(1);
    expect(body.items[0]).toMatchObject({
      id: TASK_2,
      branchName: "Nasr City",
      permissions: expect.objectContaining({
        canEdit: false,
        canStart: true,
      }),
    });
  });

  it("returns the full task list to a Scano team lead", async () => {
    insertTeamMember({ id: 11, name: "Ali", linkedUserId: 2 });
    insertTeamMember({ id: 12, name: "Sara", linkedUserId: 4, role: "team_lead" });
    insertTask({ id: TASK_1, scheduledAt: "2026-04-01T08:00:00.000Z", status: "pending" });
    insertTask({ id: TASK_2, scheduledAt: "2026-04-10T08:00:00.000Z", status: "pending" });
    assignTask(TASK_1, 11);
    assignTask(TASK_2, 11);

    const response = await fetch(`${baseUrl}/api/scano/tasks`, {
      headers: {
        "x-role": "user",
        "x-user-id": "4",
        "x-scano-role": "team_lead",
      },
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.items).toHaveLength(2);
    expect(body.items[0].permissions.canEdit).toBe(true);
  });

  it("lets admins delete a Scano task and purge its local files", async () => {
    insertTeamMember({ id: 11, name: "Ali", linkedUserId: 2 });
    insertTask({ id: TASK_1, scheduledAt: "2026-04-10T08:00:00.000Z", status: "pending" });
    assignTask(TASK_1, 11);

    const productDir = path.join(TEST_SCANO_STORAGE_DIR, "product-images", TASK_1, "product-1");
    const exportsDir = path.join(TEST_SCANO_STORAGE_DIR, "exports", TASK_1);
    fs.mkdirSync(productDir, { recursive: true });
    fs.mkdirSync(exportsDir, { recursive: true });
    const imagePath = path.join(productDir, "SKU-1.png");
    const exportPath = path.join(exportsDir, "review.zip");
    fs.writeFileSync(imagePath, TINY_PNG_BYTES);
    fs.writeFileSync(exportPath, Buffer.from("zip-data"));

    insertTaskProductRecord({
      productId: "product-1",
      taskId: TASK_1,
      teamMemberId: 11,
      barcode: "99887766",
      sku: "SKU-1",
      itemNameEn: "Imported Product",
    });
    insertTaskProductImageRecord({
      imageId: "image-1",
      productId: "product-1",
      fileName: "SKU-1.png",
      filePath: imagePath,
    });
    testDb.prepare(`
      INSERT INTO scano_task_exports (id, taskId, fileName, filePath, createdAt, confirmedDownloadAt, imagesPurgedAt)
      VALUES ('export-1', ?, 'review.zip', ?, '2026-04-04T12:00:00.000Z', NULL, NULL)
    `).run(TASK_1, exportPath);

    const response = await fetch(`${baseUrl}/api/scano/tasks/${TASK_1}`, {
      method: "DELETE",
      headers: {
        "x-role": "admin",
        "x-primary-admin": "true",
      },
    });

    expect(response.status).toBe(200);
    expect(testDb.prepare("SELECT COUNT(*) AS count FROM scano_tasks WHERE id = ?").get(TASK_1)).toEqual({ count: 0 });
    expect(testDb.prepare("SELECT COUNT(*) AS count FROM scano_task_products").get()).toEqual({ count: 0 });
    expect(testDb.prepare("SELECT COUNT(*) AS count FROM scano_task_exports").get()).toEqual({ count: 0 });
    expect(fs.existsSync(imagePath)).toBe(false);
    expect(fs.existsSync(exportPath)).toBe(false);
  });

  it("lets team leads delete visible Scano tasks and blocks scanners", async () => {
    insertTeamMember({ id: 11, name: "Ali", linkedUserId: 2 });
    insertTeamMember({ id: 12, name: "Sara", linkedUserId: 4, role: "team_lead" });
    insertTask({ id: TASK_1, scheduledAt: "2026-04-10T08:00:00.000Z", status: "pending" });
    assignTask(TASK_1, 11);

    const forbiddenResponse = await fetch(`${baseUrl}/api/scano/tasks/${TASK_1}`, {
      method: "DELETE",
      headers: {
        "x-role": "user",
        "x-user-id": "2",
        "x-scano-role": "scanner",
      },
    });
    expect(forbiddenResponse.status).toBe(403);

    const allowedResponse = await fetch(`${baseUrl}/api/scano/tasks/${TASK_1}`, {
      method: "DELETE",
      headers: {
        "x-role": "user",
        "x-user-id": "4",
        "x-scano-role": "team_lead",
      },
    });
    expect(allowedResponse.status).toBe(200);
    expect(testDb.prepare("SELECT COUNT(*) AS count FROM scano_tasks WHERE id = ?").get(TASK_1)).toEqual({ count: 0 });
  });

  it("allows scanners to resume active tasks until all assignees finish", async () => {
    insertTeamMember({ id: 11, name: "Ali", linkedUserId: 2 });
    insertTeamMember({ id: 12, name: "Mona", linkedUserId: 3 });
    insertTask({ id: TASK_1, scheduledAt: "2026-04-10T08:00:00.000Z", status: "pending" });
    assignTask(TASK_1, 11);
    assignTask(TASK_1, 12);

    const startResponse = await fetch(`${baseUrl}/api/scano/tasks/${TASK_1}/start`, {
      method: "POST",
      headers: {
        "x-role": "user",
        "x-user-id": "2",
        "x-scano-role": "scanner",
      },
    });
    expect(startResponse.status).toBe(200);

    const endResponse = await fetch(`${baseUrl}/api/scano/tasks/${TASK_1}/end`, {
      method: "POST",
      headers: {
        "x-role": "user",
        "x-user-id": "2",
        "x-scano-role": "scanner",
      },
    });
    const endedBody = await endResponse.json();
    expect(endResponse.status).toBe(200);
    expect(endedBody.item).toMatchObject({
      status: "in_progress",
      progress: {
        startedCount: 1,
        endedCount: 1,
        totalCount: 2,
      },
    });

    const resumeResponse = await fetch(`${baseUrl}/api/scano/tasks/${TASK_1}/resume`, {
      method: "POST",
      headers: {
        "x-role": "user",
        "x-user-id": "2",
        "x-scano-role": "scanner",
      },
    });
    const resumedBody = await resumeResponse.json();
    expect(resumeResponse.status).toBe(200);
    expect(resumedBody.item.viewerState).toMatchObject({
      hasStarted: true,
      hasEnded: false,
      canEnd: true,
      canResume: false,
    });
  });

  it("moves tasks to awaiting review after every assigned scanner ends, then requires export confirmation before completion", async () => {
    insertTeamMember({ id: 11, name: "Ali", linkedUserId: 2 });
    insertTeamMember({ id: 12, name: "Mona", linkedUserId: 3 });
    insertTask({ id: TASK_1, scheduledAt: "2026-04-10T08:00:00.000Z", status: "pending" });
    assignTask(TASK_1, 11);
    assignTask(TASK_1, 12);

    await fetch(`${baseUrl}/api/scano/tasks/${TASK_1}/start`, {
      method: "POST",
      headers: { "x-role": "user", "x-user-id": "2", "x-scano-role": "scanner" },
    });
    await fetch(`${baseUrl}/api/scano/tasks/${TASK_1}/start`, {
      method: "POST",
      headers: { "x-role": "user", "x-user-id": "3", "x-scano-role": "scanner" },
    });

    const firstEnd = await fetch(`${baseUrl}/api/scano/tasks/${TASK_1}/end`, {
      method: "POST",
      headers: { "x-role": "user", "x-user-id": "2", "x-scano-role": "scanner" },
    });
    expect(firstEnd.status).toBe(200);

    const secondEnd = await fetch(`${baseUrl}/api/scano/tasks/${TASK_1}/end`, {
      method: "POST",
      headers: { "x-role": "user", "x-user-id": "3", "x-scano-role": "scanner" },
    });
    const secondEndBody = await secondEnd.json();
    expect(secondEnd.status).toBe(200);
    expect(secondEndBody.item).toMatchObject({
      status: "awaiting_review",
      progress: {
        startedCount: 2,
        endedCount: 2,
        totalCount: 2,
      },
    });

    const blockedResume = await fetch(`${baseUrl}/api/scano/tasks/${TASK_1}/resume`, {
      method: "POST",
      headers: { "x-role": "user", "x-user-id": "2", "x-scano-role": "scanner" },
    });
    expect(blockedResume.status).toBe(409);

    const exportResponse = await fetch(`${baseUrl}/api/scano/tasks/${TASK_1}/exports`, {
      method: "POST",
      headers: {
        "x-role": "admin",
        "x-primary-admin": "true",
      },
    });
    const exportBody = await exportResponse.json();
    expect(exportResponse.status).toBe(201);
    expect(exportBody.item.requiresConfirmation).toBe(true);

    const confirmExportResponse = await fetch(`${baseUrl}/api/scano/tasks/${TASK_1}/exports/${exportBody.item.id}/confirm-download`, {
      method: "POST",
      headers: {
        "x-role": "admin",
        "x-primary-admin": "true",
      },
    });
    expect(confirmExportResponse.status).toBe(200);

    const completeResponse = await fetch(`${baseUrl}/api/scano/tasks/${TASK_1}/complete`, {
      method: "POST",
      headers: {
        "x-role": "admin",
        "x-primary-admin": "true",
      },
    });
    const completedBody = await completeResponse.json();
    expect(completeResponse.status).toBe(200);
    expect(completedBody.item.status).toBe("completed");
  });

  it("records export confirmation metadata and unlocks completion as soon as download is confirmed", async () => {
    const exportId = "11111111-1111-4111-8111-111111111111";
    insertTeamMember({ id: 11, name: "Ali", linkedUserId: 2 });
    insertTask({ id: TASK_1, scheduledAt: "2026-04-10T08:00:00.000Z", status: "awaiting_review" });

    const productDir = path.join(TEST_SCANO_STORAGE_DIR, "product-images", TASK_1, "product-1");
    const exportsDir = path.join(TEST_SCANO_STORAGE_DIR, "exports", TASK_1);
    fs.mkdirSync(productDir, { recursive: true });
    fs.mkdirSync(exportsDir, { recursive: true });

    const imagePath = path.join(productDir, "SKU-1.png");
    const exportPath = path.join(exportsDir, "review.zip");
    fs.writeFileSync(imagePath, TINY_PNG_BYTES);
    fs.writeFileSync(exportPath, Buffer.from("zip-data"));

    insertTaskProductRecord({
      productId: "product-1",
      taskId: TASK_1,
      teamMemberId: 11,
      barcode: "99887766",
      sku: "SKU-1",
      itemNameEn: "Imported Product",
    });
    insertTaskProductImageRecord({
      imageId: "image-1",
      productId: "product-1",
      fileName: "SKU-1.png",
      filePath: imagePath,
    });
    testDb.prepare(`
      INSERT INTO scano_task_exports (id, taskId, fileName, filePath, createdAt, confirmedDownloadAt, imagesPurgedAt)
      VALUES (?, ?, 'review.zip', ?, '2026-04-04T12:00:00.000Z', NULL, NULL)
    `).run(exportId, TASK_1, exportPath);

    const response = await fetch(`${baseUrl}/api/scano/tasks/${TASK_1}/exports/${exportId}/confirm-download`, {
      method: "POST",
      headers: {
        "x-role": "admin",
        "x-primary-admin": "true",
      },
    });
    const body = await response.json();
    const exportRow = testDb.prepare(`
      SELECT confirmedDownloadAt, imagesPurgedAt
      FROM scano_task_exports
      WHERE id = ?
    `).get(exportId) as { confirmedDownloadAt: string | null; imagesPurgedAt: string | null };

    expect(response.status).toBe(200);
    expect(body.item).toMatchObject({
      id: exportId,
      requiresConfirmation: false,
    });
    expect(body.item.confirmedDownloadAt).toEqual(expect.any(String));
    expect(body.item.imagesPurgedAt).toEqual(expect.any(String));
    expect(body.task.permissions.canComplete).toBe(true);
    expect(exportRow.confirmedDownloadAt).toEqual(expect.any(String));
    expect(exportRow.imagesPurgedAt).toEqual(expect.any(String));
  });

  it("exports only the latest row for each sku", async () => {
    insertTeamMember({ id: 11, name: "Ali", linkedUserId: 2 });
    insertTask({ id: TASK_1, scheduledAt: "2026-04-10T08:00:00.000Z", status: "awaiting_review" });
    insertTaskProductRecord({
      productId: "product-old",
      taskId: TASK_1,
      teamMemberId: 11,
      barcode: "1111111111111",
      sku: "SKU-DUPLICATE",
      price: "10",
      itemNameEn: "Old Export Name",
      confirmedAt: "2026-04-04T11:30:00.000Z",
      updatedAt: "2026-04-04T11:30:00.000Z",
    });
    insertTaskProductRecord({
      productId: "product-new",
      taskId: TASK_1,
      teamMemberId: 11,
      barcode: "2222222222222",
      sku: "sku-duplicate",
      price: "25",
      itemNameEn: "Latest Export Name",
      confirmedAt: "2026-04-04T12:30:00.000Z",
      updatedAt: "2026-04-04T12:30:00.000Z",
    });

    const exportResponse = await fetch(`${baseUrl}/api/scano/tasks/${TASK_1}/exports`, {
      method: "POST",
      headers: {
        "x-role": "admin",
        "x-primary-admin": "true",
      },
    });
    const exportBody = await exportResponse.json();

    expect(exportResponse.status).toBe(201);

    const exportRecord = testDb.prepare<[string], { filePath: string }>(`
      SELECT filePath
      FROM scano_task_exports
      WHERE id = ?
    `).get(exportBody.item.id);
    expect(exportRecord).not.toBeUndefined();

    const zipFile = await JSZip.loadAsync(fs.readFileSync(exportRecord!.filePath));
    const workbookFile = zipFile.file(`task-${TASK_1}.xlsx`);
    expect(workbookFile).not.toBeNull();

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(await workbookFile!.async("nodebuffer"));

    const worksheet = workbook.getWorksheet("Scano Review");
    expect(worksheet).toBeDefined();

    const dataRows = Array.from({ length: Math.max((worksheet?.rowCount ?? 1) - 1, 0) }, (_, index) => worksheet!.getRow(index + 2))
      .filter((row) => row.getCell(2).text.trim().length > 0);

    expect(dataRows).toHaveLength(1);
    expect(dataRows[0]?.getCell(2).text).toBe("sku-duplicate");
    expect(dataRows[0]?.getCell(3).text).toBe("25");
    expect(dataRows[0]?.getCell(4).text).toBe("2222222222222");
    expect(dataRows[0]?.getCell(5).text).toBe("2222222222222");
    expect(dataRows[0]?.getCell(6).text).toBe("Latest Export Name");
  });

  it("lets task managers update assignees during active tasks but blocks removing scanners who already started", async () => {
    insertTeamMember({ id: 11, name: "Ali", linkedUserId: 2 });
    insertTeamMember({ id: 12, name: "Mona", linkedUserId: 3 });
    insertTeamMember({ id: 13, name: "Omar", linkedUserId: 4 });
    insertTask({ id: TASK_1, scheduledAt: "2026-04-10T08:00:00.000Z", status: "in_progress", startedByUserId: 2, startedByTeamMemberId: 11 });
    assignTask(TASK_1, 11);
    assignTask(TASK_1, 12);
    insertParticipant({ taskId: TASK_1, teamMemberId: 11 });

    const rejectedResponse = await fetch(`${baseUrl}/api/scano/tasks/${TASK_1}/assignees`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        "x-role": "admin",
        "x-primary-admin": "true",
      },
      body: JSON.stringify({
        assigneeIds: [12],
      }),
    });
    expect(rejectedResponse.status).toBe(409);

    const allowedResponse = await fetch(`${baseUrl}/api/scano/tasks/${TASK_1}/assignees`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        "x-role": "user",
        "x-user-id": "4",
        "x-scano-role": "team_lead",
      },
      body: JSON.stringify({
        assigneeIds: [11, 13],
      }),
    });
    const allowedBody = await allowedResponse.json();
    expect(allowedResponse.status).toBe(200);
    expect(allowedBody.item.assignees).toEqual([
      {
        id: 11,
        name: "Ali",
        linkedUserId: 2,
      },
      {
        id: 13,
        name: "Omar",
        linkedUserId: 4,
      },
    ]);
  });

  it("returns task details and resolves barcode scans for assigned scanners only", async () => {
    insertTeamMember({ id: 11, name: "Ali", linkedUserId: 2 });
    insertTeamMember({ id: 12, name: "Mona", linkedUserId: 3 });
    insertTask({ id: TASK_1, scheduledAt: "2026-04-10T08:00:00.000Z", status: "in_progress", startedByUserId: 2, startedByTeamMemberId: 11 });
    assignTask(TASK_1, 11);
    assignTask(TASK_1, 12);
    insertParticipant({ taskId: TASK_1, teamMemberId: 11 });
    insertScan({ taskId: TASK_1, teamMemberId: 11, barcode: "1234567890" });

    const detailResponse = await fetch(`${baseUrl}/api/scano/tasks/${TASK_1}`, {
      headers: {
        "x-role": "user",
        "x-user-id": "2",
        "x-scano-role": "scanner",
      },
    });
    const detailBody = await detailResponse.json();
    expect(detailResponse.status).toBe(200);
    expect(detailBody.item).toMatchObject({
      id: TASK_1,
      counters: {
        scannedProductsCount: 0,
      },
    });
    const scansResponse = await fetch(`${baseUrl}/api/scano/tasks/${TASK_1}/scans?page=1&pageSize=10`, {
      headers: {
        "x-role": "user",
        "x-user-id": "2",
        "x-scano-role": "scanner",
      },
    });
    const scansBody = await scansResponse.json();
    expect(scansResponse.status).toBe(200);
    expect(scansBody.items).toHaveLength(1);
    expect(scansBody.total).toBe(1);

    const createScanResponse = await fetch(`${baseUrl}/api/scano/tasks/${TASK_1}/scans/resolve`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-role": "user",
        "x-user-id": "2",
        "x-scano-role": "scanner",
      },
      body: JSON.stringify({
        barcode: "99887766",
        source: "manual",
      }),
    });
    const createdScanBody = await createScanResponse.json();
    expect(createScanResponse.status).toBe(200);
    expect(createdScanBody.kind).toBe("draft");
    expect(createdScanBody.draft).toMatchObject({
      barcode: "99887766",
    });

    const productsResponse = await fetch(`${baseUrl}/api/scano/tasks/${TASK_1}/products?page=1&pageSize=10`, {
      headers: {
        "x-role": "user",
        "x-user-id": "2",
        "x-scano-role": "scanner",
      },
    });
    const productsBody = await productsResponse.json();
    expect(productsResponse.status).toBe(200);
    expect(productsBody.items).toEqual([]);
    expect(productsBody.total).toBe(0);

    const forbiddenResponse = await fetch(`${baseUrl}/api/scano/tasks/${TASK_1}/scans/resolve`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-role": "user",
        "x-user-id": "4",
        "x-scano-role": "team_lead",
      },
      body: JSON.stringify({
        barcode: "1122",
        source: "manual",
      }),
    });
    expect(forbiddenResponse.status).toBe(403);
  });

  it("returns a selection payload without hydrating image galleries when multiple external matches are found", async () => {
    insertTeamMember({ id: 11, name: "Ali", linkedUserId: 2 });
    insertTask({ id: TASK_1, scheduledAt: "2026-04-10T08:00:00.000Z", status: "in_progress", startedByUserId: 2, startedByTeamMemberId: 11 });
    assignTask(TASK_1, 11);
    insertParticipant({ taskId: TASK_1, teamMemberId: 11 });

    mockSearchScanoProductsByBarcode.mockResolvedValue([
      {
        id: "QAR4F19C",
        barcode: "99887766",
        barcodes: ["99887766"],
        itemNameEn: "Imported Product A",
        itemNameAr: "منتج أول",
        image: "https://images.example.com/product-a.jpg",
      },
      {
        id: "QAR4F19D",
        barcode: "99887766",
        barcodes: ["99887766"],
        itemNameEn: "Imported Product B",
        itemNameAr: "منتج ثاني",
        image: "https://images.example.com/product-b.jpg",
      },
    ]);

    const response = await fetch(`${baseUrl}/api/scano/tasks/${TASK_1}/scans/resolve`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-role": "user",
        "x-user-id": "2",
        "x-scano-role": "scanner",
      },
      body: JSON.stringify({
        barcode: "99887766",
        source: "manual",
      }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      kind: "selection",
      items: [
        expect.objectContaining({ id: "QAR4F19C" }),
        expect.objectContaining({ id: "QAR4F19D" }),
      ],
    });
    expect(mockGetScanoProductDetail).not.toHaveBeenCalled();
  });

  it("prefers the local enriched cache before external search during scan resolution", async () => {
    insertTeamMember({ id: 11, name: "Ali", linkedUserId: 2 });
    insertMasterProduct({
      chainId: 1037,
      chainName: "Carrefour",
      productCount: 1,
      enrichedCount: 1,
      processedCount: 1,
    });
    const entryId = insertMasterProductEnrichmentEntry({
      chainId: 1037,
      rowNumber: 1,
      sourceBarcode: "44556677",
      externalProductId: "LOCAL-1",
      sku: "SKU-LOCAL",
      price: "55",
      itemNameEn: "Local Cached Product",
      image: "https://images.example.com/local.jpg",
      chainFlag: "yes",
      vendorFlag: "yes",
    });
    insertMasterProductEnrichmentBarcode({
      entryId,
      chainId: 1037,
      barcode: "44556677",
    });
    insertTask({ id: TASK_1, scheduledAt: "2026-04-10T08:00:00.000Z", status: "in_progress", startedByUserId: 2, startedByTeamMemberId: 11 });
    assignTask(TASK_1, 11);
    insertParticipant({ taskId: TASK_1, teamMemberId: 11 });

    const response = await fetch(`${baseUrl}/api/scano/tasks/${TASK_1}/scans/resolve`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-role": "user",
        "x-user-id": "2",
        "x-scano-role": "scanner",
      },
      body: JSON.stringify({
        barcode: "44556677",
        source: "manual",
      }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      kind: "draft",
      draft: {
        externalProductId: "LOCAL-1",
        sku: "SKU-LOCAL",
        price: "55",
        itemNameEn: "Local Cached Product",
        chain: "yes",
        vendor: "yes",
        masterfile: "no",
        sourceType: "vendor",
      },
    });
    expect(mockSearchScanoProductsByBarcode).not.toHaveBeenCalled();
  });

  it("falls back to the raw master file after external search misses", async () => {
    insertTeamMember({ id: 11, name: "Ali", linkedUserId: 2 });
    insertMasterProduct({ chainId: 1037, chainName: "Carrefour", productCount: 1 });
    insertMasterProductRow({
      chainId: 1037,
      rowNumber: 1,
      sku: "MASTER-1",
      barcode: "77889900",
      price: "41",
      itemNameEn: "Master Fallback Product",
      itemNameAr: "منتج بديل",
      image: "https://images.example.com/master-fallback.jpg",
    });
    insertTask({ id: TASK_1, scheduledAt: "2026-04-10T08:00:00.000Z", status: "in_progress", startedByUserId: 2, startedByTeamMemberId: 11 });
    assignTask(TASK_1, 11);
    insertParticipant({ taskId: TASK_1, teamMemberId: 11 });
    mockSearchScanoProductsByBarcode.mockResolvedValueOnce([]);

    const response = await fetch(`${baseUrl}/api/scano/tasks/${TASK_1}/scans/resolve`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-role": "user",
        "x-user-id": "2",
        "x-scano-role": "scanner",
      },
      body: JSON.stringify({
        barcode: "77889900",
        source: "manual",
      }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      kind: "draft",
      draft: {
        externalProductId: null,
        sku: "MASTER-1",
        price: "41",
        itemNameEn: "Master Fallback Product",
        masterfile: "yes",
        sourceType: "master",
      },
    });
    expect(mockSearchScanoProductsByBarcode).toHaveBeenCalledTimes(1);
  });

  it("builds external drafts with every available detail image during review", async () => {
    insertTeamMember({ id: 11, name: "Ali", linkedUserId: 2 });
    insertTask({ id: TASK_1, scheduledAt: "2026-04-10T08:00:00.000Z", status: "in_progress", startedByUserId: 2, startedByTeamMemberId: 11 });
    assignTask(TASK_1, 11);
    insertParticipant({ taskId: TASK_1, teamMemberId: 11 });

    mockSearchScanoProductsByBarcode.mockResolvedValue([
      {
        id: "QAR4F19C",
        barcode: "99887766",
        barcodes: ["99887766", "998877660001"],
        itemNameEn: "Imported Product",
        itemNameAr: "منتج مستورد",
        image: "https://images.example.com/product.jpg",
      },
    ]);
    mockGetScanoProductDetail.mockResolvedValue({
      id: "QAR4F19C",
      sku: "SKU-1",
      price: "100",
      barcode: "99887766",
      barcodes: ["99887766", "998877660001"],
      itemNameEn: "Imported Product",
      itemNameAr: "منتج مستورد",
      images: [
        "https://images.example.com/product-1.jpg",
        "https://images.example.com/product-2.jpg",
        "https://images.example.com/product-3.jpg",
      ],
    });

    const response = await fetch(`${baseUrl}/api/scano/tasks/${TASK_1}/scans/resolve`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-role": "user",
        "x-user-id": "2",
        "x-scano-role": "scanner",
      },
      body: JSON.stringify({
        barcode: "99887766",
        source: "manual",
      }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.kind).toBe("draft");
    expect(body.draft).toMatchObject({
      externalProductId: "QAR4F19C",
      barcode: "99887766",
      barcodes: ["99887766", "998877660001"],
      itemNameEn: "Imported Product",
      itemNameAr: "منتج مستورد",
      previewImageUrl: "https://images.example.com/product-1.jpg",
      images: [
        "https://images.example.com/product-1.jpg",
        "https://images.example.com/product-2.jpg",
        "https://images.example.com/product-3.jpg",
      ],
      sku: "SKU-1",
      price: "100",
      chain: "yes",
      vendor: "yes",
      sourceType: "vendor",
    });
    expect(mockGetScanoProductDetail).toHaveBeenCalledWith({
      productId: "QAR4F19C",
      globalEntityId: "TB_EG",
    });
    expect(mockGetScanoProductAssignmentCheck).toHaveBeenCalledWith({
      productId: "QAR4F19C",
      chainId: 1037,
      vendorId: 4594,
    });
  });

  it("uses catalog barcodes in external drafts instead of the scanned lookup value", async () => {
    insertTeamMember({ id: 11, name: "Ali", linkedUserId: 2 });
    insertTask({ id: TASK_1, scheduledAt: "2026-04-10T08:00:00.000Z", status: "in_progress", startedByUserId: 2, startedByTeamMemberId: 11 });
    assignTask(TASK_1, 11);
    insertParticipant({ taskId: TASK_1, teamMemberId: 11 });

    mockSearchScanoProductsByBarcode.mockResolvedValue([
      {
        id: "QAR4F19C",
        barcode: "06223001363019",
        barcodes: ["06223001363019", "998877660001"],
        itemNameEn: "Imported Product",
        itemNameAr: "منتج مستورد",
        image: "https://images.example.com/product.jpg",
      },
    ]);
    mockGetScanoProductDetail.mockResolvedValue({
      id: "QAR4F19C",
      sku: "SKU-1",
      price: "100",
      barcode: "06223001363019",
      barcodes: ["06223001363019", "998877660001"],
      itemNameEn: "Imported Product",
      itemNameAr: "منتج مستورد",
      images: ["https://images.example.com/product-1.jpg"],
    });

    const response = await fetch(`${baseUrl}/api/scano/tasks/${TASK_1}/scans/resolve`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-role": "user",
        "x-user-id": "2",
        "x-scano-role": "scanner",
      },
      body: JSON.stringify({
        barcode: "6223001363019",
        source: "manual",
      }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.kind).toBe("draft");
    expect(body.draft).toMatchObject({
      externalProductId: "QAR4F19C",
      barcode: "06223001363019",
      barcodes: ["06223001363019", "998877660001"],
    });
  });

  it("falls back to the search preview when external detail image hydration fails", async () => {
    insertTeamMember({ id: 11, name: "Ali", linkedUserId: 2 });
    insertTask({ id: TASK_1, scheduledAt: "2026-04-10T08:00:00.000Z", status: "in_progress", startedByUserId: 2, startedByTeamMemberId: 11 });
    assignTask(TASK_1, 11);
    insertParticipant({ taskId: TASK_1, teamMemberId: 11 });

    mockSearchScanoProductsByBarcode.mockResolvedValue([
      {
        id: "QAR4F19C",
        barcode: "99887766",
        barcodes: ["99887766", "998877660001"],
        itemNameEn: "Imported Product",
        itemNameAr: "منتج مستورد",
        image: "https://images.example.com/product.jpg",
      },
    ]);
    mockGetScanoProductDetail.mockRejectedValue(new Error("detail lookup failed"));

    const response = await fetch(`${baseUrl}/api/scano/tasks/${TASK_1}/scans/resolve`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-role": "user",
        "x-user-id": "2",
        "x-scano-role": "scanner",
      },
      body: JSON.stringify({
        barcode: "99887766",
        source: "manual",
      }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.kind).toBe("draft");
    expect(body.draft).toMatchObject({
      externalProductId: "QAR4F19C",
      previewImageUrl: "https://images.example.com/product.jpg",
      images: [],
      sku: "SKU-1",
      price: "100",
    });
    expect(mockGetScanoProductDetail).toHaveBeenCalledWith({
      productId: "QAR4F19C",
      globalEntityId: "TB_EG",
    });
  });

  it("returns duplicate resolve payloads with editable existing products and logs duplicate_blocked scans", async () => {
    insertTeamMember({ id: 11, name: "Ali", linkedUserId: 2 });
    insertTeamMember({ id: 12, name: "Mona", linkedUserId: 3 });
    insertTask({ id: TASK_1, scheduledAt: "2026-04-10T08:00:00.000Z", status: "in_progress", startedByUserId: 2, startedByTeamMemberId: 11 });
    assignTask(TASK_1, 11);
    assignTask(TASK_1, 12);
    insertParticipant({ taskId: TASK_1, teamMemberId: 11 });
    insertParticipant({ taskId: TASK_1, teamMemberId: 12 });

    const createResponse = await fetch(`${baseUrl}/api/scano/tasks/${TASK_1}/products`, {
      method: "POST",
      headers: {
        "x-role": "user",
        "x-user-id": "2",
        "x-scano-role": "scanner",
      },
      body: createProductFormData({
        externalProductId: "QAR4F19C",
        barcode: "123456789",
        barcodes: ["123456789"],
        sku: "SKU-1",
        price: "100",
        itemNameEn: "Imported Product",
        itemNameAr: null,
        sourceMeta: {
          sourceType: "vendor",
          chain: "yes",
          vendor: "yes",
          masterfile: "no",
          new: "no",
        },
        imageUrls: ["https://images.example.com/product.jpg"],
      }),
    });
    const createBody = await createResponse.json();
    expect(createResponse.status).toBe(201);

    const duplicateResponse = await fetch(`${baseUrl}/api/scano/tasks/${TASK_1}/scans/resolve`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-role": "user",
        "x-user-id": "3",
        "x-scano-role": "scanner",
      },
      body: JSON.stringify({
        barcode: "123456789",
        source: "manual",
      }),
    });
    const duplicateBody = await duplicateResponse.json();

    expect(duplicateResponse.status).toBe(200);
    expect(duplicateBody).toMatchObject({
      kind: "duplicate",
      message: "This barcode was already scanned before.",
      existingProduct: {
        id: createBody.item.id,
        barcode: "123456789",
        canEdit: true,
      },
      existingScannerName: "Ali",
      rawScan: {
        outcome: "duplicate_blocked",
        barcode: "123456789",
        taskProductId: createBody.item.id,
      },
    });

    const scansResponse = await fetch(`${baseUrl}/api/scano/tasks/${TASK_1}/scans?page=1&pageSize=10`, {
      headers: {
        "x-role": "user",
        "x-user-id": "3",
        "x-scano-role": "scanner",
      },
    });
    const scansBody = await scansResponse.json();

    expect(scansResponse.status).toBe(200);
    expect(scansBody.items).toEqual(expect.arrayContaining([
      expect.objectContaining({
        outcome: "duplicate_blocked",
        barcode: "123456789",
        scannedBy: expect.objectContaining({
          name: "Mona",
          linkedUserId: 3,
        }),
      }),
    ]));
  });

  it("blocks duplicate scans when the stored product barcode is the zero-padded 14-digit variant", async () => {
    insertTeamMember({ id: 11, name: "Ali", linkedUserId: 2 });
    insertTeamMember({ id: 12, name: "Mona", linkedUserId: 3 });
    insertTask({ id: TASK_1, scheduledAt: "2026-04-10T08:00:00.000Z", status: "in_progress", startedByUserId: 2, startedByTeamMemberId: 11 });
    assignTask(TASK_1, 11);
    assignTask(TASK_1, 12);
    insertParticipant({ taskId: TASK_1, teamMemberId: 11 });
    insertParticipant({ taskId: TASK_1, teamMemberId: 12 });

    const createResponse = await fetch(`${baseUrl}/api/scano/tasks/${TASK_1}/products`, {
      method: "POST",
      headers: {
        "x-role": "user",
        "x-user-id": "2",
        "x-scano-role": "scanner",
      },
      body: createProductFormData({
        externalProductId: "QAR4F19C",
        barcode: "06223001363019",
        barcodes: ["06223001363019"],
        sku: "SKU-1",
        price: "100",
        itemNameEn: "Imported Product",
        itemNameAr: null,
        sourceMeta: {
          sourceType: "vendor",
          chain: "yes",
          vendor: "yes",
          masterfile: "no",
          new: "no",
        },
        imageUrls: ["https://images.example.com/product.jpg"],
      }),
    });
    const createBody = await createResponse.json();
    expect(createResponse.status).toBe(201);

    const duplicateResponse = await fetch(`${baseUrl}/api/scano/tasks/${TASK_1}/scans/resolve`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-role": "user",
        "x-user-id": "3",
        "x-scano-role": "scanner",
      },
      body: JSON.stringify({
        barcode: "6223001363019",
        source: "manual",
      }),
    });
    const duplicateBody = await duplicateResponse.json();

    expect(duplicateResponse.status).toBe(200);
    expect(duplicateBody).toMatchObject({
      kind: "duplicate",
      existingProduct: {
        id: createBody.item.id,
        barcode: "06223001363019",
      },
      rawScan: {
        outcome: "duplicate_blocked",
        barcode: "6223001363019",
        taskProductId: createBody.item.id,
      },
    });
  });

  it("lets any assigned scanner edit in-progress products, reports canEdit consistently, and records the actual editor", async () => {
    insertTeamMember({ id: 11, name: "Ali", linkedUserId: 2 });
    insertTeamMember({ id: 12, name: "Mona", linkedUserId: 3 });
    insertTeamMember({ id: 13, name: "Omar", linkedUserId: 4 });
    insertTask({ id: TASK_1, scheduledAt: "2026-04-10T08:00:00.000Z", status: "in_progress", startedByUserId: 2, startedByTeamMemberId: 11 });
    assignTask(TASK_1, 11);
    assignTask(TASK_1, 12);
    insertParticipant({ taskId: TASK_1, teamMemberId: 11 });
    insertParticipant({ taskId: TASK_1, teamMemberId: 12 });

    const createResponse = await fetch(`${baseUrl}/api/scano/tasks/${TASK_1}/products`, {
      method: "POST",
      headers: {
        "x-role": "user",
        "x-user-id": "2",
        "x-scano-role": "scanner",
      },
      body: createProductFormData({
        externalProductId: "QAR4F19C",
        barcode: "123456789",
        barcodes: ["123456789"],
        sku: "SKU-1",
        price: "100",
        itemNameEn: "Imported Product",
        itemNameAr: null,
        sourceMeta: {
          sourceType: "vendor",
          chain: "yes",
          vendor: "yes",
          masterfile: "no",
          new: "no",
        },
        imageUrls: ["https://images.example.com/product.jpg"],
      }),
    });
    const createBody = await createResponse.json();
    expect(createResponse.status).toBe(201);
    const createdSnapshotRow = testDb.prepare<[string], { resolvedProductJson: string }>(`
      SELECT resolvedProductJson
      FROM scano_task_scans
      WHERE taskProductId = ?
      ORDER BY id ASC
      LIMIT 1
    `).get(createBody.item.id);
    expect(createdSnapshotRow?.resolvedProductJson).toEqual(expect.any(String));

    const bootstrapResponse = await fetch(`${baseUrl}/api/scano/tasks/${TASK_1}/runner/bootstrap`, {
      headers: {
        "x-role": "user",
        "x-user-id": "3",
        "x-scano-role": "scanner",
      },
    });
    const bootstrapBody = await bootstrapResponse.json();
    expect(bootstrapResponse.status).toBe(200);
    expect(bootstrapBody.item.confirmedProducts[0]).toMatchObject({
      id: createBody.item.id,
      canEdit: true,
    });

    const listResponse = await fetch(`${baseUrl}/api/scano/tasks/${TASK_1}/products?page=1&pageSize=10`, {
      headers: {
        "x-role": "user",
        "x-user-id": "3",
        "x-scano-role": "scanner",
      },
    });
    const listBody = await listResponse.json();
    expect(listResponse.status).toBe(200);
    expect(listBody.items[0]).toMatchObject({
      id: createBody.item.id,
      canEdit: true,
    });

    const detailResponse = await fetch(`${baseUrl}/api/scano/tasks/${TASK_1}/products/${createBody.item.id}`, {
      headers: {
        "x-role": "user",
        "x-user-id": "3",
        "x-scano-role": "scanner",
      },
    });
    const detailBody = await detailResponse.json();
    expect(detailResponse.status).toBe(200);
    expect(detailBody.item).toMatchObject({
      id: createBody.item.id,
      canEdit: true,
    });

    const updateResponse = await fetch(`${baseUrl}/api/scano/tasks/${TASK_1}/products/${createBody.item.id}`, {
      method: "PATCH",
      headers: {
        "x-role": "user",
        "x-user-id": "3",
        "x-scano-role": "scanner",
      },
      body: createProductFormData({
        externalProductId: "QAR4F19C",
        barcode: "123456789",
        barcodes: ["123456789", "987654321"],
        sku: "SKU-UPDATED",
        price: "125",
        itemNameEn: "Imported Product Updated",
        itemNameAr: null,
        sourceMeta: {
          sourceType: "manual",
          chain: "no",
          vendor: "no",
          masterfile: "no",
          new: "yes",
        },
        imageUrls: ["https://images.example.com/product.jpg"],
      }),
    });
    const updateBody = await updateResponse.json();

    expect(updateResponse.status).toBe(200);
    expect(updateBody.item).toMatchObject({
      id: createBody.item.id,
      sku: "SKU-UPDATED",
      itemNameEn: "Imported Product Updated",
      canEdit: true,
    });
    expect(updateBody.item.edits[0]).toMatchObject({
      editedBy: {
        name: "Mona",
        linkedUserId: 3,
      },
      before: {
        sku: "SKU-1",
      },
      after: {
        sku: "SKU-UPDATED",
      },
    });

    const updatedDetailResponse = await fetch(`${baseUrl}/api/scano/tasks/${TASK_1}/products/${createBody.item.id}`, {
      headers: {
        "x-role": "user",
        "x-user-id": "3",
        "x-scano-role": "scanner",
      },
    });
    const updatedDetailBody = await updatedDetailResponse.json();
    expect(updatedDetailResponse.status).toBe(200);
    expect(updatedDetailBody.item).toMatchObject({
      id: createBody.item.id,
      canEdit: true,
      edited: true,
      edits: [
        expect.objectContaining({
          editedBy: expect.objectContaining({
            name: "Mona",
            linkedUserId: 3,
          }),
        }),
      ],
    });
    expect(testDb.prepare<[string], { resolvedProductJson: string }>(`
      SELECT resolvedProductJson
      FROM scano_task_scans
      WHERE taskProductId = ?
      ORDER BY id ASC
      LIMIT 1
    `).get(createBody.item.id)?.resolvedProductJson).toBe(createdSnapshotRow?.resolvedProductJson);

    const forbiddenUpdateResponse = await fetch(`${baseUrl}/api/scano/tasks/${TASK_1}/products/${createBody.item.id}`, {
      method: "PATCH",
      headers: {
        "x-role": "user",
        "x-user-id": "4",
        "x-scano-role": "scanner",
      },
      body: createProductFormData({
        externalProductId: "QAR4F19C",
        barcode: "123456789",
        barcodes: ["123456789"],
        sku: "SKU-FORBIDDEN",
        price: "100",
        itemNameEn: "Forbidden Update",
        itemNameAr: null,
        sourceMeta: {
          sourceType: "vendor",
          chain: "yes",
          vendor: "yes",
          masterfile: "no",
          new: "no",
        },
        imageUrls: ["https://images.example.com/product.jpg"],
      }),
    });

    expect(forbiddenUpdateResponse.status).toBe(403);
  });

  it("requires price and image for master/manual products before confirmation and edit", async () => {
    insertTeamMember({ id: 11, name: "Ali", linkedUserId: 2 });
    insertTask({ id: TASK_1, scheduledAt: "2026-04-10T08:00:00.000Z", status: "in_progress", startedByUserId: 2, startedByTeamMemberId: 11 });
    assignTask(TASK_1, 11);
    insertParticipant({ taskId: TASK_1, teamMemberId: 11 });

    const masterMissingImageResponse = await fetch(`${baseUrl}/api/scano/tasks/${TASK_1}/products`, {
      method: "POST",
      headers: {
        "x-role": "user",
        "x-user-id": "2",
        "x-scano-role": "scanner",
      },
      body: createProductFormData({
        externalProductId: null,
        barcode: "44556677",
        barcodes: ["44556677"],
        sku: "MASTER-1",
        price: "44",
        itemNameEn: "Master Product",
        itemNameAr: null,
        sourceMeta: {
          sourceType: "master",
          chain: "no",
          vendor: "no",
          masterfile: "yes",
          new: "no",
        },
      }),
    });
    const masterMissingImageBody = await masterMissingImageResponse.json();
    expect(masterMissingImageResponse.status).toBe(400);
    expect(masterMissingImageBody.message).toBe("Master products require at least one image.");

    const masterMissingPriceResponse = await fetch(`${baseUrl}/api/scano/tasks/${TASK_1}/products`, {
      method: "POST",
      headers: {
        "x-role": "user",
        "x-user-id": "2",
        "x-scano-role": "scanner",
      },
      body: createProductFormData({
        externalProductId: null,
        barcode: "44556678",
        barcodes: ["44556678"],
        sku: "MASTER-2",
        price: null,
        itemNameEn: "Master Product 2",
        itemNameAr: null,
        sourceMeta: {
          sourceType: "master",
          chain: "no",
          vendor: "no",
          masterfile: "yes",
          new: "no",
        },
        imageUrls: ["https://images.example.com/master.jpg"],
      }),
    });
    const masterMissingPriceBody = await masterMissingPriceResponse.json();
    expect(masterMissingPriceResponse.status).toBe(400);
    expect(masterMissingPriceBody.message).toBe("Master products require a price.");

    const manualMissingPriceForm = createProductFormData({
      externalProductId: null,
      barcode: "22334455",
      barcodes: ["22334455"],
      sku: "MANUAL-1",
      price: null,
      itemNameEn: "Manual Product",
      itemNameAr: null,
      sourceMeta: {
        sourceType: "manual",
        chain: "no",
        vendor: "no",
        masterfile: "no",
        new: "yes",
      },
    });
    manualMissingPriceForm.append("images", new Blob([TINY_PNG_BYTES], { type: "image/png" }), "manual.png");

    const manualMissingPriceResponse = await fetch(`${baseUrl}/api/scano/tasks/${TASK_1}/products`, {
      method: "POST",
      headers: {
        "x-role": "user",
        "x-user-id": "2",
        "x-scano-role": "scanner",
      },
      body: manualMissingPriceForm,
    });
    const manualMissingPriceBody = await manualMissingPriceResponse.json();
    expect(manualMissingPriceResponse.status).toBe(400);
    expect(manualMissingPriceBody.message).toBe("Manual products require a price.");

    const validManualForm = createProductFormData({
      externalProductId: null,
      barcode: "22334456",
      barcodes: ["22334456"],
      sku: "MANUAL-2",
      price: "55",
      itemNameEn: "Manual Product Valid",
      itemNameAr: null,
      sourceMeta: {
        sourceType: "manual",
        chain: "no",
        vendor: "no",
        masterfile: "no",
        new: "yes",
      },
    });
    validManualForm.append("images", new Blob([TINY_PNG_BYTES], { type: "image/png" }), "manual-valid.png");

    const validManualResponse = await fetch(`${baseUrl}/api/scano/tasks/${TASK_1}/products`, {
      method: "POST",
      headers: {
        "x-role": "user",
        "x-user-id": "2",
        "x-scano-role": "scanner",
      },
      body: validManualForm,
    });
    const validManualBody = await validManualResponse.json();
    expect(validManualResponse.status).toBe(201);

    const updateMissingPriceResponse = await fetch(`${baseUrl}/api/scano/tasks/${TASK_1}/products/${validManualBody.item.id}`, {
      method: "PATCH",
      headers: {
        "x-role": "user",
        "x-user-id": "2",
        "x-scano-role": "scanner",
      },
      body: createProductFormData({
        externalProductId: null,
        barcode: "22334456",
        barcodes: ["22334456"],
        sku: "MANUAL-2",
        price: null,
        itemNameEn: "Manual Product Valid",
        itemNameAr: null,
        sourceMeta: {
          sourceType: "manual",
          chain: "no",
          vendor: "no",
          masterfile: "no",
          new: "yes",
        },
        existingImageIds: [validManualBody.item.images[0].id],
      }),
    });
    const updateMissingPriceBody = await updateMissingPriceResponse.json();
    expect(updateMissingPriceResponse.status).toBe(400);
    expect(updateMissingPriceBody.message).toBe("Manual products require a price.");
  });

  it("bootstraps the runner with confirmed products and the task chain master index", async () => {
    insertTeamMember({ id: 11, name: "Ali", linkedUserId: 2 });
    insertMasterProduct({ chainId: 1037, chainName: "Carrefour" });
    insertMasterProductRow({
      chainId: 1037,
      rowNumber: 1,
      sku: "MASTER-1",
      barcode: "44556677",
      price: "44",
      itemNameEn: "Master Product",
      itemNameAr: "منتج ماستر",
      image: "https://images.example.com/master.jpg",
    });
    insertTask({ id: TASK_1, scheduledAt: "2026-04-10T08:00:00.000Z", status: "in_progress", startedByUserId: 2, startedByTeamMemberId: 11 });
    assignTask(TASK_1, 11);
    insertParticipant({ taskId: TASK_1, teamMemberId: 11 });

    const createResponse = await fetch(`${baseUrl}/api/scano/tasks/${TASK_1}/products`, {
      method: "POST",
      headers: {
        "x-role": "user",
        "x-user-id": "2",
        "x-scano-role": "scanner",
      },
      body: createProductFormData({
        externalProductId: null,
        barcode: "123456789",
        barcodes: ["123456789"],
        sku: "SKU-1",
        price: "100",
        itemNameEn: "Saved Product",
        itemNameAr: null,
        sourceMeta: {
          sourceType: "master",
          chain: "no",
          vendor: "no",
          masterfile: "yes",
          new: "yes",
        },
        imageUrls: ["https://images.example.com/master-preview.jpg"],
      }),
    });
    expect(createResponse.status).toBe(201);

    const response = await fetch(`${baseUrl}/api/scano/tasks/${TASK_1}/runner/bootstrap`, {
      headers: {
        "x-role": "user",
        "x-user-id": "2",
        "x-scano-role": "scanner",
      },
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.item.runnerToken).toEqual(expect.any(String));
    expect(body.item.confirmedBarcodes).toContain("123456789");
    expect(body.item.confirmedProducts).toHaveLength(1);
    expect(body.item.confirmedProducts[0]).toMatchObject({
      barcode: "123456789",
      itemNameEn: "Saved Product",
    });
    expect(body.item.masterIndex).toEqual([
      {
        barcode: "44556677",
        sku: "MASTER-1",
        price: "44",
        itemNameEn: "Master Product",
        itemNameAr: "منتج ماستر",
        image: "https://images.example.com/master.jpg",
      },
    ]);
  });

  it("uses canonical product rows instead of stale scan snapshots for bootstrap, list, detail, image download, and duplicate detection", async () => {
    const productId = "33333333-3333-4333-8333-333333333333";
    const imageId = "44444444-4444-4444-8444-444444444444";
    insertTeamMember({ id: 11, name: "Ali", linkedUserId: 2 });
    insertTask({ id: TASK_1, scheduledAt: "2026-04-10T08:00:00.000Z", status: "in_progress", startedByUserId: 2, startedByTeamMemberId: 11 });
    assignTask(TASK_1, 11);
    insertParticipant({ taskId: TASK_1, teamMemberId: 11 });

    const imageDir = path.join(TEST_SCANO_STORAGE_DIR, "product-images", TASK_1, productId);
    fs.mkdirSync(imageDir, { recursive: true });
    const imagePath = path.join(imageDir, "canonical.png");
    fs.writeFileSync(imagePath, TINY_PNG_BYTES);

    insertTaskProductRecord({
      productId,
      taskId: TASK_1,
      teamMemberId: 11,
      sourceType: "manual",
      previewImageUrl: "https://images.example.com/canonical-preview.jpg",
      barcode: "111111",
      sku: "SKU-CANON",
      price: "20",
      itemNameEn: "Canonical Product",
      itemNameAr: "منتج أصلي",
    });
    insertTaskProductBarcodeRecord({
      productId,
      barcode: "111111",
    });
    insertTaskProductBarcodeRecord({
      productId,
      barcode: "222222",
    });
    insertTaskProductImageRecord({
      imageId,
      productId,
      fileName: "canonical.png",
      filePath: imagePath,
    });
    insertResolvedProductSnapshotScan({
      taskId: TASK_1,
      teamMemberId: 11,
      taskProductId: productId,
      barcode: "999999",
      resolvedProductJson: JSON.stringify({
        sourceType: "vendor",
        externalProductId: "STALE-EXT",
        previewImageUrl: "https://images.example.com/stale-preview.jpg",
        barcode: "999999",
        barcodes: ["999999", "888888"],
        sku: "SKU-STALE",
        price: "5",
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
        confirmedAt: "2026-04-04T11:35:00.000Z",
        updatedAt: "2026-04-04T11:35:00.000Z",
      }),
    });

    const bootstrapResponse = await fetch(`${baseUrl}/api/scano/tasks/${TASK_1}/runner/bootstrap`, {
      headers: {
        "x-role": "user",
        "x-user-id": "2",
        "x-scano-role": "scanner",
      },
    });
    const bootstrapBody = await bootstrapResponse.json();

    expect(bootstrapResponse.status).toBe(200);
    expect(bootstrapBody.item.confirmedProducts).toEqual([
      expect.objectContaining({
        id: productId,
        barcode: "111111",
        barcodes: ["111111", "222222"],
        sku: "SKU-CANON",
        itemNameEn: "Canonical Product",
      }),
    ]);

    const listResponse = await fetch(`${baseUrl}/api/scano/tasks/${TASK_1}/products?page=1&pageSize=10&query=Canonical`, {
      headers: {
        "x-role": "user",
        "x-user-id": "2",
        "x-scano-role": "scanner",
      },
    });
    const listBody = await listResponse.json();

    expect(listResponse.status).toBe(200);
    expect(listBody.items).toEqual([
      expect.objectContaining({
        id: productId,
        barcode: "111111",
        barcodes: ["111111", "222222"],
        sku: "SKU-CANON",
        itemNameEn: "Canonical Product",
      }),
    ]);

    const staleListResponse = await fetch(`${baseUrl}/api/scano/tasks/${TASK_1}/products?page=1&pageSize=10&query=Stale%20Snapshot%20Product`, {
      headers: {
        "x-role": "user",
        "x-user-id": "2",
        "x-scano-role": "scanner",
      },
    });
    const staleListBody = await staleListResponse.json();

    expect(staleListResponse.status).toBe(200);
    expect(staleListBody.total).toBe(0);
    expect(staleListBody.items).toEqual([]);

    const detailResponse = await fetch(`${baseUrl}/api/scano/tasks/${TASK_1}/products/${productId}`, {
      headers: {
        "x-role": "user",
        "x-user-id": "2",
        "x-scano-role": "scanner",
      },
    });
    const detailBody = await detailResponse.json();

    expect(detailResponse.status).toBe(200);
    expect(detailBody.item).toMatchObject({
      id: productId,
      barcode: "111111",
      barcodes: ["111111", "222222"],
      sku: "SKU-CANON",
      itemNameEn: "Canonical Product",
      images: [{
        id: imageId,
        fileName: "canonical.png",
        url: `/api/scano/tasks/${TASK_1}/products/${productId}/images/${imageId}`,
      }],
    });

    const imageResponse = await fetch(`${baseUrl}/api/scano/tasks/${TASK_1}/products/${productId}/images/${imageId}`, {
      headers: {
        "x-role": "user",
        "x-user-id": "2",
        "x-scano-role": "scanner",
      },
    });

    expect(imageResponse.status).toBe(200);
    expect(imageResponse.headers.get("content-type")).toContain("image/png");
    expect(Buffer.from(await imageResponse.arrayBuffer())).toEqual(TINY_PNG_BYTES);

    const duplicateResponse = await fetch(`${baseUrl}/api/scano/tasks/${TASK_1}/scans/resolve`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-role": "user",
        "x-user-id": "2",
        "x-scano-role": "scanner",
      },
      body: JSON.stringify({
        barcode: "222222",
        source: "manual",
      }),
    });
    const duplicateBody = await duplicateResponse.json();

    expect(duplicateResponse.status).toBe(200);
    expect(duplicateBody).toMatchObject({
      kind: "duplicate",
      existingProduct: {
        id: productId,
        barcode: "111111",
        barcodes: ["111111", "222222"],
        sku: "SKU-CANON",
      },
    });

    const snapshotOnlyResponse = await fetch(`${baseUrl}/api/scano/tasks/${TASK_1}/scans/resolve`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-role": "user",
        "x-user-id": "2",
        "x-scano-role": "scanner",
      },
      body: JSON.stringify({
        barcode: "999999",
        source: "manual",
      }),
    });
    const snapshotOnlyBody = await snapshotOnlyResponse.json();

    expect(snapshotOnlyResponse.status).toBe(200);
    expect(snapshotOnlyBody.kind).toBe("draft");
    expect(snapshotOnlyBody.draft.itemNameEn).toBeNull();
  });

  it("exports canonical product rows instead of stale scan snapshots", async () => {
    insertTeamMember({ id: 11, name: "Ali", linkedUserId: 2 });
    insertTask({ id: TASK_1, scheduledAt: "2026-04-10T08:00:00.000Z", status: "awaiting_review" });
    insertTaskProductRecord({
      productId: "product-1",
      taskId: TASK_1,
      teamMemberId: 11,
      sourceType: "manual",
      barcode: "111111",
      sku: "SKU-CANON",
      price: "25",
      itemNameEn: "Canonical Export Name",
      itemNameAr: "اسم أصلي",
    });
    insertTaskProductBarcodeRecord({
      productId: "product-1",
      barcode: "111111",
    });
    insertTaskProductBarcodeRecord({
      productId: "product-1",
      barcode: "222222",
    });
    insertResolvedProductSnapshotScan({
      taskId: TASK_1,
      teamMemberId: 11,
      taskProductId: "product-1",
      barcode: "999999",
      resolvedProductJson: JSON.stringify({
        sourceType: "vendor",
        externalProductId: "STALE-EXT",
        previewImageUrl: "https://images.example.com/stale-preview.jpg",
        barcode: "999999",
        barcodes: ["999999", "888888"],
        sku: "SKU-STALE",
        price: "5",
        itemNameEn: "Stale Export Name",
        itemNameAr: "اسم قديم",
        chain: "yes",
        vendor: "yes",
        masterfile: "no",
        new: "no",
        images: [],
        createdBy: {
          id: 11,
          name: "Ali",
          linkedUserId: 2,
        },
        confirmedAt: "2026-04-04T11:35:00.000Z",
        updatedAt: "2026-04-04T11:35:00.000Z",
      }),
    });

    const exportResponse = await fetch(`${baseUrl}/api/scano/tasks/${TASK_1}/exports`, {
      method: "POST",
      headers: {
        "x-role": "admin",
        "x-primary-admin": "true",
      },
    });
    const exportBody = await exportResponse.json();

    expect(exportResponse.status).toBe(201);

    const exportRecord = testDb.prepare<[string], { filePath: string }>(`
      SELECT filePath
      FROM scano_task_exports
      WHERE id = ?
    `).get(exportBody.item.id);
    expect(exportRecord).not.toBeUndefined();

    const zipFile = await JSZip.loadAsync(fs.readFileSync(exportRecord!.filePath));
    const workbookFile = zipFile.file(`task-${TASK_1}.xlsx`);
    expect(workbookFile).not.toBeNull();

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(await workbookFile!.async("nodebuffer"));

    const worksheet = workbook.getWorksheet("Scano Review");
    expect(worksheet).toBeDefined();

    const dataRows = Array.from({ length: Math.max((worksheet?.rowCount ?? 1) - 1, 0) }, (_, index) => worksheet!.getRow(index + 2))
      .filter((row) => row.getCell(2).text.trim().length > 0);

    expect(dataRows).toHaveLength(1);
    expect(dataRows[0]?.getCell(2).text).toBe("SKU-CANON");
    expect(dataRows[0]?.getCell(3).text).toBe("25");
    expect(dataRows[0]?.getCell(4).text).toBe("111111");
    expect(dataRows[0]?.getCell(5).text).toBe("111111, 222222");
    expect(dataRows[0]?.getCell(6).text).toBe("Canonical Export Name");
  });

  it("stores previewImageUrl metadata for external-style saves without persisting external image rows", async () => {
    insertTeamMember({ id: 11, name: "Ali", linkedUserId: 2 });
    insertTask({ id: TASK_1, scheduledAt: "2026-04-10T08:00:00.000Z", status: "in_progress", startedByUserId: 2, startedByTeamMemberId: 11 });
    assignTask(TASK_1, 11);
    insertParticipant({ taskId: TASK_1, teamMemberId: 11 });

    const response = await fetch(`${baseUrl}/api/scano/tasks/${TASK_1}/products`, {
      method: "POST",
      headers: {
        "x-role": "user",
        "x-user-id": "2",
        "x-scano-role": "scanner",
      },
      body: createProductFormData({
        externalProductId: "EXT-1",
        barcode: "55443322",
        barcodes: ["55443322"],
        sku: "SKU-EXT-1",
        price: "88",
        itemNameEn: "Preview Product",
        itemNameAr: null,
        imageUrls: ["https://images.example.com/external-preview.jpg"],
        sourceMeta: {
          sourceType: "vendor",
          chain: "yes",
          vendor: "yes",
          masterfile: "no",
          new: "no",
        },
      }),
    });
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.item.previewImageUrl).toBe("https://images.example.com/external-preview.jpg");
    expect(body.item.images).toEqual([]);
    expect(testDb.prepare("SELECT COUNT(*) AS count FROM scano_task_product_images").get()).toEqual({ count: 0 });
  });

  it("uses local enriched cache for legacy runner search and hydrate before calling external APIs", async () => {
    insertTeamMember({ id: 11, name: "Ali", linkedUserId: 2 });
    insertMasterProduct({
      chainId: 1037,
      chainName: "Carrefour",
      productCount: 1,
      enrichedCount: 1,
      processedCount: 1,
    });
    const entryId = insertMasterProductEnrichmentEntry({
      chainId: 1037,
      rowNumber: 1,
      sourceBarcode: "99887766",
      externalProductId: "LOCAL-1",
      sku: "SKU-LOCAL",
      price: "77",
      itemNameEn: "Local Runner Product",
      image: "https://images.example.com/local-runner.jpg",
      chainFlag: "yes",
      vendorFlag: "yes",
    });
    insertMasterProductEnrichmentBarcode({
      entryId,
      chainId: 1037,
      barcode: "99887766",
    });
    insertTask({ id: TASK_1, scheduledAt: "2026-04-10T08:00:00.000Z", status: "in_progress", startedByUserId: 2, startedByTeamMemberId: 11 });
    assignTask(TASK_1, 11);
    insertParticipant({ taskId: TASK_1, teamMemberId: 11 });

    const bootstrapResponse = await fetch(`${baseUrl}/api/scano/tasks/${TASK_1}/runner/bootstrap`, {
      headers: {
        "x-role": "user",
        "x-user-id": "2",
        "x-scano-role": "scanner",
      },
    });
    const bootstrapBody = await bootstrapResponse.json();
    const runnerToken = bootstrapBody.item.runnerToken as string;

    const searchResponse = await fetch(`${baseUrl}/api/scano/tasks/${TASK_1}/runner/search`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-role": "user",
        "x-user-id": "2",
        "x-scano-role": "scanner",
      },
      body: JSON.stringify({
        runnerToken,
        barcode: "99887766",
      }),
    });
    const searchBody = await searchResponse.json();

    expect(searchResponse.status).toBe(200);
    expect(searchBody).toMatchObject({
      kind: "match",
      item: {
        id: "LOCAL-1",
        barcode: "99887766",
      },
    });
    expect(mockSearchScanoProductsByBarcode).not.toHaveBeenCalled();

    const hydrateResponse = await fetch(`${baseUrl}/api/scano/tasks/${TASK_1}/runner/hydrate`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-role": "user",
        "x-user-id": "2",
        "x-scano-role": "scanner",
      },
      body: JSON.stringify({
        runnerToken,
        productId: "LOCAL-1",
      }),
    });
    const hydrateBody = await hydrateResponse.json();

    expect(hydrateResponse.status).toBe(200);
    expect(hydrateBody.item).toEqual({
      chain: "yes",
      vendor: "yes",
      sku: "SKU-LOCAL",
      price: "77",
    });
    expect(mockGetScanoProductAssignmentCheck).not.toHaveBeenCalled();
  });

  it("searches external products through the runner session without recording scans", async () => {
    insertTeamMember({ id: 11, name: "Ali", linkedUserId: 2 });
    insertTask({ id: TASK_1, scheduledAt: "2026-04-10T08:00:00.000Z", status: "in_progress", startedByUserId: 2, startedByTeamMemberId: 11 });
    assignTask(TASK_1, 11);
    insertParticipant({ taskId: TASK_1, teamMemberId: 11 });

    mockSearchScanoProductsByBarcode.mockResolvedValue([
      {
        id: "QAR4F19C",
        barcode: "99887766",
        barcodes: ["99887766", "998877660001"],
        itemNameEn: "Imported Product",
        itemNameAr: null,
        image: "https://images.example.com/product.jpg",
      },
    ]);

    const bootstrapResponse = await fetch(`${baseUrl}/api/scano/tasks/${TASK_1}/runner/bootstrap`, {
      headers: {
        "x-role": "user",
        "x-user-id": "2",
        "x-scano-role": "scanner",
      },
    });
    const bootstrapBody = await bootstrapResponse.json();
    const runnerToken = bootstrapBody.item.runnerToken as string;
    expect(
      testDb.prepare("SELECT token, taskId, actorUserId, teamMemberId FROM scano_runner_sessions WHERE token = ?").get(hashSessionToken(runnerToken)),
    ).toEqual({
      token: hashSessionToken(runnerToken),
      taskId: TASK_1,
      actorUserId: 2,
      teamMemberId: 11,
    });

    const searchResponse = await fetch(`${baseUrl}/api/scano/tasks/${TASK_1}/runner/search`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-role": "user",
        "x-user-id": "2",
        "x-scano-role": "scanner",
      },
      body: JSON.stringify({
        runnerToken,
        barcode: "99887766",
      }),
    });
    const searchBody = await searchResponse.json();

    expect(searchResponse.status).toBe(200);
    expect(searchBody).toMatchObject({
      kind: "match",
      item: {
        id: "QAR4F19C",
        barcode: "99887766",
      },
    });

    const scansResponse = await fetch(`${baseUrl}/api/scano/tasks/${TASK_1}/scans?page=1&pageSize=10`, {
      headers: {
        "x-role": "user",
        "x-user-id": "2",
        "x-scano-role": "scanner",
      },
    });
    const scansBody = await scansResponse.json();
    expect(scansResponse.status).toBe(200);
    expect(scansBody.total).toBe(0);

    const invalidTokenResponse = await fetch(`${baseUrl}/api/scano/tasks/${TASK_1}/runner/search`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-role": "user",
        "x-user-id": "3",
        "x-scano-role": "scanner",
      },
      body: JSON.stringify({
        runnerToken,
        barcode: "99887766",
      }),
    });
    const invalidTokenBody = await invalidTokenResponse.json();
    expect(invalidTokenResponse.status).toBe(401);
    expect(invalidTokenBody).toMatchObject({
      ok: false,
      code: "SCANO_RUNNER_SESSION_INVALID",
      message: "Runner session is invalid. Reload the task runner.",
      errorOrigin: "session",
    });
  });

  it("treats zero-padded runner results as an exact match for the scanned barcode", async () => {
    insertTeamMember({ id: 11, name: "Ali", linkedUserId: 2 });
    insertTask({ id: TASK_1, scheduledAt: "2026-04-10T08:00:00.000Z", status: "in_progress", startedByUserId: 2, startedByTeamMemberId: 11 });
    assignTask(TASK_1, 11);
    insertParticipant({ taskId: TASK_1, teamMemberId: 11 });

    mockSearchScanoProductsByBarcode.mockResolvedValue([
      {
        id: "QAR4F19C",
        barcode: "06223001363019",
        barcodes: ["06223001363019"],
        itemNameEn: "Imported Product",
        itemNameAr: null,
        image: "https://images.example.com/product.jpg",
      },
    ]);

    const bootstrapResponse = await fetch(`${baseUrl}/api/scano/tasks/${TASK_1}/runner/bootstrap`, {
      headers: {
        "x-role": "user",
        "x-user-id": "2",
        "x-scano-role": "scanner",
      },
    });
    const bootstrapBody = await bootstrapResponse.json();
    const runnerToken = bootstrapBody.item.runnerToken as string;

    const searchResponse = await fetch(`${baseUrl}/api/scano/tasks/${TASK_1}/runner/search`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-role": "user",
        "x-user-id": "2",
        "x-scano-role": "scanner",
      },
      body: JSON.stringify({
        runnerToken,
        barcode: "6223001363019",
      }),
    });
    const searchBody = await searchResponse.json();

    expect(searchResponse.status).toBe(200);
    expect(searchBody).toMatchObject({
      kind: "match",
      item: {
        id: "QAR4F19C",
        barcode: "06223001363019",
      },
    });
  });

  it("returns multiple runner matches for non-exact search results and hydrates assignments by runner session", async () => {
    insertTeamMember({ id: 11, name: "Ali", linkedUserId: 2 });
    insertTask({ id: TASK_1, scheduledAt: "2026-04-10T08:00:00.000Z", status: "in_progress", startedByUserId: 2, startedByTeamMemberId: 11 });
    assignTask(TASK_1, 11);
    insertParticipant({ taskId: TASK_1, teamMemberId: 11 });

    mockSearchScanoProductsByBarcode.mockResolvedValue([
      {
        id: "QAR4F19C",
        barcode: "11223344",
        barcodes: ["11223344"],
        itemNameEn: "Loose Match",
        itemNameAr: null,
        image: null,
      },
    ]);

    const bootstrapResponse = await fetch(`${baseUrl}/api/scano/tasks/${TASK_1}/runner/bootstrap`, {
      headers: {
        "x-role": "user",
        "x-user-id": "2",
        "x-scano-role": "scanner",
      },
    });
    const bootstrapBody = await bootstrapResponse.json();
    const runnerToken = bootstrapBody.item.runnerToken as string;

    const searchResponse = await fetch(`${baseUrl}/api/scano/tasks/${TASK_1}/runner/search`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-role": "user",
        "x-user-id": "2",
        "x-scano-role": "scanner",
      },
      body: JSON.stringify({
        runnerToken,
        barcode: "99887766",
      }),
    });
    const searchBody = await searchResponse.json();

    expect(searchResponse.status).toBe(200);
    expect(searchBody).toMatchObject({
      kind: "multiple",
      items: [
        {
          id: "QAR4F19C",
          barcode: "11223344",
        },
      ],
    });

    const hydrateResponse = await fetch(`${baseUrl}/api/scano/tasks/${TASK_1}/runner/hydrate`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-role": "user",
        "x-user-id": "2",
        "x-scano-role": "scanner",
      },
      body: JSON.stringify({
        runnerToken,
        productId: "QAR4F19C",
      }),
    });
    const hydrateBody = await hydrateResponse.json();

    expect(hydrateResponse.status).toBe(200);
    expect(hydrateBody.item).toEqual({
      chain: "yes",
      vendor: "yes",
      sku: "SKU-1",
      price: "100",
    });
    expect(mockGetScanoProductAssignmentCheck).toHaveBeenCalledWith({
      productId: "QAR4F19C",
      chainId: 1037,
      vendorId: 4594,
    });
  });

  it("derives product source flags from source metadata on create and keeps them immutable on edit", async () => {
    insertTeamMember({ id: 11, name: "Ali", linkedUserId: 2 });
    insertTask({ id: TASK_1, scheduledAt: "2026-04-10T08:00:00.000Z", status: "in_progress", startedByUserId: 2, startedByTeamMemberId: 11 });
    assignTask(TASK_1, 11);
    insertParticipant({ taskId: TASK_1, teamMemberId: 11 });

    const createForm = new FormData();
    createForm.set("payloadJson", JSON.stringify({
      externalProductId: "QAR4F19C",
      barcode: "123456789",
      barcodes: ["123456789"],
      sku: "SKU-1",
      price: "100",
      itemNameEn: "Imported Product",
      itemNameAr: null,
      sourceMeta: {
        sourceType: "vendor",
        chain: "yes",
        vendor: "yes",
        masterfile: "no",
        new: "no",
      },
      imageUrls: ["https://images.example.com/product.jpg"],
      existingImageIds: [],
    }));

    const createResponse = await fetch(`${baseUrl}/api/scano/tasks/${TASK_1}/products`, {
      method: "POST",
      headers: {
        "x-role": "user",
        "x-user-id": "2",
        "x-scano-role": "scanner",
      },
      body: createForm,
    });
    const createBody = await createResponse.json();

    expect(createResponse.status).toBe(201);
    expect(createBody.item).toMatchObject({
      sourceType: "vendor",
      chain: "yes",
      vendor: "yes",
      masterfile: "no",
      new: "no",
      images: [],
    });
    expect(createBody.rawScan).toMatchObject({
      barcode: "123456789",
      taskProductId: createBody.item.id,
    });
    expect(createBody.taskSummary).toMatchObject({
      status: "in_progress",
      counters: {
        scannedProductsCount: 1,
        vendorCount: 1,
      },
    });
    expect(createBody.task).toBeUndefined();

    const updateForm = new FormData();
    updateForm.set("payloadJson", JSON.stringify({
      externalProductId: "QAR4F19C",
      barcode: "123456789",
      barcodes: ["123456789", "987654321"],
      sku: "SKU-1-UPDATED",
      price: "120",
      itemNameEn: "Imported Product Updated",
      itemNameAr: null,
      sourceMeta: {
        sourceType: "manual",
        chain: "no",
        vendor: "no",
        masterfile: "no",
        new: "yes",
      },
      imageUrls: ["https://images.example.com/product-updated.jpg"],
      existingImageIds: [],
    }));

    const updateResponse = await fetch(`${baseUrl}/api/scano/tasks/${TASK_1}/products/${createBody.item.id}`, {
      method: "PATCH",
      headers: {
        "x-role": "user",
        "x-user-id": "2",
        "x-scano-role": "scanner",
      },
      body: updateForm,
    });
    const updateBody = await updateResponse.json();

    expect(updateResponse.status).toBe(200);
    expect(updateBody.item).toMatchObject({
      sku: "SKU-1-UPDATED",
      itemNameEn: "Imported Product Updated",
      sourceType: "vendor",
      chain: "yes",
      vendor: "yes",
      masterfile: "no",
      new: "no",
    });
    expect(updateBody.taskSummary).toMatchObject({
      status: "in_progress",
      counters: {
        scannedProductsCount: 1,
        vendorCount: 1,
      },
    });
    expect(updateBody.task).toBeUndefined();
  });

  it("keeps retained uploaded product images readable after editing the product", async () => {
    insertTeamMember({ id: 11, name: "Ali", linkedUserId: 2 });
    insertTask({ id: TASK_1, scheduledAt: "2026-04-10T08:00:00.000Z", status: "in_progress", startedByUserId: 2, startedByTeamMemberId: 11 });
    assignTask(TASK_1, 11);
    insertParticipant({ taskId: TASK_1, teamMemberId: 11 });

    const createForm = new FormData();
    createForm.set("payloadJson", JSON.stringify({
      externalProductId: null,
      barcode: "4455667788",
      barcodes: ["4455667788"],
      sku: "LOCAL-IMAGE-1",
      price: "100",
      itemNameEn: "Manual Product",
      itemNameAr: null,
      sourceMeta: {
        sourceType: "manual",
        chain: "no",
        vendor: "no",
        masterfile: "no",
        new: "yes",
      },
      imageUrls: [],
      existingImageIds: [],
    }));
    createForm.append("images", new Blob([TINY_PNG_BYTES], { type: "image/png" }), "manual-product.png");

    const createResponse = await fetch(`${baseUrl}/api/scano/tasks/${TASK_1}/products`, {
      method: "POST",
      headers: {
        "x-role": "user",
        "x-user-id": "2",
        "x-scano-role": "scanner",
      },
      body: createForm,
    });
    const createBody = await createResponse.json();

    expect(createResponse.status).toBe(201);
    expect(createBody.item.images).toHaveLength(1);
    expect(createBody.item.images[0]).toMatchObject({
      fileName: "LOCAL-IMAGE-1.png",
    });

    const retainedImage = createBody.item.images[0] as { id: string; url: string; fileName: string };
    const updateForm = new FormData();
    updateForm.set("payloadJson", JSON.stringify({
      externalProductId: null,
      barcode: "4455667788",
      barcodes: ["4455667788", "8877665544"],
      sku: "LOCAL-IMAGE-2",
      price: "120",
      itemNameEn: "Manual Product Updated",
      itemNameAr: null,
      sourceMeta: {
        sourceType: "manual",
        chain: "yes",
        vendor: "yes",
        masterfile: "yes",
        new: "no",
      },
      imageUrls: [],
      existingImageIds: [retainedImage.id],
    }));

    const updateResponse = await fetch(`${baseUrl}/api/scano/tasks/${TASK_1}/products/${createBody.item.id}`, {
      method: "PATCH",
      headers: {
        "x-role": "user",
        "x-user-id": "2",
        "x-scano-role": "scanner",
      },
      body: updateForm,
    });
    const updateBody = await updateResponse.json();

    expect(updateResponse.status).toBe(200);
    expect(updateBody.item.images).toHaveLength(1);
    expect(updateBody.item.images[0]).toMatchObject({
      id: retainedImage.id,
      url: retainedImage.url,
      fileName: "LOCAL-IMAGE-2.png",
    });

    const imageResponse = await fetch(`${baseUrl}${updateBody.item.images[0].url}`, {
      headers: {
        "x-role": "user",
        "x-user-id": "2",
        "x-scano-role": "scanner",
      },
    });

    expect(imageResponse.status).toBe(200);
    expect(imageResponse.headers.get("content-type")).toContain("image/png");
    expect(Buffer.from(await imageResponse.arrayBuffer())).toEqual(TINY_PNG_BYTES);
  });

  it("stores only scanner-uploaded files and names them from the SKU", async () => {
    insertTeamMember({ id: 11, name: "Ali", linkedUserId: 2 });
    insertTask({ id: TASK_1, scheduledAt: "2026-04-10T08:00:00.000Z", status: "in_progress", startedByUserId: 2, startedByTeamMemberId: 11 });
    assignTask(TASK_1, 11);
    insertParticipant({ taskId: TASK_1, teamMemberId: 11 });

    const remoteOnlyForm = new FormData();
    remoteOnlyForm.set("payloadJson", JSON.stringify({
      externalProductId: "QAR4F19C",
      barcode: "123456789",
      barcodes: ["123456789"],
      sku: "SKU-REMOTE",
      price: "100",
      itemNameEn: "Imported Product",
      itemNameAr: null,
      sourceMeta: {
        sourceType: "vendor",
        chain: "yes",
        vendor: "yes",
        masterfile: "no",
        new: "no",
      },
      imageUrls: ["https://images.example.com/product.jpg"],
      existingImageIds: [],
    }));

    const remoteOnlyResponse = await fetch(`${baseUrl}/api/scano/tasks/${TASK_1}/products`, {
      method: "POST",
      headers: {
        "x-role": "user",
        "x-user-id": "2",
        "x-scano-role": "scanner",
      },
      body: remoteOnlyForm,
    });
    const remoteOnlyBody = await remoteOnlyResponse.json();

    expect(remoteOnlyResponse.status).toBe(201);
    expect(remoteOnlyBody.item.images).toEqual([]);

    const uploadedForm = new FormData();
    uploadedForm.set("payloadJson", JSON.stringify({
      externalProductId: null,
      barcode: "2233445566",
      barcodes: ["2233445566"],
      sku: "SKU-UPLOAD",
      price: "200",
      itemNameEn: "Uploaded Product",
      itemNameAr: null,
      sourceMeta: {
        sourceType: "manual",
        chain: "no",
        vendor: "no",
        masterfile: "no",
        new: "yes",
      },
      imageUrls: ["https://images.example.com/should-not-store.jpg"],
      existingImageIds: [],
    }));
    uploadedForm.append("images", new Blob([TINY_PNG_BYTES], { type: "image/png" }), "scanner-upload.png");

    const uploadedResponse = await fetch(`${baseUrl}/api/scano/tasks/${TASK_1}/products`, {
      method: "POST",
      headers: {
        "x-role": "user",
        "x-user-id": "2",
        "x-scano-role": "scanner",
      },
      body: uploadedForm,
    });
    const uploadedBody = await uploadedResponse.json();

    expect(uploadedResponse.status).toBe(201);
    expect(uploadedBody.item.images).toHaveLength(1);
    expect(uploadedBody.item.images[0]).toMatchObject({
      fileName: "SKU-UPLOAD.png",
    });
  });

  it("rejects oversized scanner image uploads before product persistence", async () => {
    insertTeamMember({ id: 11, name: "Ali", linkedUserId: 2 });
    insertTask({ id: TASK_1, scheduledAt: "2026-04-10T08:00:00.000Z", status: "in_progress", startedByUserId: 2, startedByTeamMemberId: 11 });
    assignTask(TASK_1, 11);
    insertParticipant({ taskId: TASK_1, teamMemberId: 11 });

    const oversizedForm = new FormData();
    oversizedForm.set("payloadJson", JSON.stringify({
      externalProductId: null,
      barcode: "2233445566",
      barcodes: ["2233445566"],
      sku: "SKU-BIG",
      price: "200",
      itemNameEn: "Big Upload Product",
      itemNameAr: null,
      sourceMeta: {
        sourceType: "manual",
        chain: "no",
        vendor: "no",
        masterfile: "no",
        new: "yes",
      },
      imageUrls: [],
      existingImageIds: [],
    }));
    oversizedForm.append("images", new Blob([TOO_LARGE_UPLOAD_BYTES], { type: "image/png" }), "too-large.png");

    const response = await fetch(`${baseUrl}/api/scano/tasks/${TASK_1}/products`, {
      method: "POST",
      headers: {
        "x-role": "user",
        "x-user-id": "2",
        "x-scano-role": "scanner",
      },
      body: oversizedForm,
    });
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toMatchObject({
      ok: false,
      message: "File too large",
      code: "UPLOAD_ERROR",
      errorOrigin: "validation",
    });
    expect(testDb.prepare("SELECT COUNT(*) AS count FROM scano_task_products WHERE taskId = ?").get(TASK_1)).toEqual({ count: 0 });
  });

  it("rejects non-image scanner uploads before product persistence", async () => {
    insertTeamMember({ id: 11, name: "Ali", linkedUserId: 2 });
    insertTask({ id: TASK_1, scheduledAt: "2026-04-10T08:00:00.000Z", status: "in_progress", startedByUserId: 2, startedByTeamMemberId: 11 });
    assignTask(TASK_1, 11);
    insertParticipant({ taskId: TASK_1, teamMemberId: 11 });

    const invalidTypeForm = new FormData();
    invalidTypeForm.set("payloadJson", JSON.stringify({
      externalProductId: null,
      barcode: "9988776655",
      barcodes: ["9988776655"],
      sku: "SKU-TEXT",
      price: "200",
      itemNameEn: "Invalid Type Product",
      itemNameAr: null,
      sourceMeta: {
        sourceType: "manual",
        chain: "no",
        vendor: "no",
        masterfile: "no",
        new: "yes",
      },
      imageUrls: [],
      existingImageIds: [],
    }));
    invalidTypeForm.append("images", new Blob(["not-an-image"], { type: "text/plain" }), "notes.txt");

    const response = await fetch(`${baseUrl}/api/scano/tasks/${TASK_1}/products`, {
      method: "POST",
      headers: {
        "x-role": "user",
        "x-user-id": "2",
        "x-scano-role": "scanner",
      },
      body: invalidTypeForm,
    });
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toMatchObject({
      ok: false,
      message: "Only PNG and JPEG image uploads are supported.",
      code: "SCANO_TASK_PRODUCT_IMAGE_TYPE_INVALID",
      errorOrigin: "validation",
    });
    expect(testDb.prepare("SELECT COUNT(*) AS count FROM scano_task_products WHERE taskId = ?").get(TASK_1)).toEqual({ count: 0 });
  });

  it("rejects more than five scanner image uploads in one request", async () => {
    insertTeamMember({ id: 11, name: "Ali", linkedUserId: 2 });
    insertTask({ id: TASK_1, scheduledAt: "2026-04-10T08:00:00.000Z", status: "in_progress", startedByUserId: 2, startedByTeamMemberId: 11 });
    assignTask(TASK_1, 11);
    insertParticipant({ taskId: TASK_1, teamMemberId: 11 });

    const tooManyImagesForm = new FormData();
    tooManyImagesForm.set("payloadJson", JSON.stringify({
      externalProductId: null,
      barcode: "1122334455",
      barcodes: ["1122334455"],
      sku: "SKU-MANY",
      price: "200",
      itemNameEn: "Too Many Images Product",
      itemNameAr: null,
      sourceMeta: {
        sourceType: "manual",
        chain: "no",
        vendor: "no",
        masterfile: "no",
        new: "yes",
      },
      imageUrls: [],
      existingImageIds: [],
    }));
    for (let index = 0; index < 6; index += 1) {
      tooManyImagesForm.append("images", new Blob([TINY_PNG_BYTES], { type: "image/png" }), `image-${index + 1}.png`);
    }

    const response = await fetch(`${baseUrl}/api/scano/tasks/${TASK_1}/products`, {
      method: "POST",
      headers: {
        "x-role": "user",
        "x-user-id": "2",
        "x-scano-role": "scanner",
      },
      body: tooManyImagesForm,
    });
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toMatchObject({
      ok: false,
      message: "Too many files",
      code: "UPLOAD_ERROR",
      errorOrigin: "validation",
    });
    expect(testDb.prepare("SELECT COUNT(*) AS count FROM scano_task_products WHERE taskId = ?").get(TASK_1)).toEqual({ count: 0 });
  });

  it("removes purged local task images from payloads and returns 410 for direct image reads", async () => {
    const exportId = "33333333-3333-4333-8333-333333333333";
    const productId = "44444444-4444-4444-8444-444444444444";
    const imageId = "55555555-5555-4555-8555-555555555555";
    insertTeamMember({ id: 11, name: "Ali", linkedUserId: 2 });
    insertTask({ id: TASK_1, scheduledAt: "2026-04-10T08:00:00.000Z", status: "awaiting_review" });

    const productDir = path.join(TEST_SCANO_STORAGE_DIR, "product-images", TASK_1, productId);
    const exportsDir = path.join(TEST_SCANO_STORAGE_DIR, "exports", TASK_1);
    fs.mkdirSync(productDir, { recursive: true });
    fs.mkdirSync(exportsDir, { recursive: true });

    const imagePath = path.join(productDir, "SKU-1.png");
    const exportPath = path.join(exportsDir, "review.zip");
    fs.writeFileSync(imagePath, TINY_PNG_BYTES);
    fs.writeFileSync(exportPath, Buffer.from("zip-data"));

    insertTaskProductRecord({
      productId,
      taskId: TASK_1,
      teamMemberId: 11,
      barcode: "99887766",
      sku: "SKU-1",
      itemNameEn: "Imported Product",
      previewImageUrl: "https://images.example.com/review-preview.jpg",
    });
    insertTaskProductBarcodeRecord({
      productId,
      barcode: "99887766",
    });
    insertTaskProductImageRecord({
      imageId,
      productId,
      fileName: "SKU-1.png",
      filePath: imagePath,
    });
    testDb.prepare(`
      INSERT INTO scano_task_exports (id, taskId, fileName, filePath, createdAt, confirmedDownloadAt, imagesPurgedAt)
      VALUES (?, ?, 'review.zip', ?, '2026-04-04T12:00:00.000Z', NULL, NULL)
    `).run(exportId, TASK_1, exportPath);

    const confirmResponse = await fetch(`${baseUrl}/api/scano/tasks/${TASK_1}/exports/${exportId}/confirm-download`, {
      method: "POST",
      headers: {
        "x-role": "admin",
        "x-primary-admin": "true",
      },
    });
    expect(confirmResponse.status).toBe(200);
    expect(fs.existsSync(imagePath)).toBe(false);

    const detailResponse = await fetch(`${baseUrl}/api/scano/tasks/${TASK_1}/products/${productId}`, {
      headers: {
        "x-role": "admin",
        "x-primary-admin": "true",
      },
    });
    const detailBody = await detailResponse.json();
    expect(detailResponse.status).toBe(200);
    expect(detailBody.item).toMatchObject({
      id: productId,
      previewImageUrl: "https://images.example.com/review-preview.jpg",
      images: [],
    });

    const listResponse = await fetch(`${baseUrl}/api/scano/tasks/${TASK_1}/products?page=1&pageSize=10`, {
      headers: {
        "x-role": "admin",
        "x-primary-admin": "true",
      },
    });
    const listBody = await listResponse.json();
    expect(listResponse.status).toBe(200);
    expect(listBody.items).toEqual([
      expect.objectContaining({
        id: productId,
        previewImageUrl: "https://images.example.com/review-preview.jpg",
        images: [],
      }),
    ]);

    const imageResponse = await fetch(`${baseUrl}/api/scano/tasks/${TASK_1}/products/${productId}/images/${imageId}`, {
      headers: {
        "x-role": "admin",
        "x-primary-admin": "true",
      },
      redirect: "manual",
    });
    const imageBody = await imageResponse.json();
    expect(imageResponse.status).toBe(410);
    expect(imageResponse.headers.get("location")).toBeNull();
    expect(imageBody).toMatchObject({
      ok: false,
      code: "SCANO_TASK_PRODUCT_IMAGE_PURGED",
      message: "Scano task product image is no longer available after export confirmation.",
    });
  });

  it("stores and masks Scano settings for admins", async () => {
    const getResponse = await fetch(`${baseUrl}/api/scano/settings`, {
      headers: { "x-role": "admin", "x-primary-admin": "true" },
    });
    const getBody = await getResponse.json();

    expect(getResponse.status).toBe(200);
    expect(getBody).toMatchObject({
      catalogBaseUrl: "https://catalog.example.com",
      catalogToken: "test…oken",
    });

    const putResponse = await fetch(`${baseUrl}/api/scano/settings`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        "x-role": "admin",
        "x-primary-admin": "true",
      },
      body: JSON.stringify({
        catalogBaseUrl: "https://catalog.next.example.com/",
        catalogToken: "next-token-value",
      }),
    });
    const putBody = await putResponse.json();

    expect(putResponse.status).toBe(200);
    expect(putBody.settings).toMatchObject({
      catalogBaseUrl: "https://catalog.next.example.com",
      catalogToken: "next…alue",
    });

    const forbiddenResponse = await fetch(`${baseUrl}/api/scano/settings`, {
      headers: {
        "x-role": "user",
        "x-user-id": "4",
        "x-scano-role": "team_lead",
      },
    });
    expect(forbiddenResponse.status).toBe(403);
  });

  it("tests the Scano catalog token for admins", async () => {
    mockTestScanoCatalogConnection.mockResolvedValue({
      ok: true,
      message: "Scano catalog token is valid.",
      baseUrl: "https://catalog.next.example.com",
    });

    const response = await fetch(`${baseUrl}/api/scano/settings/test`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-role": "admin",
        "x-primary-admin": "true",
      },
      body: JSON.stringify({
        catalogBaseUrl: "https://catalog.next.example.com/",
        catalogToken: "next-token-value",
      }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      ok: true,
      message: "Scano catalog token is valid.",
      baseUrl: "https://catalog.next.example.com",
    });
    expect(mockTestScanoCatalogConnection).toHaveBeenCalledWith({
      catalogBaseUrl: "https://catalog.next.example.com/",
      catalogToken: "next-token-value",
    });

    const forbiddenResponse = await fetch(`${baseUrl}/api/scano/settings/test`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-role": "user",
        "x-user-id": "4",
        "x-scano-role": "team_lead",
      },
      body: JSON.stringify({}),
    });
    expect(forbiddenResponse.status).toBe(403);
  });

  it("returns a handled 502 response when the Scano token test upstream fails", async () => {
    mockTestScanoCatalogConnection.mockRejectedValue(new (await import("../services/scanoCatalogClient.js")).ScanoCatalogClientError("Scano catalog token is invalid.", 502, {
      code: "SCANO_UPSTREAM_AUTH_REJECTED",
      errorOrigin: "integration",
      integration: "scano_catalog",
      exposeMessage: true,
    }));

    const response = await fetch(`${baseUrl}/api/scano/settings/test`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-role": "admin",
        "x-primary-admin": "true",
      },
      body: JSON.stringify({
        catalogToken: "bad-token",
      }),
    });
    const body = await response.json();

    expect(response.status).toBe(502);
    expect(body).toMatchObject({
      ok: false,
      message: "Scano catalog token is invalid.",
      code: "SCANO_UPSTREAM_AUTH_REJECTED",
      errorOrigin: "integration",
      integration: "scano_catalog",
    });
  });
});
