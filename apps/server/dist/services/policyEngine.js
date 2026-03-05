import { DateTime } from "luxon";
function isoToUtcDT(iso) {
    if (!iso)
        return null;
    const dt = DateTime.fromISO(iso, { zone: "utc" });
    return dt.isValid ? dt : null;
}
function isSameTrackedClosure(lastCloseUntil, closedUntil) {
    if (!lastCloseUntil || !closedUntil)
        return false;
    return Math.abs(DateTime.fromISO(closedUntil, { zone: "utc" }).diff(lastCloseUntil).as("seconds")) <= 5;
}
function isMonitorOwnedClosure(availability, lastCloseUntil, lastCloseAt, settings) {
    if (availability.availabilityState !== "CLOSED_UNTIL")
        return false;
    if (availability.modifiedBy === "log_vendor_monitor")
        return true;
    if (isSameTrackedClosure(lastCloseUntil, availability.closedUntil))
        return true;
    if (!lastCloseAt || !availability.closedUntil)
        return false;
    const expectedUntil = lastCloseAt.plus({ minutes: Math.max(1, settings.tempCloseMinutes) });
    const actualUntil = DateTime.fromISO(availability.closedUntil, { zone: "utc" });
    if (!actualUntil.isValid)
        return false;
    const toleranceSeconds = Math.max(90, settings.availabilityRefreshSeconds + 30);
    return Math.abs(actualUntil.diff(expectedUntil).as("seconds")) <= toleranceSeconds;
}
function resolveThresholds(branch, settings) {
    const chainKey = branch.chainName.trim().toLowerCase();
    if (!chainKey) {
        return {
            lateThreshold: settings.lateThreshold,
            unassignedThreshold: settings.unassignedThreshold,
        };
    }
    const match = settings.chains.find((item) => item.name.trim().toLowerCase() === chainKey);
    if (!match) {
        return {
            lateThreshold: settings.lateThreshold,
            unassignedThreshold: settings.unassignedThreshold,
        };
    }
    return {
        lateThreshold: match.lateThreshold,
        unassignedThreshold: match.unassignedThreshold,
    };
}
export function decide(input) {
    const { branch, metrics, availability, runtime, nowUtcIso, settings } = input;
    if (!branch.enabled)
        return { type: "NOOP" };
    if (!availability)
        return { type: "NOOP", note: "Availability not found" };
    if (!availability.changeable)
        return { type: "NOOP" };
    const now = DateTime.fromISO(nowUtcIso, { zone: "utc" });
    const thresholds = resolveThresholds(branch, settings);
    const exceedLate = metrics.lateNow >= thresholds.lateThreshold && thresholds.lateThreshold > 0;
    const exceedUnassigned = metrics.unassignedNow >= thresholds.unassignedThreshold && thresholds.unassignedThreshold > 0;
    const lastCloseUntil = isoToUtcDT(runtime?.lastUpuseCloseUntil ?? null);
    const lastCloseReason = (runtime?.lastUpuseCloseReason ?? null);
    const lastCloseAt = isoToUtcDT(runtime?.lastUpuseCloseAt ?? null);
    const isExternalOpenEarly = lastCloseUntil && now < lastCloseUntil && availability.availabilityState === "OPEN";
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
        if (now < graceEnds)
            return { type: "NOOP", note: "External open grace" };
        // After grace, enforce as normal
        if (exceedLate)
            return { type: "CLOSE", reason: "LATE" };
        if (exceedUnassigned)
            return { type: "CLOSE", reason: "UNASSIGNED" };
        return { type: "NOOP" };
    }
    // If currently temporary closed, optionally early re-open when UPuse owns this closure.
    if (availability.availabilityState === "CLOSED_UNTIL") {
        if (!isMonitorOwnedClosure(availability, lastCloseUntil, lastCloseAt, settings))
            return { type: "NOOP" };
        if (lastCloseReason === "LATE" && metrics.lateNow === 0)
            return { type: "EARLY_OPEN", reason: "LATE" };
        if (lastCloseReason === "UNASSIGNED" && metrics.unassignedNow === 0)
            return { type: "EARLY_OPEN", reason: "UNASSIGNED" };
        return { type: "NOOP" };
    }
    if (availability.availabilityState === "CLOSED") {
        return { type: "NOOP" };
    }
    // OPEN state: enforce close on threshold exceed
    if (availability.availabilityState === "OPEN") {
        if (exceedLate)
            return { type: "CLOSE", reason: "LATE" };
        if (exceedUnassigned)
            return { type: "CLOSE", reason: "UNASSIGNED" };
    }
    return { type: "NOOP" };
}
