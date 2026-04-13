import type {
  AvailabilityRecord,
  DashboardSnapshot,
  MonitorSourceError,
  OrdersMetrics,
} from "../../types/models.js";
import { getSettings } from "../../services/settingsStore.js";
import { getRuntime, listResolvedBranches } from "../../services/branchStore.js";
import { getOrdersMirrorEntitySyncStatus } from "../../services/ordersMirrorStore.js";
import { derivePreparingNow } from "../../services/orders/classification.js";
import { resolveOrdersStaleMultiplier } from "../../services/orders/shared.js";
import { currentPreparation, type OrdersPressureSummary } from "./monitorState.js";
import type { MonitorRuntimeTracker, OrdersDataState } from "./runtimeTracking.js";

type MonitorSnapshotInput = {
  running: boolean;
  degraded: boolean;
  errors: { orders?: MonitorSourceError; availability?: MonitorSourceError };
  lastOrdersFetchAt?: string;
  lastAvailabilityFetchAt?: string;
  lastHealthyAt?: string;
  ordersLastSuccessfulSyncAt?: string;
  staleOrdersBranchCount: number;
  consecutiveOrdersSourceFailures: number;
  ordersByVendor: ReadonlyMap<number, OrdersMetrics>;
  availabilityByVendor: ReadonlyMap<string, AvailabilityRecord>;
  preparationByVendor: ReadonlyMap<number, OrdersPressureSummary>;
  currentHourPlacedByVendor: ReadonlyMap<number, number>;
  ordersDataStateByVendor: ReadonlyMap<number, OrdersDataState>;
  ordersLastSyncedAtByVendor: ReadonlyMap<number, string | undefined>;
};

function resolveSnapshotVersion(fetchedAt?: string | null) {
  return fetchedAt ?? null;
}

function resolveStaleAgeSeconds(fetchedAt: string | null | undefined, cacheState: "fresh" | "warming" | "stale") {
  if (!fetchedAt || cacheState !== "stale") return null;
  const ageMs = Date.now() - new Date(fetchedAt).getTime();
  if (!Number.isFinite(ageMs) || ageMs < 0) return null;
  return Math.floor(ageMs / 1000);
}

