import { db, pruneLogs } from "../config/db.js";
import { DateTime } from "luxon";
import { nowUtcIso } from "../utils/time.js";
export function log(branchId, level, message) {
    const ts = nowUtcIso();
    db.prepare("INSERT INTO logs (branchId, ts, level, message) VALUES (?, ?, ?, ?)").run(branchId, ts, level, message);
    // Keep logs compact (avoid UI chaos)
    pruneLogs(branchId, 200);
    return { branchId, ts, level, message };
}
export function getLogs(branchId, limit = 80) {
    return db
        .prepare("SELECT ts, level, message FROM logs WHERE branchId = ? ORDER BY id DESC LIMIT ?")
        .all(branchId, limit)
        .reverse();
}
export function getLogsDayPage(branchId, beforeDay) {
    const beforeBoundaryIso = beforeDay ? cairoDayStartUtcIso(beforeDay) : null;
    const latestRow = beforeBoundaryIso
        ? db
            .prepare("SELECT ts FROM logs WHERE branchId = ? AND ts < ? ORDER BY id DESC LIMIT 1")
            .get(branchId, beforeBoundaryIso)
        : db
            .prepare("SELECT ts FROM logs WHERE branchId = ? ORDER BY id DESC LIMIT 1")
            .get(branchId);
    if (!latestRow?.ts) {
        return {
            dayKey: null,
            dayLabel: null,
            items: [],
            hasMore: false,
        };
    }
    const targetDay = DateTime.fromISO(latestRow.ts, { zone: "utc" }).setZone("Africa/Cairo").startOf("day");
    const dayKey = targetDay.toFormat("yyyy-LL-dd");
    const dayStartIso = targetDay.toUTC().toISO({ suppressMilliseconds: false });
    const dayEndIso = targetDay.plus({ days: 1 }).toUTC().toISO({ suppressMilliseconds: false });
    const items = db
        .prepare("SELECT ts, level, message FROM logs WHERE branchId = ? AND ts >= ? AND ts < ? ORDER BY id DESC")
        .all(branchId, dayStartIso, dayEndIso);
    const olderRow = db
        .prepare("SELECT 1 FROM logs WHERE branchId = ? AND ts < ? LIMIT 1")
        .get(branchId, dayStartIso);
    return {
        dayKey,
        dayLabel: targetDay.toFormat("ccc, dd LLL yyyy"),
        items,
        hasMore: Boolean(olderRow),
    };
}
export function clearLogs(branchId) {
    return db.prepare("DELETE FROM logs WHERE branchId = ?").run(branchId);
}
function cairoDayStartUtcIso(dayKey) {
    const day = DateTime.fromFormat(dayKey, "yyyy-LL-dd", { zone: "Africa/Cairo" });
    if (!day.isValid) {
        return DateTime.now().setZone("Africa/Cairo").startOf("day").toUTC().toISO({ suppressMilliseconds: false });
    }
    return day.startOf("day").toUTC().toISO({ suppressMilliseconds: false });
}
