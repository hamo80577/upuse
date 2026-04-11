import type { Statement } from "better-sqlite3";
import { db } from "../../../../config/db.js";
import { getWithRetry } from "../../../../services/orders/httpClient.js";
import { BASE } from "../../../../services/orders/types.js";
import { Mutex } from "../../../../utils/mutex.js";
import { nowUtcIso } from "../../../../utils/time.js";
import {
  extractCancellationDetail,
  normalizeLookupError,
} from "./detailLookup.js";
import { getOrdersHeaders } from "./fetchWindow.js";
import { upsertMirrorOrders } from "./mirrorPersistence.js";
import { extractTransportType, normalizeMirrorOrder } from "./normalization.js";
import type {
  DroppedActiveOrderCandidate,
  NormalizedMirrorOrder,
  OwnerLookupCandidate,
  TransportTypeLookupCandidate,
} from "./types.js";

let updateCancellationLookupStatement: Statement<any[]> | null = null;
let updateTransportTypeLookupStatement: Statement<any[]> | null = null;

const ownerLookupMutex = new Mutex();
const transportTypeLookupMutex = new Mutex();

async function mapWithConcurrency<T>(items: T[], concurrency: number, worker: (item: T) => Promise<void>) {
  if (!items.length) return;

  let cursor = 0;
  const workerCount = Math.max(1, Math.min(concurrency, items.length));
  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (cursor < items.length) {
        const index = cursor;
        cursor += 1;
        await worker(items[index]!);
      }
    }),
  );
}

function resolveOwnerLookupBatchLimit() {
  const raw = Number(process.env.UPUSE_PERFORMANCE_OWNER_LOOKUP_BATCH_LIMIT ?? "48");
  if (!Number.isFinite(raw)) return 48;
  return Math.max(1, Math.min(200, Math.floor(raw)));
}

function resolveTransportTypeLookupBatchLimit() {
  const raw = Number(process.env.UPUSE_PERFORMANCE_TRANSPORT_TYPE_LOOKUP_BATCH_LIMIT ?? "96");
  if (!Number.isFinite(raw)) return 96;
  return Math.max(1, Math.min(300, Math.floor(raw)));
}

function resolveDetailLookupConcurrency() {
  const raw = Number(process.env.UPUSE_PERFORMANCE_DETAIL_LOOKUP_CONCURRENCY ?? "4");
  if (!Number.isFinite(raw)) return 4;
  return Math.max(1, Math.min(10, Math.floor(raw)));
}

function resolveDetailLookupCooldownMs() {
  const raw = Number(process.env.UPUSE_PERFORMANCE_DETAIL_LOOKUP_COOLDOWN_MS ?? `${5 * 60 * 1000}`);
  if (!Number.isFinite(raw)) return 5 * 60 * 1000;
  return Math.max(30_000, Math.min(60 * 60 * 1000, Math.floor(raw)));
}

function getUpdateCancellationLookupStatement() {
  updateCancellationLookupStatement ??= db.prepare<
    [string | null, string | null, string | null, string | null, string | null, string | null, string, string | null, string, string, number, string]
  >(`
    UPDATE orders_mirror
    SET
      cancellationOwner = ?,
      cancellationReason = ?,
      cancellationStage = ?,
      cancellationSource = ?,
      cancellationCreatedAt = ?,
      cancellationUpdatedAt = ?,
      cancellationOwnerLookupAt = ?,
      cancellationOwnerLookupError = ?
    WHERE dayKey = ? AND globalEntityId = ? AND vendorId = ? AND orderId = ?
  `);

  return updateCancellationLookupStatement;
}

function getUpdateTransportTypeLookupStatement() {
  updateTransportTypeLookupStatement ??= db.prepare(`
    UPDATE orders_mirror
    SET
      transportType = ?,
      transportTypeLookupAt = ?,
      transportTypeLookupError = ?
    WHERE dayKey = ? AND globalEntityId = ? AND vendorId = ? AND orderId = ?
  `);

  return updateTransportTypeLookupStatement;
}

function listPendingOwnerLookupCandidates(dayKey: string, globalEntityId: string, cutoffIso: string, limit: number) {
  if (limit <= 0) return [];

  return db.prepare<[string, string, string, number], OwnerLookupCandidate>(`
    SELECT
      dayKey,
      globalEntityId,
      vendorId,
      orderId
    FROM orders_mirror
    WHERE dayKey = ?
      AND globalEntityId = ?
      AND isCancelled = 1
      AND (
        cancellationOwner IS NULL
        OR cancellationReason IS NULL
        OR cancellationCreatedAt IS NULL
      )
      AND (cancellationOwnerLookupAt IS NULL OR cancellationOwnerLookupAt <= ?)
    ORDER BY COALESCE(cancellationOwnerLookupAt, '') ASC, lastSeenAt DESC
    LIMIT ?
  `).all(dayKey, globalEntityId, cutoffIso, limit);
}

