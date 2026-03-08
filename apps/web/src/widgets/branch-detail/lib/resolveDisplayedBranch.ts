import type { BranchDetailSnapshot, BranchSnapshot } from "../../../api/types";

export function resolveDisplayedBranch(
  detail: BranchDetailSnapshot | null,
  branchSnapshot?: BranchSnapshot | null,
) {
  if (detail?.branch) {
    return detail.branch;
  }

  return branchSnapshot ?? null;
}
