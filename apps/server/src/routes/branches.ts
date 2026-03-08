import type { Request, Response } from "express";
import { z } from "zod";
import type { MonitorEngine } from "../services/monitorEngine.js";
import { addBranch, deleteBranch, getBranchById, listBranches, updateBranch } from "../services/branchStore.js";
import { resolveOrdersGlobalEntityId } from "../services/monitorOrdersPolling.js";
import { getSettings } from "../services/settingsStore.js";
import { fetchVendorOrdersDetail, lookupVendorName } from "../services/ordersClient.js";
import { resolveBranchThresholdProfile } from "../services/thresholds.js";
import { buildDeleteBranchResponse, parseBranchIdParam } from "./branchRouteHelpers.js";
import { ORDERS_VENDOR_NAME_LOOKBACK_DAYS } from "../services/orders/lookup.js";
import type { BranchDetailSnapshot, BranchMapping, BranchSnapshot, LookupVendorNameResponse, OrdersMetrics } from "../types/models.js";

const BranchBody = z.object({
  name: z.string().min(1),
  chainName: z.string().max(120).default(""),
  ordersVendorId: z.number().int().positive(),
  availabilityVendorId: z.string().min(1),
  globalEntityId: z.string().max(20).default(""),
  enabled: z.boolean().default(true),
  lateThresholdOverride: z.number().int().min(0).max(999).nullable().optional(),
  unassignedThresholdOverride: z.number().int().min(0).max(999).nullable().optional(),
}).superRefine((value, ctx) => {
  const hasLate = value.lateThresholdOverride != null;
  const hasUnassigned = value.unassignedThresholdOverride != null;
  if (hasLate === hasUnassigned) return;

  ctx.addIssue({
    code: z.ZodIssueCode.custom,
    message: "Branch threshold overrides must include both late and unassigned values.",
    path: ["lateThresholdOverride"],
  });
});

type BranchConflictField = "availabilityVendorId" | "ordersVendorId";

function parseBranchUniqueField(error: unknown): BranchConflictField | null {
  const code = (error as any)?.code;
  if (typeof code === "string" && code !== "SQLITE_CONSTRAINT_UNIQUE") {
    return null;
  }

  const message = typeof (error as any)?.message === "string" ? (error as any).message : "";
  if (!message || !/unique constraint failed/i.test(message)) return null;

  if (message.includes("branches.availabilityVendorId")) return "availabilityVendorId";
  if (message.includes("branches.ordersVendorId")) return "ordersVendorId";
  return null;
}

function uniqueFieldMessage(field: BranchConflictField) {
  if (field === "availabilityVendorId") return "Availability Vendor ID already exists";
  return "Orders Vendor ID already exists";
}

function emptyOrdersMetrics(): OrdersMetrics {
  return {
    totalToday: 0,
    cancelledToday: 0,
    doneToday: 0,
    activeNow: 0,
    lateNow: 0,
    unassignedNow: 0,
  };
}

function buildUnavailableBranchSnapshot(branch: BranchMapping, settings = getSettings()): BranchSnapshot {
  return {
    branchId: branch.id,
    name: branch.name,
    chainName: branch.chainName,
    ordersVendorId: branch.ordersVendorId,
    availabilityVendorId: branch.availabilityVendorId,
    status: "UNKNOWN",
    statusColor: "grey",
    thresholds: resolveBranchThresholdProfile(branch, settings),
    metrics: emptyOrdersMetrics(),
  };
}

function buildUnavailableBranchDetail(branch: BranchMapping, settings = getSettings()): BranchDetailSnapshot {
  return {
    snapshotAvailable: false,
    branch: buildUnavailableBranchSnapshot(branch, settings),
    totals: emptyOrdersMetrics(),
    fetchedAt: null,
    unassignedOrders: [],
    preparingOrders: [],
    message: "This branch exists, but its live snapshot is currently unavailable.",
  };
}

export function listBranchesRoute(_req: Request, res: Response) {
  res.json({ items: listBranches() });
}

export function addBranchRoute(req: Request, res: Response) {
  const parsed = BranchBody.parse(req.body);
  const input = {
    ...parsed,
    lateThresholdOverride: parsed.lateThresholdOverride ?? null,
    unassignedThresholdOverride: parsed.unassignedThresholdOverride ?? null,
  };

  try {
    const id = addBranch(input as any);
    res.json({ ok: true, id });
  } catch (error: unknown) {
    const field = parseBranchUniqueField(error);
    if (field) {
      return res.status(409).json({
        ok: false,
        message: uniqueFieldMessage(field),
        field,
      });
    }
    throw error;
  }
}

export function updateBranchRoute(req: Request, res: Response) {
  const id = parseBranchIdParam(req.params.id);
  if (!id) {
    return res.status(400).json({ ok: false, message: "Invalid branch id" });
  }

  const parsed = BranchBody.parse(req.body);
  const input = {
    ...parsed,
    lateThresholdOverride: parsed.lateThresholdOverride ?? null,
    unassignedThresholdOverride: parsed.unassignedThresholdOverride ?? null,
  };
  try {
    const updated = updateBranch(id, input as any);
    res.json({ ok: true, item: { id, ...updated } });
  } catch (error: unknown) {
    const field = parseBranchUniqueField(error);
    if (field) {
      return res.status(409).json({
        ok: false,
        message: uniqueFieldMessage(field),
        field,
      });
    }

    const errorMessage = (error as any)?.message;
    if (errorMessage === "Branch not found") {
      return res.status(404).json({ ok: false, message: "Branch not found" });
    }
    throw error;
  }
}

