import type { BranchSnapshot } from "../../../api/types";
import {
  availabilityStatusChip,
  availabilitySubtypeChip,
  formatHighDemandMeta,
  hasTimerBackedAvailability,
  resolveAvailabilityKind,
  resolveSourceClosedReason,
} from "../../../shared/lib/branch/availabilityMeta";

export function statusChip(branch: BranchSnapshot) {
  return availabilityStatusChip(branch);
}

export function closeReasonMeta(reason?: BranchSnapshot["closeReason"]) {
  if (reason === "LATE") return { label: "Late Trigger", tone: "#9a3412", background: "rgba(255,237,213,0.94)", border: "rgba(251,146,60,0.22)" };
  if (reason === "UNASSIGNED") return { label: "Unassigned Trigger", tone: "#b91c1c", background: "rgba(254,226,226,0.94)", border: "rgba(248,113,113,0.22)" };
  if (reason === "READY_TO_PICKUP") return { label: "Ready To Pickup Trigger", tone: "#1d4ed8", background: "rgba(219,234,254,0.94)", border: "rgba(96,165,250,0.24)" };
  if (reason === "CAPACITY") return { label: "Capacity Trigger", tone: "#155e75", background: "rgba(236,254,255,0.96)", border: "rgba(34,211,238,0.22)" };
  if (reason === "CAPACITY_HOUR") return { label: "Capacity / Hour Trigger", tone: "#1d4ed8", background: "rgba(239,246,255,0.96)", border: "rgba(96,165,250,0.24)" };
  return null;
}

export function statusPanelMeta(branch: BranchSnapshot) {
  const kind = resolveAvailabilityKind(branch);
  const sourceReason = resolveSourceClosedReason(branch);
  const highDemandMeta = formatHighDemandMeta(branch);
  const subtype = availabilitySubtypeChip(branch);

  if (!branch.monitorEnabled) {
    return {
      title: "Paused from Monitor",
      caption: "This branch is excluded from live monitor cycles until it is turned back on.",
      tone: "#4338ca",
      sourceLabel: null,
      showTimer: false,
      footerCaption: null,
    };
  }

  if (kind === "upuseTempClose") {
    return {
      title: "UPuse Temporary Close",
      caption:
        branch.autoReopen && branch.changeable !== false
          ? "Auto reopen is armed when the trigger recovers."
          : "Timer is tracked, but the source is not changeable right now.",
      tone: "#166534",
      sourceLabel: subtype?.label ?? "UPuse",
      showTimer: true,
      footerCaption: null,
    };
  }

  if (kind === "sourceShortClosure") {
    return {
      title: "Source Temporary Close",
      caption: "Source marks this branch as shortClosures.",
      tone: "#166534",
      sourceLabel: subtype?.label ?? "shortClosures",
      showTimer: hasTimerBackedAvailability(branch),
      footerCaption: null,
    };
  }

  if (kind === "sourceIssue") {
    return {
      title: "Closed from Source",
      caption: sourceReason ?? "Source marks this branch as issues.",
      tone: "#92400e",
      sourceLabel: subtype?.label ?? "issues",
      showTimer: false,
      footerCaption: "No timer is available while VSS reports issues for this branch.",
    };
  }

  if (kind === "sourceInactive") {
    return {
      title: "Closed from Source",
      caption: "Source marks this branch as inactive.",
      tone: "#92400e",
      sourceLabel: subtype?.label ?? "inactive",
      showTimer: false,
      footerCaption: "No timer is available while VSS reports this branch as inactive.",
    };
  }

  if (kind === "sourceOffHours") {
    return {
      title: "Closed from Source",
      caption: "Source marks this branch as offHours.",
      tone: "#92400e",
      sourceLabel: subtype?.label ?? "offHours",
      showTimer: false,
      footerCaption: "No timer is available while VSS reports this branch as offHours.",
    };
  }

  if (kind === "highDemand") {
    return {
      title: "Live and Open",
      caption: highDemandMeta ? `Source marks this branch as highDemand. ${highDemandMeta}.` : "Source marks this branch as highDemand.",
      tone: "#166534",
      sourceLabel: subtype?.label ?? "highDemand",
      showTimer: false,
      footerCaption: null,
    };
  }

  if (branch.status === "OPEN") {
    return {
      title: "Live and Open",
      caption: "No temporary closure is active.",
      tone: "#166534",
      sourceLabel: null,
      showTimer: false,
      footerCaption: null,
    };
  }

  if (branch.status === "CLOSED") {
    return {
      title: "Closed from Source",
      caption: "No temporary timer is active for this branch.",
      tone: "#92400e",
      sourceLabel: subtype?.label ?? "Source Closed",
      showTimer: false,
      footerCaption: null,
    };
  }

  return {
    title: "Waiting for Availability",
    caption: "The latest availability snapshot is still syncing.",
    tone: "#475569",
    sourceLabel: null,
    showTimer: false,
    footerCaption: null,
  };
}
