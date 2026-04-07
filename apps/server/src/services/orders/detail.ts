import { DateTime } from "luxon";
import type { BranchPickersSummary, OrdersVendorId } from "../../types/models.js";
import { cairoDayWindowUtc, isPastPickup } from "../../utils/time.js";
import { getWithRetry } from "./httpClient.js";
import { createPageLimitError } from "./paginationGuards.js";
import {
  getDetailCacheKey,
  nowUtcIso,
  resolveBranchDetailCacheTtlSeconds,
  resolveOrdersWindowSplitMaxDepth,
  resolveOrdersWindowSplitMinSpanMs,
  splitUtcWindow,
  toLiveOrder,
  type UtcWindow,
} from "./shared.js";
import { BASE, BRANCH_DETAIL_MAX_PAGES, initMetrics, type DetailCacheEntry, type VendorOrdersDetailResult } from "./types.js";

const detailCache = new Map<string, DetailCacheEntry>();
const PICKER_RECENT_ACTIVE_WINDOW_MS = 60 * 60 * 1000;

function isReadyToPickupStatus(status: unknown) {
  return typeof status === "string" && status === "READY_FOR_PICKUP";
}

interface PickerAccumulator {
  shopperId: number;
  shopperFirstName: string;
  ordersToday: number;
  firstPickupAt: string | null;
  lastPickupAt: string | null;
}

function resolveShopperId(order: any) {
  return typeof order?.shopper?.id === "number" && Number.isFinite(order.shopper.id)
    ? order.shopper.id
    : null;
}

function resolveShopperFirstName(order: any, shopperId: number) {
  return typeof order?.shopper?.firstName === "string" && order.shopper.firstName.trim().length
    ? order.shopper.firstName.trim()
    : `Picker ${shopperId}`;
}

function toValidTimeMs(iso: string | null | undefined) {
  if (!iso) return Number.NaN;
  const value = new Date(iso).getTime();
  return Number.isFinite(value) ? value : Number.NaN;
}

function resolveRecentActivityTimeMs(params: {
  order: any;
  nowMs: number;
  shopperId: number | null;
  isCompleted: boolean;
  isUnassigned: boolean;
}) {
  for (const candidate of [params.order?.lastActiveSeenAt, params.order?.last_active_seen_at]) {
    const valueMs = toValidTimeMs(candidate);
    if (Number.isFinite(valueMs)) {
      return valueMs;
    }
  }

  if (
    Number.isFinite(params.nowMs)
    && params.shopperId != null
    && !params.isCompleted
    && !params.isUnassigned
  ) {
    return params.nowMs;
  }

  return Number.NaN;
}

function updatePickerPickupBounds(picker: PickerAccumulator, pickupAt: string | undefined) {
  if (!pickupAt) return;

  const pickupAtMs = toValidTimeMs(pickupAt);
  if (!Number.isFinite(pickupAtMs)) return;

  const firstPickupAtMs = toValidTimeMs(picker.firstPickupAt);
  if (!Number.isFinite(firstPickupAtMs) || pickupAtMs < firstPickupAtMs) {
    picker.firstPickupAt = pickupAt;
  }

  const lastPickupAtMs = toValidTimeMs(picker.lastPickupAt);
  if (!Number.isFinite(lastPickupAtMs) || pickupAtMs > lastPickupAtMs) {
    picker.lastPickupAt = pickupAt;
  }
}

function createEmptyPickersSummary(): BranchPickersSummary {
  return {
    todayCount: 0,
    activePreparingCount: 0,
    recentActiveCount: 0,
    items: [],
  };
}

