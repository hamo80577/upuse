import { DateTime } from "luxon";

export const TZ = "Africa/Cairo";

export function cairoDayWindowUtc(now = DateTime.utc()) {
  const cairoNow = now.setZone(TZ);
  const startCairo = cairoNow.startOf("day");
  const endCairo = cairoNow.endOf("day");
  return {
    startUtcIso: startCairo.toUTC().toISO({ suppressMilliseconds: false })!,
    endUtcIso: endCairo.toUTC().toISO({ suppressMilliseconds: false })!,
  };
}

export function cairoHourWindowUtc(now = DateTime.utc()) {
  const cairoNow = now.setZone(TZ);
  const startCairo = cairoNow.startOf("hour");
  const endCairoExclusive = startCairo.plus({ hours: 1 });
  return {
    startUtcIso: startCairo.toUTC().toISO({ suppressMilliseconds: false })!,
    endUtcExclusiveIso: endCairoExclusive.toUTC().toISO({ suppressMilliseconds: false })!,
  };
}

export function nowUtcIso() {
  return DateTime.utc().toISO({ suppressMilliseconds: false })!;
}

export function isPastPickup(nowIsoUtc: string, pickupIsoUtc: string) {
  const now = DateTime.fromISO(nowIsoUtc, { zone: "utc" });
  const pickup = DateTime.fromISO(pickupIsoUtc, { zone: "utc" });
  return now > pickup;
}