function listPendingTransportTypeLookupCandidates(dayKey: string, globalEntityId: string, cutoffIso: string, limit: number) {
  if (limit <= 0) return [];

  return db.prepare<[string, string, string, number], TransportTypeLookupCandidate>(`
    SELECT
      dayKey,
      globalEntityId,
      vendorId,
      orderId
    FROM orders_mirror
    WHERE dayKey = ?
      AND globalEntityId = ?
      AND transportType IS NULL
      AND (transportTypeLookupAt IS NULL OR transportTypeLookupAt <= ?)
    ORDER BY COALESCE(transportTypeLookupAt, '') ASC, lastSeenAt DESC
    LIMIT ?
  `).all(dayKey, globalEntityId, cutoffIso, limit);
}

function persistCancellationLookupResult(
  candidate: OwnerLookupCandidate,
  result: {
    owner: string | null;
    reason: string | null;
    stage: string | null;
    source: string | null;
    createdAt: string | null;
    updatedAt: string | null;
    lookedUpAt: string;
    error: string | null;
  },
) {
  getUpdateCancellationLookupStatement().run(
    result.owner,
    result.reason,
    result.stage,
    result.source,
    result.createdAt,
    result.updatedAt,
    result.lookedUpAt,
    result.error,
    candidate.dayKey,
    candidate.globalEntityId,
    candidate.vendorId,
    candidate.orderId,
  );
}

function persistTransportTypeLookupResult(
  candidate: TransportTypeLookupCandidate,
  result: {
    transportType: string | null;
    lookedUpAt: string;
    error: string | null;
  },
) {
  getUpdateTransportTypeLookupStatement().run(
    result.transportType,
    result.lookedUpAt,
    result.error,
    candidate.dayKey,
    candidate.globalEntityId,
    candidate.vendorId,
    candidate.orderId,
  );
}

async function fetchOrderDetailMetadata(orderId: string, token: string) {
  const response = await getWithRetry(
    `${BASE}/orders/${encodeURIComponent(orderId)}`,
    getOrdersHeaders(token),
    1,
  );

  return {
    order: response.data,
    cancellation: extractCancellationDetail(response.data),
    transportType: extractTransportType(response.data),
  };
}

export async function reconcileDroppedActiveOrders(params: {
  token: string;
  candidates: DroppedActiveOrderCandidate[];
}) {
  if (!params.candidates.length || !params.token.trim().length) return;

  const lookedUpAt = nowUtcIso();
  const normalizedRows: NormalizedMirrorOrder[] = [];
  let fatalAuthError: string | null = null;

  await mapWithConcurrency(params.candidates, resolveDetailLookupConcurrency(), async (candidate) => {
    if (fatalAuthError) return;

    try {
      const detail = await fetchOrderDetailMetadata(candidate.orderId, params.token);
      const normalized = normalizeMirrorOrder(
        detail.order,
        candidate.dayKey,
        candidate.globalEntityId,
        lookedUpAt,
        {
          vendorId: candidate.vendorId,
          vendorName: candidate.vendorName,
          orderId: candidate.orderId,
          externalId: candidate.externalId,
        },
      );

      if (normalized) {
        normalizedRows.push(normalized);
      }

      persistTransportTypeLookupResult(candidate, {
        transportType: detail.transportType,
        lookedUpAt,
        error: detail.transportType ? null : "Transport type was missing from the detail response.",
      });

      if (
        normalized?.isCancelled === 1
        || detail.cancellation.owner
        || detail.cancellation.reason
        || detail.cancellation.createdAt
      ) {
        persistCancellationLookupResult(candidate, {
          owner: detail.cancellation.owner,
          reason: detail.cancellation.reason,
          stage: detail.cancellation.stage,
          source: detail.cancellation.source,
          createdAt: detail.cancellation.createdAt,
          updatedAt: detail.cancellation.updatedAt,
          lookedUpAt,
          error:
            detail.cancellation.owner || detail.cancellation.reason || detail.cancellation.createdAt
              ? null
              : "Cancellation detail was missing from the detail response.",
        });
      }
    } catch (error: any) {
      const normalizedError = normalizeLookupError(error);
      if (normalizedError.status === 401 || normalizedError.status === 403) {
        fatalAuthError = normalizedError.message;
      }
    }
  });

  upsertMirrorOrders(normalizedRows);
}

