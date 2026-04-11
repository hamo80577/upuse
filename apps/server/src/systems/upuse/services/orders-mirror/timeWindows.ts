import { DateTime } from "luxon";
import { TZ, cairoDayWindowUtc, nowUtcIso } from "../../../../utils/time.js";

export function getCairoDayKey(date = DateTime.utc()) {
  return date.setZone(TZ).toFormat("yyyy-LL-dd");
}

export function getPreviousCairoDayKey(dayKey: string) {
  const day = DateTime.fromFormat(dayKey, "yyyy-LL-dd", { zone: TZ });
  return day.isValid ? day.minus({ days: 1 }).toFormat("yyyy-LL-dd") : dayKey;
}

export function getDayWindow(dayKey = getCairoDayKey()) {
  const cairoStart = DateTime.fromFormat(dayKey, "yyyy-LL-dd", { zone: TZ }).startOf("day");
  if (!cairoStart.isValid) {
    return cairoDayWindowUtc(DateTime.utc());
  }

  return {
    startUtcIso: cairoStart.toUTC().toISO({ suppressMilliseconds: false })!,
    endUtcIso: cairoStart.endOf("day").toUTC().toISO({ suppressMilliseconds: false })!,
  };
}

export function getSyncWindow(dayKey = getCairoDayKey(), endIso = nowUtcIso()) {
  const fullDay = getDayWindow(dayKey);
  const end = DateTime.fromISO(endIso, { zone: "utc" });
  const boundedEnd = end.isValid
    ? Math.min(end.toMillis(), DateTime.fromISO(fullDay.endUtcIso, { zone: "utc" }).toMillis())
    : DateTime.fromISO(fullDay.endUtcIso, { zone: "utc" }).toMillis();

  return {
    startUtcIso: fullDay.startUtcIso,
    endUtcIso: new Date(boundedEnd).toISOString(),
  };
}

export function toMillis(iso?: string | null) {
  if (!iso) return Number.NaN;
  const value = new Date(iso).getTime();
  return Number.isFinite(value) ? value : Number.NaN;
}
