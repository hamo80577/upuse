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
export function resolveOrdersGlobalEntityId(branch, fallbackGlobalEntityId) {
    const branchEntityId = branch.globalEntityId?.trim();
    return branchEntityId && branchEntityId.length ? branchEntityId : fallbackGlobalEntityId;
}
export function createOrdersPollingRequests(params) {
    const selectedVendorIds = new Set(params.vendorIds);
    const requestsByEntityId = new Map();
    for (const branch of params.branches) {
        if (!selectedVendorIds.has(branch.ordersVendorId))
            continue;
        const globalEntityId = resolveOrdersGlobalEntityId(branch, params.fallbackGlobalEntityId);
        let request = requestsByEntityId.get(globalEntityId);
        if (!request) {
            request = { globalEntityId, vendorIds: [] };
            requestsByEntityId.set(globalEntityId, request);
        }
        request.vendorIds.push(branch.ordersVendorId);
    }
    return Array.from(requestsByEntityId.values());
}
