import { DateTime } from "luxon";
import type {
  AvailabilityRecord,
  BranchMapping,
  CloseReason,
  OrdersMetrics,
  ResolvedBranchMapping,
  Settings,
} from "../../types/models.js";
import { getSettings } from "../../services/settingsStore.js";
import { getRuntime, listResolvedBranches, setRuntime } from "../../services/branchStore.js";
import { log } from "../../services/logger.js";
import { resolveBranchThresholdProfile } from "../../services/thresholds.js";
import {
  currentPreparation,
  type OrdersPressureSummary,
  capacityLimit,
  normalizeRecentActivePickers,
  resolveCapacityLoad,
} from "./monitorState.js";

export type RuntimeRow = NonNullable<ReturnType<typeof getRuntime>>;
export type RuntimePatch = Partial<NonNullable<RuntimeRow>>;
export type OrdersDataState = "fresh" | "stale" | "warming";

type ExternalClosureSyncInput = {
  availabilityByVendor: ReadonlyMap<string, AvailabilityRecord>;
  ordersByVendor: ReadonlyMap<number, OrdersMetrics>;
  preparationByVendor: ReadonlyMap<number, OrdersPressureSummary>;
  currentHourPlacedByVendor: ReadonlyMap<number, number>;
  ordersDataStateByVendor: ReadonlyMap<number, OrdersDataState>;
};

function getRuntimeOrUndefined(branchId: number) {
  return getRuntime(branchId) ?? undefined;
}

function getObjectProperty(value: unknown, key: string) {
  if (typeof value !== "object" || value === null || !(key in value)) {
    return undefined;
  }

  return (value as Record<string, unknown>)[key];
}

export class MonitorRuntimeTracker {
  resolveThresholds(
    branch: Pick<
      BranchMapping,
      | "chainName"
      | "lateThresholdOverride"
      | "lateReopenThresholdOverride"
      | "unassignedThresholdOverride"
      | "unassignedReopenThresholdOverride"
      | "readyThresholdOverride"
      | "readyReopenThresholdOverride"
      | "capacityRuleEnabledOverride"
      | "capacityPerHourEnabledOverride"
      | "capacityPerHourLimitOverride"
    >,
    settings: Settings,
  ) {
    return resolveBranchThresholdProfile(branch, settings);
  }

  inferMonitorCloseReason(
    branch: ResolvedBranchMapping,
    metrics: OrdersMetrics,
    settings: Settings,
    currentHourPlacedCount: number,
    recentActivePickers: number,
    recentActiveAvailable: boolean,
  ): CloseReason | undefined {
    const thresholds = this.resolveThresholds(branch, settings);
    const readyThreshold =
      typeof thresholds.readyThreshold === "number"
        ? thresholds.readyThreshold
        : 0;
    const normalizedRecentActivePickers = normalizeRecentActivePickers(recentActivePickers);
    const capacityRuleCanApply = thresholds.capacityRuleEnabled !== false
      && recentActiveAvailable
      && normalizedRecentActivePickers >= 1;
    const capacityLoad = resolveCapacityLoad(metrics);
    const exceedLate = metrics.lateNow >= thresholds.lateThreshold && thresholds.lateThreshold > 0;
    const exceedUnassigned = metrics.unassignedNow >= thresholds.unassignedThreshold && thresholds.unassignedThreshold > 0;
    const exceedReady = (metrics.readyNow ?? 0) >= readyThreshold && readyThreshold > 0;
    const exceedCapacity = capacityRuleCanApply
      && capacityLoad > capacityLimit(normalizedRecentActivePickers);
    const exceedCapacityPerHour = thresholds.capacityPerHourEnabled === true
      && typeof thresholds.capacityPerHourLimit === "number"
      && currentHourPlacedCount >= thresholds.capacityPerHourLimit;

    if (exceedLate) return "LATE";
    if (exceedUnassigned) return "UNASSIGNED";
    if (exceedReady) return "READY_TO_PICKUP";
    if (exceedCapacity) return "CAPACITY";
    if (exceedCapacityPerHour) return "CAPACITY_HOUR";
    return undefined;
  }

  hasTrustedMonitorRuntime(runtime: RuntimeRow | undefined, settings: Settings) {
    if (!runtime) return false;
    if (typeof runtime.lastUpuseCloseEventId === "number" && runtime.lastUpuseCloseEventId > 0) {
      return true;
    }

    if (!runtime.lastUpuseCloseAt || !runtime.lastActionAt) {
      return false;
    }

    const closeAt = DateTime.fromISO(runtime.lastUpuseCloseAt, { zone: "utc" });
    const actionAt = DateTime.fromISO(runtime.lastActionAt, { zone: "utc" });
    if (!closeAt.isValid || !actionAt.isValid) {
      return false;
    }

    const toleranceSeconds = Math.max(120, settings.availabilityRefreshSeconds + 30);
    return Math.abs(actionAt.diff(closeAt).as("seconds")) <= toleranceSeconds;
  }

