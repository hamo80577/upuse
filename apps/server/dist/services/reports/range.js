import { DateTime } from "luxon";
export function resolveReportRange(params) {
    const zone = "Africa/Cairo";
    const now = DateTime.now().setZone(zone);
    if (params.preset === "today") {
        const start = now.startOf("day");
        return {
            fromIso: start.toUTC().toISO({ suppressMilliseconds: false }),
            toIso: start.plus({ days: 1 }).toUTC().toISO({ suppressMilliseconds: false }),
            fileSuffix: start.toFormat("yyyy-LL-dd"),
        };
    }
    if (params.preset === "yesterday") {
        const start = now.minus({ days: 1 }).startOf("day");
        return {
            fromIso: start.toUTC().toISO({ suppressMilliseconds: false }),
            toIso: start.plus({ days: 1 }).toUTC().toISO({ suppressMilliseconds: false }),
            fileSuffix: start.toFormat("yyyy-LL-dd"),
        };
    }
    if (params.preset === "last7") {
        const start = now.minus({ days: 6 }).startOf("day");
        return {
            fromIso: start.toUTC().toISO({ suppressMilliseconds: false }),
            toIso: now.endOf("day").plus({ milliseconds: 1 }).toUTC().toISO({ suppressMilliseconds: false }),
            fileSuffix: `${start.toFormat("yyyy-LL-dd")}_to_${now.toFormat("yyyy-LL-dd")}`,
        };
    }
    if (params.preset === "last30") {
        const start = now.minus({ days: 29 }).startOf("day");
        return {
            fromIso: start.toUTC().toISO({ suppressMilliseconds: false }),
            toIso: now.endOf("day").plus({ milliseconds: 1 }).toUTC().toISO({ suppressMilliseconds: false }),
            fileSuffix: `${start.toFormat("yyyy-LL-dd")}_to_${now.toFormat("yyyy-LL-dd")}`,
        };
    }
    const parsedDay = params.day
        ? DateTime.fromFormat(params.day, "yyyy-LL-dd", { zone })
        : DateTime.invalid("missing day");
    const start = parsedDay.isValid ? parsedDay.startOf("day") : now.startOf("day");
    return {
        fromIso: start.toUTC().toISO({ suppressMilliseconds: false }),
        toIso: start.plus({ days: 1 }).toUTC().toISO({ suppressMilliseconds: false }),
        fileSuffix: start.toFormat("yyyy-LL-dd"),
    };
}
export function toCairoLabel(iso) {
    if (!iso)
        return "";
    const dt = DateTime.fromISO(iso, { zone: "utc" }).setZone("Africa/Cairo");
    return dt.isValid ? dt.toFormat("yyyy-LL-dd HH:mm:ss") : "";
}
