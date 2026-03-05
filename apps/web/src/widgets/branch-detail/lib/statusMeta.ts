import type { BranchDetailSnapshot } from "../../../api/types";

export function statusChip(branch: BranchDetailSnapshot["branch"]) {
  if (branch.status === "OPEN") return { label: "Open", sx: { bgcolor: "#e7f7ed", color: "#166534" } };
  if (branch.status === "TEMP_CLOSE") return { label: "Temporary Close", sx: { bgcolor: "#fff1f2", color: "#be123c" } };
  if (branch.status === "CLOSED") return { label: "Closed", sx: { bgcolor: "#fff7d6", color: "#92400e" } };
  return { label: "Unknown", sx: { bgcolor: "#f1f5f9", color: "#475569" } };
}

export function closeReasonChip(reason?: BranchDetailSnapshot["branch"]["closeReason"]) {
  if (reason === "LATE") return { label: "Late Trigger", sx: { bgcolor: "rgba(251,146,60,0.14)", color: "#9a3412" } };
  if (reason === "UNASSIGNED") return { label: "Unassigned Trigger", sx: { bgcolor: "rgba(239,68,68,0.12)", color: "#b91c1c" } };
  return null;
}

export function statusPanelMeta(branch: BranchDetailSnapshot["branch"]) {
  if (branch.status === "OPEN") {
    return {
      title: "Live and Open",
      caption: "No temporary closure is active.",
      tone: "#166534",
      sourceLabel: null,
      showTimer: false,
    };
  }

  if (branch.status === "TEMP_CLOSE") {
    const isUpuseControlled = branch.closureSource === "UPUSE" || branch.closedByUpuse;
    const canAutoReopen = Boolean(isUpuseControlled && branch.autoReopen && branch.changeable !== false);
    return {
      title: isUpuseControlled ? "UPuse Temporary Close" : "Source Temporary Close",
      caption: canAutoReopen
        ? "Auto reopen is armed when the trigger recovers."
        : isUpuseControlled
          ? "Timer is tracked, but the source is not changeable right now."
          : "Observed from source. The monitor will not reopen it automatically.",
      tone: "#166534",
      sourceLabel: isUpuseControlled ? "UPuse" : "External",
      showTimer: true,
    };
  }

  if (branch.status === "CLOSED") {
    return {
      title: "Closed from Source",
      caption: "No temporary timer is active for this branch.",
      tone: "#92400e",
      sourceLabel: "Source",
      showTimer: false,
    };
  }

  return {
    title: "Waiting for Availability",
    caption: "The latest availability snapshot is still syncing.",
    tone: "#475569",
    sourceLabel: null,
    showTimer: false,
  };
}
