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
    const vendorIdsByEntity = new Map();
    for (const branch of params.branches) {
        if (!selectedVendorIds.has(branch.ordersVendorId))
            continue;
        const vendorIds = vendorIdsByEntity.get(branch.globalEntityId) ?? [];
        if (!vendorIds.includes(branch.ordersVendorId)) {
            vendorIds.push(branch.ordersVendorId);
        }
        vendorIdsByEntity.set(branch.globalEntityId, vendorIds);
    }
    return Array.from(vendorIdsByEntity.entries()).map(([globalEntityId, vendorIds]) => ({
        globalEntityId,
        vendorIds,
    }));
}
