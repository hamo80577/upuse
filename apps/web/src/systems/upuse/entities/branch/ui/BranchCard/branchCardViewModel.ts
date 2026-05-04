import type { BranchSnapshot } from "../../../../api/types";
import { closureProgress, hasDeadlinePassed } from "../../../../shared/lib/progress/closureProgress";
import { availabilityNote, availabilityStatusChip, hasTimerBackedAvailability } from "../../../../shared/lib/branch/availabilityMeta";

export function statusMeta(branch: BranchSnapshot) {
  const chip = availabilityStatusChip(branch);
  const titleColor =
    branch.status === "OPEN"
      ? "#166534"
      : branch.status === "TEMP_CLOSE"
        ? "#b45309"
        : branch.status === "CLOSED"
          ? "#92400e"
          : "#475569";

  return {
    label: chip.label,
    chipSx: {
      ...chip.sx,
      borderColor:
        branch.status === "OPEN"
          ? "rgba(22, 101, 52, 0.12)"
          : branch.status === "TEMP_CLOSE"
            ? "rgba(190, 24, 93, 0.14)"
            : branch.status === "CLOSED"
              ? "rgba(146, 64, 14, 0.12)"
              : "rgba(71, 85, 105, 0.12)",
    },
    titleColor,
    note: availabilityNote(branch),
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
  const canTrackProgress = Boolean(hasTimerBackedAvailability(branch) && branch.closeStartedAt);
  const timerReached = hasDeadlinePassed(branch.closedUntil, nowMs);

  return {
    isTempClosed: branch.status === "TEMP_CLOSE",
    progressValue,
    canTrackProgress,
    timerReached,
  };
}
