import { Mutex } from "../../../../utils/mutex.js";
import { getGlobalEntityId } from "../../../../services/settingsStore.js";
import { resolveOrdersHistorySyncSeconds } from "../../../../services/orders/shared.js";
import type { OrdersVendorId, ResolvedBranchMapping } from "../../../../types/models.js";
import { nowUtcIso } from "../../../../utils/time.js";
import { publishEntitySyncStatus } from "./statusPublication.js";
import { getCairoDayKey, getPreviousCairoDayKey, getSyncWindow, toMillis } from "./timeWindows.js";
import {
  BOOTSTRAP_SYNC_PAGE_SIZE,
  HISTORY_SYNC_PAGE_SIZE,
  ACTIVE_SYNC_PAGE_SIZE,
} from "./types.js";
import type {
  EntitySyncBaseResult,
  NormalizedMirrorOrder,
  OrdersMirrorSyncSummary,
  OrdersMirrorVendorSyncStatus,
} from "./types.js";
import { normalizeMirrorOrder } from "./normalization.js";
import {
  buildEntityStatus,
  buildMissingTokenError,
  getEntitySyncState,
  markEntitySyncFailure,
  markEntitySyncSuccess,
  pruneMirrorDays,
  summarizeMirrorSyncError,
  upsertEntitySyncState,
  resolveFetchedAt,
} from "./syncState.js";
import {
  fetchOrdersWindow,
  getHistoryWindow,
  shouldRequireFullRecoveryAudit,
  shouldReuseFreshState,
  shouldRunRepair,
} from "./fetchWindow.js";
import {
  listDroppedActiveOrderCandidates,
  replaceActiveOrders,
  upsertMirrorOrders,
} from "./mirrorPersistence.js";
import {
  drainCancellationOwnerEnrichment,
  drainTransportTypeEnrichment,
  enrichCancellationOwners,
  enrichTransportTypes,
  reconcileDroppedActiveOrders,
} from "./detailEnrichment.js";

const entitySyncMutex = new Mutex();
let entitySyncInFlight: Promise<EntitySyncBaseResult> | null = null;

