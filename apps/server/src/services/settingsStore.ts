import { db, cryptoBox } from "../config/db.js";
import { GlobalEntityIdSchema } from "../config/globalEntityId.js";
import { z } from "zod";
import type { ChainThreshold, Settings } from "../types/models.js";

interface SettingsRow {
  ordersTokenEnc: string;
  availabilityTokenEnc: string;
  globalEntityId: string;
  chainNamesJson: string;
  chainThresholdsJson: string;
  lateThreshold: number;
  lateReopenThreshold?: number;
  unassignedThreshold: number;
  unassignedReopenThreshold?: number;
  readyThreshold?: number;
  readyReopenThreshold?: number;
  tempCloseMinutes: number;
  graceMinutes: number;
  ordersRefreshSeconds: number;
  availabilityRefreshSeconds: number;
  maxVendorsPerOrdersRequest: number;
}

function clampReopenThreshold(closeThreshold: number, reopenThreshold: number | undefined) {
  const normalizedClose = Math.max(0, Math.round(closeThreshold));
  const normalizedReopen =
    typeof reopenThreshold === "number"
      ? Math.max(0, Math.round(reopenThreshold))
      : 0;
  return Math.min(normalizedClose, normalizedReopen);
}

const SettingsSchema = z.object({
  ordersToken: z.string(),
  availabilityToken: z.string(),
  globalEntityId: GlobalEntityIdSchema,
  chainNames: z.array(z.string().trim().min(1).max(120)).max(200),
  chains: z.array(
    z.object({
      name: z.string().trim().min(1).max(120),
      lateThreshold: z.number().int().min(0).max(999),
      lateReopenThreshold: z.number().int().min(0).max(999).optional().default(0),
      unassignedThreshold: z.number().int().min(0).max(999),
      unassignedReopenThreshold: z.number().int().min(0).max(999).optional().default(0),
      readyThreshold: z.number().int().min(0).max(999).optional().default(0),
      readyReopenThreshold: z.number().int().min(0).max(999).optional().default(0),
      capacityRuleEnabled: z.boolean().optional().default(true),
      capacityPerHourEnabled: z.boolean().optional().default(false),
      capacityPerHourLimit: z.number().int().min(1).max(999).nullable().optional().default(null),
    }).superRefine((value, ctx) => {
      if (!value.capacityPerHourEnabled || typeof value.capacityPerHourLimit === "number") return;
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Capacity / hour limit is required when the hourly rule is enabled.",
        path: ["capacityPerHourLimit"],
      });
      if (value.lateReopenThreshold > value.lateThreshold) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Late reopen threshold cannot be greater than the close threshold.",
          path: ["lateReopenThreshold"],
        });
      }
      if (value.unassignedReopenThreshold > value.unassignedThreshold) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Unassigned reopen threshold cannot be greater than the close threshold.",
          path: ["unassignedReopenThreshold"],
        });
      }
      if ((value.readyReopenThreshold ?? 0) > (value.readyThreshold ?? 0)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Ready to pickup reopen threshold cannot be greater than the close threshold.",
          path: ["readyReopenThreshold"],
        });
      }
    }),
  ).max(200),

  lateThreshold: z.number().int().min(0).max(999),
  lateReopenThreshold: z.number().int().min(0).max(999).optional().default(0),
  unassignedThreshold: z.number().int().min(0).max(999),
  unassignedReopenThreshold: z.number().int().min(0).max(999).optional().default(0),
  readyThreshold: z.number().int().min(0).max(999).optional().default(0),
  readyReopenThreshold: z.number().int().min(0).max(999).optional().default(0),

  tempCloseMinutes: z.number().int().min(1).max(720),
  graceMinutes: z.number().int().min(0).max(60),

  ordersRefreshSeconds: z.number().int().min(10).max(600),
  availabilityRefreshSeconds: z.number().int().min(10).max(600),

  maxVendorsPerOrdersRequest: z.number().int().min(1).max(200),
}).superRefine((value, ctx) => {
  if ((value.lateReopenThreshold ?? 0) > value.lateThreshold) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Late reopen threshold cannot be greater than the close threshold.",
      path: ["lateReopenThreshold"],
    });
  }
  if ((value.unassignedReopenThreshold ?? 0) > value.unassignedThreshold) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Unassigned reopen threshold cannot be greater than the close threshold.",
      path: ["unassignedReopenThreshold"],
    });
  }
  if ((value.readyReopenThreshold ?? 0) > (value.readyThreshold ?? 0)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Ready to pickup reopen threshold cannot be greater than the close threshold.",
      path: ["readyReopenThreshold"],
    });
  }
});

function normalizeChainNames(values: string[]) {
  const seen = new Set<string>();
  const out: string[] = [];

  for (const value of values) {
    const normalized = value.trim();
    if (!normalized) continue;
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(normalized);
  }

  return out;
}

