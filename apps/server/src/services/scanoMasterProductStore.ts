import { db } from "../config/db.js";
import type {
  ScanoMasterProductDetail,
  ScanoMasterProductField,
  ScanoMasterProductListItem,
  ScanoMasterProductMapping,
  ScanoMasterProductPreviewResponse,
  ScanoMasterProductRowExample,
  ScanoRunnerMasterIndexItem,
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
    .filter((value): value is string => !!value);
  const uniqueHeaders = new Set(selectedHeaders.map((value) => value.toLowerCase()));
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

export function previewScanoMasterProductCsv(csv: string): ScanoMasterProductPreviewResponse {
  const document = parseCsvDocument(csv);
  return {
    headers: document.header,
    sampleRows: buildPreviewRows(document.header, document.rows),
    suggestedMapping: buildSuggestedMapping(document.header),
  };
}

export function listScanoMasterProducts(): ScanoMasterProductListItem[] {
  return db.prepare<[], ScanoMasterProductListItem>(`
    SELECT
      chainId,
      chainName,
      productCount,
      updatedAt
    FROM scano_master_products
    ORDER BY datetime(updatedAt) DESC, chainName COLLATE NOCASE ASC, chainId ASC
  `).all();
}

export function getScanoMasterProduct(chainId: number): ScanoMasterProductDetail {
  const item = db.prepare<[number], {
    chainId: number;
    chainName: string;
    mappingJson: string;
    productCount: number;
    updatedAt: string;
  }>(`
    SELECT
      chainId,
      chainName,
      mappingJson,
      productCount,
      updatedAt
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
    chainId: item.chainId,
    chainName: item.chainName,
    productCount: item.productCount,
    updatedAt: item.updatedAt,
    mapping: parseStoredMapping(item.mappingJson),
    exampleRows,
  };
}

export function upsertScanoMasterProduct(input: UpsertScanoMasterProductInput): ScanoMasterProductListItem {
  if (!input.chainName.trim()) {
    throw new ScanoMasterProductStoreError("Chain name is required.", 400, "SCANO_MASTER_PRODUCT_CHAIN_NAME_REQUIRED");
  }

  const mapping = validateMasterProductMapping(input.mapping);
  const rows = mapRowsFromCsv(input.csv, mapping);
  const updatedAt = nowIso();
  const existing = db.prepare<[number], { createdAt: string }>(`
    SELECT createdAt
    FROM scano_master_products
    WHERE chainId = ?
  `).get(input.chainId);
  const createdAt = existing?.createdAt ?? updatedAt;

  const runWrite = db.transaction(() => {
    if (existing) {
      db.prepare(`
        UPDATE scano_master_products
        SET
          chainName = ?,
          mappingJson = ?,
          productCount = ?,
          updatedAt = ?,
          updatedByUserId = ?
        WHERE chainId = ?
      `).run(
        input.chainName.trim(),
        JSON.stringify(mapping),
        rows.length,
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
          updatedAt,
          updatedByUserId,
          createdAt
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        input.chainId,
        input.chainName.trim(),
        JSON.stringify(mapping),
        rows.length,
        updatedAt,
        input.actorUserId,
        createdAt,
      );
    }

    db.prepare("DELETE FROM scano_master_product_rows WHERE chainId = ?").run(input.chainId);
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
  });

  runWrite();

  return {
    chainId: input.chainId,
    chainName: input.chainName.trim(),
    productCount: rows.length,
    updatedAt,
  };
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
