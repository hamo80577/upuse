import { DateTime } from "luxon";
import type { BranchLiveOrder } from "../../types/models.js";
import { cairoDayWindowUtc, isPastPickup, nowUtcIso } from "../../utils/time.js";
import type { OrdersMode } from "./types.js";

export function resolveOrdersMode(): OrdersMode {
  return process.env.UPUSE_ORDERS_MODE === "incremental" ? "incremental" : "fullday";
}

export function resolveBranchDetailCacheTtlSeconds() {
  const raw = Number(process.env.UPUSE_BRANCH_DETAIL_CACHE_TTL_SECONDS ?? "15");
  if (!Number.isFinite(raw) || raw <= 0) return 0;
  return Math.floor(raw);
}

export function resolveOrdersChunkConcurrency() {
  const raw = Number(process.env.UPUSE_ORDERS_CHUNK_CONCURRENCY ?? "3");
  if (!Number.isFinite(raw)) return 3;
  return Math.max(1, Math.min(8, Math.floor(raw)));
}

export function resolveOrdersWindowSplitMaxDepth() {
  const raw = Number(process.env.UPUSE_ORDERS_WINDOW_SPLIT_MAX_DEPTH ?? "8");
  if (!Number.isFinite(raw)) return 8;
  return Math.max(0, Math.min(16, Math.floor(raw)));
}

export function resolveOrdersWindowSplitMinSpanMs() {
  const raw = Number(process.env.UPUSE_ORDERS_WINDOW_MIN_SPAN_MS ?? `${5 * 60 * 1000}`);
  if (!Number.isFinite(raw)) return 5 * 60 * 1000;
  return Math.max(1000, Math.min(12 * 60 * 60 * 1000, Math.floor(raw)));
}

export function resolveOrdersWindowUtc(mode: OrdersMode) {
  // `incremental` remains behavior-compatible with full-day until a safe incremental strategy ships.
  void mode;
  return cairoDayWindowUtc(DateTime.utc());
}

export interface UtcWindow {
  startUtcIso: string;
  endUtcIso: string;
}

export function splitUtcWindow(window: UtcWindow, minSpanMs: number): [UtcWindow, UtcWindow] | null {
  const start = DateTime.fromISO(window.startUtcIso, { zone: "utc" });
  const end = DateTime.fromISO(window.endUtcIso, { zone: "utc" });
  if (!start.isValid || !end.isValid) return null;

  const spanMs = end.toMillis() - start.toMillis();
  if (spanMs <= minSpanMs) return null;

  const midpointMs = Math.floor((start.toMillis() + end.toMillis()) / 2);
  const rightStartMs = midpointMs + 1;
  if (rightStartMs >= end.toMillis()) return null;

  const leftEnd = DateTime.fromMillis(midpointMs, { zone: "utc" });
  const rightStart = DateTime.fromMillis(rightStartMs, { zone: "utc" });

  return [
    {
      startUtcIso: start.toISO({ suppressMilliseconds: false })!,
      endUtcIso: leftEnd.toISO({ suppressMilliseconds: false })!,
    },
    {
      startUtcIso: rightStart.toISO({ suppressMilliseconds: false })!,
      endUtcIso: end.toISO({ suppressMilliseconds: false })!,
    },
  ];
}

export function getDetailCacheKey(globalEntityId: string, vendorId: number) {
  const dayKey = DateTime.now().setZone("Africa/Cairo").toFormat("yyyy-LL-dd");
  return `${globalEntityId}::${vendorId}::${dayKey}`;
}

export function toLiveOrder(order: any, nowIso: string): BranchLiveOrder {
  const isUnassigned = order?.status === "UNASSIGNED" || order?.shopper == null;
  const isLate = order?.pickupAt ? isPastPickup(nowIso, order.pickupAt) : false;
  const shopperId = typeof order?.shopper?.id === "number" && Number.isFinite(order.shopper.id)
    ? order.shopper.id
    : undefined;
  const shopperFirstName =
    typeof order?.shopper?.firstName === "string" && order.shopper.firstName.trim().length
      ? order.shopper.firstName.trim()
      : undefined;

  return {
    id: String(order?.id ?? ""),
    externalId: String(order?.externalId ?? order?.shortCode ?? order?.id ?? ""),
    status: String(order?.status ?? "UNKNOWN"),
    placedAt: order?.placedAt,
    pickupAt: order?.pickupAt,
    customerFirstName: order?.customerFirstName,
    shopperId,
    shopperFirstName,
    isUnassigned,
    isLate,
  };
}

export { nowUtcIso };
