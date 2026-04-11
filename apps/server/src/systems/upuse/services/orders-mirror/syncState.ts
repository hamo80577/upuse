import { db } from "../../../../config/db.js";
import { getGlobalEntityId, getSettings } from "../../../../services/settingsStore.js";
import { nowUtcIso } from "../../../../utils/time.js";
import type {
  BranchDetailCacheState,
  EntitySyncError,
  OrdersEntitySyncStateRow,
  OrdersMirrorEntitySyncStatus,
} from "./types.js";
import { getCairoDayKey, toMillis } from "./timeWindows.js";

export function resolveFetchedAt(state: OrdersEntitySyncStateRow | null) {
  if (!state) return null;
  const candidates = [
    state.lastSuccessfulSyncAt,
    state.lastBootstrapSyncAt,
    state.lastActiveSyncAt,
    state.lastHistorySyncAt,
  ].filter((value): value is string => typeof value === "string" && value.length > 0);

  if (!candidates.length) return null;
  return candidates.reduce((latest, current) => (toMillis(current) > toMillis(latest) ? current : latest));
}

export function resolveCacheState(
  state: OrdersEntitySyncStateRow | null,
  ordersRefreshSeconds: number,
  nowMs = Date.now(),
): BranchDetailCacheState {
  if (!state?.bootstrapCompletedAt) {
    return "warming";
  }

  const fetchedAt = resolveFetchedAt(state);
  if (!fetchedAt) {
    return "warming";
  }

  const staleAfterMs = Math.max(60_000, ordersRefreshSeconds * 2_000);
  return nowMs - toMillis(fetchedAt) > staleAfterMs ? "stale" : "fresh";
}

export function getEntitySyncState(dayKey: string, globalEntityId: string) {
  return db.prepare<[string, string], OrdersEntitySyncStateRow>(`
    SELECT
      dayKey,
      globalEntityId,
      lastBootstrapSyncAt,
      lastActiveSyncAt,
      lastHistorySyncAt,
      lastFullHistorySweepAt,
      lastSuccessfulSyncAt,
      lastHistoryCursorAt,
      consecutiveFailures,
      lastErrorAt,
      lastErrorCode,
      lastErrorMessage,
      staleSince,
      bootstrapCompletedAt
    FROM orders_entity_sync_state
    WHERE dayKey = ? AND globalEntityId = ?
  `).get(dayKey, globalEntityId) ?? null;
}

export function upsertEntitySyncState(dayKey: string, globalEntityId: string, patch: Partial<OrdersEntitySyncStateRow>) {
  const current = getEntitySyncState(dayKey, globalEntityId) ?? {
    dayKey,
    globalEntityId,
    lastBootstrapSyncAt: null,
    lastActiveSyncAt: null,
    lastHistorySyncAt: null,
    lastFullHistorySweepAt: null,
    lastSuccessfulSyncAt: null,
    lastHistoryCursorAt: null,
    consecutiveFailures: 0,
    lastErrorAt: null,
    lastErrorCode: null,
    lastErrorMessage: null,
    staleSince: null,
    bootstrapCompletedAt: null,
  };

  const next = {
    ...current,
    ...patch,
    dayKey,
    globalEntityId,
  };

  db.prepare(`
    INSERT INTO orders_entity_sync_state (
      dayKey,
      globalEntityId,
      lastBootstrapSyncAt,
      lastActiveSyncAt,
      lastHistorySyncAt,
      lastFullHistorySweepAt,
      lastSuccessfulSyncAt,
      lastHistoryCursorAt,
      consecutiveFailures,
      lastErrorAt,
      lastErrorCode,
      lastErrorMessage,
      staleSince,
      bootstrapCompletedAt
    ) VALUES (
      @dayKey,
      @globalEntityId,
      @lastBootstrapSyncAt,
      @lastActiveSyncAt,
      @lastHistorySyncAt,
      @lastFullHistorySweepAt,
      @lastSuccessfulSyncAt,
      @lastHistoryCursorAt,
      @consecutiveFailures,
      @lastErrorAt,
      @lastErrorCode,
      @lastErrorMessage,
      @staleSince,
      @bootstrapCompletedAt
    )
    ON CONFLICT(dayKey, globalEntityId) DO UPDATE SET
      lastBootstrapSyncAt = excluded.lastBootstrapSyncAt,
      lastActiveSyncAt = excluded.lastActiveSyncAt,
      lastHistorySyncAt = excluded.lastHistorySyncAt,
      lastFullHistorySweepAt = excluded.lastFullHistorySweepAt,
      lastSuccessfulSyncAt = excluded.lastSuccessfulSyncAt,
      lastHistoryCursorAt = excluded.lastHistoryCursorAt,
      consecutiveFailures = excluded.consecutiveFailures,
      lastErrorAt = excluded.lastErrorAt,
      lastErrorCode = excluded.lastErrorCode,
      lastErrorMessage = excluded.lastErrorMessage,
      staleSince = excluded.staleSince,
      bootstrapCompletedAt = excluded.bootstrapCompletedAt
  `).run(next);
}

