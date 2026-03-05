import { DateTime } from "luxon";
import { cairoDayWindowUtc } from "../../utils/time.js";
import { getWithRetry } from "./httpClient.js";
import { BASE } from "./types.js";
export async function lookupVendorName(params) {
    const { startUtcIso, endUtcIso } = cairoDayWindowUtc(DateTime.utc());
    const headers = { Authorization: `Bearer ${params.token}`, Accept: "application/json" };
    const qs = new URLSearchParams({
        global_entity_id: params.globalEntityId,
        page: "0",
        pageSize: "1",
        startDate: startUtcIso,
        endDate: endUtcIso,
    });
    qs.append("vendor_id[0]", String(params.ordersVendorId));
    const url = `${BASE}/orders?${qs.toString()}`;
    const res = await getWithRetry(url, headers, 1);
    const item = res.data?.items?.[0];
    const name = item?.vendor?.name;
    return typeof name === "string" && name.length ? name : null;
}