export function buildMonitorSnapshot(input: MonitorSnapshotInput, tracker: Pick<
  MonitorRuntimeTracker,
  | "resolveThresholds"
  | "isMonitorOwnedClosure"
  | "inferCloseStartedAt"
  | "inferObservedExternalCloseStartedAt"
  | "inferMonitorCloseReason"
>): DashboardSnapshot {
  const settings = getSettings();
  const branches = listResolvedBranches();
  const monitoredBranches = branches.filter((branch) => branch.enabled);
  const ordersSnapshot = getOrdersMirrorEntitySyncStatus({
    globalEntityId: settings.globalEntityId,
    ordersRefreshSeconds: settings.ordersRefreshSeconds,
  });
  const totals = {
    branchesMonitored: monitoredBranches.length,
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
  };

  const branchSnapshots = monitoredBranches.map((branch) => {
    const thresholds = tracker.resolveThresholds(branch, settings);
    const ordersDataState = input.ordersDataStateByVendor.get(branch.ordersVendorId) ?? "warming";
    const rawMetrics = input.ordersByVendor.get(branch.ordersVendorId) ?? {
      totalToday: 0,
      cancelledToday: 0,
      doneToday: 0,
      activeNow: 0,
      lateNow: 0,
      unassignedNow: 0,
      readyNow: 0,
    };
    const preparation = currentPreparation(
      input.preparationByVendor.get(branch.ordersVendorId) ?? {
        preparingNow: rawMetrics.preparingNow ?? derivePreparingNow(rawMetrics),
        preparingPickersNow: 0,
        recentActivePickers: 0,
        recentActiveAvailable: ordersDataState === "fresh",
      },
      ordersDataState === "fresh",
    );
    const ordersLastSyncedAt = input.ordersLastSyncedAtByVendor.get(branch.ordersVendorId);
    const currentHourPlacedCount = input.currentHourPlacedByVendor.get(branch.ordersVendorId) ?? 0;
    totals.ordersToday += rawMetrics.totalToday;
    totals.cancelledToday += rawMetrics.cancelledToday;
    totals.doneToday += rawMetrics.doneToday;
    totals.activeNow += rawMetrics.activeNow;
    totals.lateNow += rawMetrics.lateNow;
    totals.unassignedNow += rawMetrics.unassignedNow;

    const runtime = getRuntime(branch.id) ?? undefined;
    const trackedMonitorClosedUntil = runtime?.closureObservedUntil ?? runtime?.lastUpuseCloseUntil ?? undefined;
    let status: "OPEN" | "TEMP_CLOSE" | "CLOSED" | "UNKNOWN" = "UNKNOWN";
    let statusColor: "green" | "red" | "orange" | "grey" = "grey";
    let closedUntil: string | undefined;
    let closeStartedAt: string | undefined;
    let closedByUpuse = false;
    let closureSource: "UPUSE" | "EXTERNAL" | undefined;
    let closeReason: DashboardSnapshot["branches"][number]["closeReason"] = undefined;
    let sourceClosedReason: string | undefined;
    let autoReopen = false;

    const availabilityState = input.availabilityByVendor.get(branch.availabilityVendorId);

    if (availabilityState) {
      if (availabilityState.availabilityState === "OPEN") {
        status = "OPEN";
        statusColor = "green";
        totals.open += 1;
      } else if (availabilityState.availabilityState === "CLOSED_UNTIL") {
        status = "TEMP_CLOSE";
        statusColor = "red";
        closedByUpuse = tracker.isMonitorOwnedClosure(runtime, availabilityState);
        closedUntil = availabilityState.closedUntil ?? (closedByUpuse ? trackedMonitorClosedUntil : undefined);
        closureSource = closedByUpuse ? "UPUSE" : "EXTERNAL";
        sourceClosedReason = closedByUpuse ? undefined : availabilityState.closedReason;
        closeStartedAt = closedByUpuse
          ? tracker.inferCloseStartedAt(closedUntil, settings.tempCloseMinutes)
          : tracker.inferObservedExternalCloseStartedAt(runtime, availabilityState.closedUntil);
        autoReopen = closedByUpuse;
        if (closedByUpuse) {
          closeReason =
            runtime?.lastUpuseCloseReason ?? tracker.inferMonitorCloseReason(
              branch,
              rawMetrics,
              settings,
              currentHourPlacedCount,
              preparation.recentActivePickers,
              preparation.recentActiveAvailable,
            );
        }
        totals.tempClose += 1;
      } else if (availabilityState.availabilityState === "CLOSED" || availabilityState.availabilityState === "CLOSED_TODAY") {
        status = "CLOSED";
        statusColor = "orange";
        closureSource = "EXTERNAL";
        sourceClosedReason = availabilityState.closedReason;
        totals.closed += 1;
      } else if (availabilityState.availabilityState === "UNKNOWN") {
        totals.unknown += 1;
      }
    } else {
      totals.unknown += 1;
    }

    return {
      branchId: branch.id,
      name: branch.name,
      chainName: branch.chainName,
      monitorEnabled: true,
      ordersVendorId: branch.ordersVendorId,
      availabilityVendorId: branch.availabilityVendorId,
      status,
      statusColor,
      closedUntil,
      closeStartedAt,
      closedByUpuse,
      closureSource,
      closeReason,
      sourceClosedReason,
      autoReopen,
      changeable: availabilityState?.changeable,
      thresholds,
      metrics: rawMetrics,
      preparingNow: preparation.preparingNow,
      preparingPickersNow: preparation.preparingPickersNow,
      ordersDataState,
      ordersLastSyncedAt,
      lastUpdatedAt: input.lastHealthyAt,
    };
  });

  return {
    fetchedAt: ordersSnapshot.fetchedAt,
    cacheState: ordersSnapshot.cacheState,
    snapshotVersion: resolveSnapshotVersion(ordersSnapshot.lastSuccessfulSyncAt ?? ordersSnapshot.fetchedAt),
    staleAgeSeconds: resolveStaleAgeSeconds(ordersSnapshot.fetchedAt, ordersSnapshot.cacheState),
    monitoring: {
      running: input.running,
      lastOrdersFetchAt: input.lastOrdersFetchAt,
      lastAvailabilityFetchAt: input.lastAvailabilityFetchAt,
      lastHealthyAt: input.lastHealthyAt,
      degraded: input.degraded,
      ordersSync: {
        mode: "mirror",
        state:
          !input.lastOrdersFetchAt
            ? "warming"
            : input.consecutiveOrdersSourceFailures >= resolveOrdersStaleMultiplier() ||
              (totals.branchesMonitored > 0 && input.staleOrdersBranchCount / totals.branchesMonitored > 0.25)
              ? "degraded"
              : "healthy",
        lastSuccessfulSyncAt: input.ordersLastSuccessfulSyncAt,
        staleBranchCount: input.staleOrdersBranchCount,
        consecutiveSourceFailures: input.consecutiveOrdersSourceFailures,
      },
      errors: { ...input.errors },
    },
    totals,
    branches: branchSnapshots,
  };
}
