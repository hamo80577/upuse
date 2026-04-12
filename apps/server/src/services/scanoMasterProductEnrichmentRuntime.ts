import { db } from "../config/db.js";
import { getEnv } from "../config/env.js";
import {
  ScanoCatalogClientError,
  listScanoProductAssignments,
  normalizeBarcodeForExternalLookup,
  searchScanoBranches,
  searchScanoProductsByBarcode,
} from "./scanoCatalogClient.js";

type TimerHandle = ReturnType<typeof setTimeout>;

type EnrichmentEntryStatus =
  | "pending_search"
  | "searching"
  | "pending_assignment"
  | "checking_assignment"
  | "enriched"
  | "failed"
  | "ambiguous";

type AssignmentCandidateStatus =
  | "pending"
  | "checking"
  | "matched"
  | "rejected"
  | "failed";

interface ChainJobRow {
  chainId: number;
  importRevision: number;
  enrichmentStatus: "queued" | "running" | "completed" | "paused_auth";
  enrichmentQueuedAt: string | null;
}

interface EntryRow {
  id: number;
  chainId: number;
  importRevision: number;
  rowNumber: number;
  sourceBarcode: string;
  normalizedBarcode: string;
  attemptCount: number;
}

interface AssignmentCandidateRow {
  id: number;
  entryId: number;
  chainId: number;
  importRevision: number;
  rowNumber: number;
  sourceBarcode: string;
  entryAttemptCount: number;
  externalProductId: string;
  barcode: string;
  barcodesJson: string;
  itemNameEn: string | null;
  itemNameAr: string | null;
  image: string | null;
  attemptCount: number;
}

interface EntryFinalizeRow {
  id: number;
  chainId: number;
  importRevision: number;
  sourceBarcode: string;
  attemptCount: number;
  status: EnrichmentEntryStatus;
}

interface MatchedCandidateRow {
  externalProductId: string;
  barcode: string;
  barcodesJson: string;
  itemNameEn: string | null;
  itemNameAr: string | null;
  image: string | null;
  sku: string | null;
  price: string | null;
  chainFlag: "yes" | "no";
  vendorFlag: "yes" | "no";
}

interface CandidateAssignmentSummary {
  chain: "yes" | "no";
  vendor: "yes" | "no";
  sku: string | null;
  price: string | null;
}

interface ChainContext {
  globalEntityId: string;
}

interface SearchStageCandidate {
  externalProductId: string;
  barcode: string;
  barcodes: string[];
  itemNameEn: string | null;
  itemNameAr: string | null;
  image: string | null;
}

interface RuntimeOptions {
  baseDelayPerCallMs?: number;
  maxRetryAttempts?: number;
  maxPenaltyMultiplier?: number;
  maxDelayMs?: number;
  searchConcurrency?: number;
  assignmentConcurrency?: number;
  assignmentBacklogLimit?: number;
  maxConcurrentEntries?: number;
  maxConcurrentAssignmentLookups?: number;
}

function readPositiveIntEnv(name: string, fallback: number) {
  const rawValue = Number(getEnv(name, String(fallback)));
  if (!Number.isFinite(rawValue)) {
    return fallback;
  }
  return Math.max(1, Math.floor(rawValue));
}

function readNonNegativeIntEnv(name: string, fallback: number) {
  const rawValue = Number(getEnv(name, String(fallback)));
  if (!Number.isFinite(rawValue)) {
    return fallback;
  }
  return Math.max(0, Math.floor(rawValue));
}

function nowIso() {
  return new Date().toISOString();
}

function clampDelay(value: number, maxDelayMs: number) {
  return Math.max(0, Math.min(maxDelayMs, Math.round(value)));
}

function dedupeStrings(values: Array<string | null | undefined>) {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const rawValue of values) {
    const value = (rawValue ?? "").trim();
    if (!value) continue;
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(value);
  }
  return result;
}

async function mapWithConcurrencyLimit<TInput, TOutput>(
  items: TInput[],
  concurrency: number,
  mapper: (item: TInput, index: number) => Promise<TOutput>,
) {
  if (!items.length) {
    return [] as TOutput[];
  }

  const results = new Array<TOutput>(items.length);
  let nextIndex = 0;
  const workerCount = Math.max(1, Math.min(concurrency, items.length));

  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (true) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      if (currentIndex >= items.length) {
        return;
      }

      results[currentIndex] = await mapper(items[currentIndex]!, currentIndex);
    }
  }));

  return results;
}

function parseBarcodesJson(rawValue: string, fallbackBarcode: string) {
  try {
    const parsed = JSON.parse(rawValue) as unknown;
    if (Array.isArray(parsed)) {
      const values = dedupeStrings(parsed.map((value) => typeof value === "string" ? value : ""));
      if (values.length) {
        return values;
      }
    }
  } catch {
    // Ignore malformed JSON and fall back to the stored barcode.
  }

  return dedupeStrings([fallbackBarcode]);
}

function dedupeSearchCandidates(items: Array<{
  id: string;
  barcode: string;
  barcodes?: string[];
  itemNameEn: string | null;
  itemNameAr: string | null;
  image: string | null;
}>): SearchStageCandidate[] {
  const seen = new Set<string>();
  const result: SearchStageCandidate[] = [];
  for (const item of items) {
    const productId = item.id.trim();
    if (!productId || seen.has(productId)) {
      continue;
    }
    seen.add(productId);
    const barcodes = dedupeStrings([item.barcode, ...(item.barcodes ?? [])]);
    result.push({
      externalProductId: productId,
      barcode: item.barcode,
      barcodes: barcodes.length ? barcodes : dedupeStrings([item.barcode]),
      itemNameEn: item.itemNameEn,
      itemNameAr: item.itemNameAr,
      image: item.image,
    });
  }
  return result;
}

function isExternalBarcodeExactMatch(item: {
  barcode: string;
  barcodes?: string[];
}, barcode: string) {
  const lookupBarcode = normalizeBarcodeForExternalLookup(barcode).toLowerCase();
  if (!lookupBarcode) return false;
  return dedupeStrings([item.barcode, ...(item.barcodes ?? [])])
    .some((value) => normalizeBarcodeForExternalLookup(value).toLowerCase() === lookupBarcode);
}

