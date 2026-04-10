import type BetterSqlite3 from "better-sqlite3";
import type {
  ScanoPaginationMeta,
  ScanoTaskId,
  ScanoTaskProduct,
  ScanoTaskProductImage,
  ScanoTaskProductListSourceFilter,
  ScanoTaskProductSnapshot,
  ScanoTaskProductSource,
  ScanoYesNoFlag,
} from "../types/models.js";
import { normalizeBarcodeForExternalLookup } from "./scanoCatalogClient.js";

interface ScanoTaskProductRow {
  id: string;
  taskId: ScanoTaskId;
  createdByTeamMemberId: number;
  sourceType: ScanoTaskProductSource;
  externalProductId: string | null;
  previewImageUrl: string | null;
  barcode: string;
  sku: string;
  price: string | null;
  itemNameEn: string;
  itemNameAr: string | null;
  chainFlag: ScanoYesNoFlag;
  vendorFlag: ScanoYesNoFlag;
  masterfileFlag: ScanoYesNoFlag;
  newFlag: ScanoYesNoFlag;
  edited: number;
  confirmedAt: string;
  updatedAt: string;
  name: string;
  linkedUserId: number;
}

interface ScanoTaskProductBarcodeRow {
  productId: string;
  barcode: string;
}

interface ScanoTaskProductImageRow {
  id: string;
  productId: string;
  fileName: string;
  storageKind: "local" | "external";
  filePath: string | null;
  externalUrl: string | null;
  mimeType: string | null;
  sortOrder: number;
}

export interface StoredScanoTaskProductImage {
  id: string;
  fileName: string;
  url: string;
  filePath: string | null;
  mimeType: string | null;
}

export interface StoredScanoTaskProduct extends ScanoTaskProductSnapshot {
  id: string;
  sourceType: ScanoTaskProductSource;
  edited: boolean;
  images: StoredScanoTaskProductImage[];
  createdBy: {
    id: number;
    name: string;
    linkedUserId: number;
  };
  confirmedAt: string;
  updatedAt: string;
}

export interface TaskProductPageQueryParams {
  taskId: ScanoTaskId;
  page: number;
  pageSize: number;
  query?: string;
  source?: ScanoTaskProductListSourceFilter;
}

function buildPlaceholders(count: number) {
  return Array.from({ length: count }, () => "?").join(", ");
}

function dedupeStrings(values: string[]) {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const rawValue of values) {
    const value = rawValue.trim();
    if (!value) continue;
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(value);
  }
  return result;
}

function escapeLikePattern(value: string) {
  return value.replace(/[\\%_]/g, "\\$&");
}

function normalizePagination(page: number | undefined, pageSize: number | undefined, defaultPageSize = 10) {
  const safePage = Number.isFinite(page) && (page ?? 0) > 0 ? Math.trunc(page ?? 1) : 1;
  const safePageSize = Number.isFinite(pageSize) && (pageSize ?? 0) > 0
    ? Math.min(Math.trunc(pageSize ?? defaultPageSize), 50)
    : defaultPageSize;
  return {
    page: safePage,
    pageSize: safePageSize,
    offset: (safePage - 1) * safePageSize,
  };
}