function normalizeChainThresholds(values: ChainThreshold[]) {
  const seen = new Set<string>();
  const out: ChainThreshold[] = [];

  for (const item of values) {
    const name = item.name.trim();
    if (!name) continue;

    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    out.push({
      name,
      lateThreshold: Math.max(0, Math.round(item.lateThreshold)),
      lateReopenThreshold: clampReopenThreshold(item.lateThreshold, item.lateReopenThreshold),
      unassignedThreshold: Math.max(0, Math.round(item.unassignedThreshold)),
      unassignedReopenThreshold: clampReopenThreshold(item.unassignedThreshold, item.unassignedReopenThreshold),
      readyThreshold:
        typeof item.readyThreshold === "number"
          ? Math.max(0, Math.round(item.readyThreshold))
          : 0,
      readyReopenThreshold: clampReopenThreshold(item.readyThreshold ?? 0, item.readyReopenThreshold),
      capacityRuleEnabled: item.capacityRuleEnabled !== false,
      capacityPerHourEnabled: item.capacityPerHourEnabled === true,
      capacityPerHourLimit:
        typeof item.capacityPerHourLimit === "number"
          ? Math.max(1, Math.round(item.capacityPerHourLimit))
          : null,
    });
  }

  return out;
}

function parseChainNames(raw: unknown) {
  if (typeof raw !== "string" || !raw.length) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return normalizeChainNames(parsed.filter((value): value is string => typeof value === "string"));
  } catch {
    return [];
  }
}

function parseChainThresholds(raw: unknown, fallbackNames: string[]) {
  const fallbackChains = () =>
    normalizeChainThresholds(
      fallbackNames.map((name) => ({
        name,
        lateThreshold: 5,
        lateReopenThreshold: 0,
        unassignedThreshold: 5,
        unassignedReopenThreshold: 0,
        readyThreshold: 0,
        readyReopenThreshold: 0,
        capacityRuleEnabled: true,
        capacityPerHourEnabled: false,
        capacityPerHourLimit: null,
      })),
    );

  if (typeof raw !== "string" || !raw.length) {
    return fallbackChains();
  }

  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return fallbackChains();
    }

    if (!parsed.length) return fallbackChains();

    if (parsed.every((value) => typeof value === "string")) {
      return normalizeChainThresholds(
        parsed.map((name) => ({
          name,
          lateThreshold: 5,
          lateReopenThreshold: 0,
          unassignedThreshold: 5,
          unassignedReopenThreshold: 0,
          readyThreshold: 0,
          readyReopenThreshold: 0,
          capacityRuleEnabled: true,
          capacityPerHourEnabled: false,
          capacityPerHourLimit: null,
        })),
      );
    }

    const normalized = normalizeChainThresholds(
      parsed
        .filter(
          (
            value,
          ): value is
            | { name: string; threshold: number }
            | {
                name: string;
                lateThreshold: number;
                lateReopenThreshold?: number;
                unassignedThreshold: number;
                unassignedReopenThreshold?: number;
                readyThreshold?: number;
                readyReopenThreshold?: number;
                capacityRuleEnabled?: boolean;
                capacityPerHourEnabled?: boolean;
                capacityPerHourLimit?: number | null;
              } =>
            typeof value === "object" &&
            value !== null &&
            typeof (value as { name?: unknown }).name === "string" &&
            (
              typeof (value as { threshold?: unknown }).threshold === "number" ||
              (
                typeof (value as { lateThreshold?: unknown }).lateThreshold === "number" &&
                typeof (value as { unassignedThreshold?: unknown }).unassignedThreshold === "number"
              )
            ),
        )
        .map((value) => {
          const legacyValue = value as {
            name: string;
            threshold?: number;
            lateThreshold?: number;
            lateReopenThreshold?: number;
            unassignedThreshold?: number;
            unassignedReopenThreshold?: number;
            readyThreshold?: number;
            readyReopenThreshold?: number;
            capacityRuleEnabled?: boolean;
            capacityPerHourEnabled?: boolean;
            capacityPerHourLimit?: number | null;
          };

          const fallbackThreshold = typeof legacyValue.threshold === "number" ? legacyValue.threshold : 5;

          return {
            name: legacyValue.name,
            lateThreshold:
              typeof legacyValue.lateThreshold === "number"
                ? legacyValue.lateThreshold
                : fallbackThreshold,
            lateReopenThreshold:
              typeof legacyValue.lateReopenThreshold === "number"
                ? legacyValue.lateReopenThreshold
                : 0,
            unassignedThreshold:
              typeof legacyValue.unassignedThreshold === "number"
                ? legacyValue.unassignedThreshold
                : fallbackThreshold,
            unassignedReopenThreshold:
              typeof legacyValue.unassignedReopenThreshold === "number"
                ? legacyValue.unassignedReopenThreshold
                : 0,
            readyThreshold:
              typeof legacyValue.readyThreshold === "number"
                ? legacyValue.readyThreshold
                : 0,
            readyReopenThreshold:
              typeof legacyValue.readyReopenThreshold === "number"
                ? legacyValue.readyReopenThreshold
                : 0,
            capacityRuleEnabled: legacyValue.capacityRuleEnabled !== false,
            capacityPerHourEnabled: legacyValue.capacityPerHourEnabled === true,
            capacityPerHourLimit:
              typeof legacyValue.capacityPerHourLimit === "number"
                ? legacyValue.capacityPerHourLimit
                : null,
          };
        }),
    );
    return normalized.length ? normalized : fallbackChains();
  } catch {
    return fallbackChains();
  }
}