function getErrorStatus(error: unknown) {
  return typeof error === "object" && error !== null && "status" in error && typeof (error as { status?: unknown }).status === "number"
    ? (error as { status: number }).status
    : null;
}

function getErrorCode(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error && typeof (error as { code?: unknown }).code === "string"
    ? (error as { code: string }).code
    : null;
}

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message.trim()
    ? error.message.trim()
    : fallback;
}

function isAuthPauseError(error: unknown) {
  const status = getErrorStatus(error);
  const code = getErrorCode(error);
  return code === "SCANO_UPSTREAM_AUTH_REJECTED"
    || (status === 503 && error instanceof Error && error.message.toLowerCase().includes("not configured"));
}

function isTransientError(error: unknown) {
  const status = getErrorStatus(error);
  return status === 429 || (typeof status === "number" && status >= 500);
}

function selectNextChainJob() {
  return db.prepare<[], ChainJobRow>(`
    SELECT
      chainId,
      importRevision,
      enrichmentStatus,
      enrichmentQueuedAt
    FROM scano_master_products
    WHERE enrichmentStatus IN ('queued', 'running')
    ORDER BY
      CASE enrichmentStatus WHEN 'running' THEN 0 ELSE 1 END,
      datetime(COALESCE(enrichmentQueuedAt, updatedAt)) ASC,
      chainId ASC
    LIMIT 1
  `).get() ?? null;
}

function markChainRunning(chainId: number, atIso: string) {
  db.prepare(`
    UPDATE scano_master_products
    SET
      enrichmentStatus = 'running',
      enrichmentStartedAt = COALESCE(enrichmentStartedAt, ?),
      enrichmentPausedAt = NULL,
      enrichmentCompletedAt = NULL,
      warningCode = NULL,
      warningMessage = NULL
    WHERE chainId = ?
  `).run(atIso, chainId);
}

function claimDueSearchEntries(chainId: number, importRevision: number, atIso: string, limit: number) {
  return db.transaction(() => {
    const candidates = db.prepare<[number, number, string, number], EntryRow>(`
      SELECT
        id,
        chainId,
        importRevision,
        rowNumber,
        sourceBarcode,
        normalizedBarcode,
        attemptCount
      FROM scano_master_product_enrichment_entries
      WHERE chainId = ?
        AND importRevision = ?
        AND status = 'pending_search'
        AND (
          nextAttemptAt IS NULL
          OR datetime(nextAttemptAt) <= datetime(?)
        )
      ORDER BY rowNumber ASC, id ASC
      LIMIT ?
    `).all(chainId, importRevision, atIso, limit);

    if (!candidates.length) {
      return [] as EntryRow[];
    }

    const markEntrySearching = db.prepare(`
      UPDATE scano_master_product_enrichment_entries
      SET
        status = 'searching',
        updatedAt = ?
      WHERE id = ?
        AND status = 'pending_search'
    `);

    const claimed: EntryRow[] = [];
    for (const candidate of candidates) {
      const result = markEntrySearching.run(atIso, candidate.id);
      if (result.changes > 0) {
        claimed.push(candidate);
      }
    }

    return claimed;
  })();
}

function claimDueAssignmentCandidates(chainId: number, importRevision: number, atIso: string, limit: number) {
  return db.transaction(() => {
    const candidates = db.prepare<[number, number, string, number], AssignmentCandidateRow>(`
      SELECT
        candidate.id,
        candidate.entryId,
        candidate.chainId,
        candidate.importRevision,
        candidate.rowNumber,
        entry.sourceBarcode,
        entry.attemptCount AS entryAttemptCount,
        candidate.externalProductId,
        candidate.barcode,
        candidate.barcodesJson,
        candidate.itemNameEn,
        candidate.itemNameAr,
        candidate.image,
        candidate.attemptCount
      FROM scano_master_product_enrichment_candidates candidate
      INNER JOIN scano_master_product_enrichment_entries entry
        ON entry.id = candidate.entryId
      WHERE candidate.chainId = ?
        AND candidate.importRevision = ?
        AND candidate.status = 'pending'
        AND entry.status IN ('pending_assignment', 'checking_assignment')
        AND (
          candidate.nextAttemptAt IS NULL
          OR datetime(candidate.nextAttemptAt) <= datetime(?)
        )
      ORDER BY candidate.rowNumber ASC, candidate.id ASC
      LIMIT ?
    `).all(chainId, importRevision, atIso, limit);

    if (!candidates.length) {
      return [] as AssignmentCandidateRow[];
    }

    const markCandidateChecking = db.prepare(`
      UPDATE scano_master_product_enrichment_candidates
      SET
        status = 'checking',
        updatedAt = ?
      WHERE id = ?
        AND status = 'pending'
    `);
    const markEntryChecking = db.prepare(`
      UPDATE scano_master_product_enrichment_entries
      SET
        status = 'checking_assignment',
        updatedAt = ?
      WHERE id = ?
        AND status IN ('pending_assignment', 'checking_assignment')
    `);

    const claimed: AssignmentCandidateRow[] = [];
    const entryIds = new Set<number>();
    for (const candidate of candidates) {
      const result = markCandidateChecking.run(atIso, candidate.id);
      if (result.changes > 0) {
        claimed.push(candidate);
        entryIds.add(candidate.entryId);
      }
    }

    for (const entryId of entryIds) {
      markEntryChecking.run(atIso, entryId);
    }

    return claimed;
  })();
}

function countAssignmentBacklog(chainId: number, importRevision: number) {
  const row = db.prepare<[number, number], { count: number }>(`
    SELECT COUNT(*) AS count
    FROM scano_master_product_enrichment_candidates
    WHERE chainId = ?
      AND importRevision = ?
      AND status IN ('pending', 'checking')
  `).get(chainId, importRevision);

  return row?.count ?? 0;
}

function selectNextPendingSearchRetryAt(chainId: number, importRevision: number) {
  const row = db.prepare<[number, number], { nextAttemptAt: string | null }>(`
    SELECT nextAttemptAt
    FROM scano_master_product_enrichment_entries
    WHERE chainId = ?
      AND importRevision = ?
      AND status = 'pending_search'
      AND nextAttemptAt IS NOT NULL
    ORDER BY datetime(nextAttemptAt) ASC, rowNumber ASC, id ASC
    LIMIT 1
  `).get(chainId, importRevision);

  return row?.nextAttemptAt ?? null;
}

