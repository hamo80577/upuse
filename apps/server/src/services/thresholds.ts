import type { BranchMapping, Settings, ThresholdProfile } from "../types/models.js";

export function resolveBranchThresholdProfile(
  branch: Pick<BranchMapping, "chainName" | "lateThresholdOverride" | "unassignedThresholdOverride">,
  settings: Pick<Settings, "chains" | "lateThreshold" | "unassignedThreshold">,
): ThresholdProfile {
  const chains = Array.isArray(settings.chains) ? settings.chains : [];

  const hasBranchOverride =
    typeof branch.lateThresholdOverride === "number" &&
    typeof branch.unassignedThresholdOverride === "number";

  if (hasBranchOverride) {
    const lateThreshold = branch.lateThresholdOverride as number;
    const unassignedThreshold = branch.unassignedThresholdOverride as number;

    return {
      lateThreshold,
      unassignedThreshold,
      source: "branch",
    };
  }

  const chainKey = branch.chainName.trim().toLowerCase();
  if (chainKey) {
    const match = chains.find((item) => item.name.trim().toLowerCase() === chainKey);
    if (match) {
      return {
        lateThreshold: match.lateThreshold,
        unassignedThreshold: match.unassignedThreshold,
        source: "chain",
      };
    }
  }

  return {
    lateThreshold: settings.lateThreshold,
    unassignedThreshold: settings.unassignedThreshold,
    source: "global",
  };
}
