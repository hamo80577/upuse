import { db } from "../config/db.js";
import { normalizeBarcodeForExternalLookup } from "./scanoCatalogClient.js";
import type {
  ScanoMasterProductDetail,
  ScanoMasterProductEnrichmentStatus,
  ScanoMasterProductField,
  ScanoMasterProductListItem,
  ScanoMasterProductMapping,
  ScanoMasterProductPreviewResponse,
  ScanoMasterProductRowExample,
  ScanoRunnerMasterIndexItem,
  ScanoYesNoFlag,
} from "../types/models.js";
import { parseCsvDocument } from "./csvDocument.js";

const MASTER_PRODUCT_FIELDS = [
  "barcode",
  "sku",
  "price",
  "itemNameEn",
  "itemNameAr",
  "image",
] as const satisfies readonly ScanoMasterProductField[];
const REQUIRED_MASTER_PRODUCT_FIELDS = ["sku", "barcode", "itemNameEn"] as const satisfies readonly ScanoMasterProductField[];

interface UpsertScanoMasterProductInput {
  chainId: number;
  chainName: string;
  mapping: ScanoMasterProductMapping;
  csv: string;
  actorUserId: number;
}

interface MasterProductListRow {
  chainId: number;
  chainName: string;
  productCount: number;
  updatedAt: string;
  enrichmentStatus: ScanoMasterProductEnrichmentStatus;
  enrichedCount: number;
  processedCount: number;
  canResumeEnrichment: number;
  warningCode: string | null;
  warningMessage: string | null;
}

interface MasterProductDetailRow extends MasterProductListRow {
  mappingJson: string;
  enrichmentQueuedAt: string | null;
  enrichmentStartedAt: string | null;
  enrichmentPausedAt: string | null;
  enrichmentCompletedAt: string | null;
}

interface ExistingMasterProductRow {
  createdAt: string;
  importRevision: number;
}

interface EnrichmentSeedRow {
  rowNumber: number;
  sourceBarcode: string;
  normalizedBarcode: string;
}

interface EnrichedMatchRow {
  entryId: number;
  chainId: number;
  chainName: string;
  externalProductId: string;
  sourceBarcode: string;
  sku: string | null;
  price: string | null;
  itemNameEn: string | null;
  itemNameAr: string | null;
  image: string | null;
  chainFlag: ScanoYesNoFlag;
  vendorFlag: ScanoYesNoFlag;
}

interface EnrichedAssignmentRow {
  externalProductId: string;
  chainFlag: ScanoYesNoFlag;
  vendorFlag: ScanoYesNoFlag;
  sku: string | null;
  price: string | null;
}

export interface ScanoMasterProductMatch {
  chainId: number;
  chainName: string;
  sku: string | null;
  barcode: string;
  price: string | null;
  itemNameEn: string | null;
  itemNameAr: string | null;
  image: string | null;
}

export interface ScanoMasterProductEnrichedMatch {
  entryId: number;
  chainId: number;
  chainName: string;
  externalProductId: string;
  barcode: string;
  barcodes: string[];
  sku: string | null;
  price: string | null;
  itemNameEn: string | null;
  itemNameAr: string | null;
  image: string | null;
  chain: ScanoYesNoFlag;
  vendor: ScanoYesNoFlag;
}

export interface ScanoMasterProductEnrichedAssignment {
  externalProductId: string;
  chain: ScanoYesNoFlag;
  vendor: ScanoYesNoFlag;
  sku: string | null;
  price: string | null;
}

export class ScanoMasterProductStoreError extends Error {
  status: number;
  code: string;

  constructor(message: string, status: number, code: string) {
    super(message);
    this.name = "ScanoMasterProductStoreError";
    this.status = status;
    this.code = code;
  }
}

function nowIso() {
  return new Date().toISOString();
}

function emptyMapping(): ScanoMasterProductMapping {
  return {
    barcode: null,
    sku: null,
    price: null,
    itemNameEn: null,
    itemNameAr: null,
    image: null,
  };
}

