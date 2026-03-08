import type { Request, Response } from "express";
import { getSettings, updateSettings } from "../services/settingsStore.js";
import { z } from "zod";
import { fetchAvailabilities } from "../services/availabilityClient.js";
import { resolveOrdersGlobalEntityId } from "../services/monitorOrdersPolling.js";
import { lookupVendorName } from "../services/ordersClient.js";
import { listBranches } from "../services/branchStore.js";
import type { OrdersTokenBranchTestResult, SettingsTokenTestResponse } from "../types/models.js";

const SettingsPatch = z
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

const userTokenSettingsKeys = new Set(["ordersToken", "availabilityToken"]);

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

  if (req.authUser?.role === "user") {
    const invalidKeys = Object.keys(patch).filter((key) => !userTokenSettingsKeys.has(key));
    if (invalidKeys.length) {
      return res.status(403).json({
        ok: false,
        message: "User can update tokens only.",
      });
    }

    if (!("ordersToken" in patch) && !("availabilityToken" in patch)) {
      return res.status(400).json({
        ok: false,
        message: "Provide at least one token to update.",
      });
    }
  }

  const updated = updateSettings(patch as any);
  res.json({ ok: true, settings: { ...updated, ordersToken: mask(updated.ordersToken), availabilityToken: mask(updated.availabilityToken) } });
}

export async function testTokensRoute(_req: Request, res: Response) {
  const s = getSettings();
  const ordersToken = s.ordersToken.trim();
  const availabilityToken = s.availabilityToken.trim();
  const enabledBranches = listBranches().filter((branch) => branch.enabled);

  const out: SettingsTokenTestResponse = {
    availability: {
      configured: availabilityToken.length > 0,
      ok: false,
      status: null,
    },
    orders: {
      configValid: false,
      ok: false,
      enabledBranchCount: enabledBranches.length,
      passedBranchCount: 0,
      failedBranchCount: 0,
      branches: [],
    },
  };

  if (!out.availability.configured) {
    out.availability.message = "Availability token is not configured.";
  } else {
    try {
      await fetchAvailabilities(availabilityToken);
      out.availability.ok = true;
    } catch (e: any) {
      out.availability.status = e?.response?.status ?? null;
      out.availability.message = e?.response?.data?.message || e?.message || "Availability token test failed.";
    }
  }

  const branchChecks = await Promise.all(
    enabledBranches.map(async (branch): Promise<OrdersTokenBranchTestResult> => {
      const globalEntityId = resolveOrdersGlobalEntityId(branch, s.globalEntityId).trim();
      if (!ordersToken) {
        return {
          branchId: branch.id,
          name: branch.name,
          ordersVendorId: branch.ordersVendorId,
          globalEntityId,
          ok: false,
          status: null,
          message: "Orders token is not configured.",
        };
      }

      if (!globalEntityId) {
        return {
          branchId: branch.id,
          name: branch.name,
          ordersVendorId: branch.ordersVendorId,
          globalEntityId,
          ok: false,
          status: null,
          message: "Global Entity ID is missing for this branch.",
        };
      }

      try {
        const sampleVendorName = await lookupVendorName({
          token: ordersToken,
          globalEntityId,
          ordersVendorId: branch.ordersVendorId,
        });

        return {
          branchId: branch.id,
          name: branch.name,
          ordersVendorId: branch.ordersVendorId,
          globalEntityId,
          ok: true,
          status: null,
          sampleVendorName,
          message: sampleVendorName ? undefined : "Token worked, but no recent vendor name could be inferred.",
        };
      } catch (e: any) {
        return {
          branchId: branch.id,
          name: branch.name,
          ordersVendorId: branch.ordersVendorId,
          globalEntityId,
          ok: false,
          status: e?.response?.status ?? null,
          message: e?.response?.data?.message || e?.message || "Orders token test failed.",
        };
      }
    }),
  );

  const missingGlobalEntityCount = branchChecks.filter((branch) => !branch.globalEntityId).length;
  out.orders.branches = branchChecks;
  out.orders.passedBranchCount = branchChecks.filter((branch) => branch.ok).length;
  out.orders.failedBranchCount = branchChecks.length - out.orders.passedBranchCount;
  out.orders.configValid = ordersToken.length > 0 && enabledBranches.length > 0 && missingGlobalEntityCount === 0;

  if (!ordersToken) {
    out.orders.configMessage = "Orders token is not configured.";
  } else if (!enabledBranches.length) {
    out.orders.configMessage = "Enable at least one branch mapping to test Orders token.";
  } else if (missingGlobalEntityCount > 0) {
    out.orders.configMessage =
      missingGlobalEntityCount === 1
        ? "One enabled branch is missing a resolved Global Entity ID."
        : `${missingGlobalEntityCount} enabled branches are missing a resolved Global Entity ID.`;
  }

  out.orders.ok = out.orders.configValid && out.orders.failedBranchCount === 0;

  res.json(out);
}