function buildPaginationMeta(page: number, pageSize: number, total: number): ScanoPaginationMeta {
  return {
    page,
    pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

function isExactTaskProductLookupQuery(value: string) {
  return /^[a-z0-9._:-]+$/i.test(value) && value.length >= 6;
}

function toProductImageUrl(taskId: ScanoTaskId, productId: string, image: ScanoTaskProductImageRow) {
  if (image.storageKind === "local") {
    return `/api/scano/tasks/${taskId}/products/${productId}/images/${image.id}`;
  }
  return image.externalUrl ?? "";
}

function mapTaskProductRow(
  row: ScanoTaskProductRow,
  canEdit: boolean,
  barcodes: string[],
  images: ScanoTaskProductImage[],
): ScanoTaskProduct {
  return {
    id: row.id,
    sourceType: row.sourceType,
    externalProductId: row.externalProductId,
    previewImageUrl: row.previewImageUrl,
    barcode: row.barcode,
    barcodes,
    sku: row.sku,
    price: row.price,
    itemNameEn: row.itemNameEn,
    itemNameAr: row.itemNameAr,
    chain: row.chainFlag,
    vendor: row.vendorFlag,
    masterfile: row.masterfileFlag,
    new: row.newFlag,
    edited: row.edited === 1,
    images,
    edits: [],
    createdBy: {
      id: row.createdByTeamMemberId,
      name: row.name,
      linkedUserId: row.linkedUserId,
    },
    confirmedAt: row.confirmedAt,
    updatedAt: row.updatedAt,
    canEdit,
  };
}

function mapStoredTaskProductRow(
  row: ScanoTaskProductRow,
  barcodes: string[],
  images: StoredScanoTaskProductImage[],
): StoredScanoTaskProduct {
  return {
    id: row.id,
    sourceType: row.sourceType,
    externalProductId: row.externalProductId,
    previewImageUrl: row.previewImageUrl,
    barcode: row.barcode,
    barcodes,
    sku: row.sku,
    price: row.price,
    itemNameEn: row.itemNameEn,
    itemNameAr: row.itemNameAr,
    chain: row.chainFlag,
    vendor: row.vendorFlag,
    masterfile: row.masterfileFlag,
    new: row.newFlag,
    edited: row.edited === 1,
    images,
    createdBy: {
      id: row.createdByTeamMemberId,
      name: row.name,
      linkedUserId: row.linkedUserId,
    },
    confirmedAt: row.confirmedAt,
    updatedAt: row.updatedAt,
  };
}

function mapStoredTaskProduct(product: StoredScanoTaskProduct, canEdit: boolean): ScanoTaskProduct {
  return {
    id: product.id,
    sourceType: product.sourceType,
    externalProductId: product.externalProductId,
    previewImageUrl: product.previewImageUrl,
    barcode: product.barcode,
    barcodes: product.barcodes,
    sku: product.sku,
    price: product.price,
    itemNameEn: product.itemNameEn,
    itemNameAr: product.itemNameAr,
    chain: product.chain,
    vendor: product.vendor,
    masterfile: product.masterfile,
    new: product.new,
    edited: product.edited,
    images: product.images.map((image) => ({
      id: image.id,
      fileName: image.fileName,
      url: image.url,
    })),
    edits: [],
    createdBy: product.createdBy,
    confirmedAt: product.confirmedAt,
    updatedAt: product.updatedAt,
    canEdit,
  };
}

function getTaskProductRowsByTaskId(database: BetterSqlite3.Database, taskId: ScanoTaskId) {
  return database.prepare<[ScanoTaskId], ScanoTaskProductRow>(`
    SELECT
      p.id,
      p.taskId,
      p.createdByTeamMemberId,
      p.sourceType,
      p.externalProductId,
      p.previewImageUrl,
      p.barcode,
      p.sku,
      p.price,
      p.itemNameEn,
      p.itemNameAr,
      p.chainFlag,
      p.vendorFlag,
      p.masterfileFlag,
      p.newFlag,
      p.edited,
      p.confirmedAt,
      p.updatedAt,
      creator.name,
      creator.linkedUserId
    FROM scano_task_products p
    INNER JOIN scano_team_members creator ON creator.id = p.createdByTeamMemberId
    WHERE p.taskId = ?
    ORDER BY datetime(p.updatedAt) DESC, datetime(p.confirmedAt) DESC, p.id DESC
  `).all(taskId);
}

function getTaskProductRowById(database: BetterSqlite3.Database, taskId: ScanoTaskId, productId: string) {
  return database.prepare<[ScanoTaskId, string], ScanoTaskProductRow>(`
    SELECT
      p.id,
      p.taskId,
      p.createdByTeamMemberId,
      p.sourceType,
      p.externalProductId,
      p.previewImageUrl,
      p.barcode,
      p.sku,
      p.price,
      p.itemNameEn,
      p.itemNameAr,
      p.chainFlag,
      p.vendorFlag,
      p.masterfileFlag,
      p.newFlag,
      p.edited,
      p.confirmedAt,
      p.updatedAt,
      creator.name,
      creator.linkedUserId
    FROM scano_task_products p
    INNER JOIN scano_team_members creator ON creator.id = p.createdByTeamMemberId
    WHERE p.taskId = ? AND p.id = ?
    LIMIT 1
  `).get(taskId, productId);
}

function hasPurgedLocalTaskImages(database: BetterSqlite3.Database, taskId: ScanoTaskId) {
  const row = database.prepare<[ScanoTaskId], { hasPurgedImages: number }>(`
    SELECT 1 AS hasPurgedImages
    FROM scano_task_exports
    WHERE taskId = ?
      AND imagesPurgedAt IS NOT NULL
    LIMIT 1
  `).get(taskId);

  return !!row?.hasPurgedImages;
}

export function getTaskProductBarcodesByIds(database: BetterSqlite3.Database, productIds: string[]) {
  if (!productIds.length) {
    return new Map<string, string[]>();
  }

  const rows = database.prepare(`
    SELECT productId, barcode
    FROM scano_task_product_barcodes
    WHERE productId IN (${buildPlaceholders(productIds.length)})
    ORDER BY id ASC
  `).all(...productIds) as ScanoTaskProductBarcodeRow[];

  const result = new Map<string, string[]>();
  for (const row of rows) {
    result.set(row.productId, [...(result.get(row.productId) ?? []), row.barcode]);
  }
  return result;
}

export function getTaskProductImagesByIds(database: BetterSqlite3.Database, taskId: ScanoTaskId, productIds: string[]) {
  if (!productIds.length) {
    return new Map<string, ScanoTaskProductImage[]>();
  }

  const hidePurgedLocalImages = hasPurgedLocalTaskImages(database, taskId);
  const rows = database.prepare(`
    SELECT id, productId, fileName, storageKind, filePath, externalUrl, mimeType, sortOrder
    FROM scano_task_product_images
    WHERE productId IN (${buildPlaceholders(productIds.length)})
    ORDER BY sortOrder ASC, id ASC
  `).all(...productIds) as ScanoTaskProductImageRow[];

  const result = new Map<string, ScanoTaskProductImage[]>();
  for (const row of rows) {
    if (hidePurgedLocalImages && row.storageKind === "local") {
      continue;
    }

    const image: ScanoTaskProductImage = {
      id: row.id,
      fileName: row.fileName,
      url: toProductImageUrl(taskId, row.productId, row),
    };
    result.set(row.productId, [...(result.get(row.productId) ?? []), image]);
  }
  return result;
}

export function getStoredTaskProductImagesByIds(database: BetterSqlite3.Database, taskId: ScanoTaskId, productIds: string[]) {
  if (!productIds.length) {
    return new Map<string, StoredScanoTaskProductImage[]>();
  }

  const hidePurgedLocalImages = hasPurgedLocalTaskImages(database, taskId);
  const rows = database.prepare(`
    SELECT id, productId, fileName, storageKind, filePath, externalUrl, mimeType, sortOrder
    FROM scano_task_product_images
    WHERE productId IN (${buildPlaceholders(productIds.length)})
    ORDER BY sortOrder ASC, id ASC
  `).all(...productIds) as ScanoTaskProductImageRow[];

  const result = new Map<string, StoredScanoTaskProductImage[]>();
  for (const row of rows) {
    if (hidePurgedLocalImages && row.storageKind === "local") {
      continue;
    }

    const image: StoredScanoTaskProductImage = {
      id: row.id,
      fileName: row.fileName,
      url: toProductImageUrl(taskId, row.productId, row),
      filePath: row.filePath,
      mimeType: row.mimeType,
    };
    result.set(row.productId, [...(result.get(row.productId) ?? []), image]);
  }
  return result;
}

export function listStoredTaskProducts(database: BetterSqlite3.Database, taskId: ScanoTaskId) {
  const rows = getTaskProductRowsByTaskId(database, taskId);
  if (!rows.length) {
    return [];
  }

  const productIds = rows.map((row) => row.id);
  const barcodesByProductId = getTaskProductBarcodesByIds(database, productIds);
  const imagesByProductId = getStoredTaskProductImagesByIds(database, taskId, productIds);

  return rows.map((row) =>
    mapStoredTaskProductRow(
      row,
      dedupeStrings([row.barcode, ...(barcodesByProductId.get(row.id) ?? [])]),
      imagesByProductId.get(row.id) ?? [],
    ));
}

export function listTaskProducts(database: BetterSqlite3.Database, taskId: ScanoTaskId, canEdit: boolean) {
  return listStoredTaskProducts(database, taskId).map((product) => mapStoredTaskProduct(product, canEdit));
}

export function getStoredTaskProductById(database: BetterSqlite3.Database, taskId: ScanoTaskId, productId: string) {
  const row = getTaskProductRowById(database, taskId, productId);
  if (!row) {
    return null;
  }

  const barcodesByProductId = getTaskProductBarcodesByIds(database, [row.id]);
  const imagesByProductId = getStoredTaskProductImagesByIds(database, taskId, [row.id]);
  return mapStoredTaskProductRow(
    row,
    dedupeStrings([row.barcode, ...(barcodesByProductId.get(row.id) ?? [])]),
    imagesByProductId.get(row.id) ?? [],
  );
}

export function getTaskProductById(database: BetterSqlite3.Database, taskId: ScanoTaskId, productId: string, canEdit: boolean) {
  const product = getStoredTaskProductById(database, taskId, productId);
  return product ? mapStoredTaskProduct(product, canEdit) : null;
}

export function getStoredTaskProductsForExport(database: BetterSqlite3.Database, taskId: ScanoTaskId) {
  const products = listStoredTaskProducts(database, taskId);
  const dedupedProducts = new Map<string, StoredScanoTaskProduct>();

  for (const product of products) {
    const skuKey = product.sku.trim().toLowerCase();
    if (dedupedProducts.has(skuKey)) {
      continue;
    }
    dedupedProducts.set(skuKey, product);
  }

  return Array.from(dedupedProducts.values());
}

function executeTaskProductPageQuery(
  database: BetterSqlite3.Database,
  params: {
    filters: string[];
    values: Array<string | number>;
    page: number;
    pageSize: number;
  },
) {
  const whereClause = params.filters.join(" AND ");
  const meta = normalizePagination(params.page, params.pageSize);
  const totalRow = database.prepare<[...Array<string | number>], { total: number }>(`
    SELECT COUNT(*) AS total
    FROM scano_task_products p
    WHERE ${whereClause}
  `).get(...params.values);

  const rows = database.prepare<[...Array<string | number>], ScanoTaskProductRow>(`
    SELECT
      p.id,
      p.taskId,
      p.createdByTeamMemberId,
      p.sourceType,
      p.externalProductId,
      p.previewImageUrl,
      p.barcode,
      p.sku,
      p.price,
      p.itemNameEn,
      p.itemNameAr,
      p.chainFlag,
      p.vendorFlag,
      p.masterfileFlag,
      p.newFlag,
      p.edited,
      p.confirmedAt,
      p.updatedAt,
      creator.name,
      creator.linkedUserId
    FROM scano_task_products p
    INNER JOIN scano_team_members creator ON creator.id = p.createdByTeamMemberId
    WHERE ${whereClause}
    ORDER BY datetime(p.confirmedAt) DESC, p.id DESC
    LIMIT ? OFFSET ?
  `).all(...params.values, meta.pageSize, meta.offset);

  return {
    rows,
    meta: buildPaginationMeta(meta.page, meta.pageSize, totalRow?.total ?? 0),
  };
}

export function getTaskProductPageRows(database: BetterSqlite3.Database, params: TaskProductPageQueryParams) {
  const baseFilters = ["p.taskId = ?"];
  const baseValues: Array<string | number> = [params.taskId];

  if (params.source && params.source !== "all") {
    baseFilters.push("p.sourceType = ?");
    baseValues.push(params.source);
  }

  const trimmedQuery = params.query?.trim() ?? "";
  if (!trimmedQuery) {
    return executeTaskProductPageQuery(database, {
      filters: baseFilters,
      values: baseValues,
      page: params.page,
      pageSize: params.pageSize,
    });
  }

  if (isExactTaskProductLookupQuery(trimmedQuery)) {
    const exactResult = executeTaskProductPageQuery(database, {
      filters: [
        ...baseFilters,
        `(
          p.barcode = ? COLLATE NOCASE
          OR p.sku = ? COLLATE NOCASE
          OR p.externalProductId = ? COLLATE NOCASE
          OR EXISTS (
            SELECT 1
            FROM scano_task_product_barcodes pb
            WHERE pb.productId = p.id
              AND pb.barcode = ? COLLATE NOCASE
          )
        )`,
      ],
      values: [...baseValues, trimmedQuery, trimmedQuery, trimmedQuery, trimmedQuery],
      page: params.page,
      pageSize: params.pageSize,
    });

    if (exactResult.meta.total > 0) {
      return exactResult;
    }
  }

  const pattern = `%${escapeLikePattern(trimmedQuery)}%`;
  return executeTaskProductPageQuery(database, {
    filters: [
      ...baseFilters,
      `(
        p.barcode LIKE ? ESCAPE '\\' COLLATE NOCASE
        OR p.sku LIKE ? ESCAPE '\\' COLLATE NOCASE
        OR COALESCE(p.externalProductId, '') LIKE ? ESCAPE '\\' COLLATE NOCASE
        OR p.itemNameEn LIKE ? ESCAPE '\\' COLLATE NOCASE
        OR COALESCE(p.itemNameAr, '') LIKE ? ESCAPE '\\' COLLATE NOCASE
        OR EXISTS (
          SELECT 1
          FROM scano_task_product_barcodes pb
          WHERE pb.productId = p.id
            AND pb.barcode LIKE ? ESCAPE '\\' COLLATE NOCASE
        )
      )`,
    ],
    values: [...baseValues, pattern, pattern, pattern, pattern, pattern, pattern],
    page: params.page,
    pageSize: params.pageSize,
  });
}

export function findDuplicateTaskProduct(
  database: BetterSqlite3.Database,
  params: {
    taskId: ScanoTaskId;
    barcode: string;
    excludeProductId?: string | null;
    canEdit: boolean;
  },
) {
  const normalizedBarcode = params.barcode.trim();
  const lookupBarcode = normalizeBarcodeForExternalLookup(normalizedBarcode);
  if (!normalizedBarcode) {
    return null;
  }

  const row = database.prepare<[ScanoTaskId, string | null, string | null, string, string, string, string], ScanoTaskProductRow>(`
    SELECT
      p.id,
      p.taskId,
      p.createdByTeamMemberId,
      p.sourceType,
      p.externalProductId,
      p.previewImageUrl,
      p.barcode,
      p.sku,
      p.price,
      p.itemNameEn,
      p.itemNameAr,
      p.chainFlag,
      p.vendorFlag,
      p.masterfileFlag,
      p.newFlag,
      p.edited,
      p.confirmedAt,
      p.updatedAt,
      creator.name,
      creator.linkedUserId
    FROM scano_task_products p
    INNER JOIN scano_team_members creator ON creator.id = p.createdByTeamMemberId
    WHERE p.taskId = ?
      AND (? IS NULL OR p.id <> ?)
      AND (
        p.barcode = ? COLLATE NOCASE
        OR p.barcode = ? COLLATE NOCASE
        OR EXISTS (
          SELECT 1
          FROM scano_task_product_barcodes pb
          WHERE pb.productId = p.id
            AND (
              pb.barcode = ? COLLATE NOCASE
              OR pb.barcode = ? COLLATE NOCASE
            )
        )
      )
    ORDER BY datetime(p.updatedAt) DESC, datetime(p.confirmedAt) DESC, p.id DESC
    LIMIT 1
  `).get(
    params.taskId,
    params.excludeProductId ?? null,
    params.excludeProductId ?? null,
    normalizedBarcode,
    lookupBarcode,
    normalizedBarcode,
    lookupBarcode,
  );

  if (!row) {
    return null;
  }

  const barcodesByProductId = getTaskProductBarcodesByIds(database, [row.id]);
  const imagesByProductId = getTaskProductImagesByIds(database, params.taskId, [row.id]);
  return mapTaskProductRow(
    row,
    params.canEdit,
    dedupeStrings([row.barcode, ...(barcodesByProductId.get(row.id) ?? [])]),
    imagesByProductId.get(row.id) ?? [],
  );
}
