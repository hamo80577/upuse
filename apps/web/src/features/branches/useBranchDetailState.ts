import { useEffect, useRef, useState } from "react";
import { api } from "../../api/client";
import type { BranchDetailResult, BranchSnapshot } from "../../api/types";
import { appendOlderLogDayUnique, upsertLatestLogDay, type BranchLogDay } from "./logState";

const DETAIL_CACHE_TTL_MS = 60_000;
const DETAIL_AUTO_REFRESH_INTERVAL_MS = 60_000;

function getCairoDayKey(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Cairo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);

  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function isAbortError(error: unknown) {
  return error instanceof Error && error.name === "AbortError";
}

function branchDetailCacheKey(branchId: number, dayKey: string) {
  return `${branchId}|${dayKey}`;
}

function buildBranchStatusSignature(branchSnapshot?: BranchSnapshot | null) {
  if (!branchSnapshot) return "";

  return [
    branchSnapshot.branchId,
    branchSnapshot.monitorEnabled ? "1" : "0",
    branchSnapshot.status,
    branchSnapshot.closedUntil ?? "",
    branchSnapshot.closeReason ?? "",
    branchSnapshot.closureSource ?? "",
    branchSnapshot.closedByUpuse ? "1" : "0",
    branchSnapshot.changeable === false ? "0" : "1",
    branchSnapshot.autoReopen ? "1" : "0",
  ].join("|");
}

function getResultBranchId(detail: BranchDetailResult | null) {
  if (!detail) return null;
  if (detail.kind === "branch_not_found") return detail.branchId;
  return detail.branch.branchId;
}

