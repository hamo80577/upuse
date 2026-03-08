import { DateTime } from "luxon";
import type { BranchMapping, CloseReason, OrdersMetrics, AvailabilityRecord, Settings } from "../types/models.js";
import { resolveBranchThresholdProfile } from "./thresholds.js";

export interface PolicyInput {
  branch: BranchMapping;
  metrics: OrdersMetrics;
  availability?: AvailabilityRecord;
  runtime?: {
    lastUpuseCloseUntil?: string | null;
    lastUpuseCloseReason?: CloseReason | null;
    lastUpuseCloseAt?: string | null;
    lastUpuseCloseEventId?: number | null;
    externalOpenDetectedAt?: string | null;
    lastActionAt?: string | null;
  };
  nowUtcIso: string;
  settings: Settings;
}

export type PolicyDecision =
  | { type: "NOOP"; note?: string }
  | { type: "CLOSE"; reason: CloseReason }
  | { type: "EARLY_OPEN"; reason: CloseReason }
  | { type: "MARK_EXTERNAL_OPEN"; note?: string };

function isoToUtcDT(iso?: string | null) {
  if (!iso) return null;
  const dt = DateTime.fromISO(iso, { zone: "utc" });
  return dt.isValid ? dt : null;
}

function isSameTrackedClosure(lastCloseUntil: DateTime | null, closedUntil?: string) {
  if (!lastCloseUntil || !closedUntil) return false;
  return Math.abs(
    DateTime.fromISO(closedUntil, { zone: "utc" }).diff(lastCloseUntil).as("seconds")
  ) <= 5;
}

function hasTrustedTrackedRuntime(
  runtime: PolicyInput["runtime"] | undefined,
  settings: Settings,
) {
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

function isMonitorOwnedClosure(
  availability: AvailabilityRecord,
  lastCloseUntil: DateTime | null,
  lastCloseAt: DateTime | null,
  settings: Settings,
) {
  if (availability.availabilityState !== "CLOSED_UNTIL") return false;
  if (isSameTrackedClosure(lastCloseUntil, availability.closedUntil)) return true;

  if (!lastCloseAt || !availability.closedUntil) return false;

  const expectedUntil = lastCloseAt.plus({ minutes: Math.max(1, settings.tempCloseMinutes) });
  const actualUntil = DateTime.fromISO(availability.closedUntil, { zone: "utc" });
  if (!actualUntil.isValid) return false;

  const toleranceSeconds = Math.max(90, settings.availabilityRefreshSeconds + 30);
  return Math.abs(actualUntil.diff(expectedUntil).as("seconds")) <= toleranceSeconds;
}

export function decide(input: PolicyInput): PolicyDecision {
  const { branch, metrics, availability, runtime, nowUtcIso, settings } = input;
  if (!branch.enabled) return { type: "NOOP" };
  if (!availability) return { type: "NOOP", note: "Availability not found" };
  if (!availability.changeable) return { type: "NOOP" };

  const now = DateTime.fromISO(nowUtcIso, { zone: "utc" });
  const thresholds = resolveBranchThresholdProfile(branch, settings);
  const trustedRuntime = hasTrustedTrackedRuntime(runtime, settings);

  const exceedLate = metrics.lateNow >= thresholds.lateThreshold && thresholds.lateThreshold > 0;
  const exceedUnassigned = metrics.unassignedNow >= thresholds.unassignedThreshold && thresholds.unassignedThreshold > 0;

  const lastCloseUntil = trustedRuntime ? isoToUtcDT(runtime?.lastUpuseCloseUntil ?? null) : null;
  const lastCloseReason = trustedRuntime ? (runtime?.lastUpuseCloseReason ?? null) as CloseReason | null : null;
  const lastCloseAt = trustedRuntime ? isoToUtcDT(runtime?.lastUpuseCloseAt ?? null) : null;

  const isExternalOpenEarly =
    lastCloseUntil && now < lastCloseUntil && availability.availabilityState === "OPEN";

  // Grace logic: if someone opened externally before last close window ends.
  if (isExternalOpenEarly) {
    // After a UPuse close, give the availability source one refresh window to reflect the new state
    // before treating an OPEN response as a true external/manual reopen.
    if (lastCloseAt) {
      const sourceSyncDeadline = lastCloseAt.plus({ seconds: Math.max(20, settings.availabilityRefreshSeconds + 5) });
      if (now < sourceSyncDeadline) {
        return { type: "NOOP", note: "Waiting for close state propagation" };
      }
    }

    const detectedAt = isoToUtcDT(runtime?.externalOpenDetectedAt ?? null);
    if (!detectedAt) {
      return { type: "MARK_EXTERNAL_OPEN", note: "External open detected" };
    }
    const graceEnds = detectedAt.plus({ minutes: settings.graceMinutes });
    if (now < graceEnds) return { type: "NOOP", note: "External open grace" };

    // After grace, enforce as normal
    if (exceedLate) return { type: "CLOSE", reason: "LATE" };
    if (exceedUnassigned) return { type: "CLOSE", reason: "UNASSIGNED" };
    return { type: "NOOP" };
  }

  // If currently temporary closed, optionally early re-open when UPuse owns this closure.
  if (availability.availabilityState === "CLOSED_UNTIL") {
    if (!isMonitorOwnedClosure(availability, lastCloseUntil, lastCloseAt, settings)) return { type: "NOOP" };

    if (lastCloseReason === "LATE" && metrics.lateNow === 0) return { type: "EARLY_OPEN", reason: "LATE" };
    if (lastCloseReason === "UNASSIGNED" && metrics.unassignedNow === 0) return { type: "EARLY_OPEN", reason: "UNASSIGNED" };

    return { type: "NOOP" };
  }

  if (availability.availabilityState === "CLOSED") {
    return { type: "NOOP" };
  }

  // OPEN state: enforce close on threshold exceed
  if (availability.availabilityState === "OPEN") {
    if (exceedLate) return { type: "CLOSE", reason: "LATE" };
    if (exceedUnassigned) return { type: "CLOSE", reason: "UNASSIGNED" };
  }

  return { type: "NOOP" };
}