export function pruneMirrorDays(dayKeysToKeep: string[]) {
  const placeholders = dayKeysToKeep.map(() => "?").join(", ");
  db.prepare(`DELETE FROM orders_mirror WHERE dayKey NOT IN (${placeholders})`).run(...dayKeysToKeep);
  db.prepare(`DELETE FROM orders_sync_state WHERE dayKey NOT IN (${placeholders})`).run(...dayKeysToKeep);
  db.prepare(`DELETE FROM orders_entity_sync_state WHERE dayKey NOT IN (${placeholders})`).run(...dayKeysToKeep);
}

export function summarizeMirrorSyncError(error: any): EntitySyncError {
  const statusCode = typeof error?.response?.status === "number" ? error.response.status : undefined;
  const code = typeof error?.code === "string" ? error.code : undefined;
  const responseMessage =
    error?.response?.data?.message ||
    error?.response?.data?.error ||
    error?.message ||
    "Orders API request failed";

  return {
    statusCode,
    code,
    message: String(responseMessage),
  };
}

export function buildMissingTokenError(): EntitySyncError {
  return {
    code: "UPUSE_ORDERS_TOKEN_MISSING",
    message: "Orders token is not configured.",
  };
}

export function markEntitySyncFailure(dayKey: string, globalEntityId: string, error: EntitySyncError) {
  const current = getEntitySyncState(dayKey, globalEntityId);
  const nowIso = nowUtcIso();
  upsertEntitySyncState(dayKey, globalEntityId, {
    ...current,
    consecutiveFailures: (current?.consecutiveFailures ?? 0) + 1,
    lastErrorAt: nowIso,
    lastErrorCode: error.code ?? (error.statusCode != null ? String(error.statusCode) : null),
    lastErrorMessage: error.message,
    staleSince: current?.staleSince ?? nowIso,
  });
}

export function markEntitySyncSuccess(dayKey: string, globalEntityId: string, fetchedAt: string, patch?: Partial<OrdersEntitySyncStateRow>) {
  const current = getEntitySyncState(dayKey, globalEntityId);
  upsertEntitySyncState(dayKey, globalEntityId, {
    ...current,
    ...patch,
    lastSuccessfulSyncAt: fetchedAt,
    consecutiveFailures: 0,
    lastErrorAt: null,
    lastErrorCode: null,
    lastErrorMessage: null,
    staleSince: null,
  });
}

export function buildEntityStatus(dayKey: string, globalEntityId: string, ordersRefreshSeconds: number): OrdersMirrorEntitySyncStatus {
  const state = getEntitySyncState(dayKey, globalEntityId);
  const fetchedAt = resolveFetchedAt(state);

  return {
    dayKey,
    globalEntityId,
    cacheState: resolveCacheState(state, ordersRefreshSeconds),
    fetchedAt,
    lastSuccessfulSyncAt: state?.lastSuccessfulSyncAt ?? fetchedAt,
    consecutiveFailures: state?.consecutiveFailures ?? 0,
    lastErrorMessage: state?.lastErrorMessage ?? null,
    bootstrapCompleted: Boolean(state?.bootstrapCompletedAt),
  };
}

export function getOrdersMirrorEntitySyncStatus(params?: {
  dayKey?: string;
  globalEntityId?: string;
  ordersRefreshSeconds?: number;
}) {
  const dayKey = params?.dayKey ?? getCairoDayKey();
  const globalEntityId = params?.globalEntityId ?? getGlobalEntityId();
  const ordersRefreshSeconds = params?.ordersRefreshSeconds ?? getSettings().ordersRefreshSeconds;
  return buildEntityStatus(dayKey, globalEntityId, ordersRefreshSeconds);
}