  isTrackedUpuseClosure(runtime: RuntimeRow | undefined, closedUntil?: string) {
    if (!closedUntil) return false;
    const lastUntil = runtime?.lastUpuseCloseUntil;
    if (!lastUntil) return false;

    const dt1 = DateTime.fromISO(lastUntil, { zone: "utc" });
    const dt2 = DateTime.fromISO(closedUntil, { zone: "utc" });
    return Math.abs(dt1.diff(dt2).as("seconds")) <= 5;
  }

  matchesExpectedMonitorCloseWindow(runtime: RuntimeRow | undefined, closedUntil?: string) {
    if (!closedUntil || !runtime?.lastUpuseCloseAt) return false;

    const settings = getSettings();
    const lastCloseAt = DateTime.fromISO(runtime.lastUpuseCloseAt, { zone: "utc" });
    const actualUntil = DateTime.fromISO(closedUntil, { zone: "utc" });
    if (!lastCloseAt.isValid || !actualUntil.isValid) return false;

    const expectedUntil = lastCloseAt.plus({ minutes: Math.max(1, settings.tempCloseMinutes) });
    const toleranceSeconds = Math.max(90, settings.availabilityRefreshSeconds + 30);
    return Math.abs(actualUntil.diff(expectedUntil).as("seconds")) <= toleranceSeconds;
  }

  isObservedClosureMatch(runtime: RuntimeRow | undefined, closedUntil?: string) {
    if (!closedUntil || !runtime?.closureObservedUntil) return false;

    const observedUntil = DateTime.fromISO(runtime.closureObservedUntil, { zone: "utc" });
    const actualUntil = DateTime.fromISO(closedUntil, { zone: "utc" });
    if (!observedUntil.isValid || !actualUntil.isValid) return false;

    return Math.abs(observedUntil.diff(actualUntil).as("seconds")) <= 5;
  }

  isMonitorOwnedClosure(runtime: RuntimeRow | undefined, availability?: AvailabilityRecord) {
    if (!availability || availability.availabilityState !== "CLOSED_UNTIL") return false;
    const settings = getSettings();
    if (!this.hasTrustedMonitorRuntime(runtime, settings)) return false;
    if (runtime?.closureOwner === "EXTERNAL") return false;
    if (!availability.closedUntil) {
      return runtime?.closureOwner === "UPUSE" && Boolean(runtime.closureObservedUntil ?? runtime.lastUpuseCloseUntil);
    }

    if (runtime?.closureOwner === "UPUSE") {
      return (
        this.isObservedClosureMatch(runtime, availability.closedUntil) ||
        this.isTrackedUpuseClosure(runtime, availability.closedUntil) ||
        this.matchesExpectedMonitorCloseWindow(runtime, availability.closedUntil)
      );
    }

    return (
      this.isTrackedUpuseClosure(runtime, availability.closedUntil) ||
      this.matchesExpectedMonitorCloseWindow(runtime, availability.closedUntil)
    );
  }

  hasActiveTrackedMonitorWindow(runtime: RuntimeRow | undefined, nowIso: string) {
    const settings = getSettings();
    if (!this.hasTrustedMonitorRuntime(runtime, settings)) return false;
    const trackedCloseUntil = runtime?.closureObservedUntil ?? runtime?.lastUpuseCloseUntil;
    if (!trackedCloseUntil) return false;

    const now = DateTime.fromISO(nowIso, { zone: "utc" });
    const lastUntil = DateTime.fromISO(trackedCloseUntil, { zone: "utc" });
    if (!now.isValid || !lastUntil.isValid) return false;

    return now <= lastUntil.plus({ seconds: 120 });
  }

  inferCloseStartedAt(closedUntil: string | undefined, durationMinutes: number) {
    if (!closedUntil) return undefined;
    const end = DateTime.fromISO(closedUntil, { zone: "utc" });
    if (!end.isValid) return undefined;
    return end.minus({ minutes: Math.max(1, durationMinutes) }).toISO({ suppressMilliseconds: false }) ?? undefined;
  }

  inferObservedExternalCloseStartedAt(runtime: RuntimeRow | undefined, closedUntil: string | undefined) {
    if (!runtime?.lastExternalCloseAt || !closedUntil) return undefined;
    if (runtime.lastExternalCloseUntil !== closedUntil) return undefined;

    const startedAt = DateTime.fromISO(runtime.lastExternalCloseAt, { zone: "utc" });
    return startedAt.isValid
      ? startedAt.toISO({ suppressMilliseconds: false }) ?? undefined
      : undefined;
  }