function selectNextPendingAssignmentRetryAt(chainId: number, importRevision: number) {
  const row = db.prepare<[number, number], { nextAttemptAt: string | null }>(`
    SELECT nextAttemptAt
    FROM scano_master_product_enrichment_candidates
    WHERE chainId = ?
      AND importRevision = ?
      AND status = 'pending'
      AND nextAttemptAt IS NOT NULL
    ORDER BY datetime(nextAttemptAt) ASC, rowNumber ASC, id ASC
    LIMIT 1
  `).get(chainId, importRevision);

  return row?.nextAttemptAt ?? null;
}

function refreshChainProgress(chainId: number, importRevision: number) {
  const counts = db.prepare<[number, number], {
    enrichedCount: number | null;
    processedCount: number | null;
  }>(`
    SELECT
      SUM(CASE WHEN status = 'enriched' THEN 1 ELSE 0 END) AS enrichedCount,
      SUM(CASE WHEN status IN ('enriched', 'failed', 'ambiguous') THEN 1 ELSE 0 END) AS processedCount
    FROM scano_master_product_enrichment_entries
    WHERE chainId = ?
      AND importRevision = ?
  `).get(chainId, importRevision);

  db.prepare(`
    UPDATE scano_master_products
    SET
      enrichedCount = ?,
      processedCount = ?
    WHERE chainId = ?
      AND importRevision = ?
  `).run(
    counts?.enrichedCount ?? 0,
    counts?.processedCount ?? 0,
    chainId,
    importRevision,
  );
}

function finalizeChainIfDone(chainId: number, importRevision: number, atIso: string) {
  const activeEntryRow = db.prepare<[number, number], { count: number }>(`
    SELECT COUNT(*) AS count
    FROM scano_master_product_enrichment_entries
    WHERE chainId = ?
      AND importRevision = ?
      AND status IN ('pending_search', 'searching', 'pending_assignment', 'checking_assignment')
  `).get(chainId, importRevision);
  if ((activeEntryRow?.count ?? 0) > 0) {
    return false;
  }

  const activeCandidateRow = db.prepare<[number, number], { count: number }>(`
    SELECT COUNT(*) AS count
    FROM scano_master_product_enrichment_candidates
    WHERE chainId = ?
      AND importRevision = ?
      AND status IN ('pending', 'checking')
  `).get(chainId, importRevision);
  if ((activeCandidateRow?.count ?? 0) > 0) {
    return false;
  }

  refreshChainProgress(chainId, importRevision);
  db.prepare(`
    UPDATE scano_master_products
    SET
      enrichmentStatus = 'completed',
      enrichmentCompletedAt = ?,
      warningCode = NULL,
      warningMessage = NULL
    WHERE chainId = ?
      AND importRevision = ?
  `).run(atIso, chainId, importRevision);

  return true;
}

function deleteEntryLookupBarcodes(entryId: number) {
  db.prepare(`
    DELETE FROM scano_master_product_enrichment_barcodes
    WHERE entryId = ?
  `).run(entryId);
}

function deleteEntryCandidates(entryId: number) {
  db.prepare(`
    DELETE FROM scano_master_product_enrichment_candidates
    WHERE entryId = ?
  `).run(entryId);
}

function saveTerminalEntry(params: {
  entryId: number;
  status: "failed" | "ambiguous";
  attemptCount: number;
  lastError: string;
  updatedAt: string;
}) {
  deleteEntryLookupBarcodes(params.entryId);

  db.prepare(`
    UPDATE scano_master_product_enrichment_entries
    SET
      status = ?,
      attemptCount = ?,
      nextAttemptAt = NULL,
      lastError = ?,
      externalProductId = NULL,
      sku = NULL,
      price = NULL,
      itemNameEn = NULL,
      itemNameAr = NULL,
      image = NULL,
      chainFlag = NULL,
      vendorFlag = NULL,
      enrichedAt = NULL,
      updatedAt = ?
    WHERE id = ?
  `).run(
    params.status,
    params.attemptCount,
    params.lastError,
    params.updatedAt,
    params.entryId,
  );
}

function saveSearchRetryEntry(params: {
  entryId: number;
  attemptCount: number;
  nextAttemptAt: string;
  lastError: string;
  updatedAt: string;
}) {
  deleteEntryCandidates(params.entryId);
  db.prepare(`
    UPDATE scano_master_product_enrichment_entries
    SET
      status = 'pending_search',
      attemptCount = ?,
      nextAttemptAt = ?,
      lastError = ?,
      updatedAt = ?
    WHERE id = ?
  `).run(
    params.attemptCount,
    params.nextAttemptAt,
    params.lastError,
    params.updatedAt,
    params.entryId,
  );
}

function saveAuthPausedSearchEntry(params: {
  entryId: number;
  chainId: number;
  importRevision: number;
  warningCode: string;
  warningMessage: string;
  updatedAt: string;
}) {
  deleteEntryCandidates(params.entryId);
  db.prepare(`
    UPDATE scano_master_product_enrichment_entries
    SET
      status = 'pending_search',
      nextAttemptAt = NULL,
      lastError = ?,
      updatedAt = ?
    WHERE id = ?
  `).run(
    params.warningMessage,
    params.updatedAt,
    params.entryId,
  );

  refreshChainProgress(params.chainId, params.importRevision);
  db.prepare(`
    UPDATE scano_master_products
    SET
      enrichmentStatus = 'paused_auth',
      enrichmentPausedAt = ?,
      warningCode = ?,
      warningMessage = ?
    WHERE chainId = ?
      AND importRevision = ?
  `).run(
    params.updatedAt,
    params.warningCode,
    params.warningMessage,
    params.chainId,
    params.importRevision,
  );
}