export function getSettings(): Settings {
  const row = db.prepare<[], SettingsRow>("SELECT * FROM settings WHERE id=1").get();
  if (!row) {
    throw new Error("Settings row not found");
  }
  const chainNames = parseChainNames(row.chainNamesJson);
  const chains = parseChainThresholds(row.chainThresholdsJson, chainNames);
  const settings: Settings = {
    ordersToken: cryptoBox.decrypt(row.ordersTokenEnc),
    availabilityToken: cryptoBox.decrypt(row.availabilityTokenEnc),
    globalEntityId: GlobalEntityIdSchema.parse(row.globalEntityId),
    chainNames: chains.map((item) => item.name),
    chains,
    lateThreshold: row.lateThreshold,
    lateReopenThreshold: clampReopenThreshold(row.lateThreshold, row.lateReopenThreshold),
    unassignedThreshold: row.unassignedThreshold,
    unassignedReopenThreshold: clampReopenThreshold(row.unassignedThreshold, row.unassignedReopenThreshold),
    readyThreshold: typeof row.readyThreshold === "number" ? row.readyThreshold : 0,
    readyReopenThreshold: clampReopenThreshold(row.readyThreshold ?? 0, row.readyReopenThreshold),
    tempCloseMinutes: row.tempCloseMinutes,
    graceMinutes: row.graceMinutes,
    ordersRefreshSeconds: row.ordersRefreshSeconds,
    availabilityRefreshSeconds: row.availabilityRefreshSeconds,
    maxVendorsPerOrdersRequest: row.maxVendorsPerOrdersRequest,
  };
  return settings;
}

export function getGlobalEntityId() {
  const row = db.prepare<[], Pick<SettingsRow, "globalEntityId">>("SELECT globalEntityId FROM settings WHERE id=1").get();
  if (!row) {
    throw new Error("Settings row not found");
  }

  return GlobalEntityIdSchema.parse(row.globalEntityId);
}

export function updateSettings(patch: Partial<Settings>) {
  const current = getSettings();
  const normalizedChains = normalizeChainThresholds(patch.chains ?? current.chains);
  const merged: Settings = {
    ...current,
    ...patch,
    chainNames: normalizedChains.map((item) => item.name),
    chains: normalizedChains,
    lateReopenThreshold: clampReopenThreshold(
      patch.lateThreshold ?? current.lateThreshold,
      patch.lateReopenThreshold ?? current.lateReopenThreshold,
    ),
    unassignedReopenThreshold: clampReopenThreshold(
      patch.unassignedThreshold ?? current.unassignedThreshold,
      patch.unassignedReopenThreshold ?? current.unassignedReopenThreshold,
    ),
    readyReopenThreshold: clampReopenThreshold(
      patch.readyThreshold ?? current.readyThreshold ?? 0,
      patch.readyReopenThreshold ?? current.readyReopenThreshold,
    ),
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
      lateReopenThreshold = ?,
      unassignedThreshold = ?,
      unassignedReopenThreshold = ?,
      readyThreshold = ?,
      readyReopenThreshold = ?,
      tempCloseMinutes = ?,
      graceMinutes = ?,
      ordersRefreshSeconds = ?,
      availabilityRefreshSeconds = ?,
      maxVendorsPerOrdersRequest = ?
    WHERE id = 1
  `).run(
    cryptoBox.encrypt(merged.ordersToken),
    cryptoBox.encrypt(merged.availabilityToken),
    merged.globalEntityId,
    JSON.stringify(merged.chainNames),
    JSON.stringify(merged.chains),
    merged.lateThreshold,
    merged.lateReopenThreshold ?? 0,
    merged.unassignedThreshold,
    merged.unassignedReopenThreshold ?? 0,
    merged.readyThreshold ?? 0,
    merged.readyReopenThreshold ?? 0,
    merged.tempCloseMinutes,
    merged.graceMinutes,
    merged.ordersRefreshSeconds,
    merged.availabilityRefreshSeconds,
    merged.maxVendorsPerOrdersRequest
  );

  return merged;
}