  buildClearedMonitorRuntimePatch(runtime: RuntimeRow | undefined) {
    const patch: RuntimePatch = {};

    if (runtime?.lastUpuseCloseUntil) patch.lastUpuseCloseUntil = null;
    if (runtime?.lastUpuseCloseReason) patch.lastUpuseCloseReason = null;
    if (runtime?.lastUpuseCloseAt) patch.lastUpuseCloseAt = null;
    if (runtime?.lastUpuseCloseEventId) patch.lastUpuseCloseEventId = null;
    if (runtime?.externalOpenDetectedAt) patch.externalOpenDetectedAt = null;

    return patch;
  }

  buildClearedClosureObservationPatch(runtime: RuntimeRow | undefined) {
    const patch: RuntimePatch = {};

    if (runtime?.closureOwner) patch.closureOwner = null;
    if (runtime?.closureObservedUntil) patch.closureObservedUntil = null;
    if (runtime?.closureObservedAt) patch.closureObservedAt = null;

    return patch;
  }

  syncTrackedMonitorRuntime(
    branch: ResolvedBranchMapping,
    metrics: OrdersMetrics,
    currentHourPlacedCount: number,
    recentActivePickers: number,
    recentActiveAvailable: boolean,
    runtime: RuntimeRow | undefined,
    closedUntil: string,
    nowIso: string,
    settings: Settings,
  ) {
    const patch: RuntimePatch = {};

    if (!runtime?.lastUpuseCloseUntil) {
      patch.lastUpuseCloseUntil = closedUntil;
    }

    if (runtime?.closureOwner !== "UPUSE") {
      patch.closureOwner = "UPUSE";
    }

    if (runtime?.closureObservedUntil !== closedUntil) {
      patch.closureObservedUntil = closedUntil;
    }

    const nextObservedAt =
      runtime?.closureOwner === "UPUSE" &&
      runtime?.closureObservedUntil === closedUntil &&
      runtime?.closureObservedAt
        ? runtime.closureObservedAt
        : nowIso;
    if (runtime?.closureObservedAt !== nextObservedAt) {
      patch.closureObservedAt = nextObservedAt;
    }

    if (!runtime?.lastUpuseCloseAt) {
      const inferredCloseAt = this.inferCloseStartedAt(closedUntil, settings.tempCloseMinutes);
      if (inferredCloseAt) {
        patch.lastUpuseCloseAt = inferredCloseAt;
      }
    }

    if (!runtime?.lastUpuseCloseReason) {
      const inferredReason = this.inferMonitorCloseReason(
        branch,
        metrics,
        settings,
        currentHourPlacedCount,
        recentActivePickers,
        recentActiveAvailable,
      );
      if (inferredReason) {
        patch.lastUpuseCloseReason = inferredReason;
      }
    }

    if (runtime?.externalOpenDetectedAt) {
      patch.externalOpenDetectedAt = null;
    }

    if (runtime?.lastExternalCloseUntil) {
      patch.lastExternalCloseUntil = null;
    }

    if (runtime?.lastExternalCloseAt) {
      patch.lastExternalCloseAt = null;
    }

    if (!Object.keys(patch).length) {
      return runtime;
    }

    setRuntime(branch.id, patch);
    return getRuntimeOrUndefined(branch.id);
  }

  syncExternalTemporaryClosureRuntime(
    branch: ResolvedBranchMapping,
    runtime: RuntimeRow | undefined,
    externalClosedUntil: string,
    nowIso: string,
    clearTrackedMonitorRuntime: boolean,
  ) {
    const patch: RuntimePatch = {};
    const observedAt =
      runtime?.closureOwner === "EXTERNAL" &&
      runtime?.closureObservedUntil === externalClosedUntil &&
      runtime?.closureObservedAt
        ? runtime.closureObservedAt
        : runtime?.lastExternalCloseUntil === externalClosedUntil && runtime?.lastExternalCloseAt
          ? runtime.lastExternalCloseAt
          : nowIso;

    if (runtime?.closureOwner !== "EXTERNAL") {
      patch.closureOwner = "EXTERNAL";
    }
    if (runtime?.closureObservedUntil !== externalClosedUntil) {
      patch.closureObservedUntil = externalClosedUntil;
    }
    if (runtime?.closureObservedAt !== observedAt) {
      patch.closureObservedAt = observedAt;
    }
    if (runtime?.lastExternalCloseUntil !== externalClosedUntil) {
      patch.lastExternalCloseUntil = externalClosedUntil;
    }
    if (runtime?.lastExternalCloseAt !== observedAt) {
      patch.lastExternalCloseAt = observedAt;
    }
    if (runtime?.externalOpenDetectedAt) {
      patch.externalOpenDetectedAt = null;
    }

    if (clearTrackedMonitorRuntime) {
      Object.assign(patch, this.buildClearedMonitorRuntimePatch(runtime));
    }

    if (!Object.keys(patch).length) {
      return runtime;
    }

    return (setRuntime(branch.id, patch) ?? null) || getRuntimeOrUndefined(branch.id);
  }

