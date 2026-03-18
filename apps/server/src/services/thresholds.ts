import type { BranchMapping, Settings, ThresholdProfile } from "../types/models.js";

export function resolveBranchThresholdProfile(
  branch: Pick<BranchMapping, "chainName" | "lateThresholdOverride" | "unassignedThresholdOverride" | "capacityRuleEnabledOverride">,
  settings: Pick<Settings, "chains" | "lateThreshold" | "unassignedThreshold">,
): ThresholdProfile {
  const chains = Array.isArray(settings.chains) ? settings.chains : [];

  const chainKey = branch.chainName.trim().toLowerCase();
  const chainMatch = chainKey
    ? chains.find((item) => item.name.trim().toLowerCase() === chainKey)
    : undefined;
  const inherited = chainMatch
    ? {
        lateThreshold: chainMatch.lateThreshold,
        unassignedThreshold: chainMatch.unassignedThreshold,
        capacityRuleEnabled: chainMatch.capacityRuleEnabled !== false,
        source: "chain" as const,
      }
    : {
        lateThreshold: settings.lateThreshold,
        unassignedThreshold: settings.unassignedThreshold,
        capacityRuleEnabled: true,
        source: "global" as const,
      };

  const hasBranchThresholdOverride =
    typeof branch.lateThresholdOverride === "number" &&
    typeof branch.unassignedThresholdOverride === "number";
  const hasBranchCapacityOverride = typeof branch.capacityRuleEnabledOverride === "boolean";

  if (hasBranchThresholdOverride || hasBranchCapacityOverride) {
    return {
      lateThreshold: hasBranchThresholdOverride ? (branch.lateThresholdOverride as number) : inherited.lateThreshold,
      unassignedThreshold: hasBranchThresholdOverride ? (branch.unassignedThresholdOverride as number) : inherited.unassignedThreshold,
      capacityRuleEnabled: hasBranchCapacityOverride ? branch.capacityRuleEnabledOverride as boolean : inherited.capacityRuleEnabled,
      source: "branch",
    };
  }

  if (chainMatch) {
    return inherited;
  }

  return {
    ...inherited,
  };
}