function buildPickersSummary(params: {
  pickersById: Map<number, PickerAccumulator>;
  todayPickerIds: Set<number>;
  activePreparingPickerIds: Set<number>;
  recentActivePickerIds: Set<number>;
  includeItems: boolean;
}): BranchPickersSummary {
  const items = params.includeItems
    ? Array.from(params.pickersById.values())
      .sort((left, right) => {
        if (right.ordersToday !== left.ordersToday) {
          return right.ordersToday - left.ordersToday;
        }

        const leftLastPickupAtMs = toValidTimeMs(left.lastPickupAt);
        const rightLastPickupAtMs = toValidTimeMs(right.lastPickupAt);
        if (Number.isFinite(leftLastPickupAtMs) || Number.isFinite(rightLastPickupAtMs)) {
          if (!Number.isFinite(leftLastPickupAtMs)) return 1;
          if (!Number.isFinite(rightLastPickupAtMs)) return -1;
          if (rightLastPickupAtMs !== leftLastPickupAtMs) {
            return rightLastPickupAtMs - leftLastPickupAtMs;
          }
        }

        return left.shopperFirstName.localeCompare(right.shopperFirstName, "en", { sensitivity: "base" });
      })
      .map((picker) => ({
        shopperId: picker.shopperId,
        shopperFirstName: picker.shopperFirstName,
        ordersToday: picker.ordersToday,
        firstPickupAt: picker.firstPickupAt,
        lastPickupAt: picker.lastPickupAt,
        recentlyActive: params.recentActivePickerIds.has(picker.shopperId),
      }))
    : [];

  return {
    todayCount: params.todayPickerIds.size,
    activePreparingCount: params.activePreparingPickerIds.size,
    recentActiveCount: params.recentActivePickerIds.size,
    items,
  };
}

function stableOrderKey(order: any) {
  if (order?.id != null) return String(order.id);
  if (order?.externalId != null) return String(order.externalId);
  return "";
}

