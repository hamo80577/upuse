import type Database from "better-sqlite3";
import { backfillScanoTaskProductCanonicalRows } from "../../../services/scanoTaskProductMutations.js";

type EncryptLike = {
  encrypt(value: string): string;
};

export function applyScanoSchemaMigrations(db: Database.Database) {
  const scanoTeamColumns = db.prepare("PRAGMA table_info(scano_team_members)").all() as Array<{ name: string }>;
  if (!scanoTeamColumns.some((column) => column.name === "role")) {
    db.exec("ALTER TABLE scano_team_members ADD COLUMN role TEXT NOT NULL DEFAULT 'scanner'");
    db.exec("UPDATE scano_team_members SET role = 'scanner' WHERE TRIM(role) = '' OR role IS NULL");
  }

  const scanoTaskScanColumns = db.prepare("PRAGMA table_info(scano_task_scans)").all() as Array<{ name: string }>;
  if (!scanoTaskScanColumns.some((column) => column.name === "outcome")) {
    db.exec("ALTER TABLE scano_task_scans ADD COLUMN outcome TEXT NOT NULL DEFAULT 'manual_only'");
    db.exec("UPDATE scano_task_scans SET outcome = 'manual_only' WHERE outcome IS NULL OR TRIM(outcome) = ''");
  }
  if (!scanoTaskScanColumns.some((column) => column.name === "taskProductId")) {
    db.exec("ALTER TABLE scano_task_scans ADD COLUMN taskProductId TEXT");
  }

  const scanoTaskProductColumns = db.prepare("PRAGMA table_info(scano_task_products)").all() as Array<{ name: string }>;
  if (!scanoTaskProductColumns.some((column) => column.name === "previewImageUrl")) {
    db.exec("ALTER TABLE scano_task_products ADD COLUMN previewImageUrl TEXT");
  }

  const scanoMasterProductColumns = db.prepare("PRAGMA table_info(scano_master_products)").all() as Array<{ name: string }>;
  if (!scanoMasterProductColumns.some((column) => column.name === "importRevision")) {
    db.exec("ALTER TABLE scano_master_products ADD COLUMN importRevision INTEGER NOT NULL DEFAULT 1");
  }
  if (!scanoMasterProductColumns.some((column) => column.name === "enrichmentStatus")) {
    db.exec("ALTER TABLE scano_master_products ADD COLUMN enrichmentStatus TEXT NOT NULL DEFAULT 'queued'");
  }
  if (!scanoMasterProductColumns.some((column) => column.name === "enrichmentQueuedAt")) {
    db.exec("ALTER TABLE scano_master_products ADD COLUMN enrichmentQueuedAt TEXT");
  }
  if (!scanoMasterProductColumns.some((column) => column.name === "enrichmentStartedAt")) {
    db.exec("ALTER TABLE scano_master_products ADD COLUMN enrichmentStartedAt TEXT");
  }
  if (!scanoMasterProductColumns.some((column) => column.name === "enrichmentPausedAt")) {
    db.exec("ALTER TABLE scano_master_products ADD COLUMN enrichmentPausedAt TEXT");
  }
  if (!scanoMasterProductColumns.some((column) => column.name === "enrichmentCompletedAt")) {
    db.exec("ALTER TABLE scano_master_products ADD COLUMN enrichmentCompletedAt TEXT");
  }
  if (!scanoMasterProductColumns.some((column) => column.name === "enrichedCount")) {
    db.exec("ALTER TABLE scano_master_products ADD COLUMN enrichedCount INTEGER NOT NULL DEFAULT 0");
  }
  if (!scanoMasterProductColumns.some((column) => column.name === "processedCount")) {
    db.exec("ALTER TABLE scano_master_products ADD COLUMN processedCount INTEGER NOT NULL DEFAULT 0");
  }
  if (!scanoMasterProductColumns.some((column) => column.name === "warningCode")) {
    db.exec("ALTER TABLE scano_master_products ADD COLUMN warningCode TEXT");
  }
  if (!scanoMasterProductColumns.some((column) => column.name === "warningMessage")) {
    db.exec("ALTER TABLE scano_master_products ADD COLUMN warningMessage TEXT");
  }

  db.exec(`
    UPDATE scano_master_products
    SET
      importRevision = COALESCE(importRevision, 1),
      enrichmentStatus = CASE
        WHEN TRIM(COALESCE(enrichmentStatus, '')) = '' THEN 'queued'
        ELSE enrichmentStatus
      END,
      enrichmentQueuedAt = COALESCE(enrichmentQueuedAt, updatedAt),
      enrichedCount = COALESCE(enrichedCount, 0),
      processedCount = COALESCE(processedCount, 0)
  `);

  backfillScanoTaskProductCanonicalRows(db);
}

export function ensureDefaultScanoSettingsRow(params: {
  cryptoBox: EncryptLike;
  db: Database.Database;
}) {
  const { cryptoBox, db } = params;
  const scanoSettingsRow = db.prepare("SELECT id FROM scano_settings WHERE id = 1").get();

  if (scanoSettingsRow) {
    return;
  }

  db.prepare(`
    INSERT INTO scano_settings (
      id,
      catalogBaseUrl,
      catalogTokenEnc,
      updatedAt
    ) VALUES (1, '', ?, ?)
  `).run(
    cryptoBox.encrypt(""),
    new Date().toISOString(),
  );
}
