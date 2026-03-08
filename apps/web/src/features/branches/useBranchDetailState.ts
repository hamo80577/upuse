import { useEffect, useRef, useState } from "react";
import { api } from "../../api/client";
import type { BranchDetailSnapshot, BranchSnapshot } from "../../api/types";
import { appendOlderLogDayUnique, upsertLatestLogDay, type BranchLogDay } from "./logState";

const DETAIL_CACHE_TTL_MS = 15_000;
const DETAIL_POLL_INTERVAL_MS = 10_000;

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

export function useBranchDetailState(options: {
  branchId: number | null;
  branchSnapshot?: BranchSnapshot | null;
  open: boolean;
  refreshToken?: string;
}) {
  const [detail, setDetail] = useState<BranchDetailSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [logDays, setLogDays] = useState<BranchLogDay[]>([]);
  const [logLoading, setLogLoading] = useState(false);
  const [logLoadingMore, setLogLoadingMore] = useState(false);
  const [hasMoreLogs, setHasMoreLogs] = useState(false);
  const [logError, setLogError] = useState<string | null>(null);
  const [clearingLog, setClearingLog] = useState(false);
  const [pollTick, setPollTick] = useState(0);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const loadedBranchIdRef = useRef<number | null>(null);
  const loadedLogBranchIdRef = useRef<number | null>(null);
  const lastRefreshTokenRef = useRef<string>("");
  const lastPollTickRef = useRef(0);
  const detailCacheRef = useRef(new Map<string, { expiresAtMs: number; value: BranchDetailSnapshot }>());
  const detailRequestRef = useRef<{
    key: string;
    promise: Promise<BranchDetailSnapshot>;
    controller: AbortController;
  } | null>(null);
  const latestLogRequestRef = useRef<AbortController | null>(null);
  const latestLogRequestIdRef = useRef(0);
  const olderLogRequestRef = useRef<AbortController | null>(null);
  const olderLogRequestIdRef = useRef(0);
  const branchVendorId = options.branchSnapshot?.ordersVendorId ?? "";
  const detailDayKey = getCairoDayKey();

  useEffect(() => {
    if (!options.open || !options.branchId) return;

    let active = true;
    const initialLoad = loadedBranchIdRef.current !== options.branchId || !detail;
    const refreshToken = options.refreshToken ?? "";
    const refreshTokenChanged = lastRefreshTokenRef.current !== refreshToken;
    const pollTickChanged = lastPollTickRef.current !== pollTick;
    const forceRefresh = refreshTokenChanged || pollTickChanged;
    lastRefreshTokenRef.current = refreshToken;
    lastPollTickRef.current = pollTick;
    const detailCacheKey = `${options.branchId}|${branchVendorId}|${detailDayKey}`;

    if (forceRefresh) {
      // Invalidate stale cache when parent snapshot or live polling triggers a refresh.
      detailCacheRef.current.delete(detailCacheKey);
    }

    const cached = detailCacheRef.current.get(detailCacheKey);
    if (!forceRefresh && cached && cached.expiresAtMs > Date.now()) {
      setDetail(cached.value);
      loadedBranchIdRef.current = cached.value.branch.branchId;
      setLoading(false);
      setRefreshing(false);
      setError(null);
      return;
    }

    if (initialLoad) {
      setLoading(true);
      setDetail(null);
    } else {
      setRefreshing(true);
    }
    setError(null);

    let request = detailRequestRef.current;
    if (!request || request.key !== detailCacheKey) {
      if (request && request.key !== detailCacheKey) {
        request.controller.abort();
      }
      const controller = new AbortController();
      request = {
        key: detailCacheKey,
        controller,
        promise: api.branchDetail(options.branchId, { signal: controller.signal }),
      };
      detailRequestRef.current = request;
    }

    request.promise
      .then((data) => {
        if (!active) return;
        detailCacheRef.current.set(detailCacheKey, {
          expiresAtMs: Date.now() + DETAIL_CACHE_TTL_MS,
          value: data,
        });
        setDetail(data);
        loadedBranchIdRef.current = data.branch.branchId;
        setError(null);
      })
      .catch((e: unknown) => {
        if (!active || isAbortError(e)) return;
        setError(e instanceof Error ? e.message || "Failed to load branch detail" : "Failed to load branch detail");
      })
      .finally(() => {
        if (detailRequestRef.current?.key === detailCacheKey && detailRequestRef.current?.promise === request?.promise) {
          detailRequestRef.current = null;
        }
        if (!active) return;
        setLoading(false);
        setRefreshing(false);
      });

    return () => {
      active = false;
    };
  }, [branchVendorId, detailDayKey, options.branchId, options.open, options.refreshToken, pollTick]);

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
    lastRefreshTokenRef.current = "";
    lastPollTickRef.current = 0;
    setPollTick(0);
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
      setPollTick((current) => current + 1);
    }, DETAIL_POLL_INTERVAL_MS);

    return () => {
      window.clearInterval(timer);
    };
  }, [options.branchId, options.open]);

  useEffect(() => {
    if (!options.open || !options.branchId) return;

    let active = true;
    latestLogRequestRef.current?.abort();
    const controller = new AbortController();
    latestLogRequestRef.current = controller;
    const requestId = latestLogRequestIdRef.current + 1;
    latestLogRequestIdRef.current = requestId;
    const initialLoad = loadedLogBranchIdRef.current !== options.branchId;
    if (initialLoad) {
      setLogLoading(true);
      setLogDays([]);
      setHasMoreLogs(false);
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
        if (!active) return;
        if (isAbortError(e)) return;
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
  }, [options.branchId, options.open, options.refreshToken, pollTick]);

  useEffect(() => {
    if (!options.open) return;
    const timer = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [options.open]);

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
    loadMoreLogs,
    clearLog,
  };
}
