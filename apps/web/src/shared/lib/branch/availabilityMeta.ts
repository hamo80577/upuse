import type { AvailabilityKind, BranchSnapshot } from "../../../api/types";

export function resolveAvailabilityKind(branch: BranchSnapshot): AvailabilityKind {
  if (branch.availabilityKind) return branch.availabilityKind;

  if (branch.status === "TEMP_CLOSE" && (branch.closedByUpuse || branch.closureSource === "UPUSE")) {
    return "upuseTempClose";
  }

  if (branch.vssGroup === "shortClosures" || branch.status === "TEMP_CLOSE") {
    return "sourceShortClosure";
  }

  if (branch.vssGroup === "issues") return "sourceIssue";
  if (branch.vssGroup === "inactive") return "sourceInactive";
  if (branch.vssGroup === "offHours") return "sourceOffHours";
  if (branch.vssGroup === "highDemand") return "highDemand";
  if (branch.status === "OPEN") return "open";
  return "unknown";
}

export function resolveAvailabilitySubtypeLabel(branch: BranchSnapshot) {
  const kind = resolveAvailabilityKind(branch);

  if (kind === "sourceShortClosure") return "shortClosures";
  if (kind === "sourceIssue") return "issues";
  if (kind === "sourceInactive") return "inactive";
  if (kind === "sourceOffHours") return "offHours";
  if (kind === "highDemand") return "highDemand";
  if (kind === "upuseTempClose") return "UPuse";
  return null;
}

export function hasTimerBackedAvailability(branch: BranchSnapshot) {
  const kind = resolveAvailabilityKind(branch);
  return (kind === "upuseTempClose" || kind === "sourceShortClosure") && Boolean(branch.closedUntil);
}

export function rawSourceClosedReason(reason?: string) {
  const normalized = reason?.trim();
  return normalized ? normalized : null;
}

export function resolveSourceClosedReason(branch: BranchSnapshot) {
  return rawSourceClosedReason(branch.vssClosedReason ?? branch.sourceClosedReason);
}

export function formatHighDemandMeta(branch: BranchSnapshot) {
  if (!branch.preptimeAdjustment) return null;

  const adjustment = `+${branch.preptimeAdjustment.adjustmentMinutes} min`;
  const windowLabel = `${branch.preptimeAdjustment.interval.startTime} - ${branch.preptimeAdjustment.interval.endTime}`;
  return `${adjustment} • ${windowLabel}`;
}

export function availabilityStatusChip(branch: BranchSnapshot) {
  if (!branch.monitorEnabled) {
    return { label: "Paused", sx: { bgcolor: "#eef2ff", color: "#4338ca" } };
  }

  if (branch.status === "OPEN") return { label: "Open", sx: { bgcolor: "#e7f7ed", color: "#166534" } };
  if (branch.status === "TEMP_CLOSE") return { label: "Temporary Close", sx: { bgcolor: "#fff1f2", color: "#be123c" } };
  if (branch.status === "CLOSED") return { label: "Closed", sx: { bgcolor: "#fff7d6", color: "#92400e" } };
  return { label: "Unknown", sx: { bgcolor: "#f1f5f9", color: "#475569" } };
}

export function availabilitySubtypeChip(branch: BranchSnapshot) {
  const label = resolveAvailabilitySubtypeLabel(branch);
  if (!label) return null;

  if (label === "UPuse") {
    return {
      label,
      sx: {
        bgcolor: "rgba(219,234,254,0.94)",
        color: "#1d4ed8",
        borderColor: "rgba(96,165,250,0.24)",
      },
    };
  }

  if (label === "highDemand") {
    return {
      label,
      sx: {
        bgcolor: "rgba(255,247,214,0.95)",
        color: "#92400e",
        borderColor: "rgba(245,158,11,0.2)",
      },
    };
  }

  if (label === "shortClosures") {
    return {
      label,
      sx: {
        bgcolor: "rgba(255,241,242,0.95)",
        color: "#be123c",
        borderColor: "rgba(244,114,182,0.2)",
      },
    };
  }

  return {
    label,
    sx: {
      bgcolor: "rgba(248,250,252,0.96)",
      color: "#475569",
      borderColor: "rgba(148,163,184,0.18)",
    },
  };
}

export function availabilityNote(branch: BranchSnapshot) {
  const kind = resolveAvailabilityKind(branch);
  const sourceReason = resolveSourceClosedReason(branch);
  const highDemandMeta = formatHighDemandMeta(branch);

  if (kind === "upuseTempClose") {
    return "Temporary closure is active until the timer ends or the trigger returns to zero.";
  }

  if (kind === "sourceShortClosure") {
    return branch.closedUntil
      ? "Source marks this branch as shortClosures until the countdown ends."
      : "Source marks this branch as shortClosures with no countdown target yet.";
  }

  if (kind === "sourceIssue") {
    return sourceReason ? sourceReason : "Source marks this branch as issues.";
  }

  if (kind === "sourceInactive") {
    return "Source marks this branch as inactive.";
  }

  if (kind === "sourceOffHours") {
    return "Source marks this branch as offHours.";
  }

  if (kind === "highDemand") {
    return highDemandMeta ? `Source marks this branch as highDemand. ${highDemandMeta}.` : "Source marks this branch as highDemand.";
  }

  if (branch.status === "UNKNOWN") {
    return "Waiting for the latest API update.";
  }

  return "";
}
