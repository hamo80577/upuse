import { getWithRetry } from "../../../../services/orders/httpClient.js";
import { createPageLimitError } from "../../../../services/orders/paginationGuards.js";
import {
  resolveOrdersEntitySyncMaxPages,
  resolveOrdersRepairSweepSeconds,
  resolveOrdersWindowSplitMaxDepth,
  resolveOrdersWindowSplitMinSpanMs,
  splitUtcWindow,
  type UtcWindow,
} from "../../../../services/orders/shared.js";
import { BASE } from "../../../../services/orders/types.js";
import type { OrdersEntitySyncStateRow, OrdersFetchResult } from "./types.js";
import { HISTORY_OVERLAP_MS } from "./types.js";
import { getDayWindow, toMillis } from "./timeWindows.js";
import { resolveCacheState, resolveFetchedAt } from "./syncState.js";
import { stableOrderKey } from "./normalization.js";

export function getOrdersHeaders(token: string) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/json",
    Origin: "https://portal.talabat.com",
    Referer: "https://portal.talabat.com/",
    "x-request-source": "ops-portal",
  };
}

export async function fetchOrdersWindow(params: {
  token: string;
  globalEntityId: string;
  pageSize: number;
  window: UtcWindow;
  nowIso: string;
  isCompleted?: boolean;
}) {
  const headers = getOrdersHeaders(params.token);
  const maxSplitDepth = resolveOrdersWindowSplitMaxDepth();
  const minSplitSpanMs = resolveOrdersWindowSplitMinSpanMs();
  const maxPages = resolveOrdersEntitySyncMaxPages();
  const seenOrderIds = new Set<string>();
  const items: any[] = [];

  const collectWindow = async (window: UtcWindow, depth: number): Promise<void> => {
    let page = 0;
    while (true) {
      const qs = new URLSearchParams({
        global_entity_id: params.globalEntityId,
        page: String(page),
        pageSize: String(params.pageSize),
        startDate: window.startUtcIso,
        endDate: window.endUtcIso,
        order: "pickupAt,asc",
      });
      if (typeof params.isCompleted === "boolean") {
        qs.set("isCompleted", params.isCompleted ? "true" : "false");
      }

      const res = await getWithRetry(`${BASE}/orders?${qs.toString()}`, headers, 2);
      const pageItems = Array.isArray(res.data?.items) ? res.data.items : [];

      for (const order of pageItems) {
        const orderKey = stableOrderKey(order);
        if (!orderKey || seenOrderIds.has(orderKey)) continue;
        seenOrderIds.add(orderKey);
        items.push(order);
      }

      if (pageItems.length < params.pageSize) break;
      if (page + 1 >= maxPages) {
        const splitWindows = depth < maxSplitDepth
          ? splitUtcWindow(window, minSplitSpanMs)
          : null;
        if (splitWindows) {
          await collectWindow(splitWindows[0], depth + 1);
          await collectWindow(splitWindows[1], depth + 1);
          return;
        }

        throw createPageLimitError({
          scope: "orders_aggregate",
          globalEntityId: params.globalEntityId,
          page,
          windowStartUtc: window.startUtcIso,
          windowEndUtc: window.endUtcIso,
          splitDepth: depth,
          maxPages,
        });
      }

      page += 1;
    }
  };

  await collectWindow(params.window, 0);
  return {
    items,
    fetchedAt: params.nowIso,
  } satisfies OrdersFetchResult;
}

export function getHistoryWindow(dayKey: string, state: OrdersEntitySyncStateRow | null, endUtcIso: string) {
  const fullDay = getDayWindow(dayKey);
  const dayStartMs = toMillis(fullDay.startUtcIso);
  const dayEndMs = toMillis(endUtcIso);
  const cursorMs = Number.isFinite(toMillis(state?.lastHistoryCursorAt))
    ? toMillis(state?.lastHistoryCursorAt)
    : dayStartMs;
  const startMs = Math.max(dayStartMs, cursorMs - HISTORY_OVERLAP_MS);

  return {
    startUtcIso: new Date(startMs).toISOString(),
    endUtcIso,
    shouldRun: dayEndMs > startMs,
  };
}

export function shouldRunRepair(state: OrdersEntitySyncStateRow | null) {
  if (!state?.lastFullHistorySweepAt) return true;
  const lastSweepMs = toMillis(state.lastFullHistorySweepAt);
  if (!Number.isFinite(lastSweepMs)) return true;
  return Date.now() - lastSweepMs >= resolveOrdersRepairSweepSeconds() * 1000;
}

export function shouldReuseFreshState(state: OrdersEntitySyncStateRow | null, ordersRefreshSeconds: number) {
  if (!state?.bootstrapCompletedAt) return false;
  if (resolveCacheState(state, ordersRefreshSeconds) !== "fresh") return false;
  const fetchedAt = resolveFetchedAt(state);
  if (!fetchedAt) return false;
  return Date.now() - toMillis(fetchedAt) < Math.max(5_000, ordersRefreshSeconds * 1000);
}

export function shouldRequireFullRecoveryAudit(state: OrdersEntitySyncStateRow | null, ordersRefreshSeconds: number) {
  if (!state?.bootstrapCompletedAt) return false;
  if ((state.consecutiveFailures ?? 0) > 0) return true;
  if (state.staleSince) return true;
  return resolveCacheState(state, ordersRefreshSeconds) === "stale";
}