function storeSearchCandidatesAndMarkEntry(params: {
  entryId: number;
  chainId: number;
  importRevision: number;
  rowNumber: number;
  attemptCount: number;
  candidates: SearchStageCandidate[];
  updatedAt: string;
}) {
  db.transaction(() => {
    deleteEntryCandidates(params.entryId);
    deleteEntryLookupBarcodes(params.entryId);

    db.prepare(`
      UPDATE scano_master_product_enrichment_entries
      SET
        status = 'pending_assignment',
        attemptCount = ?,
        nextAttemptAt = NULL,
        lastError = NULL,
        externalProductId = NULL,
        sku = NULL,
        price = NULL,
        itemNameEn = NULL,
        itemNameAr = NULL,
        image = NULL,
        chainFlag = NULL,
        vendorFlag = NULL,
        enrichedAt = NULL,
        updatedAt = ?
      WHERE id = ?
    `).run(
      params.attemptCount,
      params.updatedAt,
      params.entryId,
    );

    const insertCandidate = db.prepare(`
      INSERT INTO scano_master_product_enrichment_candidates (
        entryId,
        chainId,
        importRevision,
        rowNumber,
        externalProductId,
        barcode,
        barcodesJson,
        itemNameEn,
        itemNameAr,
        image,
        status,
        attemptCount,
        nextAttemptAt,
        lastError,
        sku,
        price,
        chainFlag,
        vendorFlag,
        createdAt,
        updatedAt
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', 0, NULL, NULL, NULL, NULL, NULL, NULL, ?, ?)
    `);

    for (const candidate of params.candidates) {
      insertCandidate.run(
        params.entryId,
        params.chainId,
        params.importRevision,
        params.rowNumber,
        candidate.externalProductId,
        candidate.barcode,
        JSON.stringify(candidate.barcodes),
        candidate.itemNameEn,
        candidate.itemNameAr,
        candidate.image,
        params.updatedAt,
        params.updatedAt,
      );
    }
  })();
}

function updateCandidateStatus(params: {
  candidateId: number;
  expectedStatus: AssignmentCandidateStatus;
  nextStatus: AssignmentCandidateStatus;
  attemptCount?: number;
  nextAttemptAt?: string | null;
  lastError?: string | null;
  sku?: string | null;
  price?: string | null;
  chainFlag?: "yes" | "no" | null;
  vendorFlag?: "yes" | "no" | null;
  updatedAt: string;
}) {
  const result = db.prepare(`
    UPDATE scano_master_product_enrichment_candidates
    SET
      status = ?,
      attemptCount = COALESCE(?, attemptCount),
      nextAttemptAt = ?,
      lastError = ?,
      sku = ?,
      price = ?,
      chainFlag = ?,
      vendorFlag = ?,
      updatedAt = ?
    WHERE id = ?
      AND status = ?
  `).run(
    params.nextStatus,
    params.attemptCount ?? null,
    params.nextAttemptAt ?? null,
    params.lastError ?? null,
    params.sku ?? null,
    params.price ?? null,
    params.chainFlag ?? null,
    params.vendorFlag ?? null,
    params.updatedAt,
    params.candidateId,
    params.expectedStatus,
  );

  return result.changes > 0;
}

function saveCandidateRetry(params: {
  candidateId: number;
  entryId: number;
  attemptCount: number;
  nextAttemptAt: string;
  lastError: string;
  updatedAt: string;
}) {
  const updated = updateCandidateStatus({
    candidateId: params.candidateId,
    expectedStatus: "checking",
    nextStatus: "pending",
    attemptCount: params.attemptCount,
    nextAttemptAt: params.nextAttemptAt,
    lastError: params.lastError,
    updatedAt: params.updatedAt,
  });
  if (!updated) {
    return false;
  }

  db.prepare(`
    UPDATE scano_master_product_enrichment_entries
    SET
      status = 'pending_assignment',
      updatedAt = ?
    WHERE id = ?
      AND status IN ('pending_assignment', 'checking_assignment')
  `).run(
    params.updatedAt,
    params.entryId,
  );

  return true;
}

function saveAuthPausedCandidate(params: {
  candidateId: number;
  entryId: number;
  chainId: number;
  importRevision: number;
  warningCode: string;
  warningMessage: string;
  updatedAt: string;
}) {
  const updated = updateCandidateStatus({
    candidateId: params.candidateId,
    expectedStatus: "checking",
    nextStatus: "pending",
    nextAttemptAt: null,
    lastError: params.warningMessage,
    updatedAt: params.updatedAt,
  });
  if (!updated) {
    return false;
  }

  db.prepare(`
    UPDATE scano_master_product_enrichment_entries
    SET
      status = 'pending_assignment',
      updatedAt = ?
    WHERE id = ?
      AND status IN ('pending_assignment', 'checking_assignment')
  `).run(
    params.updatedAt,
    params.entryId,
  );

  refreshChainProgress(params.chainId, params.importRevision);
  db.prepare(`
    UPDATE scano_master_products
    SET
      enrichmentStatus = 'paused_auth',
      enrichmentPausedAt = ?,
      warningCode = ?,
      warningMessage = ?
    WHERE chainId = ?
      AND importRevision = ?
  `).run(
    params.updatedAt,
    params.warningCode,
    params.warningMessage,
    params.chainId,
    params.importRevision,
  );

  return true;
}

function saveCandidateMatched(params: {
  candidateId: number;
  attemptCount: number;
  assignment: CandidateAssignmentSummary;
  updatedAt: string;
}) {
  return updateCandidateStatus({
    candidateId: params.candidateId,
    expectedStatus: "checking",
    nextStatus: "matched",
    attemptCount: params.attemptCount,
    nextAttemptAt: null,
    lastError: null,
    sku: params.assignment.sku,
    price: params.assignment.price,
    chainFlag: params.assignment.chain,
    vendorFlag: params.assignment.vendor,
    updatedAt: params.updatedAt,
  });
}

function saveCandidateRejected(params: {
  candidateId: number;
  attemptCount: number;
  updatedAt: string;
}) {
  return updateCandidateStatus({
    candidateId: params.candidateId,
    expectedStatus: "checking",
    nextStatus: "rejected",
    attemptCount: params.attemptCount,
    nextAttemptAt: null,
    lastError: null,
    sku: null,
    price: null,
    chainFlag: "no",
    vendorFlag: "no",
    updatedAt: params.updatedAt,
  });
}

