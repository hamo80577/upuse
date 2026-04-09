import type BetterSqlite3 from "better-sqlite3";
import type { ScanoTaskId, ScanoTaskProductSource, ScanoYesNoFlag } from "../types/models.js";
import type { StoredScanoTaskProduct, StoredScanoTaskProductImage } from "./scanoTaskProductQueries.js";

interface BackfillCandidateRow {
  scanId: number;
  taskId: ScanoTaskId;
  teamMemberId: number;
  taskProductId: string;
  resolvedProductJson: string;
  scannedAt: string;
  canonicalProductId: string | null;
  barcodeCount: number;
  imageCount: number;
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

function normalizeYesNoFlag(value: unknown, fallback: ScanoYesNoFlag = "no"): ScanoYesNoFlag {
  return value === "yes" ? "yes" : value === "no" ? "no" : fallback;
}

function determineSourceType(flags: {
  vendor: ScanoYesNoFlag;
  chain: ScanoYesNoFlag;
  masterfile: ScanoYesNoFlag;
}): ScanoTaskProductSource {
  if (flags.vendor === "yes") return "vendor";
  if (flags.chain === "yes") return "chain";
  if (flags.masterfile === "yes") return "master";
  return "manual";
}

function normalizeSourceType(value: unknown, flags: {
  vendor: ScanoYesNoFlag;
  chain: ScanoYesNoFlag;
  masterfile: ScanoYesNoFlag;
}): ScanoTaskProductSource {
  if (value === "vendor" || value === "chain" || value === "master" || value === "manual") {
    return value;
  }
  return determineSourceType(flags);
}

function guessMimeTypeFromFileName(fileName: string) {
  const normalized = fileName.trim().toLowerCase();
  if (normalized.endsWith(".png")) return "image/png";
  if (normalized.endsWith(".gif")) return "image/gif";
  if (normalized.endsWith(".webp")) return "image/webp";
  return "image/jpeg";
}

function parseIsoOrFallback(value: unknown, fallback: string) {
  if (typeof value !== "string" || !value.trim()) {
    return fallback;
  }
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? fallback : new Date(parsed).toISOString();
}

function replaceTaskProductBarcodeProjection(
  database: BetterSqlite3.Database,
  productId: string,
  barcodes: string[],
  createdAt: string,
) {
  database.prepare("DELETE FROM scano_task_product_barcodes WHERE productId = ?").run(productId);
  for (const barcode of barcodes) {
    database.prepare(`
      INSERT INTO scano_task_product_barcodes (productId, barcode, createdAt)
      VALUES (?, ?, ?)
    `).run(productId, barcode, createdAt);
  }
}

function replaceTaskProductImageProjection(
  database: BetterSqlite3.Database,
  productId: string,
  images: StoredScanoTaskProductImage[],
  createdAt: string,
) {
  database.prepare("DELETE FROM scano_task_product_images WHERE productId = ?").run(productId);
  for (const [index, image] of images.entries()) {
    const storageKind = image.filePath ? "local" : "external";
    const externalUrl = image.filePath ? null : image.url;
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
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      image.id,
      productId,
      image.fileName,
      storageKind,
      image.filePath,
      externalUrl,
      image.mimeType ?? guessMimeTypeFromFileName(image.fileName),
      index,
      createdAt,
    );
  }
}

