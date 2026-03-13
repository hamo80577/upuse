import { db, cryptoBox } from "../config/db.js";
import { GlobalEntityIdSchema } from "../config/globalEntityId.js";
import { z } from "zod";
const SettingsSchema = z.object({
    ordersToken: z.string(),
    availabilityToken: z.string(),
    globalEntityId: GlobalEntityIdSchema,
    chainNames: z.array(z.string().trim().min(1).max(120)).max(200),
    chains: z.array(z.object({
        name: z.string().trim().min(1).max(120),
        lateThreshold: z.number().int().min(0).max(999),
        unassignedThreshold: z.number().int().min(0).max(999),
    })).max(200),
    lateThreshold: z.number().int().min(0).max(999),
    unassignedThreshold: z.number().int().min(0).max(999),
    tempCloseMinutes: z.number().int().min(1).max(720),
    graceMinutes: z.number().int().min(0).max(60),
    ordersRefreshSeconds: z.number().int().min(10).max(600),
    availabilityRefreshSeconds: z.number().int().min(10).max(600),
    maxVendorsPerOrdersRequest: z.number().int().min(1).max(200),
});
function normalizeChainNames(values) {
    const seen = new Set();
    const out = [];
    for (const value of values) {
        const normalized = value.trim();
        if (!normalized)
            continue;
        const key = normalized.toLowerCase();
        if (seen.has(key))
            continue;
        seen.add(key);
        out.push(normalized);
    }
    return out;
}
function normalizeChainThresholds(values) {
    const seen = new Set();
    const out = [];
    for (const item of values) {
        const name = item.name.trim();
        if (!name)
            continue;
        const key = name.toLowerCase();
        if (seen.has(key))
            continue;
        seen.add(key);
        out.push({
            name,
            lateThreshold: Math.max(0, Math.round(item.lateThreshold)),
            unassignedThreshold: Math.max(0, Math.round(item.unassignedThreshold)),
        });
    }
    return out;
}
function parseChainNames(raw) {
    if (typeof raw !== "string" || !raw.length)
        return [];
    try {
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed))
            return [];
        return normalizeChainNames(parsed.filter((value) => typeof value === "string"));
    }
    catch {
        return [];
    }
}
function parseChainThresholds(raw, fallbackNames) {
    const fallbackChains = () => normalizeChainThresholds(fallbackNames.map((name) => ({
        name,
        lateThreshold: 5,
        unassignedThreshold: 5,
    })));
    if (typeof raw !== "string" || !raw.length) {
        return fallbackChains();
    }
    try {
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) {
            return fallbackChains();
        }
        if (!parsed.length)
            return fallbackChains();
        if (parsed.every((value) => typeof value === "string")) {
            return normalizeChainThresholds(parsed.map((name) => ({
                name,
                lateThreshold: 5,
                unassignedThreshold: 5,
            })));
        }
        const normalized = normalizeChainThresholds(parsed
            .filter((value) => typeof value === "object" &&
            value !== null &&
            typeof value.name === "string" &&
            (typeof value.threshold === "number" ||
                (typeof value.lateThreshold === "number" &&
                    typeof value.unassignedThreshold === "number")))
            .map((value) => {
            const legacyValue = value;
            const fallbackThreshold = typeof legacyValue.threshold === "number" ? legacyValue.threshold : 5;
            return {
                name: legacyValue.name,
                lateThreshold: typeof legacyValue.lateThreshold === "number"
                    ? legacyValue.lateThreshold
                    : fallbackThreshold,
                unassignedThreshold: typeof legacyValue.unassignedThreshold === "number"
                    ? legacyValue.unassignedThreshold
                    : fallbackThreshold,
            };
        }));
        return normalized.length ? normalized : fallbackChains();
    }
    catch {
        return fallbackChains();
    }
}
export function getSettings() {
    const row = db.prepare("SELECT * FROM settings WHERE id=1").get();
    if (!row) {
        throw new Error("Settings row not found");
    }
    const chainNames = parseChainNames(row.chainNamesJson);
    const chains = parseChainThresholds(row.chainThresholdsJson, chainNames);
    const settings = {
        ordersToken: cryptoBox.decrypt(row.ordersTokenEnc),
        availabilityToken: cryptoBox.decrypt(row.availabilityTokenEnc),
        globalEntityId: GlobalEntityIdSchema.parse(row.globalEntityId),
        chainNames: chains.map((item) => item.name),
        chains,
        lateThreshold: row.lateThreshold,
        unassignedThreshold: row.unassignedThreshold,
        tempCloseMinutes: row.tempCloseMinutes,
        graceMinutes: row.graceMinutes,
        ordersRefreshSeconds: row.ordersRefreshSeconds,
        availabilityRefreshSeconds: row.availabilityRefreshSeconds,
        maxVendorsPerOrdersRequest: row.maxVendorsPerOrdersRequest,
    };
    return settings;
}
export function getGlobalEntityId() {
    const row = db.prepare("SELECT globalEntityId FROM settings WHERE id=1").get();
    if (!row) {
        throw new Error("Settings row not found");
    }
    return GlobalEntityIdSchema.parse(row.globalEntityId);
}
export function updateSettings(patch) {
    const current = getSettings();
    const normalizedChains = normalizeChainThresholds(patch.chains ?? current.chains);
    const merged = {
        ...current,
        ...patch,
        chainNames: normalizedChains.map((item) => item.name),
        chains: normalizedChains,
    };
    SettingsSchema.parse(merged);
    db.prepare(`
    UPDATE settings SET
      ordersTokenEnc = ?,
      availabilityTokenEnc = ?,
      globalEntityId = ?,
      chainNamesJson = ?,
      chainThresholdsJson = ?,
      lateThreshold = ?,
      unassignedThreshold = ?,
      tempCloseMinutes = ?,
      graceMinutes = ?,
      ordersRefreshSeconds = ?,
      availabilityRefreshSeconds = ?,
      maxVendorsPerOrdersRequest = ?
    WHERE id = 1
  `).run(cryptoBox.encrypt(merged.ordersToken), cryptoBox.encrypt(merged.availabilityToken), merged.globalEntityId, JSON.stringify(merged.chainNames), JSON.stringify(merged.chains), merged.lateThreshold, merged.unassignedThreshold, merged.tempCloseMinutes, merged.graceMinutes, merged.ordersRefreshSeconds, merged.availabilityRefreshSeconds, merged.maxVendorsPerOrdersRequest);
    return merged;
}
