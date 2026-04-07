import type { BranchMapping, Settings, ThresholdProfile } from "../types/models.js";

function clampReopenThreshold(closeThreshold: number, reopenThreshold: number | undefined) {
  const normalizedClose = Math.max(0, Math.round(closeThreshold));
  const normalizedReopen =
    typeof reopenThreshold === "number"
      ? Math.max(0, Math.round(reopenThreshold))
      : 0;
  return Math.min(normalizedClose, normalizedReopen);
}

export function resolveBranchThresholdProfile(
  branch: Pick<
    BranchMapping,
    | "chainName"
    | "lateThresholdOverride"
    | "lateReopenThresholdOverride"
    | "unassignedThresholdOverride"
    | "unassignedReopenThresholdOverride"
    | "readyThresholdOverride"
    | "readyReopenThresholdOverride"
    | "capacityRuleEnabledOverride"
    | "capacityPerHourEnabledOverride"
    | "capacityPerHourLimitOverride"
  >,
  settings: Pick<
    Settings,
    | "chains"
    | "lateThreshold"
    | "lateReopenThreshold"
    | "unassignedThreshold"
    | "unassignedReopenThreshold"
    | "readyThreshold"
    | "readyReopenThreshold"
  >,
): ThresholdProfile {
  const chains = Array.isArray(settings.chains) ? settings.chains : [];

  const chainKey = branch.chainName.trim().toLowerCase();
  const chainMatch = chainKey
    ? chains.find((item) => item.name.trim().toLowerCase() === chainKey)
    : undefined;
  const inherited = chainMatch
    ? {
        lateThreshold: chainMatch.lateThreshold,
        lateReopenThreshold: clampReopenThreshold(chainMatch.lateThreshold, chainMatch.lateReopenThreshold),
        unassignedThreshold: chainMatch.unassignedThreshold,
        unassignedReopenThreshold: clampReopenThreshold(chainMatch.unassignedThreshold, chainMatch.unassignedReopenThreshold),
        readyThreshold: chainMatch.readyThreshold ?? 0,
        readyReopenThreshold: clampReopenThreshold(chainMatch.readyThreshold ?? 0, chainMatch.readyReopenThreshold),
        capacityRuleEnabled: chainMatch.capacityRuleEnabled !== false,
        capacityPerHourEnabled: chainMatch.capacityPerHourEnabled === true,
        capacityPerHourLimit: chainMatch.capacityPerHourLimit ?? null,
        source: "chain" as const,
      }
      : {
        lateThreshold: settings.lateThreshold,
        lateReopenThreshold: clampReopenThreshold(settings.lateThreshold, settings.lateReopenThreshold),
        unassignedThreshold: settings.unassignedThreshold,
        unassignedReopenThreshold: clampReopenThreshold(settings.unassignedThreshold, settings.unassignedReopenThreshold),
        readyThreshold: settings.readyThreshold ?? 0,
        readyReopenThreshold: clampReopenThreshold(settings.readyThreshold ?? 0, settings.readyReopenThreshold),
        capacityRuleEnabled: true,
        capacityPerHourEnabled: false,
        capacityPerHourLimit: null,
        source: "global" as const,
      };

  const hasBranchThresholdOverride =
    typeof branch.lateThresholdOverride === "number" &&
    typeof branch.unassignedThresholdOverride === "number";
  const hasBranchLateReopenThresholdOverride = typeof branch.lateReopenThresholdOverride === "number";
  const hasBranchUnassignedReopenThresholdOverride = typeof branch.unassignedReopenThresholdOverride === "number";
  const hasBranchReadyThresholdOverride = typeof branch.readyThresholdOverride === "number";
  const hasBranchReadyReopenThresholdOverride = typeof branch.readyReopenThresholdOverride === "number";
  const hasBranchCapacityOverride = typeof branch.capacityRuleEnabledOverride === "boolean";
  const hasBranchCapacityPerHourOverride =
    typeof branch.capacityPerHourEnabledOverride === "boolean" &&
    typeof branch.capacityPerHourLimitOverride === "number";

  if (
    hasBranchThresholdOverride
    || hasBranchLateReopenThresholdOverride
    || hasBranchUnassignedReopenThresholdOverride
    || hasBranchReadyThresholdOverride
    || hasBranchReadyReopenThresholdOverride
    || hasBranchCapacityOverride
    || hasBranchCapacityPerHourOverride
  ) {
    return {
      lateThreshold: hasBranchThresholdOverride ? (branch.lateThresholdOverride as number) : inherited.lateThreshold,
      lateReopenThreshold: clampReopenThreshold(
        hasBranchThresholdOverride ? (branch.lateThresholdOverride as number) : inherited.lateThreshold,
        hasBranchLateReopenThresholdOverride ? branch.lateReopenThresholdOverride as number : inherited.lateReopenThreshold,
      ),
      unassignedThreshold: hasBranchThresholdOverride ? (branch.unassignedThresholdOverride as number) : inherited.unassignedThreshold,
      unassignedReopenThreshold: clampReopenThreshold(
        hasBranchThresholdOverride ? (branch.unassignedThresholdOverride as number) : inherited.unassignedThreshold,
        hasBranchUnassignedReopenThresholdOverride ? branch.unassignedReopenThresholdOverride as number : inherited.unassignedReopenThreshold,
      ),
      readyThreshold: hasBranchReadyThresholdOverride ? branch.readyThresholdOverride as number : inherited.readyThreshold,
      readyReopenThreshold: clampReopenThreshold(
        hasBranchReadyThresholdOverride ? branch.readyThresholdOverride as number : inherited.readyThreshold ?? 0,
        hasBranchReadyReopenThresholdOverride ? branch.readyReopenThresholdOverride as number : inherited.readyReopenThreshold,
      ),
      capacityRuleEnabled: hasBranchCapacityOverride ? branch.capacityRuleEnabledOverride as boolean : inherited.capacityRuleEnabled,
      capacityPerHourEnabled:
        hasBranchCapacityPerHourOverride
          ? branch.capacityPerHourEnabledOverride as boolean
          : inherited.capacityPerHourEnabled,
      capacityPerHourLimit:
        hasBranchCapacityPerHourOverride
          ? branch.capacityPerHourLimitOverride as number
          : inherited.capacityPerHourLimit,
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
