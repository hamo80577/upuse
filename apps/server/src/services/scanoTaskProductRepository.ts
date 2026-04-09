import type BetterSqlite3 from "better-sqlite3";
import { db } from "../config/db.js";
import type {
  ScanoTaskId,
  ScanoTaskProductListSourceFilter,
  ScanoTaskProductsPageResponse,
} from "../types/models.js";
import {
  findDuplicateTaskProduct,
  getStoredTaskProductById,
  getStoredTaskProductsForExport,
  getTaskProductBarcodesByIds,
  getTaskProductById,
  getTaskProductImagesByIds,
  getTaskProductPageRows,
  listStoredTaskProducts,
  listTaskProducts,
  type StoredScanoTaskProduct,
  type StoredScanoTaskProductImage,
} from "./scanoTaskProductQueries.js";
import { syncTaskProductProjection } from "./scanoTaskProductMutations.js";

export type { StoredScanoTaskProduct, StoredScanoTaskProductImage } from "./scanoTaskProductQueries.js";

export function createScanoTaskProductRepository(database: BetterSqlite3.Database) {
  return {
    syncTaskProductProjection(taskId: ScanoTaskId, product: StoredScanoTaskProduct, edited: boolean) {
      syncTaskProductProjection(database, taskId, product, edited);
    },

    getTaskProductBarcodesByIds(productIds: string[]) {
      return getTaskProductBarcodesByIds(database, productIds);
    },

    getTaskProductImagesByIds(taskId: ScanoTaskId, productIds: string[]) {
      return getTaskProductImagesByIds(database, taskId, productIds);
    },

    getStoredTaskProductsForExport(taskId: ScanoTaskId) {
      return getStoredTaskProductsForExport(database, taskId);
    },

    getTaskProductPageRows(params: {
      taskId: ScanoTaskId;
      page: number;
      pageSize: number;
      query?: string;
      source?: ScanoTaskProductListSourceFilter;
    }) {
      return getTaskProductPageRows(database, params);
    },

    listTaskProducts(taskId: ScanoTaskId, canEdit: boolean) {
      return listTaskProducts(database, taskId, canEdit);
    },

    listStoredTaskProducts(taskId: ScanoTaskId) {
      return listStoredTaskProducts(database, taskId);
    },

    getTaskProductById(taskId: ScanoTaskId, productId: string, canEdit: boolean) {
      return getTaskProductById(database, taskId, productId, canEdit);
    },

    getStoredTaskProductById(taskId: ScanoTaskId, productId: string) {
      return getStoredTaskProductById(database, taskId, productId);
    },

    findDuplicateTaskProduct(
      taskId: ScanoTaskId,
      barcode: string,
      options: {
        excludeProductId?: string | null;
        canEdit: boolean;
      },
    ) {
      return findDuplicateTaskProduct(database, {
        taskId,
        barcode,
        excludeProductId: options.excludeProductId,
        canEdit: options.canEdit,
      });
    },

    listTaskProductPage(params: {
      taskId: ScanoTaskId;
      page: number;
      pageSize: number;
      query?: string;
      source?: ScanoTaskProductListSourceFilter;
      canEdit: boolean;
    }): ScanoTaskProductsPageResponse {
      const { rows, meta } = getTaskProductPageRows(database, params);
      const productIds = rows.map((row) => row.id);
      const barcodesByProductId = getTaskProductBarcodesByIds(database, productIds);
      const imagesByProductId = getTaskProductImagesByIds(database, params.taskId, productIds);

      return {
        ...meta,
        items: rows.map((row) => ({
          id: row.id,
          sourceType: row.sourceType,
          externalProductId: row.externalProductId,
          previewImageUrl: row.previewImageUrl,
          barcode: row.barcode,
          barcodes: barcodesByProductId.get(row.id) ?? [row.barcode],
          sku: row.sku,
          price: row.price,
          itemNameEn: row.itemNameEn,
          itemNameAr: row.itemNameAr,
          chain: row.chainFlag,
          vendor: row.vendorFlag,
          masterfile: row.masterfileFlag,
          new: row.newFlag,
          edited: row.edited === 1,
          images: imagesByProductId.get(row.id) ?? [],
          edits: [],
          createdBy: {
            id: row.createdByTeamMemberId,
            name: row.name,
            linkedUserId: row.linkedUserId,
          },
          confirmedAt: row.confirmedAt,
          updatedAt: row.updatedAt,
          canEdit: params.canEdit,
        })),
      };
    },
  };
}

export const scanoTaskProductRepository = createScanoTaskProductRepository(db);
