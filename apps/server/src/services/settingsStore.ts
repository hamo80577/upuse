import { db, cryptoBox } from "../config/db.js";
import { z } from "zod";
import type { ChainThreshold, Settings } from "../types/models.js";

interface SettingsRow {
  ordersTokenEnc: string;
  availabilityTokenEnc: string;
  globalEntityId: string;
  chainNamesJson: string;
  chainThresholdsJson: string;
  lateThreshold: number;
  unassignedThreshold: number;
  tempCloseMinutes: number;
  graceMinutes: number;
  ordersRefreshSeconds: number;
  availabilityRefreshSeconds: number;
  maxVendorsPerOrdersRequest: number;
}

const SettingsSchema = z.object({
  ordersToken: z.string(),
  availabilityToken: z.string(),
  globalEntityId: z.string().trim().min(2).max(64).regex(/^[A-Za-z0-9_-]+$/),
  chainNames: z.array(z.string().trim().min(1).max(120)).max(200),
  chains: z.array(
    z.object({
      name: z.string().trim().min(1).max(120),
      lateThreshold: z.number().int().min(0).max(999),
      unassignedThreshold: z.number().int().min(0).max(999),
    }),
  ).max(200),

  lateThreshold: z.number().int().min(0).max(999),
  unassignedThreshold: z.number().int().min(0).max(999),

  tempCloseMinutes: z.number().int().min(1).max(720),
  graceMinutes: z.number().int().min(0).max(60),

  ordersRefreshSeconds: z.number().int().min(10).max(600),
  availabilityRefreshSeconds: z.number().int().min(10).max(600),

  maxVendorsPerOrdersRequest: z.number().int().min(1).max(200),
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
      unassignedThreshold: Math.max(0, Math.round(item.unassignedThreshold)),
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
        unassignedThreshold: 5,
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
          unassignedThreshold: 5,
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
            | { name: string; lateThreshold: number; unassignedThreshold: number } =>
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
            unassignedThreshold?: number;
          };

          const fallbackThreshold = typeof legacyValue.threshold === "number" ? legacyValue.threshold : 5;

          return {
            name: legacyValue.name,
            lateThreshold:
              typeof legacyValue.lateThreshold === "number"
                ? legacyValue.lateThreshold
                : fallbackThreshold,
            unassignedThreshold:
              typeof legacyValue.unassignedThreshold === "number"
                ? legacyValue.unassignedThreshold
                : fallbackThreshold,
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
    globalEntityId: SettingsSchema.shape.globalEntityId.parse(row.globalEntityId),
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
  const row = db.prepare<[], Pick<SettingsRow, "globalEntityId">>("SELECT globalEntityId FROM settings WHERE id=1").get();
  if (!row) {
    throw new Error("Settings row not found");
  }

  return SettingsSchema.shape.globalEntityId.parse(row.globalEntityId);
}

export function updateSettings(patch: Partial<Settings>) {
  const current = getSettings();
  const normalizedChains = normalizeChainThresholds(patch.chains ?? current.chains);
  const merged: Settings = {
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
  `).run(
    cryptoBox.encrypt(merged.ordersToken),
    cryptoBox.encrypt(merged.availabilityToken),
    merged.globalEntityId,
    JSON.stringify(merged.chainNames),
    JSON.stringify(merged.chains),
    merged.lateThreshold,
    merged.unassignedThreshold,
    merged.tempCloseMinutes,
    merged.graceMinutes,
    merged.ordersRefreshSeconds,
    merged.availabilityRefreshSeconds,
    merged.maxVendorsPerOrdersRequest
  );

  return merged;
}