function failEntryFromAssignmentError(params: {
  entryId: number;
  candidateId: number;
  entryAttemptCount: number;
  candidateAttemptCount: number;
  message: string;
  updatedAt: string;
}) {
  return db.transaction(() => {
    const updated = updateCandidateStatus({
      candidateId: params.candidateId,
      expectedStatus: "checking",
      nextStatus: "failed",
      attemptCount: params.candidateAttemptCount,
      nextAttemptAt: null,
      lastError: params.message,
      updatedAt: params.updatedAt,
    });
    if (!updated) {
      return false;
    }

    db.prepare(`
      UPDATE scano_master_product_enrichment_candidates
      SET
        status = 'failed',
        nextAttemptAt = NULL,
        lastError = COALESCE(lastError, ?),
        updatedAt = ?
      WHERE entryId = ?
        AND status IN ('pending', 'checking')
    `).run(
      params.message,
      params.updatedAt,
      params.entryId,
    );

    saveTerminalEntry({
      entryId: params.entryId,
      status: "failed",
      attemptCount: params.entryAttemptCount,
      lastError: params.message,
      updatedAt: params.updatedAt,
    });

    return true;
  })();
}

function saveEnrichedEntry(params: {
  entryId: number;
  chainId: number;
  importRevision: number;
  attemptCount: number;
  sourceBarcode: string;
  barcodes: string[];
  externalProductId: string;
  sku: string | null;
  price: string | null;
  itemNameEn: string | null;
  itemNameAr: string | null;
  image: string | null;
  chainFlag: "yes" | "no";
  vendorFlag: "yes" | "no";
  updatedAt: string;
}) {
  deleteEntryLookupBarcodes(params.entryId);

  db.prepare(`
    UPDATE scano_master_product_enrichment_entries
    SET
      status = 'enriched',
      attemptCount = ?,
      nextAttemptAt = NULL,
      lastError = NULL,
      externalProductId = ?,
      sku = ?,
      price = ?,
      itemNameEn = ?,
      itemNameAr = ?,
      image = ?,
      chainFlag = ?,
      vendorFlag = ?,
      enrichedAt = ?,
      updatedAt = ?
    WHERE id = ?
  `).run(
    params.attemptCount,
    params.externalProductId,
    params.sku,
    params.price,
    params.itemNameEn,
    params.itemNameAr,
    params.image,
    params.chainFlag,
    params.vendorFlag,
    params.updatedAt,
    params.updatedAt,
    params.entryId,
  );

  const insertBarcode = db.prepare(`
    INSERT INTO scano_master_product_enrichment_barcodes (
      entryId,
      chainId,
      importRevision,
      barcode,
      normalizedBarcode,
      createdAt
    ) VALUES (?, ?, ?, ?, ?, ?)
  `);

  for (const barcode of dedupeStrings([params.sourceBarcode, ...params.barcodes])) {
    const normalizedBarcode = normalizeBarcodeForExternalLookup(barcode);
    if (!normalizedBarcode) continue;
    insertBarcode.run(
      params.entryId,
      params.chainId,
      params.importRevision,
      barcode,
      normalizedBarcode,
      params.updatedAt,
    );
  }

  refreshChainProgress(params.chainId, params.importRevision);
}

function maybeFinalizeEntryAfterAssignments(entryId: number, updatedAt: string) {
  const entry = db.prepare<[number], EntryFinalizeRow>(`
    SELECT
      id,
      chainId,
      importRevision,
      sourceBarcode,
      attemptCount,
      status
    FROM scano_master_product_enrichment_entries
    WHERE id = ?
  `).get(entryId);
  if (!entry || !["pending_assignment", "checking_assignment"].includes(entry.status)) {
    return false;
  }

  const candidateState = db.prepare<[number], {
    pendingCount: number | null;
    checkingCount: number | null;
    matchedCount: number | null;
  }>(`
    SELECT
      SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pendingCount,
      SUM(CASE WHEN status = 'checking' THEN 1 ELSE 0 END) AS checkingCount,
      SUM(CASE WHEN status = 'matched' THEN 1 ELSE 0 END) AS matchedCount
    FROM scano_master_product_enrichment_candidates
    WHERE entryId = ?
  `).get(entryId);

  const pendingCount = candidateState?.pendingCount ?? 0;
  const checkingCount = candidateState?.checkingCount ?? 0;
  const matchedCount = candidateState?.matchedCount ?? 0;

  if (pendingCount > 0 || checkingCount > 0) {
    db.prepare(`
      UPDATE scano_master_product_enrichment_entries
      SET
        status = ?,
        updatedAt = ?
      WHERE id = ?
        AND status IN ('pending_assignment', 'checking_assignment')
    `).run(
      checkingCount > 0 ? "checking_assignment" : "pending_assignment",
      updatedAt,
      entryId,
    );
    return false;
  }

  if (matchedCount === 0) {
    saveTerminalEntry({
      entryId,
      status: "failed",
      attemptCount: entry.attemptCount,
      lastError: "Exact external matches were found, but none were assigned to this chain.",
      updatedAt,
    });
    refreshChainProgress(entry.chainId, entry.importRevision);
    return true;
  }

  if (matchedCount > 1) {
    saveTerminalEntry({
      entryId,
      status: "ambiguous",
      attemptCount: entry.attemptCount,
      lastError: "Multiple exact external products were assigned to this chain.",
      updatedAt,
    });
    refreshChainProgress(entry.chainId, entry.importRevision);
    return true;
  }

  const matched = db.prepare<[number], MatchedCandidateRow>(`
    SELECT
      externalProductId,
      barcode,
      barcodesJson,
      itemNameEn,
      itemNameAr,
      image,
      sku,
      price,
      chainFlag,
      vendorFlag
    FROM scano_master_product_enrichment_candidates
    WHERE entryId = ?
      AND status = 'matched'
    ORDER BY id ASC
    LIMIT 1
  `).get(entryId);
  if (!matched) {
    return false;
  }

  saveEnrichedEntry({
    entryId,
    chainId: entry.chainId,
    importRevision: entry.importRevision,
    attemptCount: entry.attemptCount,
    sourceBarcode: entry.sourceBarcode,
    barcodes: parseBarcodesJson(matched.barcodesJson, matched.barcode),
    externalProductId: matched.externalProductId,
    sku: matched.sku,
    price: matched.price,
    itemNameEn: matched.itemNameEn,
    itemNameAr: matched.itemNameAr,
    image: matched.image,
    chainFlag: matched.chainFlag,
    vendorFlag: matched.vendorFlag,
    updatedAt,
  });

  return true;
}