async function performEntitySync(params: {
  token: string;
  globalEntityId: string;
  ordersRefreshSeconds: number;
  force?: boolean;
}) {
  const dayKey = getCairoDayKey();
  const previousDayKey = getPreviousCairoDayKey(dayKey);
  pruneMirrorDays([dayKey, previousDayKey]);

  let state = getEntitySyncState(dayKey, params.globalEntityId);
  if (!params.force && shouldReuseFreshState(state, params.ordersRefreshSeconds)) {
    const entityStatus = buildEntityStatus(dayKey, params.globalEntityId, params.ordersRefreshSeconds);
    return {
      dayKey,
      globalEntityId: params.globalEntityId,
      success: true,
      fetchedAt: entityStatus.fetchedAt,
      cacheState: entityStatus.cacheState,
      consecutiveFailures: entityStatus.consecutiveFailures,
    } satisfies EntitySyncBaseResult;
  }

  if (!params.token.trim().length) {
    const missingTokenError = buildMissingTokenError();
    markEntitySyncFailure(dayKey, params.globalEntityId, missingTokenError);
    const entityStatus = buildEntityStatus(dayKey, params.globalEntityId, params.ordersRefreshSeconds);
    publishEntitySyncStatus(entityStatus);
    return {
      dayKey,
      globalEntityId: params.globalEntityId,
      success: false,
      fetchedAt: entityStatus.fetchedAt,
      cacheState: entityStatus.cacheState,
      consecutiveFailures: entityStatus.consecutiveFailures,
      error: missingTokenError,
    } satisfies EntitySyncBaseResult;
  }

  try {
    const nowIso = nowUtcIso();
    const syncWindow = getSyncWindow(dayKey, nowIso);
    const phaseFetchedAt: string[] = [];
    const bootstrapRequired = !state?.bootstrapCompletedAt;
    const recoveryAuditRequired = shouldRequireFullRecoveryAudit(state, params.ordersRefreshSeconds);

    if (bootstrapRequired) {
      const bootstrap = await fetchOrdersWindow({
        token: params.token,
        globalEntityId: params.globalEntityId,
        pageSize: BOOTSTRAP_SYNC_PAGE_SIZE,
        window: syncWindow,
        nowIso,
      });

      upsertMirrorOrders(
        bootstrap.items
          .map((order) => normalizeMirrorOrder(order, dayKey, params.globalEntityId, bootstrap.fetchedAt))
          .filter((row): row is NormalizedMirrorOrder => Boolean(row)),
      );

      phaseFetchedAt.push(bootstrap.fetchedAt);
      upsertEntitySyncState(dayKey, params.globalEntityId, {
        ...state,
        lastBootstrapSyncAt: bootstrap.fetchedAt,
        lastHistoryCursorAt: syncWindow.endUtcIso,
        bootstrapCompletedAt: bootstrap.fetchedAt,
      });
      state = getEntitySyncState(dayKey, params.globalEntityId);
    } else {
      const active = await fetchOrdersWindow({
        token: params.token,
        globalEntityId: params.globalEntityId,
        pageSize: ACTIVE_SYNC_PAGE_SIZE,
        window: syncWindow,
        nowIso,
        isCompleted: false,
      });

      const activeRows = active.items
        .map((order) => normalizeMirrorOrder(order, dayKey, params.globalEntityId, active.fetchedAt))
        .filter((row): row is NormalizedMirrorOrder => Boolean(row));
      const activeOrderIds = activeRows.map((row) => row.orderId);

      upsertMirrorOrders(activeRows);
      const droppedActiveCandidates = listDroppedActiveOrderCandidates({
        dayKey,
        globalEntityId: params.globalEntityId,
        activeOrderIds,
      });
      replaceActiveOrders({
        dayKey,
        globalEntityId: params.globalEntityId,
        activeOrderIds,
      });
      await reconcileDroppedActiveOrders({
        token: params.token,
        candidates: droppedActiveCandidates,
      });
      phaseFetchedAt.push(active.fetchedAt);
      upsertEntitySyncState(dayKey, params.globalEntityId, {
        ...state,
        lastActiveSyncAt: active.fetchedAt,
      });
      state = getEntitySyncState(dayKey, params.globalEntityId);

      if (recoveryAuditRequired) {
        const recoveryAudit = await fetchOrdersWindow({
          token: params.token,
          globalEntityId: params.globalEntityId,
          pageSize: HISTORY_SYNC_PAGE_SIZE,
          window: syncWindow,
          nowIso,
        });

        upsertMirrorOrders(
          recoveryAudit.items
            .map((order) => normalizeMirrorOrder(order, dayKey, params.globalEntityId, recoveryAudit.fetchedAt))
            .filter((row): row is NormalizedMirrorOrder => Boolean(row)),
        );

        phaseFetchedAt.push(recoveryAudit.fetchedAt);
        upsertEntitySyncState(dayKey, params.globalEntityId, {
          ...state,
          lastHistorySyncAt: recoveryAudit.fetchedAt,
          lastFullHistorySweepAt: recoveryAudit.fetchedAt,
          lastHistoryCursorAt: syncWindow.endUtcIso,
        });
        state = getEntitySyncState(dayKey, params.globalEntityId);
      } else {
        const historyWindow = getHistoryWindow(dayKey, state, syncWindow.endUtcIso);
        const shouldRunHistory =
          historyWindow.shouldRun &&
          (params.force || !state?.lastHistorySyncAt || Date.now() - toMillis(state.lastHistorySyncAt) >= resolveOrdersHistorySyncSeconds() * 1000);

        if (shouldRunHistory) {
          const history = await fetchOrdersWindow({
            token: params.token,
            globalEntityId: params.globalEntityId,
            pageSize: HISTORY_SYNC_PAGE_SIZE,
            window: {
              startUtcIso: historyWindow.startUtcIso,
              endUtcIso: historyWindow.endUtcIso,
            },
            nowIso,
          });

          upsertMirrorOrders(
            history.items
              .map((order) => normalizeMirrorOrder(order, dayKey, params.globalEntityId, history.fetchedAt))
              .filter((row): row is NormalizedMirrorOrder => Boolean(row)),
          );

          phaseFetchedAt.push(history.fetchedAt);
          upsertEntitySyncState(dayKey, params.globalEntityId, {
            ...state,
            lastHistorySyncAt: history.fetchedAt,
            lastHistoryCursorAt: historyWindow.endUtcIso,
          });
          state = getEntitySyncState(dayKey, params.globalEntityId);
        }

        if (params.force || shouldRunRepair(state)) {
          const repair = await fetchOrdersWindow({
            token: params.token,
            globalEntityId: params.globalEntityId,
            pageSize: HISTORY_SYNC_PAGE_SIZE,
            window: syncWindow,
            nowIso,
          });

          upsertMirrorOrders(
            repair.items
              .map((order) => normalizeMirrorOrder(order, dayKey, params.globalEntityId, repair.fetchedAt))
              .filter((row): row is NormalizedMirrorOrder => Boolean(row)),
          );

          phaseFetchedAt.push(repair.fetchedAt);
          upsertEntitySyncState(dayKey, params.globalEntityId, {
            ...state,
            lastFullHistorySweepAt: repair.fetchedAt,
          });
          state = getEntitySyncState(dayKey, params.globalEntityId);
        }
      }
    }

    const latestFetchedAt = phaseFetchedAt.length
      ? phaseFetchedAt.reduce((latest, current) => (toMillis(current) > toMillis(latest) ? current : latest))
      : resolveFetchedAt(state) ?? nowIso;

    if (recoveryAuditRequired) {
      await drainTransportTypeEnrichment(dayKey, params.globalEntityId, params.token);
      await drainCancellationOwnerEnrichment(dayKey, params.globalEntityId, params.token);
    } else {
      await enrichTransportTypes(dayKey, params.globalEntityId, params.token);
      await enrichCancellationOwners(dayKey, params.globalEntityId, params.token);
    }

    markEntitySyncSuccess(dayKey, params.globalEntityId, latestFetchedAt, {
      ...state,
      bootstrapCompletedAt: state?.bootstrapCompletedAt ?? latestFetchedAt,
    });

    const entityStatus = buildEntityStatus(dayKey, params.globalEntityId, params.ordersRefreshSeconds);
    publishEntitySyncStatus(entityStatus);
    return {
      dayKey,
      globalEntityId: params.globalEntityId,
      success: true,
      fetchedAt: entityStatus.fetchedAt,
      cacheState: entityStatus.cacheState,
      consecutiveFailures: entityStatus.consecutiveFailures,
    } satisfies EntitySyncBaseResult;
  } catch (error: any) {
    const normalized = summarizeMirrorSyncError(error);
    markEntitySyncFailure(dayKey, params.globalEntityId, normalized);
    const entityStatus = buildEntityStatus(dayKey, params.globalEntityId, params.ordersRefreshSeconds);
    publishEntitySyncStatus(entityStatus);

    return {
      dayKey,
      globalEntityId: params.globalEntityId,
      success: false,
      fetchedAt: entityStatus.fetchedAt,
      cacheState: entityStatus.cacheState,
      consecutiveFailures: entityStatus.consecutiveFailures,
      error: normalized,
    } satisfies EntitySyncBaseResult;
  }
}

