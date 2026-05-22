import { DateTime } from "luxon";
import { z } from "zod";
import type { AvailabilityRecord, BranchMapping, HighDemandSchedule, Settings } from "../types/models.js";

export const HIGH_DEMAND_DURATION_MINUTES = 30;
export const HIGH_DEMAND_ADJUSTMENT_MINUTES = 10;
export const HIGH_DEMAND_TIME_ZONE = "Africa/Cairo";

export const DEFAULT_HIGH_DEMAND_SCHEDULE: HighDemandSchedule = {
  enabled: false,
  hours: [],
};

export const HighDemandScheduleSchema = z
  .object({
    enabled: z.boolean(),
    hours: z.array(z.number().int().min(0).max(23)).default([]),
  })
  .strict()
  .transform((value) => normalizeHighDemandSchedule(value));

export const NullableHighDemandScheduleOverrideSchema = z.union([HighDemandScheduleSchema, z.null()]);

export function normalizeHighDemandSchedule(value: unknown): HighDemandSchedule {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return DEFAULT_HIGH_DEMAND_SCHEDULE;
  }

  const raw = value as { enabled?: unknown; hours?: unknown };
  const enabled = raw.enabled === true;
  const hours = Array.isArray(raw.hours)
    ? Array.from(new Set(
      raw.hours
        .filter((hour): hour is number => Number.isInteger(hour) && hour >= 0 && hour <= 23),
    )).sort((left, right) => left - right)
    : [];

  return {
    enabled,
    hours: enabled ? hours : [],
  };
}

export function normalizeNullableHighDemandScheduleOverride(value: unknown): HighDemandSchedule | null {
  if (value == null) return null;
  return normalizeHighDemandSchedule(value);
}

export function resolveEffectiveHighDemandSchedule(
  branch: Pick<BranchMapping, "chainName" | "highDemandScheduleOverride">,
  settings: Pick<Settings, "chains">,
) {
  const override = normalizeNullableHighDemandScheduleOverride(branch.highDemandScheduleOverride);
  if (override) {
    return {
      source: "branch" as const,
      schedule: override,
      override,
    };
  }

  const chainName = branch.chainName.trim().toLowerCase();
  const chain = settings.chains.find((item) => item.name.trim().toLowerCase() === chainName);
  if (chain) {
    return {
      source: "chain" as const,
      schedule: normalizeHighDemandSchedule(chain.highDemandSchedule),
      override: null,
    };
  }

  return {
    source: "default" as const,
    schedule: DEFAULT_HIGH_DEMAND_SCHEDULE,
    override: null,
  };
}

export function isHighDemandHourActive(schedule: HighDemandSchedule, nowUtcIso: string) {
  if (!schedule.enabled || !schedule.hours.length) return false;
  const now = DateTime.fromISO(nowUtcIso, { zone: "utc" }).setZone(HIGH_DEMAND_TIME_ZONE);
  return now.isValid && schedule.hours.includes(now.hour);
}

export function getHighDemandUntil(nowUtcIso: string) {
  const now = DateTime.fromISO(nowUtcIso, { zone: "utc" });
  if (!now.isValid) return undefined;
  return now.plus({ minutes: HIGH_DEMAND_DURATION_MINUTES }).toISO({ suppressMilliseconds: false }) ?? undefined;
}

export function isUpuseHighDemandWindowActive(
  runtime: { lastUpuseHighDemandUntil?: string | null } | undefined,
  nowUtcIso: string,
) {
  if (!runtime?.lastUpuseHighDemandUntil) return false;
  const until = DateTime.fromISO(runtime.lastUpuseHighDemandUntil, { zone: "utc" });
  const now = DateTime.fromISO(nowUtcIso, { zone: "utc" });
  return until.isValid && now.isValid && now < until;
}

export function resolveHighDemandSource(
  availability: AvailabilityRecord | undefined,
  runtime: { lastUpuseHighDemandUntil?: string | null } | undefined,
  referenceUtcIso: string,
): "UPUSE" | "EXTERNAL" | undefined {
  if (availability?.vssGroup !== "highDemand") return undefined;
  return isUpuseHighDemandWindowActive(runtime, referenceUtcIso) ? "UPUSE" : "EXTERNAL";
}
