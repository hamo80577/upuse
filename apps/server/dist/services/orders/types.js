export const BASE = "https://shopper-management-api-live-me.deliveryhero.io";
export const ORDERS_API_SAFE_VENDOR_BATCH_LIMIT = 20;
export const ORDERS_AGG_MAX_PAGES = 200;
export const BRANCH_DETAIL_MAX_PAGES = 200;
export function initMetrics() {
    return {
        totalToday: 0,
        cancelledToday: 0,
        doneToday: 0,
        activeNow: 0,
        lateNow: 0,
        unassignedNow: 0,
    };
}
export function chunk(arr, size) {
    const out = [];
    for (let i = 0; i < arr.length; i += size)
        out.push(arr.slice(i, i + size));
    return out;
}
