import type { ScanoTaskProductsPageResponse, ScanoTaskScansPageResponse } from "../../api/types";

export const PRODUCTS_PAGE_SIZE = 10;

export const EMPTY_PRODUCTS_PAGE: ScanoTaskProductsPageResponse = {
  items: [],
  page: 1,
  pageSize: PRODUCTS_PAGE_SIZE,
  total: 0,
  totalPages: 1,
};

export const EMPTY_SCANS_PAGE: ScanoTaskScansPageResponse = {
  items: [],
  page: 1,
  pageSize: PRODUCTS_PAGE_SIZE,
  total: 0,
  totalPages: 1,
};
