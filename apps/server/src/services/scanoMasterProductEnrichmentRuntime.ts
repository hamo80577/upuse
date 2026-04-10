import { db } from "../config/db.js";
import {
  ScanoCatalogClientError,
  normalizeBarcodeForExternalLookup,
  searchScanoBranches,
  searchScanoProductsByBarcode,
  listScanoProductAssignments,
} from "./scanoCatalogClient.js";

type TimerHandle = ReturnType<typeof setTimeout>;

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

interface CandidateAssignmentSummary {
  chain: "yes" | "no";
  vendor: "yes" | "no";
  sku: string | null;
  price: string | null;
}

interface ChainContext {
  globalEntityId: string;
}

interface RuntimeOptions {
  baseDelayPerCallMs?: number;
  maxRetryAttempts?: number;
  maxPenaltyMultiplier?: number;
  maxDelayMs?: number;
  maxConcurrentEntries?: number;
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

function claimDueEntries(chainId: number, importRevision: number, atIso: string, limit: number) {
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
        AND status = 'pending'
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

    const markEntryRunning = db.prepare(`
      UPDATE scano_master_product_enrichment_entries
      SET
        status = 'running',
        updatedAt = ?
      WHERE id = ?
        AND status = 'pending'
    `);

    const claimed: EntryRow[] = [];
    for (const candidate of candidates) {
      const result = markEntryRunning.run(atIso, candidate.id);
      if (result.changes > 0) {
        claimed.push(candidate);
      }
    }

    return claimed;
  })();
}