async function runEntitySync(params: {
  token: string;
  globalEntityId: string;
  ordersRefreshSeconds: number;
  force?: boolean;
}) {
  if (entitySyncInFlight) {
    return entitySyncInFlight;
  }

  entitySyncInFlight = entitySyncMutex
    .runExclusive(async () => performEntitySync(params))
    .finally(() => {
      entitySyncInFlight = null;
    });

  return entitySyncInFlight;
}

function buildSyncSummary(params: {
  branches: ResolvedBranchMapping[];
  dayKey: string;
  globalEntityId: string;
  ordersRefreshSeconds: number;
  base: EntitySyncBaseResult;
}): OrdersMirrorSyncSummary {
  const vendorIds = Array.from(new Set(params.branches.map((branch) => branch.ordersVendorId)));
  const entityStatus = buildEntityStatus(params.dayKey, params.globalEntityId, params.ordersRefreshSeconds);
  const statusesByVendor = new Map<OrdersVendorId, OrdersMirrorVendorSyncStatus>();

  for (const vendorId of vendorIds) {
    statusesByVendor.set(vendorId, {
      vendorId,
      cacheState: entityStatus.cacheState,
      fetchedAt: entityStatus.fetchedAt,
      consecutiveFailures: entityStatus.consecutiveFailures,
    });
  }

  return {
    dayKey: params.dayKey,
    totalVendors: vendorIds.length,
    successfulVendors: params.base.success ? vendorIds.length : 0,
    failedVendors: params.base.success ? 0 : vendorIds.length,
    updatedVendors: params.base.success ? vendorIds.length : 0,
    staleVendorCount: entityStatus.cacheState === "stale" ? vendorIds.length : 0,
    lastSuccessfulSyncAt: entityStatus.lastSuccessfulSyncAt,
    errors: params.base.error
      ? [
          {
            vendorIds,
            statusCode: params.base.error.statusCode,
            message: params.base.error.message,
          },
        ]
      : [],
    statusesByVendor,
  };
}

export async function syncOrdersMirror(params: {
  token: string;
  branches: ResolvedBranchMapping[];
  ordersRefreshSeconds: number;
  force?: boolean;
}): Promise<OrdersMirrorSyncSummary> {
  const globalEntityId = params.branches[0]?.globalEntityId ?? getGlobalEntityId();
  const base = await runEntitySync({
    token: params.token,
    globalEntityId,
    ordersRefreshSeconds: params.ordersRefreshSeconds,
    force: params.force,
  });

  return buildSyncSummary({
    branches: params.branches,
    dayKey: base.dayKey,
    globalEntityId,
    ordersRefreshSeconds: params.ordersRefreshSeconds,
    base,
  });
}
