export function resolveBranchThresholdProfile(branch, settings) {
    const chains = Array.isArray(settings.chains) ? settings.chains : [];
    const hasBranchOverride = typeof branch.lateThresholdOverride === "number" &&
        typeof branch.unassignedThresholdOverride === "number";
    if (hasBranchOverride) {
        const lateThreshold = branch.lateThresholdOverride;
        const unassignedThreshold = branch.unassignedThresholdOverride;
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