export async function fetchVendorOrdersDetail(params: {
  token: string;
  globalEntityId: string;
  vendorId: OrdersVendorId;
  pageSize?: number;
  includeMetrics?: boolean;
  includeOrders?: boolean;
  includePickers?: boolean;
  includePickerItems?: boolean;
}): Promise<VendorOrdersDetailResult> {
  const cacheTtlSeconds = resolveBranchDetailCacheTtlSeconds();
  const includeMetrics = params.includeMetrics ?? true;
  const includeOrders = params.includeOrders ?? true;
  const includePickers = params.includePickers ?? true;
  const includePickerItems = includePickers && (params.includePickerItems ?? true);
  const cacheKey = `${getDetailCacheKey(params.globalEntityId, params.vendorId)}::metrics=${includeMetrics ? 1 : 0}|orders=${includeOrders ? 1 : 0}|pickers=${includePickers ? 1 : 0}|pickerItems=${includePickerItems ? 1 : 0}`;
  const cached = detailCache.get(cacheKey);
  if (cacheTtlSeconds > 0 && cached && cached.expiresAtMs > Date.now()) {
    return cached.value;
  }

  const pageSize = params.pageSize ?? 20;
  const { startUtcIso, endUtcIso } = cairoDayWindowUtc(DateTime.utc());
  const dayWindow: UtcWindow = { startUtcIso, endUtcIso };
  const nowIso = nowUtcIso();
  const headers = {
    Authorization: `Bearer ${params.token}`,
    Accept: "application/json",
  };
  const maxSplitDepth = resolveOrdersWindowSplitMaxDepth();
  const minSplitSpanMs = resolveOrdersWindowSplitMinSpanMs();
  const seenOrderIds = new Set<string>();

  const metrics = initMetrics();
  const unassignedOrders: ReturnType<typeof toLiveOrder>[] = [];
  const preparingOrders: ReturnType<typeof toLiveOrder>[] = [];
  const pickersById = new Map<number, PickerAccumulator>();
  const todayPickerIds = new Set<number>();
  const activePreparingPickerIds = new Set<number>();
  const recentActivePickerIds = new Set<number>();
  const nowMs = new Date(nowIso).getTime();

  const collectWindow = async (window: UtcWindow, depth: number): Promise<void> => {
    let page = 0;
    while (true) {
      const qs = new URLSearchParams({
        global_entity_id: params.globalEntityId,
        page: String(page),
        pageSize: String(pageSize),
        startDate: window.startUtcIso,
        endDate: window.endUtcIso,
        order: "pickupAt,asc",
      });
      qs.append("vendor_id[0]", String(params.vendorId));

      const url = `${BASE}/orders?${qs.toString()}`;
      const res = await getWithRetry(url, headers, 2);
      const items = res.data?.items ?? [];

      for (const order of items) {
        const orderKey = stableOrderKey(order);
        if (orderKey) {
          if (seenOrderIds.has(orderKey)) continue;
          seenOrderIds.add(orderKey);
        }

        const liveOrder = includeOrders || includePickers ? toLiveOrder(order, nowIso) : null;
        const isCompleted = Boolean(order?.isCompleted);
        const isUnassigned = liveOrder
          ? liveOrder.isUnassigned
          : order?.status === "UNASSIGNED" || order?.shopper == null;

        if (includeMetrics) {
          metrics.totalToday += 1;
          if (order?.status === "CANCELLED") metrics.cancelledToday += 1;

          if (isCompleted) {
            metrics.doneToday += 1;
          } else {
            metrics.activeNow += 1;
            if (order?.pickupAt && isPastPickup(nowIso, order.pickupAt)) metrics.lateNow += 1;
            if (isReadyToPickupStatus(order?.status)) metrics.readyNow = (metrics.readyNow ?? 0) + 1;
            if (isUnassigned) metrics.unassignedNow += 1;
          }
        }

        if (includeOrders && liveOrder && !isCompleted) {
          if (liveOrder.isUnassigned) {
            unassignedOrders.push(liveOrder);
          } else {
            preparingOrders.push(liveOrder);
          }
        }

        if (!includePickers) {
          continue;
        }

        const shopperId = resolveShopperId(order);
        if (shopperId == null) {
          continue;
        }

        todayPickerIds.add(shopperId);

        if (includePickerItems) {
          const currentPicker = pickersById.get(shopperId) ?? {
            shopperId,
            shopperFirstName: resolveShopperFirstName(order, shopperId),
            ordersToday: 0,
            firstPickupAt: null,
            lastPickupAt: null,
          };
          currentPicker.ordersToday += 1;
          updatePickerPickupBounds(currentPicker, order?.pickupAt);
          pickersById.set(shopperId, currentPicker);
        }

        if (!isCompleted && !isUnassigned) {
          activePreparingPickerIds.add(shopperId);
        }

        const recentActivityTimeMs = resolveRecentActivityTimeMs({
          order,
          nowMs,
          shopperId,
          isCompleted,
          isUnassigned,
        });
        if (
          Number.isFinite(nowMs) &&
          Number.isFinite(recentActivityTimeMs) &&
          recentActivityTimeMs <= nowMs &&
          recentActivityTimeMs >= nowMs - PICKER_RECENT_ACTIVE_WINDOW_MS
        ) {
          recentActivePickerIds.add(shopperId);
        }
      }

      if (items.length < pageSize) break;
      if (page + 1 >= BRANCH_DETAIL_MAX_PAGES) {
        const splitWindows =
          depth < maxSplitDepth
            ? splitUtcWindow(window, minSplitSpanMs)
            : null;
        if (splitWindows) {
          await collectWindow(splitWindows[0], depth + 1);
          await collectWindow(splitWindows[1], depth + 1);
          return;
        }

        throw createPageLimitError({
          scope: "branch_detail",
          globalEntityId: params.globalEntityId,
          page,
          vendorId: params.vendorId,
          windowStartUtc: window.startUtcIso,
          windowEndUtc: window.endUtcIso,
          splitDepth: depth,
        });
      }
      page += 1;
    }
  };

  await collectWindow(dayWindow, 0);

  unassignedOrders.sort((a, b) => {
    const t1 = a.placedAt ? new Date(a.placedAt).getTime() : 0;
    const t2 = b.placedAt ? new Date(b.placedAt).getTime() : 0;
    return t1 - t2;
  });
  preparingOrders.sort((a, b) => {
    const t1 = a.pickupAt ? new Date(a.pickupAt).getTime() : Number.MAX_SAFE_INTEGER;
    const t2 = b.pickupAt ? new Date(b.pickupAt).getTime() : Number.MAX_SAFE_INTEGER;
    return t1 - t2;
  });

  const result = {
    metrics,
    fetchedAt: nowIso,
    unassignedOrders,
    preparingOrders,
    pickers: includePickers && (todayPickerIds.size || activePreparingPickerIds.size || recentActivePickerIds.size || pickersById.size)
      ? buildPickersSummary({
          pickersById,
          todayPickerIds,
          activePreparingPickerIds,
          recentActivePickerIds,
          includeItems: includePickerItems,
        })
      : createEmptyPickersSummary(),
  };

  if (cacheTtlSeconds > 0) {
    detailCache.set(cacheKey, {
      expiresAtMs: Date.now() + cacheTtlSeconds * 1000,
      value: result,
    });
  }

  return result;
}

export async function fetchVendorPickersSummary(params: {
  token: string;
  globalEntityId: string;
  vendorId: OrdersVendorId;
  pageSize?: number;
}): Promise<BranchPickersSummary> {
  const result = await fetchVendorOrdersDetail({
    ...params,
    includeMetrics: false,
    includeOrders: false,
    includePickers: true,
    includePickerItems: true,
  });

  return result.pickers;
}
