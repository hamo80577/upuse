import type { OrdersVendorId } from "../../types/models.js";
import { BRANCH_DETAIL_MAX_PAGES, ORDERS_AGG_MAX_PAGES } from "./types.js";

export function isVendorIdValidationError(error: any) {
  if (error?.response?.status !== 400) return false;

  const details = error?.response?.data?.details;
  if (!details || typeof details !== "object") return false;

  return Object.keys(details).some((key) => {
    const normalized = key.toLowerCase();
    return normalized.includes("vendorid") || normalized.includes("vendor_id");
  });
}

export function createPageLimitError(params: {
  scope: "orders_aggregate" | "branch_detail";
  globalEntityId: string;
  page: number;
  vendorId?: OrdersVendorId;
  vendorChunk?: OrdersVendorId[];
  windowStartUtc?: string;
  windowEndUtc?: string;
  splitDepth?: number;
}) {
  const error: any = new Error(
    params.scope === "orders_aggregate"
      ? "Orders aggregate pagination exceeded the safe limit"
      : "Branch detail pagination exceeded the safe limit",
  );

  error.code = "UPUSE_ORDERS_PAGE_LIMIT_EXCEEDED";
  error.details = {
    scope: params.scope,
    globalEntityId: params.globalEntityId,
    page: params.page,
    vendorId: params.vendorId,
    vendorChunk: params.vendorChunk,
    windowStartUtc: params.windowStartUtc,
    windowEndUtc: params.windowEndUtc,
    splitDepth: params.splitDepth,
    maxPages: params.scope === "orders_aggregate" ? ORDERS_AGG_MAX_PAGES : BRANCH_DETAIL_MAX_PAGES,
  };
  return error;
}