export function deleteBranchRoute(req: Request, res: Response) {
  const result = buildDeleteBranchResponse(req.params.id, deleteBranch);
  res.status(result.statusCode).json(result.body);
}

export function branchDetailRoute(engine: MonitorEngine) {
  return async (req: Request, res: Response) => {
    const id = parseBranchIdParam(req.params.id);
    if (!id) {
      return res.status(400).json({ ok: false, message: "Invalid branch id" });
    }

    const branch = getBranchById(id);
    if (!branch) {
      return res.status(404).json({ ok: false, message: "Branch not found" });
    }

    const settings = getSettings();
    const snapshotBranch = engine.getSnapshot().branches.find((item) => item.branchId === id);
    if (!snapshotBranch) {
      const fallbackDetail = buildUnavailableBranchDetail(branch, settings);
      return res.json(fallbackDetail);
    }

    try {
      const detail = await fetchVendorOrdersDetail({
        token: settings.ordersToken,
        globalEntityId: resolveOrdersGlobalEntityId(branch, settings.globalEntityId),
        vendorId: branch.ordersVendorId,
      });

      const body: BranchDetailSnapshot = {
        snapshotAvailable: true,
        branch: {
          ...snapshotBranch,
          metrics: snapshotBranch.metrics,
          thresholds: snapshotBranch.thresholds ?? resolveBranchThresholdProfile(branch, settings),
        },
        totals: snapshotBranch.metrics,
        fetchedAt: detail.fetchedAt,
        unassignedOrders: detail.unassignedOrders,
        preparingOrders: detail.preparingOrders,
      };
      res.json(body);
    } catch (e: any) {
      res.status(502).json({
        ok: false,
        message: e?.response?.data?.message || e?.message || "Failed to load branch detail",
        status: e?.response?.status ?? null,
      });
    }
  };
}

export async function lookupVendorNameRoute(req: Request, res: Response) {
  const ordersVendorId = Number(req.query.ordersVendorId);
  if (!ordersVendorId) return res.status(400).json({ ok: false });

  const s = getSettings();
  const requestedGlobalEntityId = typeof req.query.globalEntityId === "string" ? req.query.globalEntityId : "";
  const resolvedGlobalEntityId = resolveOrdersGlobalEntityId({ globalEntityId: requestedGlobalEntityId }, s.globalEntityId);
  const branches = listBranches();
  const mappedBranch = branches.find((branch) => (
    branch.ordersVendorId === ordersVendorId &&
    resolveOrdersGlobalEntityId(branch, s.globalEntityId) === resolvedGlobalEntityId &&
    branch.name.trim().length > 0
  ));

  if (mappedBranch) {
    const body: LookupVendorNameResponse = {
      ok: true,
      name: mappedBranch.name.trim(),
      source: "branch_mapping",
      resolvedGlobalEntityId,
      checkedSources: ["branch_mapping"],
      note: "Name filled from the saved branch mapping for this vendor.",
    };
    return res.json(body);
  }

  try {
    const name = await lookupVendorName({
      token: s.ordersToken,
      globalEntityId: resolvedGlobalEntityId,
      ordersVendorId,
    });
    const body: LookupVendorNameResponse = {
      ok: true,
      name,
      source: name ? "recent_orders" : "none",
      resolvedGlobalEntityId,
      checkedSources: ["branch_mapping", "recent_orders"],
      note: name
        ? `Name inferred from recent orders seen in the last ${ORDERS_VENDOR_NAME_LOOKBACK_DAYS} days.`
        : `Checked saved branch mappings and recent orders in the last ${ORDERS_VENDOR_NAME_LOOKBACK_DAYS} days. No name could be inferred for this vendor right now.`,
    };
    res.json(body);
  } catch (e: any) {
    res.status(500).json({ ok: false, status: e?.response?.status ?? null });
  }
}

// Helper: parse pasted request text to auto-fill IDs.
// Supports:
// - Orders URL containing vendor_id[0]=123
// - Availability PUT URL containing /vendors/456/availability
export function parseMappingRoute(req: Request, res: Response) {
  const Body = z.object({ text: z.string().min(1) });
  const { text } = Body.parse(req.body);

  const ordersMatch = text.match(/vendor_id(?:%5B|\[)0(?:%5D|\])=([0-9]+)/) || text.match(/vendor_id\[0\]=([0-9]+)/);
  const avMatch = text.match(/\/vendors\/([0-9]+)\/availability/);

  res.json({
    ok: true,
    ordersVendorId: ordersMatch ? Number(ordersMatch[1]) : null,
    availabilityVendorId: avMatch ? avMatch[1] : null,
  });
}
