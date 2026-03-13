import type { BranchSnapshot } from "../../../api/types";

export function statusChip(branch: BranchSnapshot) {
  if (!branch.monitorEnabled) return { label: "Paused", sx: { bgcolor: "#eef2ff", color: "#4338ca" } };
  if (branch.status === "OPEN") return { label: "Open", sx: { bgcolor: "#e7f7ed", color: "#166534" } };
  if (branch.status === "TEMP_CLOSE") return { label: "Temporary Close", sx: { bgcolor: "#fff1f2", color: "#be123c" } };
  if (branch.status === "CLOSED") return { label: "Closed", sx: { bgcolor: "#fff7d6", color: "#92400e" } };
  return { label: "Unknown", sx: { bgcolor: "#f1f5f9", color: "#475569" } };
}

export function closeReasonMeta(reason?: BranchSnapshot["closeReason"]) {
  if (reason === "LATE") return { label: "Late Trigger", tone: "#9a3412", background: "rgba(255,237,213,0.94)", border: "rgba(251,146,60,0.22)" };
  if (reason === "UNASSIGNED") return { label: "Unassigned Trigger", tone: "#b91c1c", background: "rgba(254,226,226,0.94)", border: "rgba(248,113,113,0.22)" };
  return null;
}

export function statusPanelMeta(branch: BranchSnapshot) {
  if (!branch.monitorEnabled) {
    return {
      title: "Paused from Monitor",
      caption: "This branch is excluded from live monitor cycles until it is turned back on.",
      tone: "#4338ca",
      sourceLabel: null,
      showTimer: false,
    };
  }

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
      sourceLabel: isUpuseControlled ? "UPuse Control" : "External Source",
      showTimer: true,
    };
  }

  if (branch.status === "CLOSED") {
    return {
      title: "Closed from Source",
      caption: "No temporary timer is active for this branch.",
      tone: "#92400e",
      sourceLabel: "Source Closed",
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
