import type { BranchSnapshot } from "../../../api/types";
import { resolveAvailabilityKind } from "./availabilityMeta";

export function formatSourceClosedReason(reason?: string) {
  const normalized = reason?.trim();
  return normalized ? normalized : null;
}

export function isExternalManualSourceClose(branch: BranchSnapshot) {
  return resolveAvailabilityKind(branch) === "sourceShortClosure" && branch.closureSource === "EXTERNAL" && !branch.closedUntil;
}
