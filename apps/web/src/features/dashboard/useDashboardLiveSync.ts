import { useEffect, useMemo, useRef, useState } from "react";
import { api, describeApiError } from "../../api/client";
import type { DashboardLiveConnectionState, DashboardSnapshot } from "../../api/types";
import { useMonitorStatus } from "../../app/providers/MonitorStatusProvider";
import { getLatestMonitoringUpdateAt, getStaleThresholdMs, getSyncAgeMs, isSyncStale } from "../../entities/monitoring/syncFreshness";

const STREAM_RECONNECT_DELAYS_MS = [1000, 3000, 5000, 10000] as const;
const FALLBACK_POLL_MS = 15000;

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

function isAbortError(error: unknown) {
  return error instanceof Error && error.name === "AbortError";
}

function isUnsupportedStreamError(error: unknown) {
  return error instanceof Error && error.message === "Streaming is not supported in this browser.";
}

export function useDashboardLiveSync() {
  const { applyMonitoring } = useMonitorStatus();
  const [snap, setSnapState] = useState<DashboardSnapshot>(emptySnap);
  const [refreshSettings, setRefreshSettings] = useState({
    ordersRefreshSeconds: 30,
    availabilityRefreshSeconds: 30,
  });
  const [syncClock, setSyncClock] = useState(() => Date.now());
  const [syncRecovering, setSyncRecovering] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [connectionState, setConnectionStateState] = useState<DashboardLiveConnectionState>("connecting");

  const applyMonitoringRef = useRef(applyMonitoring);
  const connectionStateRef = useRef<DashboardLiveConnectionState>("connecting");
  const fallbackPollRef = useRef<number | null>(null);
  const reconnectTimerRef = useRef<number | null>(null);
  const streamAbortRef = useRef<AbortController | null>(null);
  const reconnectAttemptRef = useRef(0);
  const streamSessionRef = useRef(0);
  const hasSnapshotRef = useRef(false);
  const mountedRef = useRef(true);
  const staleRecoveryKeyRef = useRef<string | null>(null);

  const setConnectionState = (nextState: DashboardLiveConnectionState) => {
    connectionStateRef.current = nextState;
    setConnectionStateState(nextState);
  };

  const applySnapshot = (nextSnap: DashboardSnapshot) => {
    hasSnapshotRef.current = true;
    setSnapState(nextSnap);
    setSyncError(null);
    applyMonitoringRef.current(nextSnap.monitoring);
  };

  const loadDashboard = async (options?: { silent?: boolean }) => {
    try {
      const data = await api.dashboard();
      applySnapshot(data);
      setSyncError(null);
      if (connectionStateRef.current !== "live") {
        setConnectionState("fallback");
      }
      return { ok: true as const };
    } catch (error) {
      const message = describeApiError(error, "Failed to load dashboard");
      if (!options?.silent) {
        setSyncError(message);
      }
      if (connectionStateRef.current !== "live") {
        setConnectionState("disconnected");
      }
      return { ok: false as const, message };
    }
  };

  const stopFallbackPolling = () => {
    if (fallbackPollRef.current == null) return;
    window.clearInterval(fallbackPollRef.current);
    fallbackPollRef.current = null;
  };

  const startFallbackPolling = (options?: { immediate?: boolean }) => {
    if (options?.immediate) {
      void loadDashboard({ silent: !hasSnapshotRef.current });
    }

    if (fallbackPollRef.current != null) {
      if (connectionStateRef.current !== "disconnected") {
        setConnectionState("fallback");
      }
      return;
    }

    if (connectionStateRef.current !== "disconnected") {
      setConnectionState("fallback");
    }

    fallbackPollRef.current = window.setInterval(() => {
      void loadDashboard({ silent: true });
    }, FALLBACK_POLL_MS);
  };

  const stopReconnectTimer = () => {
    if (reconnectTimerRef.current == null) return;
    window.clearTimeout(reconnectTimerRef.current);
    reconnectTimerRef.current = null;
  };

  const stopStreamConnection = () => {
    stopReconnectTimer();
    streamAbortRef.current?.abort();
    streamAbortRef.current = null;
  };

  const scheduleReconnect = (connectStream: () => void) => {
    stopReconnectTimer();
    const delay = STREAM_RECONNECT_DELAYS_MS[Math.min(reconnectAttemptRef.current, STREAM_RECONNECT_DELAYS_MS.length - 1)];
    reconnectAttemptRef.current = Math.min(reconnectAttemptRef.current + 1, STREAM_RECONNECT_DELAYS_MS.length - 1);
    if (connectionStateRef.current !== "fallback") {
      setConnectionState("connecting");
    }
    reconnectTimerRef.current = window.setTimeout(() => {
      reconnectTimerRef.current = null;
      connectStream();
    }, delay);
  };

  useEffect(() => {
    applyMonitoringRef.current = applyMonitoring;
  }, [applyMonitoring]);

  useEffect(() => {
    mountedRef.current = true;

    const handleStreamClosed = async (options?: { error?: unknown; shouldReconnect?: boolean }) => {
      if (!mountedRef.current) return;
      const shouldReconnect = options?.shouldReconnect ?? true;
      const hasSnapshot = hasSnapshotRef.current;

      if (!hasSnapshot) {
        const rescue = await loadDashboard({ silent: false });
        if (!mountedRef.current) return;
        if (!rescue.ok) {
          setConnectionState("disconnected");
        }
      }

      startFallbackPolling();

      if (options?.error && !isUnsupportedStreamError(options.error) && !isAbortError(options.error) && !hasSnapshot) {
        setSyncError(describeApiError(options.error, "Live stream disconnected"));
      }

      if (shouldReconnect) {
        scheduleReconnect(connectStream);
      }
    };

    const connectStream = () => {
      if (!mountedRef.current) return;
      stopStreamConnection();

      const sessionId = streamSessionRef.current + 1;
      streamSessionRef.current = sessionId;
      const controller = new AbortController();
      streamAbortRef.current = controller;

      if (connectionStateRef.current !== "fallback") {
        setConnectionState("connecting");
      }

      void api
        .streamDashboard({
          signal: controller.signal,
          onOpen: () => {
            if (!mountedRef.current || streamSessionRef.current !== sessionId) return;
            reconnectAttemptRef.current = 0;
            stopFallbackPolling();
            setSyncError(null);
            setConnectionState("live");
          },
          onSnapshot: (nextSnap) => {
            if (!mountedRef.current || streamSessionRef.current !== sessionId) return;
            applySnapshot(nextSnap);
          },
        })
        .then(() => {
          if (!mountedRef.current || streamSessionRef.current !== sessionId || controller.signal.aborted) return;
          void handleStreamClosed();
        })
        .catch((error) => {
          if (!mountedRef.current || streamSessionRef.current !== sessionId || controller.signal.aborted || isAbortError(error)) return;
          if (isUnsupportedStreamError(error)) {
            setSyncError(null);
            void handleStreamClosed({ error, shouldReconnect: false });
            return;
          }
          void handleStreamClosed({ error });
        });
    };

    connectStream();

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
      mountedRef.current = false;
      stopFallbackPolling();
      stopStreamConnection();
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

  const attemptSyncRecovery = async (manual = false) => {
    if (syncRecovering) {
      return { ok: false, manual, message: "Recovery already in progress" };
    }

    setSyncRecovering(true);
    try {
      const monitoring = await api.monitorStatus();
      applyMonitoringRef.current(monitoring);
      const fresh = await api.dashboard();
      applySnapshot(fresh);
      setSyncError(null);
      if (connectionStateRef.current !== "live") {
        setConnectionState("fallback");
      }
      return { ok: true, manual, message: undefined as string | undefined };
    } catch (error) {
      const message = describeApiError(error, "Refresh failed");
      setSyncError(message);
      if (connectionStateRef.current !== "live") {
        setConnectionState("disconnected");
      }
      return { ok: false, manual, message };
    } finally {
      setSyncRecovering(false);
    }
  };

  useEffect(() => {
    if (!syncStale || !latestMonitoringUpdateAt) return;
    if (staleRecoveryKeyRef.current === latestMonitoringUpdateAt) return;

    staleRecoveryKeyRef.current = latestMonitoringUpdateAt;
    void attemptSyncRecovery();
  }, [syncStale, latestMonitoringUpdateAt]);

  return {
    snap,
    setSnap: applySnapshot,
    connectionState,
    latestMonitoringUpdateAt,
    syncAgeMs,
    staleThresholdMs,
    isSyncStale: syncStale,
    syncRecovering,
    syncError,
    attemptSyncRecovery,
  };
}
