import { useEffect, useMemo, useRef, useState } from "react";
import { api, describeApiError } from "../../../api/client";
import { useMonitorStatus } from "../../../app/providers/MonitorStatusProvider";
import { useDashboardLiveSync } from "../../../features/dashboard/useDashboardLiveSync";
import { isGroupExpanded } from "./dashboardGrouping";

export interface ToastState {
  type: "success" | "error";
  msg: string;
}

export interface ScreenLoadingState {
  title: string;
  note: string;
}

export function useDashboardPageState() {
  const { startMonitoring, stopMonitoring } = useMonitorStatus();
  const {
    snap,
    setSnap,
    connectionState,
    latestMonitoringUpdateAt,
    syncAgeMs,
    staleThresholdMs,
    isSyncStale,
    syncRecovering,
    syncError,
    attemptSyncRecovery,
  } = useDashboardLiveSync();

  const [toast, setToast] = useState<ToastState | null>(null);
  const [detailBranchId, setDetailBranchId] = useState<number | null>(null);
  const [reportDialogOpen, setReportDialogOpen] = useState(false);
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});
  const [screenLoading, setScreenLoading] = useState<ScreenLoadingState | null>(null);
  const loadingRequestRef = useRef(0);
  const loadingTimeoutRef = useRef<number | null>(null);

  const clearLoadingTimeout = () => {
    if (loadingTimeoutRef.current != null) {
      window.clearTimeout(loadingTimeoutRef.current);
      loadingTimeoutRef.current = null;
    }
  };

  const startLoadingGuard = (requestId: number, timeoutMs = 25_000) => {
    clearLoadingTimeout();
    loadingTimeoutRef.current = window.setTimeout(() => {
      if (loadingRequestRef.current !== requestId) return;
      loadingRequestRef.current = 0;
      setScreenLoading(null);
      setToast({
        type: "error",
        msg: "Refresh is taking too long. Check API status or try again.",
      });
    }, timeoutMs);
  };

  const finishLoadingGuard = (requestId: number) => {
    if (loadingRequestRef.current !== requestId) return false;
    loadingRequestRef.current = 0;
    clearLoadingTimeout();
    setScreenLoading(null);
    return true;
  };

  useEffect(() => {
    return () => {
      clearLoadingTimeout();
    };
  }, []);

  const onStart = async () => {
    const requestId = loadingRequestRef.current + 1;
    loadingRequestRef.current = requestId;
    setScreenLoading({
      title: "Starting monitor",
      note: "Syncing orders and branch states...",
    });
    startLoadingGuard(requestId, 30_000);
    try {
      // The server start route already primes orders/availability and returns the fresh snapshot.
      const started = await startMonitoring();
      if (started.snapshot) {
        setSnap(started.snapshot);
      }

      setToast({ type: "success", msg: "Monitoring started" });
    } catch (error) {
      setToast({ type: "error", msg: describeApiError(error, "Failed to start") });
    } finally {
      finishLoadingGuard(requestId);
    }
  };

  const onStop = async () => {
    try {
      const stopped = await stopMonitoring();
      if (stopped.snapshot) {
        setSnap(stopped.snapshot);
      }
      setToast({ type: "success", msg: "Monitoring stopped" });
    } catch (error) {
      setToast({ type: "error", msg: describeApiError(error, "Failed to stop") });
    }
  };

  const openBranchDetail = (branchId: number) => {
    setDetailBranchId(branchId);
  };

  const closeBranchDetail = () => {
    setDetailBranchId(null);
  };

  const onRefreshNowWithLoading = () => {
    const requestId = loadingRequestRef.current + 1;
    loadingRequestRef.current = requestId;
    setScreenLoading({
      title: "Refreshing live data",
      note: "Loading latest orders and branch states...",
    });
    startLoadingGuard(requestId, 25_000);

    void Promise.allSettled([api.monitorRefreshOrders(), attemptSyncRecovery(true)])
      .then((results) => {
        if (loadingRequestRef.current !== requestId) return;
        const [ordersRefresh, syncRefresh] = results;

        if (ordersRefresh.status === "fulfilled" && ordersRefresh.value.snapshot) {
          setSnap(ordersRefresh.value.snapshot);
        }

        if (syncRefresh.status === "fulfilled") {
          setToast({
            type: syncRefresh.value.ok ? "success" : "error",
            msg: syncRefresh.value.ok ? "Sync refreshed" : syncRefresh.value.message || "Refresh failed",
          });
          return;
        }

        setToast({
          type: "error",
          msg: describeApiError(syncRefresh.reason, "Refresh failed"),
        });
      })
      .finally(() => {
        finishLoadingGuard(requestId);
      });
  };

  const toggleGroup = (groupKey: string) => {
    setExpandedGroups((current) => ({
      ...current,
      [groupKey]: !isGroupExpanded(current, groupKey),
    }));
  };

  const selectedBranch = useMemo(
    () => (detailBranchId ? snap.branches.find((branch) => branch.branchId === detailBranchId) : null),
    [detailBranchId, snap.branches],
  );

  const detailRefreshToken = useMemo(() => {
    if (!detailBranchId) return undefined;
    return [
      detailBranchId,
      snap.monitoring.lastOrdersFetchAt ?? "",
      snap.monitoring.lastAvailabilityFetchAt ?? "",
      snap.monitoring.lastHealthyAt ?? "",
      selectedBranch?.lastUpdatedAt ?? "",
      selectedBranch?.metrics.activeNow ?? "",
      selectedBranch?.metrics.lateNow ?? "",
      selectedBranch?.metrics.unassignedNow ?? "",
    ].join("|");
  }, [
    detailBranchId,
    selectedBranch,
    snap.monitoring.lastAvailabilityFetchAt,
    snap.monitoring.lastHealthyAt,
    snap.monitoring.lastOrdersFetchAt,
  ]);

  return {
    snap,
    connectionState,
    latestMonitoringUpdateAt,
    syncAgeMs,
    staleThresholdMs,
    isSyncStale,
    syncRecovering,
    syncError,
    toast,
    setToast,
    detailBranchId,
    selectedBranch,
    detailRefreshToken,
    reportDialogOpen,
    setReportDialogOpen,
    expandedGroups,
    screenLoading,
    onStart,
    onStop,
    onRefreshNowWithLoading,
    openBranchDetail,
    closeBranchDetail,
    toggleGroup,
  };
}