function finalizeReadyAssignmentEntries(chainId: number, importRevision: number, updatedAt: string) {
  const items = db.prepare<[number, number], { id: number }>(`
    SELECT entry.id
    FROM scano_master_product_enrichment_entries entry
    WHERE entry.chainId = ?
      AND entry.importRevision = ?
      AND entry.status IN ('pending_assignment', 'checking_assignment')
      AND EXISTS (
        SELECT 1
        FROM scano_master_product_enrichment_candidates candidate
        WHERE candidate.entryId = entry.id
      )
      AND NOT EXISTS (
        SELECT 1
        FROM scano_master_product_enrichment_candidates candidate
        WHERE candidate.entryId = entry.id
          AND candidate.status IN ('pending', 'checking')
      )
    ORDER BY entry.rowNumber ASC, entry.id ASC
  `).all(chainId, importRevision);

  let finalizedCount = 0;
  for (const item of items) {
    if (maybeFinalizeEntryAfterAssignments(item.id, updatedAt)) {
      finalizedCount += 1;
    }
  }
  return finalizedCount;
}

function requeuePausedAuthJobs() {
  db.prepare(`
    UPDATE scano_master_products
    SET
      enrichmentStatus = 'queued',
      enrichmentPausedAt = NULL,
      warningCode = NULL,
      warningMessage = NULL
    WHERE enrichmentStatus = 'paused_auth'
  `).run();
}

function recoverInterruptedWork() {
  db.exec(`
    UPDATE scano_master_product_enrichment_entries
    SET
      status = 'pending_search',
      nextAttemptAt = NULL
    WHERE status IN ('pending', 'running', 'searching');

    UPDATE scano_master_product_enrichment_entries
    SET
      status = CASE
        WHEN EXISTS (
          SELECT 1
          FROM scano_master_product_enrichment_candidates candidate
          WHERE candidate.entryId = scano_master_product_enrichment_entries.id
        ) THEN 'pending_assignment'
        ELSE 'pending_search'
      END
    WHERE status IN ('pending_assignment', 'checking_assignment');

    UPDATE scano_master_product_enrichment_candidates
    SET
      status = 'pending',
      nextAttemptAt = NULL
    WHERE status = 'checking';

    UPDATE scano_master_products
    SET enrichmentStatus = 'queued'
    WHERE enrichmentStatus = 'running';
  `);
}

export class ScanoMasterProductEnrichmentRuntime {
  private readonly baseDelayPerCallMs: number;
  private readonly maxRetryAttempts: number;
  private readonly maxPenaltyMultiplier: number;
  private readonly maxDelayMs: number;
  private readonly searchConcurrency: number;
  private readonly assignmentConcurrency: number;
  private readonly assignmentBacklogLimit: number;
  private timer: TimerHandle | null = null;
  private started = false;
  private processing = false;
  private penaltyMultiplier = 1;
  private readonly chainContextCache = new Map<string, ChainContext>();
  private readonly chainContextInFlight = new Map<string, Promise<ChainContext>>();

  constructor(options?: RuntimeOptions) {
    this.baseDelayPerCallMs = Math.max(
      0,
      options?.baseDelayPerCallMs ?? readNonNegativeIntEnv("UPUSE_SCANO_MASTER_ENRICHMENT_BASE_DELAY_MS", 25),
    );
    this.maxRetryAttempts = Math.max(
      1,
      options?.maxRetryAttempts ?? readPositiveIntEnv("UPUSE_SCANO_MASTER_ENRICHMENT_MAX_RETRY_ATTEMPTS", 3),
    );
    this.maxPenaltyMultiplier = Math.max(
      1,
      options?.maxPenaltyMultiplier ?? readPositiveIntEnv("UPUSE_SCANO_MASTER_ENRICHMENT_MAX_PENALTY_MULTIPLIER", 12),
    );
    this.maxDelayMs = Math.max(
      5_000,
      options?.maxDelayMs ?? readPositiveIntEnv("UPUSE_SCANO_MASTER_ENRICHMENT_MAX_DELAY_MS", 10 * 60 * 1000),
    );
    this.searchConcurrency = Math.max(
      1,
      Math.floor(
        options?.searchConcurrency
        ?? options?.maxConcurrentEntries
        ?? readPositiveIntEnv(
          "UPUSE_SCANO_MASTER_ENRICHMENT_SEARCH_CONCURRENCY",
          readPositiveIntEnv("UPUSE_SCANO_MASTER_ENRICHMENT_CONCURRENCY", 24),
        ),
      ),
    );
    this.assignmentConcurrency = Math.max(
      1,
      Math.floor(
        options?.assignmentConcurrency
        ?? options?.maxConcurrentAssignmentLookups
        ?? readPositiveIntEnv(
          "UPUSE_SCANO_MASTER_ENRICHMENT_ASSIGNMENT_CONCURRENCY",
          readPositiveIntEnv("UPUSE_SCANO_MASTER_ENRICHMENT_ASSIGNMENT_LOOKUP_CONCURRENCY", 24),
        ),
      ),
    );
    this.assignmentBacklogLimit = Math.max(
      this.assignmentConcurrency,
      Math.floor(
        options?.assignmentBacklogLimit
        ?? readPositiveIntEnv("UPUSE_SCANO_MASTER_ENRICHMENT_ASSIGNMENT_BACKLOG_LIMIT", 240),
      ),
    );
  }

  start() {
    if (this.started) {
      return;
    }
    this.started = true;
    recoverInterruptedWork();
    this.schedule(0);
  }

