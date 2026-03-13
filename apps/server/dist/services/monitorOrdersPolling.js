import { FIXED_GLOBAL_ENTITY_ID } from "../config/constants.js";
export function createOrdersPollingPlan(params) {
    void params.availabilityByVendor;
    void params.closedSnapshotDayByBranch;
    void params.cairoDayKey;
    const vendorIds = new Set();
    const resetBranchIds = [];
    const captureBranchIds = [];
    for (const branch of params.branches) {
        if (!branch.enabled) {
            resetBranchIds.push(branch.id);
            continue;
        }
        vendorIds.add(branch.ordersVendorId);
    }
    return {
        vendorIds: Array.from(vendorIds),
        resetBranchIds,
        captureBranchIds,
    };
}
export function createOrdersPollingRequests(params) {
    const selectedVendorIds = new Set(params.vendorIds);
    const resolvedVendorIds = Array.from(new Set(params.branches
        .filter((branch) => selectedVendorIds.has(branch.ordersVendorId))
        .map((branch) => branch.ordersVendorId)));
    return resolvedVendorIds.length
        ? [{
                globalEntityId: FIXED_GLOBAL_ENTITY_ID,
                vendorIds: resolvedVendorIds,
            }]
        : [];
}