export async function enrichTransportTypes(dayKey: string, globalEntityId: string, token: string) {
  if (!token.trim().length || transportTypeLookupMutex.locked) return;

  await transportTypeLookupMutex.runExclusive(async () => {
    const retryAfterIso = new Date(Date.now() - resolveDetailLookupCooldownMs()).toISOString();
    const candidates = listPendingTransportTypeLookupCandidates(
      dayKey,
      globalEntityId,
      retryAfterIso,
      resolveTransportTypeLookupBatchLimit(),
    );
    if (!candidates.length) return;

    const lookedUpAt = nowUtcIso();
    let fatalAuthError: string | null = null;

    await mapWithConcurrency(candidates, resolveDetailLookupConcurrency(), async (candidate) => {
      if (fatalAuthError) {
        persistTransportTypeLookupResult(candidate, {
          transportType: null,
          lookedUpAt,
          error: fatalAuthError,
        });
        return;
      }

      try {
        const detail = await fetchOrderDetailMetadata(candidate.orderId, token);
        persistTransportTypeLookupResult(candidate, {
          transportType: detail.transportType,
          lookedUpAt,
          error: detail.transportType ? null : "Transport type was missing from the detail response.",
        });
      } catch (error: any) {
        const normalized = normalizeLookupError(error);
        if (normalized.status === 401 || normalized.status === 403) {
          fatalAuthError = normalized.message;
        }
        persistTransportTypeLookupResult(candidate, {
          transportType: null,
          lookedUpAt,
          error: normalized.message,
        });
      }
    });
  });
}

export async function enrichCancellationOwners(dayKey: string, globalEntityId: string, token: string) {
  if (!token.trim().length || ownerLookupMutex.locked) return;

  await ownerLookupMutex.runExclusive(async () => {
    const retryAfterIso = new Date(Date.now() - resolveDetailLookupCooldownMs()).toISOString();
    const candidates = listPendingOwnerLookupCandidates(
      dayKey,
      globalEntityId,
      retryAfterIso,
      resolveOwnerLookupBatchLimit(),
    );
    if (!candidates.length) return;

    const lookedUpAt = nowUtcIso();
    let fatalAuthError: string | null = null;

    await mapWithConcurrency(candidates, resolveDetailLookupConcurrency(), async (candidate) => {
      if (fatalAuthError) {
        persistCancellationLookupResult(candidate, {
          owner: null,
          reason: null,
          stage: null,
          source: null,
          createdAt: null,
          updatedAt: null,
          lookedUpAt,
          error: fatalAuthError,
        });
        return;
      }

      try {
        const detail = await fetchOrderDetailMetadata(candidate.orderId, token);
        persistCancellationLookupResult(candidate, {
          owner: detail.cancellation.owner,
          reason: detail.cancellation.reason,
          stage: detail.cancellation.stage,
          source: detail.cancellation.source,
          createdAt: detail.cancellation.createdAt,
          updatedAt: detail.cancellation.updatedAt,
          lookedUpAt,
          error:
            detail.cancellation.owner || detail.cancellation.reason || detail.cancellation.createdAt
              ? null
              : "Cancellation detail was missing from the detail response.",
        });
      } catch (error: any) {
        const normalized = normalizeLookupError(error);
        if (normalized.status === 401 || normalized.status === 403) {
          fatalAuthError = normalized.message;
        }
        persistCancellationLookupResult(candidate, {
          owner: null,
          reason: null,
          stage: null,
          source: null,
          createdAt: null,
          updatedAt: null,
          lookedUpAt,
          error: normalized.message,
        });
      }
    });
  });
}

export async function drainTransportTypeEnrichment(dayKey: string, globalEntityId: string, token: string) {
  while (true) {
    const retryAfterIso = new Date(Date.now() - resolveDetailLookupCooldownMs()).toISOString();
    const pendingCandidates = listPendingTransportTypeLookupCandidates(
      dayKey,
      globalEntityId,
      retryAfterIso,
      resolveTransportTypeLookupBatchLimit(),
    );
    if (!pendingCandidates.length) {
      return;
    }
    await enrichTransportTypes(dayKey, globalEntityId, token);
  }
}

export async function drainCancellationOwnerEnrichment(dayKey: string, globalEntityId: string, token: string) {
  while (true) {
    const retryAfterIso = new Date(Date.now() - resolveDetailLookupCooldownMs()).toISOString();
    const pendingCandidates = listPendingOwnerLookupCandidates(
      dayKey,
      globalEntityId,
      retryAfterIso,
      resolveOwnerLookupBatchLimit(),
    );
    if (!pendingCandidates.length) {
      return;
    }
    await enrichCancellationOwners(dayKey, globalEntityId, token);
  }
}
