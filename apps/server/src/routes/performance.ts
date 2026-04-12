import type { Request, Response } from "express";
import type { MonitorEngine } from "../monitor/engine/MonitorEngine.js";
import { buildPerformanceStatusColorMap } from "../services/performanceStatusColors.js";
import type {
  PerformanceBranchFilter,
  PerformanceDeliveryTypeFilter,
  PerformanceTrendResolutionMinutes,
} from "../types/models.js";
import { getPerformanceBranchDetail, getPerformanceSummary, getPerformanceTrend, getPerformanceVendorDetail } from "../services/performanceStore.js";
import { parseBranchIdParam } from "./branchRouteHelpers.js";

const DEFAULT_TREND_RESOLUTION_MINUTES: PerformanceTrendResolutionMinutes = 60;
const DEFAULT_TREND_START_MINUTE = 0;
const DEFAULT_TREND_END_MINUTE = 1_440;
const ALLOWED_TREND_RESOLUTIONS = new Set<PerformanceTrendResolutionMinutes>([15, 30, 60]);
const ALLOWED_TREND_DELIVERY_TYPES = new Set<PerformanceDeliveryTypeFilter>(["logistics", "vendor_delivery"]);
const ALLOWED_TREND_BRANCH_FILTERS = new Set<PerformanceBranchFilter>(["vendor", "transport", "late", "on_hold", "unassigned", "in_prep", "ready"]);

function parseTrendResolutionMinutes(value: unknown) {
  if (value == null) return DEFAULT_TREND_RESOLUTION_MINUTES;
  if (Array.isArray(value)) return null;
  const numericValue = Number(value);
  if (!Number.isInteger(numericValue) || !ALLOWED_TREND_RESOLUTIONS.has(numericValue as PerformanceTrendResolutionMinutes)) {
    return null;
  }
  return numericValue as PerformanceTrendResolutionMinutes;
}

function parseTrendMinute(value: unknown, fallback: number) {
  if (value == null) return fallback;
  if (Array.isArray(value)) return null;
  const numericValue = Number(value);
  if (!Number.isInteger(numericValue) || numericValue < 0 || numericValue > DEFAULT_TREND_END_MINUTE || numericValue % 15 !== 0) {
    return null;
  }
  return numericValue;
}

function parseTrendVendorIds(value: unknown) {
  if (value == null) return undefined;
  const values = Array.isArray(value) ? value : [value];
  const vendorIds = values.map((item) => Number(item));
  if (vendorIds.some((item) => !Number.isInteger(item) || item <= 0)) {
    return null;
  }
  return Array.from(new Set(vendorIds));
}

function parseTrendSearchQuery(value: unknown) {
  if (value == null) return undefined;
  if (Array.isArray(value)) return null;
  if (typeof value !== "string") return null;
  const normalizedValue = value.trim();
  return normalizedValue.length ? normalizedValue : undefined;
}

function parseTrendEnumList<T extends string>(value: unknown, allowedValues: Set<T>) {
  if (value == null) return undefined;
  const values = Array.isArray(value) ? value : [value];
  if (values.some((item) => typeof item !== "string" || !allowedValues.has(item as T))) {
    return null;
  }
  return Array.from(new Set(values as T[]));
}

export function performanceSummaryRoute(engine: MonitorEngine) {
  return async (_req: Request, res: Response) => {
    res.json(await getPerformanceSummary(buildPerformanceStatusColorMap(engine)));
  };
}

export function performanceTrendRoute() {
  return async (req: Request, res: Response) => {
    const input = req.method === "POST" ? (req.body ?? {}) : req.query;
    const resolutionMinutes = parseTrendResolutionMinutes(input.resolutionMinutes);
    const startMinute = parseTrendMinute(input.startMinute, DEFAULT_TREND_START_MINUTE);
    const endMinute = parseTrendMinute(input.endMinute, DEFAULT_TREND_END_MINUTE);
    const vendorIds = parseTrendVendorIds(input.vendorId ?? input.vendorIds);
    const searchQuery = parseTrendSearchQuery(input.searchQuery);
    const selectedDeliveryTypes = parseTrendEnumList(
      input.deliveryType ?? input.selectedDeliveryTypes,
      ALLOWED_TREND_DELIVERY_TYPES,
    );
    const selectedBranchFilters = parseTrendEnumList(
      input.branchFilter ?? input.selectedBranchFilters,
      ALLOWED_TREND_BRANCH_FILTERS,
    );

    if (
      !resolutionMinutes
      || startMinute == null
      || endMinute == null
      || vendorIds === null
      || searchQuery === null
      || selectedDeliveryTypes === null
      || selectedBranchFilters === null
    ) {
      return res.status(400).json({ ok: false, message: "Invalid trend query" });
    }
    if (startMinute >= endMinute) {
      return res.status(400).json({ ok: false, message: "Invalid trend query" });
    }

    return res.json(await getPerformanceTrend({
      resolutionMinutes,
      startMinute,
      endMinute,
      vendorIds,
      searchQuery,
      selectedDeliveryTypes,
      selectedBranchFilters,
    }));
  };
}

export function performanceBranchDetailRoute(engine: MonitorEngine) {
  return async (req: Request, res: Response) => {
    const branchId = parseBranchIdParam(req.params.id);
    if (!branchId) {
      return res.status(400).json({ ok: false, message: "Invalid branch id" });
    }

    const detail = await getPerformanceBranchDetail(branchId, buildPerformanceStatusColorMap(engine));
    if (!detail) {
      return res.status(404).json({ ok: false, message: "Branch not found" });
    }

    return res.json(detail);
  };
}

export function performanceVendorDetailRoute() {
  return async (req: Request, res: Response) => {
    const vendorId = parseBranchIdParam(req.params.id);
    if (!vendorId) {
      return res.status(400).json({ ok: false, message: "Invalid vendor id" });
    }

    const detail = await getPerformanceVendorDetail(vendorId);
    if (!detail) {
      return res.status(404).json({ ok: false, message: "Vendor not found" });
    }

    return res.json(detail);
  };
}
