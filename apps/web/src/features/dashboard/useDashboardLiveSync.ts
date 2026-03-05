import { useEffect, useMemo, useRef, useState } from "react";
import { api, describeApiError } from "../../api/client";
import type { DashboardSnapshot } from "../../api/types";
import { getLatestMonitoringUpdateAt, getStaleThresholdMs, getSyncAgeMs, isSyncStale } from "../../entities/monitoring/syncFreshness";

const DASHBOARD_POLL_MS = 5000;

const emptySnap: DashboardSnapshot = {
  monitoring: { running: false },
  totals: {
    branchesMonitored: 0,
    open: 0,
    tempClose: 0,
    closed: 0,
    unknown: 0,
    ordersToday: 0,
    cancelledToday: 0,
    doneToday: 0,
    activeNow: 0,
    lateNow: 0,
    unassignedNow: 0,
  },
  branches: [],
};

export function useDashboardLiveSync() {
  const [snap, setSnap] = useState<DashboardSnapshot>(emptySnap);
  const [refreshSettings, setRefreshSettings] = useState({
    ordersRefreshSeconds: 30,
    availabilityRefreshSeconds: 30,
  });
  const [syncClock, setSyncClock] = useState(() => Date.now());
  const [syncRecovering, setSyncRecovering] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);

  const dashboardPollRef = useRef<number | null>(null);
  const staleRecoveryKeyRef = useRef<string | null>(null);

  const stopDashboardPolling = () => {
    if (!dashboardPollRef.current) return;
    window.clearInterval(dashboardPollRef.current);
    dashboardPollRef.current = null;
  };

  const loadDashboard = async (options?: { silent?: boolean }) => {
    try {
      const data = await api.dashboard();
      setSnap(data);
      setSyncError(null);
      return { ok: true as const };
    } catch (error) {
      const message = describeApiError(error, "Failed to load dashboard");
      if (!options?.silent) {
        setSyncError(message);
      }
      return { ok: false as const, message };
    }
  };

  const startDashboardPolling = () => {
    stopDashboardPolling();
    void loadDashboard();
    dashboardPollRef.current = window.setInterval(() => {
      void loadDashboard();
    }, DASHBOARD_POLL_MS);
  };

  const attemptSyncRecovery = async (manual = false) => {
    if (syncRecovering) {
      return { ok: false, manual, message: "Recovery already in progress" };
    }

    setSyncRecovering(true);
    try {
      await api.monitorStatus();
      const fresh = await api.dashboard();
      setSnap(fresh);
      setSyncError(null);
      return { ok: true, manual, message: undefined as string | undefined };
    } catch (error) {
      const message = describeApiError(error, "Refresh failed");
      setSyncError(message);
      return { ok: false, manual, message };
    } finally {
      setSyncRecovering(false);
    }
  };

  useEffect(() => {
    startDashboardPolling();

    api.getSettings()
      .then((settings) => {
        setRefreshSettings({
          ordersRefreshSeconds: settings.ordersRefreshSeconds,
          availabilityRefreshSeconds: settings.availabilityRefreshSeconds,
        });
      })
      .catch((error) => {
        setSyncError((current) => current ?? describeApiError(error, "Failed to load refresh settings"));
      });

    const clock = window.setInterval(() => {
      setSyncClock(Date.now());
    }, 2000);

    return () => {
      stopDashboardPolling();
      window.clearInterval(clock);
    };
  }, []);

  const latestMonitoringUpdateAt = useMemo(() => {
    return getLatestMonitoringUpdateAt({
      lastOrdersFetchAt: snap.monitoring.lastOrdersFetchAt,
      lastAvailabilityFetchAt: snap.monitoring.lastAvailabilityFetchAt,
      lastHealthyAt: snap.monitoring.lastHealthyAt,
    });
  }, [
    snap.monitoring.lastAvailabilityFetchAt,
    snap.monitoring.lastHealthyAt,
    snap.monitoring.lastOrdersFetchAt,
  ]);

  const staleThresholdMs = getStaleThresholdMs({
    ordersRefreshSeconds: refreshSettings.ordersRefreshSeconds,
    availabilityRefreshSeconds: refreshSettings.availabilityRefreshSeconds,
  });
  const syncAgeMs = getSyncAgeMs({
    latestMonitoringUpdateAt,
    syncClockMs: syncClock,
  });
  const syncStale = isSyncStale({
    running: snap.monitoring.running,
    latestMonitoringUpdateAt,
    syncAgeMs,
    staleThresholdMs,
  });

  useEffect(() => {
    if (!syncStale || !latestMonitoringUpdateAt) return;
    if (staleRecoveryKeyRef.current === latestMonitoringUpdateAt) return;

    staleRecoveryKeyRef.current = latestMonitoringUpdateAt;
    void attemptSyncRecovery();
  }, [syncStale, latestMonitoringUpdateAt]);

  return {
    snap,
    setSnap,
    latestMonitoringUpdateAt,
    syncAgeMs,
    staleThresholdMs,
    isSyncStale: syncStale,
    syncRecovering,
    syncError,
    attemptSyncRecovery,
  };
}
