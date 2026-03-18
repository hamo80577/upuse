import type { Request, Response } from "express";
import { getSettings, updateSettings } from "../services/settingsStore.js";
import { GlobalEntityIdSchema } from "../config/globalEntityId.js";
import { z } from "zod";
import { getSettingsTokenTestSnapshot, startSettingsTokenTestJob } from "../services/settingsTokenTestStore.js";
import { hasCapability } from "../http/authorization.js";

const SettingsPatch = z
  .object({
    ordersToken: z.string().optional(),
    availabilityToken: z.string().optional(),
    globalEntityId: GlobalEntityIdSchema.optional(),
    chains: z.array(
      z.object({
        name: z.string().min(1).max(120),
        lateThreshold: z.number().int().min(0).max(999),
        unassignedThreshold: z.number().int().min(0).max(999),
        capacityRuleEnabled: z.boolean().optional(),
      }),
    ).max(200).optional(),
    lateThreshold: z.number().int().min(0).optional(),
    unassignedThreshold: z.number().int().min(0).optional(),
    tempCloseMinutes: z.number().int().min(1).optional(),
    graceMinutes: z.number().int().min(0).optional(),
    ordersRefreshSeconds: z.number().int().min(10).optional(),
    availabilityRefreshSeconds: z.number().int().min(10).optional(),
    maxVendorsPerOrdersRequest: z.number().int().min(1).optional(),
  })
  .strict();

export function getSettingsRoute(_req: Request, res: Response) {
  const s = getSettings();
  res.json({ ...s, ordersToken: mask(s.ordersToken), availabilityToken: mask(s.availabilityToken) });
}

function mask(token: string) {
  if (!token) return "";
  if (token.length <= 8) return "********";
  return token.slice(0, 4) + "…" + token.slice(-4);
}

export function putSettingsRoute(req: Request, res: Response) {
  const body = req.body ?? {};
  const patch = SettingsPatch.parse(body);
  const requestedKeys = Object.keys(patch);
  const touchesTokens = requestedKeys.some((key) => key === "ordersToken" || key === "availabilityToken");
  const touchesThresholds = requestedKeys.some((key) => key === "chains" || key === "lateThreshold" || key === "unassignedThreshold");
  const touchesAdminSettings = requestedKeys.some((key) =>
    key === "globalEntityId"
    || key === "tempCloseMinutes"
    || key === "graceMinutes"
    || key === "ordersRefreshSeconds"
    || key === "availabilityRefreshSeconds"
    || key === "maxVendorsPerOrdersRequest",
  );
  const role = req.authUser?.role;

  if (touchesTokens && !hasCapability(role, "manage_settings_tokens")) {
    return res.status(403).json({
      ok: false,
      message: "Forbidden",
    });
  }

  if (touchesThresholds && !hasCapability(role, "manage_thresholds")) {
    return res.status(403).json({
      ok: false,
      message: "Forbidden",
    });
  }

  if (touchesAdminSettings && !hasCapability(role, "manage_settings")) {
    return res.status(403).json({
      ok: false,
      message: "Forbidden",
    });
  }

  const updated = updateSettings(patch as any);
  res.json({ ok: true, settings: { ...updated, ordersToken: mask(updated.ordersToken), availabilityToken: mask(updated.availabilityToken) } });
}

export async function testTokensRoute(_req: Request, res: Response) {
  const job = startSettingsTokenTestJob();
  res.status(202).json({
    ok: true,
    jobId: job.jobId,
    snapshot: job.snapshot,
  });
}

export function getTokenTestRoute(req: Request, res: Response) {
  const jobId = String(req.params.jobId ?? "").trim();
  if (!jobId) {
    return res.status(400).json({
      ok: false,
      message: "Missing token test job id",
    });
  }

  const snapshot = getSettingsTokenTestSnapshot(jobId);
  if (!snapshot) {
    return res.status(404).json({
      ok: false,
      message: "Token test job not found",
    });
  }

  return res.json(snapshot);
}