  extractClosedUntilCandidate(payload: unknown): string | undefined {
    const availability = getObjectProperty(payload, "availability");
    const data = getObjectProperty(payload, "data");
    const candidates = [
      getObjectProperty(payload, "closedUntil"),
      getObjectProperty(payload, "closed_until"),
      getObjectProperty(availability, "closedUntil"),
      getObjectProperty(availability, "closed_until"),
      getObjectProperty(data, "closedUntil"),
      getObjectProperty(data, "closed_until"),
    ];

    const value = candidates.find(
      (candidate): candidate is string => typeof candidate === "string" && candidate.trim().length > 0,
    );
    if (!value) return undefined;

    const parsed = DateTime.fromISO(value, { zone: "utc" });
    return parsed.isValid
      ? parsed.toISO({ suppressMilliseconds: false }) ?? undefined
      : undefined;
  }

  syncExternalClosureState(input: ExternalClosureSyncInput, nowIso: string) {
    const settings = getSettings();
    const branches = listResolvedBranches({ enabledOnly: true });

    for (const branch of branches) {
      const availability = input.availabilityByVendor.get(branch.availabilityVendorId);
      let runtime = getRuntimeOrUndefined(branch.id);
      const metrics = input.ordersByVendor.get(branch.ordersVendorId) ?? {
        totalToday: 0,
        cancelledToday: 0,
        doneToday: 0,
        activeNow: 0,
        lateNow: 0,
        unassignedNow: 0,
        readyNow: 0,
      };
      const currentHourPlacedCount = input.currentHourPlacedByVendor.get(branch.ordersVendorId) ?? 0;
      const preparation = currentPreparation(
        input.preparationByVendor.get(branch.ordersVendorId),
        input.ordersDataStateByVendor.get(branch.ordersVendorId) === "fresh",
      );
      if (!availability) {
        continue;
      }

      const monitorWindowStillActive = this.hasActiveTrackedMonitorWindow(runtime, nowIso);
      const trackedMonitorClosedUntil = runtime?.closureObservedUntil ?? runtime?.lastUpuseCloseUntil ?? undefined;
      const isMonitorOwnedTempClose = Boolean(
        availability.availabilityState === "CLOSED_UNTIL" &&
        this.isMonitorOwnedClosure(runtime, availability) &&
        (availability.closedUntil ?? trackedMonitorClosedUntil),
      );

      if (isMonitorOwnedTempClose) {
        runtime = this.syncTrackedMonitorRuntime(
          branch,
          metrics,
          currentHourPlacedCount,
          preparation.recentActivePickers,
          preparation.recentActiveAvailable,
          runtime,
          availability.closedUntil ?? trackedMonitorClosedUntil ?? "",
          nowIso,
          settings,
        );
        continue;
      }

      if (availability.availabilityState === "CLOSED_UNTIL" && availability.closedUntil) {
        const externalClosedUntil = availability.closedUntil;
        const shouldPersistExternalWindow =
          runtime?.closureOwner !== "EXTERNAL" ||
          runtime?.lastExternalCloseUntil !== externalClosedUntil ||
          runtime?.lastExternalCloseAt == null;

        if (shouldPersistExternalWindow || !monitorWindowStillActive) {
          runtime = this.syncExternalTemporaryClosureRuntime(
            branch,
            runtime,
            externalClosedUntil,
            nowIso,
            !monitorWindowStillActive,
          );
          const untilDt = DateTime.fromISO(externalClosedUntil, { zone: "utc" }).setZone("Africa/Cairo");
          const untilLabel = untilDt.isValid ? untilDt.toFormat("HH:mm") : null;
          if (shouldPersistExternalWindow) {
            log(
              branch.id,
              "WARN",
              untilLabel ? `TEMP CLOSE — external source until ${untilLabel}` : "TEMP CLOSE — external source",
            );
          }
        }
        continue;
      }

      if (runtime?.lastExternalCloseUntil || runtime?.lastExternalCloseAt || runtime?.closureOwner === "EXTERNAL") {
        if (availability.availabilityState === "OPEN") {
          log(branch.id, "INFO", "OPEN — external source reopened");
        } else if (availability.availabilityState === "CLOSED" || availability.availabilityState === "CLOSED_TODAY") {
          log(branch.id, "WARN", "CLOSED — external source");
        }

        setRuntime(branch.id, {
          ...this.buildClearedClosureObservationPatch(runtime),
          lastExternalCloseUntil: null,
          lastExternalCloseAt: null,
        });
      }
    }
  }
}