export function useBranchDetailState(options: {
  branchId: number | null;
  branchSnapshot?: BranchSnapshot | null;
  open: boolean;
}) {
  const [detail, setDetail] = useState<BranchDetailResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [logDays, setLogDays] = useState<BranchLogDay[]>([]);
  const [logLoading, setLogLoading] = useState(false);
  const [logLoadingMore, setLogLoadingMore] = useState(false);
  const [hasMoreLogs, setHasMoreLogs] = useState(false);
  const [logError, setLogError] = useState<string | null>(null);
  const [clearingLog, setClearingLog] = useState(false);
  const [manualDetailRefreshTick, setManualDetailRefreshTick] = useState(0);
  const [autoDetailRefreshTick, setAutoDetailRefreshTick] = useState(0);
  const [manualLogRefreshTick, setManualLogRefreshTick] = useState(0);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const loadedBranchIdRef = useRef<number | null>(null);
  const loadedLogBranchIdRef = useRef<number | null>(null);
  const lastHandledManualDetailRefreshTickRef = useRef(0);
  const lastHandledAutoDetailRefreshTickRef = useRef(0);
  const lastHandledManualLogRefreshTickRef = useRef(0);
  const lastLogStatusSignatureRef = useRef("");
  const detailCacheRef = useRef(new Map<string, { expiresAtMs: number; value: BranchDetailResult }>());
  const detailRequestRef = useRef<{ requestId: number; controller: AbortController } | null>(null);
  const detailRequestIdRef = useRef(0);
  const latestLogRequestRef = useRef<AbortController | null>(null);
  const latestLogRequestIdRef = useRef(0);
  const olderLogRequestRef = useRef<AbortController | null>(null);
  const olderLogRequestIdRef = useRef(0);
  const detailDayKey = getCairoDayKey();
  const statusSignature = buildBranchStatusSignature(options.branchSnapshot);

  useEffect(() => {
    if (!options.open || !options.branchId) return;

    const cacheKey = branchDetailCacheKey(options.branchId, detailDayKey);
    const currentBranchMatches = loadedBranchIdRef.current === options.branchId;
    const manualRefreshRequested = lastHandledManualDetailRefreshTickRef.current !== manualDetailRefreshTick;
    const autoRefreshRequested = lastHandledAutoDetailRefreshTickRef.current !== autoDetailRefreshTick;
    const forceRefresh = manualRefreshRequested || autoRefreshRequested;

    lastHandledManualDetailRefreshTickRef.current = manualDetailRefreshTick;
    lastHandledAutoDetailRefreshTickRef.current = autoDetailRefreshTick;

    const cached = detailCacheRef.current.get(cacheKey);
    if (!forceRefresh && cached && cached.expiresAtMs > Date.now()) {
      setDetail(cached.value);
      loadedBranchIdRef.current = getResultBranchId(cached.value);
      setLoading(false);
      setRefreshing(false);
      setError(null);
      return;
    }

    let active = true;
    if (!currentBranchMatches) {
      setLoading(true);
      setRefreshing(false);
      setDetail(null);
    } else {
      setRefreshing(true);
    }
    setError(null);

    detailRequestRef.current?.controller.abort();
    const controller = new AbortController();
    const requestId = detailRequestIdRef.current + 1;
    detailRequestIdRef.current = requestId;
    detailRequestRef.current = { requestId, controller };

    api.branchDetail(options.branchId, { signal: controller.signal })
      .then((data) => {
        if (!active || requestId !== detailRequestIdRef.current) return;
        if (data.kind !== "branch_not_found") {
          detailCacheRef.current.set(cacheKey, {
            expiresAtMs: Date.now() + DETAIL_CACHE_TTL_MS,
            value: data,
          });
        }
        setDetail(data);
        loadedBranchIdRef.current = getResultBranchId(data);
        setError(null);
      })
      .catch((e: unknown) => {
        if (!active || isAbortError(e) || requestId !== detailRequestIdRef.current) return;
        setError(e instanceof Error ? e.message || "Failed to load branch detail" : "Failed to load branch detail");
      })
      .finally(() => {
        if (detailRequestRef.current?.requestId === requestId) {
          detailRequestRef.current = null;
        }
        if (!active || requestId !== detailRequestIdRef.current) return;
        setLoading(false);
        setRefreshing(false);
      });

    return () => {
      active = false;
    };
  }, [autoDetailRefreshTick, detailDayKey, manualDetailRefreshTick, options.branchId, options.open]);

  useEffect(() => {
    if (options.open) return;

    detailRequestRef.current?.controller.abort();
    detailRequestRef.current = null;
    latestLogRequestRef.current?.abort();
    latestLogRequestRef.current = null;
    latestLogRequestIdRef.current += 1;
    olderLogRequestRef.current?.abort();
    olderLogRequestRef.current = null;
    olderLogRequestIdRef.current += 1;
    detailCacheRef.current.clear();
    loadedBranchIdRef.current = null;
    loadedLogBranchIdRef.current = null;
    lastHandledManualDetailRefreshTickRef.current = 0;
    lastHandledAutoDetailRefreshTickRef.current = 0;
    lastHandledManualLogRefreshTickRef.current = 0;
    lastLogStatusSignatureRef.current = "";
    setManualDetailRefreshTick(0);
    setAutoDetailRefreshTick(0);
    setManualLogRefreshTick(0);
    setDetail(null);
    setLoading(false);
    setRefreshing(false);
    setError(null);
    setLogDays([]);
    setLogLoading(false);
    setLogLoadingMore(false);
    setHasMoreLogs(false);
    setLogError(null);
    setClearingLog(false);
  }, [options.open]);

  useEffect(() => {
    if (!options.open || !options.branchId) return;

    const timer = window.setInterval(() => {
      setAutoDetailRefreshTick((current) => current + 1);
    }, DETAIL_AUTO_REFRESH_INTERVAL_MS);

    return () => {
      window.clearInterval(timer);
    };
  }, [options.branchId, options.open]);

  useEffect(() => {
    if (!options.open || !options.branchId) return;

    const initialLoad = loadedLogBranchIdRef.current !== options.branchId;
    const manualRefreshRequested = lastHandledManualLogRefreshTickRef.current !== manualLogRefreshTick;
    const statusChanged = !initialLoad && lastLogStatusSignatureRef.current !== statusSignature;
    if (!initialLoad && !manualRefreshRequested && !statusChanged) {
      return;
    }

    lastHandledManualLogRefreshTickRef.current = manualLogRefreshTick;
    lastLogStatusSignatureRef.current = statusSignature;

    let active = true;
    latestLogRequestRef.current?.abort();
    const controller = new AbortController();
    latestLogRequestRef.current = controller;
    const requestId = latestLogRequestIdRef.current + 1;
    latestLogRequestIdRef.current = requestId;

    if (initialLoad) {
      setLogLoading(true);
      setLogDays([]);
      setHasMoreLogs(false);
    } else {
      setLogLoading(true);
    }
    setLogError(null);

    api.logs(options.branchId, undefined, { signal: controller.signal })
      .then((page) => {
        if (!active || requestId !== latestLogRequestIdRef.current) return;
        setHasMoreLogs(Boolean(page.dayKey && page.dayLabel && page.hasMore));
        setLogDays((current) => {
          const update = upsertLatestLogDay({
            current,
            page,
            initialLoad,
          });
          return update.next;
        });
        loadedLogBranchIdRef.current = options.branchId;
      })
      .catch((e: Error) => {
        if (!active || isAbortError(e) || requestId !== latestLogRequestIdRef.current) return;
        setLogError(e.message || "Failed to load log");
      })
      .finally(() => {
        if (!active || requestId !== latestLogRequestIdRef.current) return;
        setLogLoading(false);
      });

    return () => {
      active = false;
      controller.abort();
      if (latestLogRequestRef.current === controller) {
        latestLogRequestRef.current = null;
      }
    };
  }, [manualLogRefreshTick, options.branchId, options.open, statusSignature]);

  useEffect(() => {
    if (!options.open) return;
    const timer = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [options.open]);

  const refreshDetail = () => {
    if (!options.branchId || !options.open) return;
    setManualDetailRefreshTick((current) => current + 1);
    setManualLogRefreshTick((current) => current + 1);
  };

  const loadMoreLogs = async () => {
    if (!options.branchId || !hasMoreLogs || logLoadingMore || !logDays.length) return;

    let requestController: AbortController | null = null;
    try {
      setLogLoadingMore(true);
      setLogError(null);
      const oldestDayKey = logDays[logDays.length - 1]?.dayKey;
      olderLogRequestRef.current?.abort();
      const controller = new AbortController();
      requestController = controller;
      olderLogRequestRef.current = controller;
      const requestId = olderLogRequestIdRef.current + 1;
      olderLogRequestIdRef.current = requestId;

      const page = await api.logs(options.branchId, oldestDayKey, { signal: controller.signal });
      if (requestId !== olderLogRequestIdRef.current) return;

      setHasMoreLogs(Boolean(page.dayKey && page.dayLabel && page.hasMore));
      setLogDays((current) => appendOlderLogDayUnique({ current, page }).next);
    } catch (e: unknown) {
      if (isAbortError(e)) return;
      setLogError(e instanceof Error ? e.message : "Failed to load older log");
    } finally {
      if (requestController && olderLogRequestRef.current === requestController) {
        olderLogRequestRef.current = null;
      }
      setLogLoadingMore(false);
    }
  };

  const clearLog = async () => {
    if (!options.branchId || clearingLog) return;

    try {
      setClearingLog(true);
      await api.clearLogs(options.branchId);
      setLogDays([]);
      setHasMoreLogs(false);
      setLogError(null);
    } catch (e: unknown) {
      setLogError(e instanceof Error ? e.message : "Failed to clear log");
    } finally {
      setClearingLog(false);
    }
  };

  return {
    detail,
    loading,
    refreshing,
    error,
    logDays,
    logLoading,
    logLoadingMore,
    hasMoreLogs,
    logError,
    clearingLog,
    nowMs,
    refreshDetail,
    loadMoreLogs,
    clearLog,
  };
}
