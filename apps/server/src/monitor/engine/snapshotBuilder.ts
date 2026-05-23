import type {
  AvailabilityKind,
  AvailabilityRecord,
  DashboardSnapshot,
  MonitorSourceError,
  OrdersMetrics,
} from "../../types/models.js";
import { FIXED_AVAILABILITY_REFRESH_SECONDS } from "../../config/monitoring.js";
import { getSettings } from "../../services/settingsStore.js";
import { getRuntime, listResolvedBranches } from "../../services/branchStore.js";
import { getOrdersMirrorEntitySyncStatus } from "../../services/ordersMirrorStore.js";
import { listTodayMonitorOperationCountsByBranch } from "../../services/actionReportStore.js";
import { derivePreparingNow } from "../../services/orders/classification.js";
import { resolveOrdersStaleMultiplier } from "../../services/orders/shared.js";
import { currentPreparation, type OrdersPressureSummary } from "./monitorState.js";
import type { MonitorRuntimeTracker, OrdersDataState } from "./runtimeTracking.js";
import { resolveEffectiveHighDemandSchedule, resolveHighDemandSource } from "../../services/highDemandSchedule.js";

type MonitorSnapshotInput = {
  running: boolean;
  degraded: boolean;
  errors: { orders?: MonitorSourceError; availability?: MonitorSourceError };
  lastOrdersFetchAt?: string;
  lastAvailabilityAttemptAt?: string;
  lastAvailabilityFetchAt?: string;
  lastHealthyAt?: string;
  ordersLastSuccessfulSyncAt?: string;
  availabilityLastSuccessfulSyncAt?: string;
  staleOrdersBranchCount: number;
  consecutiveOrdersSourceFailures: number;
  consecutiveAvailabilitySourceFailures: number;
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

function resolveAvailabilityKind(
  runtime: ReturnType<typeof getRuntime> | null | undefined,
  availabilityState: AvailabilityRecord | undefined,
  tracker: Pick<MonitorRuntimeTracker, "isMonitorOwnedClosure">,
): AvailabilityKind {
  if (!availabilityState) return "unknown";

  if (availabilityState.availabilityState === "CLOSED_UNTIL" && tracker.isMonitorOwnedClosure(runtime ?? undefined, availabilityState)) {
    return "upuseTempClose";
  }

  if (availabilityState.vssGroup === "shortClosures" || availabilityState.availabilityState === "CLOSED_UNTIL") {
    return "sourceShortClosure";
  }

  if (availabilityState.vssGroup === "issues") {
    return "sourceIssue";
  }

  if (availabilityState.vssGroup === "inactive") {
    return "sourceInactive";
  }

  if (availabilityState.vssGroup === "offHours") {
    return "sourceOffHours";
  }

  if (availabilityState.vssGroup === "highDemand") {
    return "highDemand";
  }

  if (availabilityState.availabilityState === "OPEN" || availabilityState.vssGroup === "open") {
    return "open";
  }

  return "unknown";
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
  const operationCountsByBranch = listTodayMonitorOperationCountsByBranch(monitoredBranches.map((branch) => branch.id));
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
    onHoldNow: 0,
    upuseTempCloseToday: 0,
    upuseHighDemandToday: 0,
  };

  const branchSnapshots = monitoredBranches.map((branch) => {
    const operationsToday = operationCountsByBranch.get(branch.id) ?? {
      upuseTempClose: 0,
      upuseHighDemand: 0,
    };
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
      onHoldNow: 0,
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
    totals.onHoldNow += rawMetrics.onHoldNow ?? 0;
    totals.upuseTempCloseToday += operationsToday.upuseTempClose;
    totals.upuseHighDemandToday += operationsToday.upuseHighDemand;

    const runtime = getRuntime(branch.id) ?? undefined;
    const effectiveHighDemandSchedule = resolveEffectiveHighDemandSchedule(branch, settings);
    const highDemandReferenceAt =
      input.lastAvailabilityFetchAt ??
      input.availabilityLastSuccessfulSyncAt ??
      input.lastHealthyAt ??
      new Date().toISOString();
    const trackedMonitorClosedUntil = runtime?.closureObservedUntil ?? runtime?.lastUpuseCloseUntil ?? undefined;
    let status: "OPEN" | "TEMP_CLOSE" | "CLOSED" | "UNKNOWN" = "UNKNOWN";
    let statusColor: "green" | "red" | "orange" | "grey" = "grey";
    let availabilityKind: AvailabilityKind = "unknown";
    let closedUntil: string | undefined;
    let closeStartedAt: string | undefined;
    let closedByUpuse = false;
    let closureSource: "UPUSE" | "EXTERNAL" | undefined;
    let closeReason: DashboardSnapshot["branches"][number]["closeReason"] = undefined;
    let sourceClosedReason: string | undefined;
    let autoReopen = false;

    const availabilityState = input.availabilityByVendor.get(branch.availabilityVendorId);

    if (availabilityState) {
      availabilityKind = resolveAvailabilityKind(runtime, availabilityState, tracker);

      if (availabilityKind === "open" || availabilityKind === "highDemand") {
        status = "OPEN";
        statusColor = "green";
        totals.open += 1;
      } else if (availabilityKind === "upuseTempClose" || availabilityKind === "sourceShortClosure") {
        status = "TEMP_CLOSE";
        statusColor = "red";
        closedByUpuse = availabilityKind === "upuseTempClose";
        closedUntil = availabilityKind === "upuseTempClose"
          ? availabilityState.closedUntil ?? trackedMonitorClosedUntil
          : availabilityState.vssNextOpeningAt ?? availabilityState.closedUntil;
        closureSource = closedByUpuse ? "UPUSE" : "EXTERNAL";
        sourceClosedReason = closedByUpuse ? undefined : availabilityState.vssClosedReason ?? availabilityState.closedReason;
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
      } else if (
        availabilityKind === "sourceIssue" ||
        availabilityKind === "sourceInactive" ||
        availabilityKind === "sourceOffHours"
      ) {
        status = "CLOSED";
        statusColor = "orange";
        closureSource = "EXTERNAL";
        sourceClosedReason = availabilityState.vssClosedReason ?? availabilityState.closedReason;
        totals.closed += 1;
      } else {
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
      availabilityKind,
      closedUntil,
      closeStartedAt,
      closedByUpuse,
      closureSource,
      closeReason,
      sourceClosedReason,
      autoReopen,
      changeable: availabilityState?.changeable,
      vssBucket: availabilityState?.vssBucket,
      vssGroup: availabilityState?.vssGroup,
      vssNextOpeningAt: availabilityState?.vssNextOpeningAt,
      vssEndTime: availabilityState?.vssEndTime,
      vssClosedReason: availabilityState?.vssClosedReason,
      vssChangeable: availabilityState?.vssChangeable,
      preptimeAdjustment: availabilityState?.preptimeAdjustment,
      highDemandSchedule: effectiveHighDemandSchedule.schedule,
      highDemandScheduleSource: effectiveHighDemandSchedule.source,
      highDemandScheduleOverride: effectiveHighDemandSchedule.override,
      highDemandSource: resolveHighDemandSource(availabilityState, runtime, highDemandReferenceAt),
      thresholds,
      metrics: rawMetrics,
      preparingNow: preparation.preparingNow,
      preparingPickersNow: preparation.preparingPickersNow,
      ordersDataState,
      ordersLastSyncedAt,
      operationsToday,
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
        cadenceSeconds: settings.ordersRefreshSeconds,
        lastSuccessfulSyncAt: input.ordersLastSuccessfulSyncAt,
        staleBranchCount: input.staleOrdersBranchCount,
        consecutiveSourceFailures: input.consecutiveOrdersSourceFailures,
        error: input.errors.orders,
      },
      availabilitySync: {
        state:
          !input.lastAvailabilityAttemptAt
            ? "warming"
            : input.errors.availability
              ? "degraded"
              : input.lastAvailabilityFetchAt
                ? "healthy"
                : "warming",
        cadenceSeconds: FIXED_AVAILABILITY_REFRESH_SECONDS,
        lastAttemptAt: input.lastAvailabilityAttemptAt,
        lastSuccessfulSyncAt: input.availabilityLastSuccessfulSyncAt,
        consecutiveFailures: input.consecutiveAvailabilitySourceFailures,
        error: input.errors.availability,
      },
      errors: { ...input.errors },
    },
    totals,
    branches: branchSnapshots,
  };
}