export function syncTaskProductProjection(
  database: BetterSqlite3.Database,
  taskId: ScanoTaskId,
  product: StoredScanoTaskProduct,
  edited: boolean,
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
    ON CONFLICT(id) DO UPDATE SET
      sourceType = excluded.sourceType,
      externalProductId = excluded.externalProductId,
      previewImageUrl = excluded.previewImageUrl,
      sku = excluded.sku,
      price = excluded.price,
      barcode = excluded.barcode,
      itemNameEn = excluded.itemNameEn,
      itemNameAr = excluded.itemNameAr,
      chainFlag = excluded.chainFlag,
      vendorFlag = excluded.vendorFlag,
      masterfileFlag = excluded.masterfileFlag,
      newFlag = excluded.newFlag,
      edited = excluded.edited,
      updatedAt = excluded.updatedAt
  `).run(
    product.id,
    taskId,
    product.createdBy.id,
    product.sourceType,
    product.externalProductId,
    product.previewImageUrl,
    product.sku,
    product.price,
    product.barcode,
    product.itemNameEn,
    product.itemNameAr,
    product.chain,
    product.vendor,
    product.masterfile,
    product.new,
    edited ? 1 : 0,
    product.confirmedAt,
    product.updatedAt,
  );

  replaceTaskProductBarcodeProjection(database, product.id, product.barcodes, product.updatedAt);
  replaceTaskProductImageProjection(database, product.id, product.images, product.updatedAt);
}

function parseStoredTaskProductSnapshot(row: BackfillCandidateRow): StoredScanoTaskProduct | null {
  try {
    const parsed = JSON.parse(row.resolvedProductJson) as Record<string, unknown>;
    const fallbackChain = normalizeYesNoFlag(parsed.chain, "no");
    const fallbackVendor = normalizeYesNoFlag(parsed.vendor, "no");
    const fallbackMasterfile = normalizeYesNoFlag(parsed.masterfile, "no");
    const sourceType = normalizeSourceType(parsed.sourceType, {
      vendor: fallbackVendor,
      chain: fallbackChain,
      masterfile: fallbackMasterfile,
    });
    const chain = normalizeYesNoFlag(parsed.chain, sourceType === "chain" ? "yes" : sourceType === "vendor" ? "yes" : "no");
    const vendor = normalizeYesNoFlag(parsed.vendor, sourceType === "vendor" ? "yes" : "no");
    const masterfile = normalizeYesNoFlag(parsed.masterfile, sourceType === "master" ? "yes" : "no");
    const productBarcode = typeof parsed.barcode === "string" ? parsed.barcode.trim() : "";
    const productSku = typeof parsed.sku === "string" ? parsed.sku.trim() : "";
    const productName = typeof parsed.itemNameEn === "string" ? parsed.itemNameEn.trim() : "";
    if (!productBarcode || !productSku || !productName) {
      return null;
    }

    const snapshotImages = Array.isArray(parsed.images)
      ? parsed.images.flatMap((image) => {
          if (!image || typeof image !== "object") {
            return [];
          }
          const imageRecord = image as Record<string, unknown>;
          const id = typeof imageRecord.id === "string" ? imageRecord.id.trim() : "";
          const fileName = typeof imageRecord.fileName === "string" ? imageRecord.fileName.trim() : "";
          const url = typeof imageRecord.url === "string" ? imageRecord.url.trim() : "";
          const filePath = typeof imageRecord.filePath === "string" && imageRecord.filePath.trim()
            ? imageRecord.filePath.trim()
            : null;
          if (!id || !fileName || !url) {
            return [];
          }
          return [{
            id,
            fileName,
            url,
            filePath,
            mimeType: typeof imageRecord.mimeType === "string" && imageRecord.mimeType.trim()
              ? imageRecord.mimeType.trim()
              : null,
          } satisfies StoredScanoTaskProductImage];
        })
      : [];

    const barcodes = dedupeStrings([
      productBarcode,
      ...((Array.isArray(parsed.barcodes) ? parsed.barcodes : [])
        .filter((value): value is string => typeof value === "string")),
    ]);
    const createdByRecord = parsed.createdBy && typeof parsed.createdBy === "object"
      ? parsed.createdBy as Record<string, unknown>
      : null;
    const createdById = typeof createdByRecord?.id === "number" && Number.isInteger(createdByRecord.id) && createdByRecord.id > 0
      ? createdByRecord.id
      : row.teamMemberId;

    return {
      id: row.taskProductId,
      sourceType,
      edited: Boolean(parsed.edited),
      externalProductId: typeof parsed.externalProductId === "string" && parsed.externalProductId.trim()
        ? parsed.externalProductId.trim()
        : null,
      previewImageUrl: typeof parsed.previewImageUrl === "string" && parsed.previewImageUrl.trim()
        ? parsed.previewImageUrl.trim()
        : null,
      barcode: productBarcode,
      barcodes,
      sku: productSku,
      price: typeof parsed.price === "string" && parsed.price.trim()
        ? parsed.price.trim()
        : null,
      itemNameEn: productName,
      itemNameAr: typeof parsed.itemNameAr === "string" && parsed.itemNameAr.trim()
        ? parsed.itemNameAr.trim()
        : null,
      chain,
      vendor,
      masterfile,
      new: normalizeYesNoFlag(parsed.new, vendor === "yes" || chain === "yes" ? "no" : "yes"),
      images: snapshotImages,
      createdBy: {
        id: createdById,
        name: typeof createdByRecord?.name === "string" ? createdByRecord.name : "",
        linkedUserId: typeof createdByRecord?.linkedUserId === "number" && Number.isInteger(createdByRecord.linkedUserId)
          ? createdByRecord.linkedUserId
          : 0,
      },
      confirmedAt: parseIsoOrFallback(parsed.confirmedAt, row.scannedAt),
      updatedAt: parseIsoOrFallback(parsed.updatedAt, row.scannedAt),
    };
  } catch {
    return null;
  }
}

export function backfillScanoTaskProductCanonicalRows(
  database: BetterSqlite3.Database,
  logger: Pick<Console, "warn"> = console,
) {
  const rows = database.prepare<[], BackfillCandidateRow>(`
    SELECT
      s.id AS scanId,
      s.taskId,
      s.teamMemberId,
      s.taskProductId,
      s.resolvedProductJson,
      s.scannedAt,
      p.id AS canonicalProductId,
      COALESCE(pb.count, 0) AS barcodeCount,
      COALESCE(pi.count, 0) AS imageCount
    FROM scano_task_scans s
    LEFT JOIN scano_task_products p ON p.id = s.taskProductId
    LEFT JOIN (
      SELECT productId, COUNT(*) AS count
      FROM scano_task_product_barcodes
      GROUP BY productId
    ) pb ON pb.productId = s.taskProductId
    LEFT JOIN (
      SELECT productId, COUNT(*) AS count
      FROM scano_task_product_images
      GROUP BY productId
    ) pi ON pi.productId = s.taskProductId
    WHERE s.taskProductId IS NOT NULL
      AND s.resolvedProductJson IS NOT NULL
    ORDER BY datetime(s.scannedAt) DESC, s.id DESC
  `).all();

  const seenProductIds = new Set<string>();
  for (const row of rows) {
    if (seenProductIds.has(row.taskProductId)) {
      continue;
    }
    seenProductIds.add(row.taskProductId);

    const needsParentBackfill = !row.canonicalProductId;
    const needsBarcodeBackfill = Boolean(row.canonicalProductId) && row.barcodeCount === 0;
    const needsImageBackfill = Boolean(row.canonicalProductId) && row.imageCount === 0;
    if (!needsParentBackfill && !needsBarcodeBackfill && !needsImageBackfill) {
      continue;
    }

    const product = parseStoredTaskProductSnapshot(row);
    if (!product) {
      logger.warn(
        `Skipping malformed Scano task product snapshot during backfill (taskId=${row.taskId}, scanId=${row.scanId}, taskProductId=${row.taskProductId}).`,
      );
      continue;
    }

    if (needsParentBackfill) {
      syncTaskProductProjection(database, row.taskId, product, product.edited);
      continue;
    }

    if (needsBarcodeBackfill) {
      replaceTaskProductBarcodeProjection(database, row.taskProductId, product.barcodes, product.updatedAt);
    }
    if (needsImageBackfill) {
      replaceTaskProductImageProjection(database, row.taskProductId, product.images, product.updatedAt);
    }
  }
}
