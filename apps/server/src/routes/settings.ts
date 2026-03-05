import type { Request, Response } from "express";
import { getSettings, updateSettings } from "../services/settingsStore.js";
import { z } from "zod";
import { fetchAvailabilities } from "../services/availabilityClient.js";
import { resolveOrdersGlobalEntityId } from "../services/monitorOrdersPolling.js";
import { lookupVendorName } from "../services/ordersClient.js";
import { listBranches } from "../services/branchStore.js";

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
  const Patch = z
    .object({
      ordersToken: z.string().optional(),
      availabilityToken: z.string().optional(),
      globalEntityId: z.string().min(1).optional(),
      chains: z.array(
        z.object({
          name: z.string().min(1).max(120),
          lateThreshold: z.number().int().min(0).max(999),
          unassignedThreshold: z.number().int().min(0).max(999),
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

  const patch = Patch.parse(body);
  const updated = updateSettings(patch as any);
  res.json({ ok: true, settings: { ...updated, ordersToken: mask(updated.ordersToken), availabilityToken: mask(updated.availabilityToken) } });
}

export async function testTokensRoute(_req: Request, res: Response) {
  const s = getSettings();
  const out: any = { orders: { ok: false }, availability: { ok: false } };

  // Availability token test
  try {
    await fetchAvailabilities(s.availabilityToken);
    out.availability.ok = true;
  } catch (e: any) {
    out.availability.ok = false;
    out.availability.status = e?.response?.status ?? null;
  }

  // Orders token test: use first mapped branch if available
  const branches = listBranches().filter((b) => b.enabled);
  const first = branches[0];
  if (!first) {
    out.orders.ok = false;
    out.orders.note = "Add a branch mapping to test Orders token.";
  } else {
    try {
      const globalEntityId = resolveOrdersGlobalEntityId(first, s.globalEntityId);
      const name = await lookupVendorName({
        token: s.ordersToken,
        globalEntityId,
        ordersVendorId: first.ordersVendorId,
      });
      out.orders.ok = true;
      out.orders.sampleVendor = { id: first.ordersVendorId, name, globalEntityId };
    } catch (e: any) {
      out.orders.ok = false;
      out.orders.status = e?.response?.status ?? null;
    }
  }

  res.json(out);
}