function selectNextPendingRetryAt(chainId: number, importRevision: number) {
  const row = db.prepare<[number, number], { nextAttemptAt: string | null }>(`
    SELECT nextAttemptAt
    FROM scano_master_product_enrichment_entries
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
  const pendingRow = db.prepare<[number, number], { count: number }>(`
    SELECT COUNT(*) AS count
    FROM scano_master_product_enrichment_entries
    WHERE chainId = ?
      AND importRevision = ?
      AND status IN ('pending', 'running')
  `).get(chainId, importRevision);

  if ((pendingRow?.count ?? 0) > 0) {
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

function saveTerminalEntry(params: {
  entryId: number;
  status: "failed" | "ambiguous";
  attemptCount: number;
  lastError: string;
  updatedAt: string;
}) {
  db.prepare(`
    DELETE FROM scano_master_product_enrichment_barcodes
    WHERE entryId = ?
  `).run(params.entryId);

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

function saveRetryEntry(params: {
  entryId: number;
  attemptCount: number;
  nextAttemptAt: string;
  lastError: string;
  updatedAt: string;
}) {
  db.prepare(`
    UPDATE scano_master_product_enrichment_entries
    SET
      status = 'pending',
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

function saveAuthPausedEntry(params: {
  entryId: number;
  chainId: number;
  importRevision: number;
  warningCode: string;
  warningMessage: string;
  updatedAt: string;
}) {
  db.prepare(`
    UPDATE scano_master_product_enrichment_entries
    SET
      status = 'pending',
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
  db.prepare(`
    DELETE FROM scano_master_product_enrichment_barcodes
    WHERE entryId = ?
  `).run(params.entryId);

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
  db.prepare(`
    UPDATE scano_master_product_enrichment_entries
    SET
      status = 'pending',
      nextAttemptAt = NULL
    WHERE status = 'running'
  `).run();

  db.prepare(`
    UPDATE scano_master_products
    SET enrichmentStatus = 'queued'
    WHERE enrichmentStatus = 'running'
  `).run();
}

export class ScanoMasterProductEnrichmentRuntime {
  private readonly baseDelayPerCallMs: number;
  private readonly maxRetryAttempts: number;
  private readonly maxPenaltyMultiplier: number;
  private readonly maxDelayMs: number;
  private readonly maxConcurrentEntries: number;
  private timer: TimerHandle | null = null;
  private started = false;
  private processing = false;
  private penaltyMultiplier = 1;
  private readonly chainContextCache = new Map<string, ChainContext>();
  private readonly chainContextInFlight = new Map<string, Promise<ChainContext>>();

  constructor(options?: RuntimeOptions) {
    this.baseDelayPerCallMs = Math.max(100, options?.baseDelayPerCallMs ?? 250);
    this.maxRetryAttempts = Math.max(1, options?.maxRetryAttempts ?? 3);
    this.maxPenaltyMultiplier = Math.max(1, options?.maxPenaltyMultiplier ?? 12);
    this.maxDelayMs = Math.max(5_000, options?.maxDelayMs ?? 10 * 60 * 1000);
    this.maxConcurrentEntries = Math.max(1, Math.floor(options?.maxConcurrentEntries ?? 4));
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
      return await this.processNextChainEntry();
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

  private async processNextChainEntry() {
    const chain = selectNextChainJob();
    if (!chain) {
      this.schedule(this.baseDelayPerCallMs * 5);
      return false;
    }

    const startedAt = nowIso();
    if (chain.enrichmentStatus !== "running") {
      markChainRunning(chain.chainId, startedAt);
    }

    const entries = claimDueEntries(chain.chainId, chain.importRevision, startedAt, this.maxConcurrentEntries);
    if (!entries.length) {
      const finalized = finalizeChainIfDone(chain.chainId, chain.importRevision, startedAt);
      if (finalized) {
        this.chainContextCache.delete(this.getChainCacheKey(chain.chainId, chain.importRevision));
        this.penaltyMultiplier = Math.max(1, this.penaltyMultiplier * 0.9);
        this.schedule(0, true);
        return true;
      }

      const nextRetryAt = selectNextPendingRetryAt(chain.chainId, chain.importRevision);
      if (nextRetryAt) {
        this.schedule(Math.max(this.baseDelayPerCallMs, Date.parse(nextRetryAt) - Date.now()), true);
        return false;
      }

      this.schedule(this.baseDelayPerCallMs, true);
      return false;
    }

    const results = await Promise.all(entries.map((entry) => this.processEntry(chain, entry, startedAt)));
    finalizeChainIfDone(chain.chainId, chain.importRevision, nowIso());

    if (results.some((result) => result.kind === "auth_pause")) {
      this.schedule(this.baseDelayPerCallMs * 10, true);
      return false;
    }

    const maxCallsUsed = results.reduce((largest, result) => Math.max(largest, result.callsUsed), 1);
    const nextDelayMs = clampDelay(
      this.baseDelayPerCallMs * maxCallsUsed * this.penaltyMultiplier,
      this.maxDelayMs,
    );
    this.schedule(nextDelayMs, true);
    return true;
  }

  private async processEntry(chain: ChainJobRow, entry: EntryRow, atIso: string): Promise<{
    kind: "processed" | "auth_pause";
    callsUsed: number;
  }> {
    let callsUsed = 0;

    try {
      const chainContext = await this.getChainContext(chain.chainId, chain.importRevision);
      callsUsed += chainContext.callsUsed;

      const searchResults = await searchScanoProductsByBarcode({
        barcode: entry.sourceBarcode,
        globalEntityId: chainContext.value.globalEntityId,
      });
      callsUsed += 1;

      const exactMatches = searchResults.filter((item) => isExternalBarcodeExactMatch(item, entry.sourceBarcode));
      if (!exactMatches.length) {
        saveTerminalEntry({
          entryId: entry.id,
          status: "failed",
          attemptCount: entry.attemptCount + 1,
          lastError: "No exact external product match was found for this barcode.",
          updatedAt: atIso,
        });
        refreshChainProgress(chain.chainId, chain.importRevision);
        finalizeChainIfDone(chain.chainId, chain.importRevision, atIso);
        this.penaltyMultiplier = Math.max(1, this.penaltyMultiplier * 0.92);
        return {
          kind: "processed",
          callsUsed,
        };
      }

      const validMatches: Array<{
        id: string;
        barcode: string;
        barcodes: string[];
        itemNameEn: string | null;
        itemNameAr: string | null;
        image: string | null;
        assignment: CandidateAssignmentSummary;
      }> = [];

      for (const item of exactMatches) {
        const assignments = await listScanoProductAssignments(item.id);
        callsUsed += 1;
        const assignment = this.selectAssignmentForChain(assignments, chain.chainId);
        if (!assignment) {
          continue;
        }

        validMatches.push({
          id: item.id,
          barcode: item.barcode,
          barcodes: dedupeStrings([item.barcode, ...(item.barcodes ?? [])]),
          itemNameEn: item.itemNameEn,
          itemNameAr: item.itemNameAr,
          image: item.image,
          assignment,
        });
        if (validMatches.length > 1) {
          break;
        }
      }

      if (!validMatches.length) {
        saveTerminalEntry({
          entryId: entry.id,
          status: "failed",
          attemptCount: entry.attemptCount + 1,
          lastError: "Exact external matches were found, but none were assigned to this chain.",
          updatedAt: atIso,
        });
        refreshChainProgress(chain.chainId, chain.importRevision);
        finalizeChainIfDone(chain.chainId, chain.importRevision, atIso);
        this.penaltyMultiplier = Math.max(1, this.penaltyMultiplier * 0.92);
        return {
          kind: "processed",
          callsUsed,
        };
      }

      if (validMatches.length > 1) {
        saveTerminalEntry({
          entryId: entry.id,
          status: "ambiguous",
          attemptCount: entry.attemptCount + 1,
          lastError: "Multiple exact external products were assigned to this chain.",
          updatedAt: atIso,
        });
        refreshChainProgress(chain.chainId, chain.importRevision);
        finalizeChainIfDone(chain.chainId, chain.importRevision, atIso);
        this.penaltyMultiplier = Math.max(1, this.penaltyMultiplier * 0.92);
        return {
          kind: "processed",
          callsUsed,
        };
      }

      const selected = validMatches[0]!;
      saveEnrichedEntry({
        entryId: entry.id,
        chainId: chain.chainId,
        importRevision: chain.importRevision,
        attemptCount: entry.attemptCount + 1,
        sourceBarcode: entry.sourceBarcode,
        barcodes: selected.barcodes,
        externalProductId: selected.id,
        sku: selected.assignment.sku,
        price: selected.assignment.price,
        itemNameEn: selected.itemNameEn,
        itemNameAr: selected.itemNameAr,
        image: selected.image,
        chainFlag: selected.assignment.chain,
        vendorFlag: selected.assignment.vendor,
        updatedAt: atIso,
      });
      this.penaltyMultiplier = Math.max(1, this.penaltyMultiplier * 0.85);
      finalizeChainIfDone(chain.chainId, chain.importRevision, atIso);

      return {
        kind: "processed",
        callsUsed,
      };
    } catch (error) {
      const message = getErrorMessage(error, "Master product enrichment failed.");

      if (isAuthPauseError(error)) {
        saveAuthPausedEntry({
          entryId: entry.id,
          chainId: chain.chainId,
          importRevision: chain.importRevision,
          warningCode: "SCANO_MASTER_ENRICHMENT_AUTH_PAUSED",
          warningMessage: message,
          updatedAt: atIso,
        });
        return {
          kind: "auth_pause",
          callsUsed: Math.max(1, callsUsed),
        };
      }

      if (isTransientError(error)) {
        const attemptCount = entry.attemptCount + 1;
        if (attemptCount >= this.maxRetryAttempts) {
          saveTerminalEntry({
            entryId: entry.id,
            status: "failed",
            attemptCount,
            lastError: message,
            updatedAt: atIso,
          });
          refreshChainProgress(chain.chainId, chain.importRevision);
          finalizeChainIfDone(chain.chainId, chain.importRevision, atIso);
        } else {
          saveRetryEntry({
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
          callsUsed: Math.max(1, callsUsed),
        };
      }

      saveTerminalEntry({
        entryId: entry.id,
        status: "failed",
        attemptCount: entry.attemptCount + 1,
        lastError: message,
        updatedAt: atIso,
      });
      refreshChainProgress(chain.chainId, chain.importRevision);
      finalizeChainIfDone(chain.chainId, chain.importRevision, atIso);
      this.penaltyMultiplier = Math.max(1, this.penaltyMultiplier * 0.95);
      return {
        kind: "processed",
        callsUsed: Math.max(1, callsUsed),
      };
    }
  }

  private computeRetryDelayMs(attemptCount: number) {
    const baseDelayMs = 30_000 * Math.max(1, attemptCount);
    return clampDelay(baseDelayMs * this.penaltyMultiplier, this.maxDelayMs);
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
