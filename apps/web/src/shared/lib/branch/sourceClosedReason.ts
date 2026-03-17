import type { BranchSnapshot } from "../../../api/types";

function titleCase(value: string) {
  return value
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

export function formatSourceClosedReason(reason?: string) {
  const normalized = reason?.trim();
  if (!normalized) return null;
  if (normalized.toUpperCase() === "TECHNICAL_PROBLEM") {
    return "Issues";
  }
  return titleCase(normalized);
}

export function isExternalManualSourceClose(branch: BranchSnapshot) {
  return branch.status === "TEMP_CLOSE" && branch.closureSource === "EXTERNAL" && !branch.closedUntil;
}
