import type { BranchSnapshot } from "../../../../api/types";
import { closureProgress, hasDeadlinePassed } from "../../../../shared/lib/progress/closureProgress";
import { formatSourceClosedReason, isExternalManualSourceClose } from "../../../../shared/lib/branch/sourceClosedReason";

export function statusMeta(branch: BranchSnapshot) {
  if (branch.status === "OPEN") {
    return {
      label: "Open",
      chipSx: { bgcolor: "#e7f7ed", color: "#166534", borderColor: "rgba(22, 101, 52, 0.12)" },
      titleColor: "#166534",
      note: "",
    };
  }
  if (branch.status === "TEMP_CLOSE") {
    const sourceReason = formatSourceClosedReason(branch.sourceClosedReason);
    return {
      label: "Temporary Close",
      chipSx: { bgcolor: "#fff1f2", color: "#be123c", borderColor: "rgba(190, 24, 93, 0.14)" },
      titleColor: "#b45309",
      note: isExternalManualSourceClose(branch)
        ? sourceReason
          ? `Closed from source with ${sourceReason} selected. No reopen timer; manual reopen required.`
          : "Closed from source with no reopen timer; manual reopen required."
        : "Temporary closure is active until the timer ends or the trigger returns to zero.",
    };
  }
  if (branch.status === "CLOSED") {
    return {
      label: "Closed",
      chipSx: { bgcolor: "#fff7d6", color: "#92400e", borderColor: "rgba(146, 64, 14, 0.12)" },
      titleColor: "#92400e",
      note: "",
    };
  }
  return {
    label: "Unknown",
    chipSx: { bgcolor: "#f1f5f9", color: "#475569", borderColor: "rgba(71, 85, 105, 0.12)" },
    titleColor: "#475569",
    note: "Waiting for the latest API update.",
  };
}

export function rankMeta(rank: number) {
  if (rank === 1) {
    return {
      panelBg: "rgba(255,247,237,0.92)",
      textColor: "#b45309",
      railColor: "#f59e0b",
    };
  }

  if (rank === 2) {
    return {
      panelBg: "rgba(248,250,252,0.96)",
      textColor: "#475569",
      railColor: "#94a3b8",
    };
  }

  if (rank === 3) {
    return {
      panelBg: "rgba(255,247,237,0.92)",
      textColor: "#c2410c",
      railColor: "#fb923c",
    };
  }

  return {
    panelBg: "rgba(248,250,252,0.9)",
    textColor: "#475569",
    railColor: "rgba(148,163,184,0.55)",
  };
}

export function resolveClosureUiState(branch: BranchSnapshot, nowMs: number) {
  const progressValue = closureProgress(branch.closeStartedAt, branch.closedUntil, nowMs);
  const canTrackProgress = Boolean(branch.status === "TEMP_CLOSE" && branch.closedUntil && branch.closeStartedAt);
  const timerReached = hasDeadlinePassed(branch.closedUntil, nowMs);

  return {
    isTempClosed: branch.status === "TEMP_CLOSE",
    progressValue,
    canTrackProgress,
    timerReached,
  };
}
