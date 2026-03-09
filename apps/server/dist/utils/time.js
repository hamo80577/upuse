import { DateTime } from "luxon";
export const TZ = "Africa/Cairo";
export function cairoDayWindowUtc(now = DateTime.utc()) {
    const cairoNow = now.setZone(TZ);
    const startCairo = cairoNow.startOf("day");
    const endCairo = cairoNow.endOf("day");
    return {
        startUtcIso: startCairo.toUTC().toISO({ suppressMilliseconds: false }),
        endUtcIso: endCairo.toUTC().toISO({ suppressMilliseconds: false }),
    };
}
export function nowUtcIso() {
    return DateTime.utc().toISO({ suppressMilliseconds: false });
}
export function isPastPickup(nowIsoUtc, pickupIsoUtc) {
    const now = DateTime.fromISO(nowIsoUtc, { zone: "utc" });
    const pickup = DateTime.fromISO(pickupIsoUtc, { zone: "utc" });
    return now > pickup;
}