  stop() {
    this.started = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  poke() {
    if (!this.started) {
      return;
    }
    this.schedule(0, true);
  }

  notifyConfigChanged() {
    requeuePausedAuthJobs();
    this.penaltyMultiplier = 1;
    this.poke();
  }

  async runCycleOnce() {
    if (!this.started || this.processing) {
      return false;
    }

    this.processing = true;
    try {
      return await this.processNextChain();
    } finally {
      this.processing = false;
    }
  }

  private schedule(delayMs: number, replace = false) {
    if (!this.started) {
      return;
    }
    if (this.timer && !replace) {
      return;
    }
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.runCycleOnce();
    }, clampDelay(delayMs, this.maxDelayMs));
  }

  private async processNextChain() {
    const chain = selectNextChainJob();
    if (!chain) {
      this.schedule(this.baseDelayPerCallMs * 5);
      return false;
    }

    const startedAt = nowIso();
    if (chain.enrichmentStatus !== "running") {
      markChainRunning(chain.chainId, startedAt);
    }

    const assignmentCandidates = claimDueAssignmentCandidates(
      chain.chainId,
      chain.importRevision,
      startedAt,
      this.assignmentConcurrency,
    );
    const assignmentBacklog = countAssignmentBacklog(chain.chainId, chain.importRevision);
    const searchEntries = assignmentBacklog < this.assignmentBacklogLimit
      ? claimDueSearchEntries(chain.chainId, chain.importRevision, startedAt, this.searchConcurrency)
      : [];

    if (!searchEntries.length && !assignmentCandidates.length) {
      const finalizedReadyEntries = finalizeReadyAssignmentEntries(chain.chainId, chain.importRevision, startedAt);
      const finalized = finalizeChainIfDone(chain.chainId, chain.importRevision, startedAt);
      if (finalized) {
        this.chainContextCache.delete(this.getChainCacheKey(chain.chainId, chain.importRevision));
        this.penaltyMultiplier = Math.max(1, this.penaltyMultiplier * 0.9);
        this.schedule(0, true);
        return true;
      }

      if (finalizedReadyEntries > 0) {
        this.schedule(0, true);
        return true;
      }

      const nextRetryAt = this.selectNextPendingRetryAt(chain.chainId, chain.importRevision);
      if (nextRetryAt) {
        this.schedule(Math.max(this.baseDelayPerCallMs, Date.parse(nextRetryAt) - Date.now()), true);
        return false;
      }

      this.schedule(this.baseDelayPerCallMs, true);
      return false;
    }

    const [searchResults, assignmentResults] = await Promise.all([
      Promise.all(searchEntries.map((entry) => this.processSearchEntry(chain, entry, startedAt))),
      Promise.all(assignmentCandidates.map((candidate) => this.processAssignmentCandidate(chain, candidate, startedAt))),
    ]);

    finalizeReadyAssignmentEntries(chain.chainId, chain.importRevision, nowIso());
    finalizeChainIfDone(chain.chainId, chain.importRevision, nowIso());

    const results = [...searchResults, ...assignmentResults];
    if (results.some((result) => result.kind === "auth_pause")) {
      this.schedule(this.baseDelayPerCallMs * 10, true);
      return false;
    }

    if (results.length > 0) {
      this.schedule(clampDelay(this.baseDelayPerCallMs * this.penaltyMultiplier, this.maxDelayMs), true);
      return true;
    }

    this.schedule(this.baseDelayPerCallMs, true);
    return false;
  }

  private async processSearchEntry(chain: ChainJobRow, entry: EntryRow, atIso: string): Promise<{
    kind: "processed" | "auth_pause";
  }> {
    try {
      const chainContext = await this.getChainContext(chain.chainId, chain.importRevision);

      const searchResults = await searchScanoProductsByBarcode({
        barcode: entry.sourceBarcode,
        globalEntityId: chainContext.value.globalEntityId,
      });

      const exactMatches = dedupeSearchCandidates(
        searchResults.filter((item) => isExternalBarcodeExactMatch(item, entry.sourceBarcode)),
      );
      if (!exactMatches.length) {
        deleteEntryCandidates(entry.id);
        saveTerminalEntry({
          entryId: entry.id,
          status: "failed",
          attemptCount: entry.attemptCount + 1,
          lastError: "No exact external product match was found for this barcode.",
          updatedAt: atIso,
        });
        refreshChainProgress(chain.chainId, chain.importRevision);
        this.penaltyMultiplier = Math.max(1, this.penaltyMultiplier * 0.92);
        return {
          kind: "processed",
        };
      }

      storeSearchCandidatesAndMarkEntry({
        entryId: entry.id,
        chainId: chain.chainId,
        importRevision: chain.importRevision,
        rowNumber: entry.rowNumber,
        attemptCount: entry.attemptCount + 1,
        candidates: exactMatches,
        updatedAt: atIso,
      });
      this.penaltyMultiplier = Math.max(1, this.penaltyMultiplier * 0.9);

      return {
        kind: "processed",
      };
    } catch (error) {
      const message = getErrorMessage(error, "Master product enrichment search failed.");

      if (isAuthPauseError(error)) {
        saveAuthPausedSearchEntry({
          entryId: entry.id,
          chainId: chain.chainId,
          importRevision: chain.importRevision,
          warningCode: "SCANO_MASTER_ENRICHMENT_AUTH_PAUSED",
          warningMessage: message,
          updatedAt: atIso,
        });
        return {
          kind: "auth_pause",
        };
      }

      if (isTransientError(error)) {
        const attemptCount = entry.attemptCount + 1;
        if (attemptCount >= this.maxRetryAttempts) {
          deleteEntryCandidates(entry.id);
          saveTerminalEntry({
            entryId: entry.id,
            status: "failed",
            attemptCount,
            lastError: message,
            updatedAt: atIso,
          });
          refreshChainProgress(chain.chainId, chain.importRevision);
        } else {
          saveSearchRetryEntry({
            entryId: entry.id,
            attemptCount,
            nextAttemptAt: new Date(Date.now() + this.computeRetryDelayMs(attemptCount)).toISOString(),
            lastError: message,
            updatedAt: atIso,
          });
        }
        this.penaltyMultiplier = Math.min(this.maxPenaltyMultiplier, Math.max(2, this.penaltyMultiplier * 2));
        return {
          kind: "processed",
        };
      }

      deleteEntryCandidates(entry.id);
      saveTerminalEntry({
        entryId: entry.id,
        status: "failed",
        attemptCount: entry.attemptCount + 1,
        lastError: message,
        updatedAt: atIso,
      });
      refreshChainProgress(chain.chainId, chain.importRevision);
      this.penaltyMultiplier = Math.max(1, this.penaltyMultiplier * 0.95);
      return {
        kind: "processed",
      };
    }
  }

  private async processAssignmentCandidate(chain: ChainJobRow, candidate: AssignmentCandidateRow, atIso: string): Promise<{
    kind: "processed" | "auth_pause";
  }> {
    try {
      const assignments = await listScanoProductAssignments(candidate.externalProductId);
      const assignment = this.selectAssignmentForChain(assignments, chain.chainId);

      const updated = assignment
        ? saveCandidateMatched({
          candidateId: candidate.id,
          attemptCount: candidate.attemptCount + 1,
          assignment,
          updatedAt: atIso,
        })
        : saveCandidateRejected({
          candidateId: candidate.id,
          attemptCount: candidate.attemptCount + 1,
          updatedAt: atIso,
        });
      if (updated) {
        maybeFinalizeEntryAfterAssignments(candidate.entryId, atIso);
      }

      this.penaltyMultiplier = Math.max(1, this.penaltyMultiplier * 0.9);
      return {
        kind: "processed",
      };
    } catch (error) {
      const message = getErrorMessage(error, "Master product enrichment assignment check failed.");

      if (isAuthPauseError(error)) {
        const updated = saveAuthPausedCandidate({
          candidateId: candidate.id,
          entryId: candidate.entryId,
          chainId: chain.chainId,
          importRevision: chain.importRevision,
          warningCode: "SCANO_MASTER_ENRICHMENT_AUTH_PAUSED",
          warningMessage: message,
          updatedAt: atIso,
        });
        return {
          kind: updated ? "auth_pause" : "processed",
        };
      }

      if (isTransientError(error)) {
        const attemptCount = candidate.attemptCount + 1;
        if (attemptCount >= this.maxRetryAttempts) {
          const failed = failEntryFromAssignmentError({
            entryId: candidate.entryId,
            candidateId: candidate.id,
            entryAttemptCount: candidate.entryAttemptCount,
            candidateAttemptCount: attemptCount,
            message,
            updatedAt: atIso,
          });
          if (failed) {
            refreshChainProgress(chain.chainId, chain.importRevision);
          }
        } else {
          saveCandidateRetry({
            candidateId: candidate.id,
            entryId: candidate.entryId,
            attemptCount,
            nextAttemptAt: new Date(Date.now() + this.computeRetryDelayMs(attemptCount)).toISOString(),
            lastError: message,
            updatedAt: atIso,
          });
        }
        this.penaltyMultiplier = Math.min(this.maxPenaltyMultiplier, Math.max(2, this.penaltyMultiplier * 2));
        return {
          kind: "processed",
        };
      }

      const failed = failEntryFromAssignmentError({
        entryId: candidate.entryId,
        candidateId: candidate.id,
        entryAttemptCount: candidate.entryAttemptCount,
        candidateAttemptCount: candidate.attemptCount + 1,
        message,
        updatedAt: atIso,
      });
      if (failed) {
        refreshChainProgress(chain.chainId, chain.importRevision);
      }
      this.penaltyMultiplier = Math.max(1, this.penaltyMultiplier * 0.95);
      return {
        kind: "processed",
      };
    }
  }

  private computeRetryDelayMs(attemptCount: number) {
    const baseDelayMs = 30_000 * Math.max(1, attemptCount);
    return clampDelay(baseDelayMs * this.penaltyMultiplier, this.maxDelayMs);
  }

  private selectNextPendingRetryAt(chainId: number, importRevision: number) {
    const searchRetryAt = selectNextPendingSearchRetryAt(chainId, importRevision);
    const assignmentRetryAt = selectNextPendingAssignmentRetryAt(chainId, importRevision);
    if (!searchRetryAt) return assignmentRetryAt;
    if (!assignmentRetryAt) return searchRetryAt;
    return Date.parse(searchRetryAt) <= Date.parse(assignmentRetryAt) ? searchRetryAt : assignmentRetryAt;
  }

  private getChainCacheKey(chainId: number, importRevision: number) {
    return `${chainId}:${importRevision}`;
  }

  private async getChainContext(chainId: number, importRevision: number): Promise<{
    value: ChainContext;
    callsUsed: number;
  }> {
    const cacheKey = this.getChainCacheKey(chainId, importRevision);
    const cached = this.chainContextCache.get(cacheKey);
    if (cached) {
      return {
        value: cached,
        callsUsed: 0,
      };
    }

    const pending = this.chainContextInFlight.get(cacheKey);
    if (pending) {
      return {
        value: await pending,
        callsUsed: 0,
      };
    }

    const loader = (async () => {
      const response = await searchScanoBranches({
        chainId,
        query: "",
      });
      const firstBranch = response.items[0] ?? null;
      if (!firstBranch?.globalEntityId?.trim()) {
        throw new ScanoCatalogClientError(
          "Scano chain is missing a branch global entity for enrichment lookup.",
          502,
          {
            code: "SCANO_MASTER_ENRICHMENT_BRANCH_MISSING",
            errorOrigin: "integration",
            integration: "scano_catalog",
            exposeMessage: true,
          },
        );
      }

      const value = {
        globalEntityId: firstBranch.globalEntityId.trim(),
      };
      this.chainContextCache.set(cacheKey, value);
      return value;
    })();
    this.chainContextInFlight.set(cacheKey, loader);

    const value = await loader.finally(() => {
      this.chainContextInFlight.delete(cacheKey);
    });
    return {
      value,
      callsUsed: 1,
    };
  }

  private selectAssignmentForChain(assignments: Array<{
    vendorId: number | null;
    chainId: number | null;
    sku: string | null;
    price: string | null;
  }>, chainId: number): CandidateAssignmentSummary | null {
    const scopedAssignments = assignments.filter((item) => item.chainId === chainId);
    if (!scopedAssignments.length) {
      return null;
    }

    const vendorAssignment = scopedAssignments.find((item) => typeof item.vendorId === "number" && item.vendorId > 0) ?? null;
    const chainAssignment = vendorAssignment ?? scopedAssignments[0] ?? null;
    if (!chainAssignment) {
      return null;
    }

    return {
      chain: "yes",
      vendor: vendorAssignment ? "yes" : "no",
      sku: vendorAssignment?.sku ?? chainAssignment.sku ?? null,
      price: vendorAssignment?.price ?? chainAssignment.price ?? null,
    };
  }
}

export const scanoMasterProductEnrichmentRuntime = new ScanoMasterProductEnrichmentRuntime();

export function initializeScanoMasterProductEnrichmentRuntime() {
  scanoMasterProductEnrichmentRuntime.start();
}

export function stopScanoMasterProductEnrichmentRuntime() {
  scanoMasterProductEnrichmentRuntime.stop();
}

export function notifyScanoMasterProductEnrichmentQueueChanged() {
  scanoMasterProductEnrichmentRuntime.poke();
}

export function notifyScanoMasterProductEnrichmentConfigChanged() {
  scanoMasterProductEnrichmentRuntime.notifyConfigChanged();
}