function normalizeHeaderKey(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function toNullableCell(value: string | undefined) {
  const normalized = (value ?? "").trim();
  return normalized ? normalized : null;
}

function buildHeaderValue(rowValues: string[], headerIndex: number | undefined) {
  if (typeof headerIndex !== "number" || headerIndex < 0) {
    return null;
  }

  return toNullableCell(rowValues[headerIndex]);
}

function parseStoredMapping(raw: string): ScanoMasterProductMapping {
  try {
    const parsed = JSON.parse(raw) as Partial<Record<ScanoMasterProductField, unknown>>;
    return normalizeMasterProductMapping(parsed);
  } catch {
    return emptyMapping();
  }
}

function normalizeMasterProductMapping(
  value: Partial<Record<ScanoMasterProductField, unknown>> | null | undefined,
): ScanoMasterProductMapping {
  const mapping = emptyMapping();
  for (const field of MASTER_PRODUCT_FIELDS) {
    const raw = value?.[field];
    mapping[field] = typeof raw === "string" && raw.trim() ? raw.trim() : null;
  }
  return mapping;
}

function validateMasterProductMapping(
  value: Partial<Record<ScanoMasterProductField, unknown>> | null | undefined,
): ScanoMasterProductMapping {
  const mapping = normalizeMasterProductMapping(value);

  for (const field of REQUIRED_MASTER_PRODUCT_FIELDS) {
    if (!mapping[field]) {
      throw new ScanoMasterProductStoreError(
        `Master product mapping must include ${field}.`,
        400,
        "SCANO_MASTER_PRODUCT_REQUIRED_MAPPING",
      );
    }
  }

  const selectedHeaders = MASTER_PRODUCT_FIELDS
    .map((field) => mapping[field])
    .filter((header): header is string => !!header);
  const uniqueHeaders = new Set(selectedHeaders.map((header) => header.toLowerCase()));
  if (selectedHeaders.length !== uniqueHeaders.size) {
    throw new ScanoMasterProductStoreError(
      "Each source CSV header can only be mapped once.",
      400,
      "SCANO_MASTER_PRODUCT_DUPLICATE_MAPPING",
    );
  }

  return mapping;
}

function suggestFieldForHeader(header: string): ScanoMasterProductField | null {
  const normalized = normalizeHeaderKey(header);

  if (
    normalized.includes("barcode") ||
    normalized.includes("bar code") ||
    normalized === "ean" ||
    normalized.includes("ean code")
  ) {
    return "barcode";
  }
  if (
    normalized === "sku" ||
    normalized.includes("item number") ||
    normalized.includes("item no") ||
    normalized.includes("item code") ||
    normalized.includes("product code")
  ) {
    return "sku";
  }
  if (normalized.includes("price")) {
    return "price";
  }
  if (
    normalized.includes("item name en") ||
    normalized.includes("name en") ||
    normalized.includes("english name")
  ) {
    return "itemNameEn";
  }
  if (
    normalized.includes("item name ar") ||
    normalized.includes("name ar") ||
    normalized.includes("arabic name")
  ) {
    return "itemNameAr";
  }
  if (normalized.includes("image") || normalized.includes("img") || normalized.includes("photo")) {
    return "image";
  }

  return null;
}

function buildSuggestedMapping(headers: string[]): ScanoMasterProductMapping {
  const mapping = emptyMapping();
  const assignedHeaders = new Set<string>();

  for (const header of headers) {
    const suggestion = suggestFieldForHeader(header);
    if (!suggestion || mapping[suggestion] || assignedHeaders.has(header.toLowerCase())) {
      continue;
    }
    mapping[suggestion] = header;
    assignedHeaders.add(header.toLowerCase());
  }

  return mapping;
}

function buildPreviewRows(headers: string[], rows: Array<{ values: string[] }>) {
  return rows.slice(0, 10).map((row) =>
    Object.fromEntries(headers.map((header, index) => [header, (row.values[index] ?? "").trim()])),
  );
}

function mapRowsFromCsv(csv: string, mapping: ScanoMasterProductMapping): ScanoMasterProductRowExample[] {
  const document = parseCsvDocument(csv);
  if (!document.rows.length) {
    throw new ScanoMasterProductStoreError(
      "CSV must contain at least one product row.",
      400,
      "SCANO_MASTER_PRODUCT_ROWS_REQUIRED",
    );
  }

  const headerIndexByName = new Map(document.header.map((header, index) => [header, index]));
  const missingMappedHeaders = MASTER_PRODUCT_FIELDS
    .map((field) => mapping[field])
    .filter((header): header is string => !!header && !headerIndexByName.has(header));
  if (missingMappedHeaders.length) {
    throw new ScanoMasterProductStoreError(
      `Mapped header "${missingMappedHeaders[0]}" was not found in the CSV file.`,
      400,
      "SCANO_MASTER_PRODUCT_HEADER_NOT_FOUND",
    );
  }

  const seenSkus = new Set<string>();
  const seenBarcodes = new Set<string>();
  const rows: ScanoMasterProductRowExample[] = [];

  for (const row of document.rows) {
    const nextRow: ScanoMasterProductRowExample = {
      rowNumber: row.lineNumber,
      sku: buildHeaderValue(row.values, headerIndexByName.get(mapping.sku ?? "")),
      barcode: buildHeaderValue(row.values, headerIndexByName.get(mapping.barcode ?? "")),
      price: buildHeaderValue(row.values, headerIndexByName.get(mapping.price ?? "")),
      itemNameEn: buildHeaderValue(row.values, headerIndexByName.get(mapping.itemNameEn ?? "")),
      itemNameAr: buildHeaderValue(row.values, headerIndexByName.get(mapping.itemNameAr ?? "")),
      image: buildHeaderValue(row.values, headerIndexByName.get(mapping.image ?? "")),
    };

    const normalizedSku = nextRow.sku?.toLowerCase() ?? "";
    const normalizedBarcode = nextRow.barcode?.toLowerCase() ?? "";
    if ((normalizedSku && seenSkus.has(normalizedSku)) || (normalizedBarcode && seenBarcodes.has(normalizedBarcode))) {
      continue;
    }

    if (normalizedSku) {
      seenSkus.add(normalizedSku);
    }
    if (normalizedBarcode) {
      seenBarcodes.add(normalizedBarcode);
    }
    rows.push(nextRow);
  }

  return rows;
}

function mapDetailRow(row: {
  rowNumber: number;
  sku: string | null;
  barcode: string | null;
  price: string | null;
  itemNameEn: string | null;
  itemNameAr: string | null;
  image: string | null;
}): ScanoMasterProductRowExample {
  return {
    rowNumber: row.rowNumber,
    sku: row.sku,
    barcode: row.barcode,
    price: row.price,
    itemNameEn: row.itemNameEn,
    itemNameAr: row.itemNameAr,
    image: row.image,
  };
}

function normalizeEnrichmentBarcode(value: string | null | undefined) {
  const trimmed = (value ?? "").trim();
  if (!trimmed) {
    return "";
  }
  return normalizeBarcodeForExternalLookup(trimmed);
}

function buildEnrichmentSeedRows(rows: ScanoMasterProductRowExample[]): EnrichmentSeedRow[] {
  const seenBarcodes = new Set<string>();
  const result: EnrichmentSeedRow[] = [];

  for (const row of rows) {
    const sourceBarcode = row.barcode?.trim() ?? "";
    const normalizedBarcode = normalizeEnrichmentBarcode(sourceBarcode);
    if (!sourceBarcode || !normalizedBarcode || seenBarcodes.has(normalizedBarcode.toLowerCase())) {
      continue;
    }
    seenBarcodes.add(normalizedBarcode.toLowerCase());
    result.push({
      rowNumber: row.rowNumber,
      sourceBarcode,
      normalizedBarcode,
    });
  }

  return result;
}

function mapListRow(row: MasterProductListRow): ScanoMasterProductListItem {
  return {
    chainId: row.chainId,
    chainName: row.chainName,
    productCount: row.productCount,
    updatedAt: row.updatedAt,
    enrichmentStatus: row.enrichmentStatus,
    enrichedCount: row.enrichedCount,
    processedCount: row.processedCount,
    canResumeEnrichment: row.canResumeEnrichment === 1,
    warningCode: row.warningCode,
    warningMessage: row.warningMessage,
  };
}

function mapYesNoFlag(value: string | null | undefined): ScanoYesNoFlag {
  return value === "yes" ? "yes" : "no";
}

function loadEnrichedBarcodes(entryId: number) {
  return db.prepare<[number], { barcode: string }>(`
    SELECT barcode
    FROM scano_master_product_enrichment_barcodes
    WHERE entryId = ?
    ORDER BY id ASC
  `).all(entryId).map((row) => row.barcode);
}

export function previewScanoMasterProductCsv(csv: string): ScanoMasterProductPreviewResponse {
  const document = parseCsvDocument(csv);
  return {
    headers: document.header,
    sampleRows: buildPreviewRows(document.header, document.rows),
    suggestedMapping: buildSuggestedMapping(document.header),
  };
}

export function listScanoMasterProducts(): ScanoMasterProductListItem[] {
  return db.prepare<[], MasterProductListRow>(`
    SELECT
      chainId,
      chainName,
      productCount,
      updatedAt,
      enrichmentStatus,
      enrichedCount,
      processedCount,
      CASE
        WHEN enrichmentStatus = 'running' THEN 0
        WHEN EXISTS (
          SELECT 1
          FROM scano_master_product_enrichment_entries entry
          WHERE entry.chainId = scano_master_products.chainId
            AND entry.importRevision = scano_master_products.importRevision
            AND entry.status <> 'enriched'
        ) THEN 1
        ELSE 0
      END AS canResumeEnrichment,
      warningCode,
      warningMessage
    FROM scano_master_products
    ORDER BY datetime(updatedAt) DESC, chainName COLLATE NOCASE ASC, chainId ASC
  `).all().map(mapListRow);
}

export function getScanoMasterProduct(chainId: number): ScanoMasterProductDetail {
  const item = db.prepare<[number], MasterProductDetailRow>(`
    SELECT
      chainId,
      chainName,
      mappingJson,
      productCount,
      updatedAt,
      enrichmentStatus,
      enrichmentQueuedAt,
      enrichmentStartedAt,
      enrichmentPausedAt,
      enrichmentCompletedAt,
      enrichedCount,
      processedCount,
      CASE
        WHEN enrichmentStatus = 'running' THEN 0
        WHEN EXISTS (
          SELECT 1
          FROM scano_master_product_enrichment_entries entry
          WHERE entry.chainId = scano_master_products.chainId
            AND entry.importRevision = scano_master_products.importRevision
            AND entry.status <> 'enriched'
        ) THEN 1
        ELSE 0
      END AS canResumeEnrichment,
      warningCode,
      warningMessage
    FROM scano_master_products
    WHERE chainId = ?
  `).get(chainId);

  if (!item) {
    throw new ScanoMasterProductStoreError("Master product chain was not found.", 404, "SCANO_MASTER_PRODUCT_NOT_FOUND");
  }

  const exampleRows = db.prepare<[number], {
    rowNumber: number;
    sku: string | null;
    barcode: string | null;
    price: string | null;
    itemNameEn: string | null;
    itemNameAr: string | null;
    image: string | null;
  }>(`
    SELECT
      rowNumber,
      sku,
      barcode,
      price,
      itemNameEn,
      itemNameAr,
      image
    FROM scano_master_product_rows
    WHERE chainId = ?
    ORDER BY rowNumber ASC, id ASC
    LIMIT 10
  `).all(chainId).map(mapDetailRow);

  return {
    ...mapListRow(item),
    mapping: parseStoredMapping(item.mappingJson),
    exampleRows,
    enrichmentQueuedAt: item.enrichmentQueuedAt,
    enrichmentStartedAt: item.enrichmentStartedAt,
    enrichmentPausedAt: item.enrichmentPausedAt,
    enrichmentCompletedAt: item.enrichmentCompletedAt,
  };
}

export function upsertScanoMasterProduct(input: UpsertScanoMasterProductInput): ScanoMasterProductListItem {
  if (!input.chainName.trim()) {
    throw new ScanoMasterProductStoreError("Chain name is required.", 400, "SCANO_MASTER_PRODUCT_CHAIN_NAME_REQUIRED");
  }

  const mapping = validateMasterProductMapping(input.mapping);
  const rows = mapRowsFromCsv(input.csv, mapping);
  const enrichmentSeedRows = buildEnrichmentSeedRows(rows);
  const updatedAt = nowIso();
  const existing = db.prepare<[number], ExistingMasterProductRow>(`
    SELECT createdAt, importRevision
    FROM scano_master_products
    WHERE chainId = ?
  `).get(input.chainId);
  const createdAt = existing?.createdAt ?? updatedAt;
  const importRevision = (existing?.importRevision ?? 0) + 1;
  const enrichmentStatus: ScanoMasterProductEnrichmentStatus = enrichmentSeedRows.length ? "queued" : "completed";

  const runWrite = db.transaction(() => {
    if (existing) {
      db.prepare(`
        UPDATE scano_master_products
        SET
          chainName = ?,
          mappingJson = ?,
          productCount = ?,
          importRevision = ?,
          enrichmentStatus = ?,
          enrichmentQueuedAt = ?,
          enrichmentStartedAt = NULL,
          enrichmentPausedAt = NULL,
          enrichmentCompletedAt = ?,
          enrichedCount = 0,
          processedCount = 0,
          warningCode = NULL,
          warningMessage = NULL,
          updatedAt = ?,
          updatedByUserId = ?
        WHERE chainId = ?
      `).run(
        input.chainName.trim(),
        JSON.stringify(mapping),
        rows.length,
        importRevision,
        enrichmentStatus,
        updatedAt,
        enrichmentSeedRows.length ? null : updatedAt,
        updatedAt,
        input.actorUserId,
        input.chainId,
      );
    } else {
      db.prepare(`
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
        ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, 0, 0, NULL, NULL, ?, ?, ?)
      `).run(
        input.chainId,
        input.chainName.trim(),
        JSON.stringify(mapping),
        rows.length,
        importRevision,
        enrichmentStatus,
        updatedAt,
        enrichmentSeedRows.length ? null : updatedAt,
        updatedAt,
        input.actorUserId,
        createdAt,
      );
    }

    db.prepare("DELETE FROM scano_master_product_rows WHERE chainId = ?").run(input.chainId);
    db.prepare("DELETE FROM scano_master_product_enrichment_entries WHERE chainId = ?").run(input.chainId);

    const insertRow = db.prepare(`
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
    `);

    for (const row of rows) {
      insertRow.run(
        input.chainId,
        row.rowNumber,
        row.sku,
        row.barcode,
        row.price,
        row.itemNameEn,
        row.itemNameAr,
        row.image,
      );
    }

    if (enrichmentSeedRows.length) {
      const insertEnrichmentEntry = db.prepare(`
        INSERT INTO scano_master_product_enrichment_entries (
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
        ) VALUES (?, ?, ?, ?, ?, 'pending_search', 0, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, ?, ?)
      `);

      for (const row of enrichmentSeedRows) {
        insertEnrichmentEntry.run(
          input.chainId,
          importRevision,
          row.rowNumber,
          row.sourceBarcode,
          row.normalizedBarcode,
          updatedAt,
          updatedAt,
        );
      }
    }
  });

  runWrite();

  return {
    chainId: input.chainId,
    chainName: input.chainName.trim(),
    productCount: rows.length,
    updatedAt,
    enrichmentStatus,
    enrichedCount: 0,
    processedCount: 0,
    canResumeEnrichment: enrichmentSeedRows.length > 0,
    warningCode: null,
    warningMessage: null,
  };
}

export function resumeScanoMasterProductEnrichment(chainId: number): ScanoMasterProductListItem {
  const item = db.prepare<[number], {
    chainId: number;
    importRevision: number;
    enrichmentStatus: ScanoMasterProductEnrichmentStatus;
  }>(`
    SELECT
      chainId,
      importRevision,
      enrichmentStatus
    FROM scano_master_products
    WHERE chainId = ?
  `).get(chainId);

  if (!item) {
    throw new ScanoMasterProductStoreError("Master product chain was not found.", 404, "SCANO_MASTER_PRODUCT_NOT_FOUND");
  }

  if (item.enrichmentStatus !== "running") {
    const atIso = nowIso();
    db.transaction(() => {
      db.prepare(`
        UPDATE scano_master_product_enrichment_candidates
        SET
          status = 'pending',
          attemptCount = 0,
          nextAttemptAt = NULL,
          lastError = NULL,
          sku = NULL,
          price = NULL,
          chainFlag = NULL,
          vendorFlag = NULL,
          updatedAt = ?
        WHERE chainId = ?
          AND importRevision = ?
          AND entryId IN (
            SELECT id
            FROM scano_master_product_enrichment_entries
            WHERE chainId = ?
              AND importRevision = ?
              AND status <> 'enriched'
          )
      `).run(atIso, chainId, item.importRevision, chainId, item.importRevision);

      db.prepare(`
        UPDATE scano_master_product_enrichment_entries
        SET
          status = CASE
            WHEN EXISTS (
              SELECT 1
              FROM scano_master_product_enrichment_candidates candidate
              WHERE candidate.entryId = scano_master_product_enrichment_entries.id
            ) THEN 'pending_assignment'
            ELSE 'pending_search'
          END,
          attemptCount = 0,
          nextAttemptAt = NULL,
          lastError = NULL,
          updatedAt = ?
        WHERE chainId = ?
          AND importRevision = ?
          AND status <> 'enriched'
      `).run(atIso, chainId, item.importRevision);

      const counts = db.prepare<[number, number], {
        enrichedCount: number | null;
        processedCount: number | null;
        remainingCount: number | null;
      }>(`
        SELECT
          SUM(CASE WHEN status = 'enriched' THEN 1 ELSE 0 END) AS enrichedCount,
          SUM(CASE WHEN status IN ('enriched', 'failed', 'ambiguous') THEN 1 ELSE 0 END) AS processedCount,
          SUM(CASE WHEN status <> 'enriched' THEN 1 ELSE 0 END) AS remainingCount
        FROM scano_master_product_enrichment_entries
        WHERE chainId = ?
          AND importRevision = ?
      `).get(chainId, item.importRevision);

      if ((counts?.remainingCount ?? 0) > 0) {
        db.prepare(`
          UPDATE scano_master_products
          SET
            enrichmentStatus = 'queued',
            enrichmentQueuedAt = ?,
            enrichmentStartedAt = NULL,
            enrichmentPausedAt = NULL,
            enrichmentCompletedAt = NULL,
            enrichedCount = ?,
            processedCount = ?,
            warningCode = NULL,
            warningMessage = NULL,
            updatedAt = ?
          WHERE chainId = ?
            AND importRevision = ?
        `).run(
          atIso,
          counts?.enrichedCount ?? 0,
          counts?.processedCount ?? 0,
          atIso,
          chainId,
          item.importRevision,
        );
        return;
      }

      db.prepare(`
        UPDATE scano_master_products
        SET
          warningCode = NULL,
          warningMessage = NULL,
          updatedAt = ?
        WHERE chainId = ?
          AND importRevision = ?
      `).run(atIso, chainId, item.importRevision);
    })();
  }

  return listScanoMasterProducts().find((entry) => entry.chainId === chainId)
    ?? (() => {
      throw new ScanoMasterProductStoreError("Master product chain was not found.", 404, "SCANO_MASTER_PRODUCT_NOT_FOUND");
    })();
}

export function deleteScanoMasterProduct(chainId: number) {
  const existing = db.prepare<[number], { chainId: number }>(`
    SELECT chainId
    FROM scano_master_products
    WHERE chainId = ?
  `).get(chainId);

  if (!existing) {
    throw new ScanoMasterProductStoreError("Master product chain was not found.", 404, "SCANO_MASTER_PRODUCT_NOT_FOUND");
  }

  db.prepare("DELETE FROM scano_master_products WHERE chainId = ?").run(chainId);
}

export function findScanoMasterProductEnrichedMatch(chainId: number, barcode: string): ScanoMasterProductEnrichedMatch | null {
  const normalizedBarcode = normalizeEnrichmentBarcode(barcode);
  if (!normalizedBarcode) {
    return null;
  }

  const rows = db.prepare<[number, string], EnrichedMatchRow>(`
    SELECT
      e.id AS entryId,
      p.chainId,
      p.chainName,
      e.externalProductId,
      e.sourceBarcode,
      e.sku,
      e.price,
      e.itemNameEn,
      e.itemNameAr,
      e.image,
      e.chainFlag,
      e.vendorFlag
    FROM scano_master_product_enrichment_barcodes b
    INNER JOIN scano_master_product_enrichment_entries e
      ON e.id = b.entryId
    INNER JOIN scano_master_products p
      ON p.chainId = e.chainId
      AND p.importRevision = e.importRevision
    WHERE b.chainId = ?
      AND b.normalizedBarcode = ?
      AND e.status = 'enriched'
    ORDER BY CASE e.vendorFlag WHEN 'yes' THEN 0 ELSE 1 END, e.rowNumber ASC, e.id ASC
    LIMIT 2
  `).all(chainId, normalizedBarcode);

  if (!rows.length) {
    return null;
  }

  const first = rows[0]!;
  if (rows.length > 1 && rows.some((row) => row.entryId !== first.entryId)) {
    return null;
  }

  return {
    entryId: first.entryId,
    chainId: first.chainId,
    chainName: first.chainName,
    externalProductId: first.externalProductId,
    barcode: first.sourceBarcode,
    barcodes: loadEnrichedBarcodes(first.entryId),
    sku: first.sku,
    price: first.price,
    itemNameEn: first.itemNameEn,
    itemNameAr: first.itemNameAr,
    image: first.image,
    chain: mapYesNoFlag(first.chainFlag),
    vendor: mapYesNoFlag(first.vendorFlag),
  };
}

export function findScanoMasterProductEnrichedAssignment(chainId: number, externalProductId: string): ScanoMasterProductEnrichedAssignment | null {
  const normalizedProductId = externalProductId.trim();
  if (!normalizedProductId) {
    return null;
  }

  const item = db.prepare<[number, string], EnrichedAssignmentRow>(`
    SELECT
      e.externalProductId,
      e.chainFlag,
      e.vendorFlag,
      e.sku,
      e.price
    FROM scano_master_product_enrichment_entries e
    INNER JOIN scano_master_products p
      ON p.chainId = e.chainId
      AND p.importRevision = e.importRevision
    WHERE e.chainId = ?
      AND e.externalProductId = ? COLLATE NOCASE
      AND e.status = 'enriched'
    ORDER BY CASE e.vendorFlag WHEN 'yes' THEN 0 ELSE 1 END, e.rowNumber ASC, e.id ASC
    LIMIT 1
  `).get(chainId, normalizedProductId);

  if (!item) {
    return null;
  }

  return {
    externalProductId: item.externalProductId,
    chain: mapYesNoFlag(item.chainFlag),
    vendor: mapYesNoFlag(item.vendorFlag),
    sku: item.sku,
    price: item.price,
  };
}

export function findScanoMasterProductMatch(chainId: number, barcode: string): ScanoMasterProductMatch | null {
  const normalizedBarcode = barcode.trim();
  if (!normalizedBarcode) {
    return null;
  }

  return db.prepare<[number, string], ScanoMasterProductMatch>(`
    SELECT
      p.chainId,
      p.chainName,
      r.sku,
      r.barcode,
      r.price,
      r.itemNameEn,
      r.itemNameAr,
      r.image
    FROM scano_master_product_rows r
    INNER JOIN scano_master_products p ON p.chainId = r.chainId
    WHERE r.chainId = ?
      AND LOWER(COALESCE(r.barcode, '')) = LOWER(?)
    ORDER BY r.rowNumber ASC, r.id ASC
    LIMIT 1
  `).get(chainId, normalizedBarcode) ?? null;
}

export function listScanoMasterProductIndex(chainId: number): ScanoRunnerMasterIndexItem[] {
  return db.prepare<[number], ScanoRunnerMasterIndexItem>(`
    SELECT
      barcode,
      sku,
      price,
      itemNameEn,
      itemNameAr,
      image
    FROM scano_master_product_rows
    WHERE chainId = ?
      AND TRIM(COALESCE(barcode, '')) <> ''
    ORDER BY rowNumber ASC, id ASC
  `).all(chainId);
}
