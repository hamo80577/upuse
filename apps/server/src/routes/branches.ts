import type { Request, Response } from "express";
import { z } from "zod";
import type { MonitorEngine } from "../services/monitorEngine.js";
import { addBranch, deleteBranch, getBranchById, listBranches, updateBranch } from "../services/branchStore.js";
import { getBranchCatalogResponse, getResolvedCatalogBranchForAdd, refreshBranchCatalogNow } from "../services/branchCatalogService.js";
import { resolveOrdersGlobalEntityId } from "../services/monitorOrdersPolling.js";
import { getSettings } from "../services/settingsStore.js";
import { lookupVendorName } from "../services/ordersClient.js";
import { getMirrorBranchDetail, getMirrorBranchPickers } from "../services/ordersMirrorStore.js";
import { resolveBranchThresholdProfile } from "../services/thresholds.js";
import { log } from "../services/logger.js";
import { buildDeleteBranchResponse, parseBranchIdParam } from "./branchRouteHelpers.js";
import { ORDERS_VENDOR_NAME_LOOKBACK_DAYS } from "../services/orders/lookup.js";
import type { BranchDetailCacheState, BranchDetailFetchFailed, BranchDetailOk, BranchDetailResult, BranchDetailSnapshotUnavailable, BranchMapping, BranchSnapshot, BranchPickersSummary, LookupVendorNameResponse, OrdersMetrics } from "../types/models.js";

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

const AddBranchFromCatalogBody = z.object({
  availabilityVendorId: z.string().min(1),
  chainName: z.string().max(120).default(""),
  enabled: z.boolean().default(true),
});

const BranchMonitoringBody = z.object({
  enabled: z.boolean(),
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

function emptyBranchPickers(): BranchPickersSummary {
  return {
    todayCount: 0,
    activePreparingCount: 0,
    lastHourCount: 0,
    items: [],
  };
}

function buildUnavailableBranchSnapshot(branch: BranchMapping, settings = getSettings()): BranchSnapshot {
  return {
    branchId: branch.id,
    name: branch.name,
    chainName: branch.chainName,
    monitorEnabled: branch.enabled,
    ordersVendorId: branch.ordersVendorId,
    availabilityVendorId: branch.availabilityVendorId,
    status: "UNKNOWN",
    statusColor: "grey",
    thresholds: resolveBranchThresholdProfile(branch, settings),
    metrics: emptyOrdersMetrics(),
    preparingNow: 0,
    preparingPickersNow: 0,
  };
}

function buildBranchDetailNotFound(branchId: number): BranchDetailResult {
  return {
    kind: "branch_not_found",
    branchId,
    message: "Branch not found",
  };
}

function snapshotUnavailableMessage(branch: BranchMapping, detailErrorMessage?: string | null) {
  if (!branch.enabled) {
    if (detailErrorMessage) {
      return `This branch is paused in monitor. Orders detail could not be loaded. ${detailErrorMessage}`;
    }
    return "This branch is paused in monitor. Live snapshot will resume after it is re-enabled.";
  }

  if (detailErrorMessage) {
    return `Live availability snapshot is currently unavailable, and orders detail could not be loaded. ${detailErrorMessage}`;
  }

  return "This branch exists, but its live snapshot is currently unavailable.";
}

function applyResolvedThresholds(snapshot: BranchSnapshot, branch: BranchMapping, settings = getSettings()): BranchSnapshot {
  return {
    ...snapshot,
    metrics: snapshot.metrics,
    thresholds: snapshot.thresholds ?? resolveBranchThresholdProfile(branch, settings),
  };
}

function buildSnapshotUnavailableDetail(
  branch: BranchMapping,
  settings = getSettings(),
  options?: {
    branchSnapshot?: BranchSnapshot;
    totals?: OrdersMetrics;
    fetchedAt?: string | null;
    unassignedOrders?: BranchDetailSnapshotUnavailable["unassignedOrders"];
    preparingOrders?: BranchDetailSnapshotUnavailable["preparingOrders"];
    pickers?: BranchDetailSnapshotUnavailable["pickers"];
    cacheState?: BranchDetailCacheState;
    message?: string;
  },
): BranchDetailSnapshotUnavailable {
  const snapshot = applyResolvedThresholds(options?.branchSnapshot ?? buildUnavailableBranchSnapshot(branch, settings), branch, settings);
  return {
    kind: "snapshot_unavailable",
    branch: snapshot,
    totals: options?.totals ?? snapshot.metrics,
    fetchedAt: options?.fetchedAt ?? null,
    cacheState: options?.cacheState ?? "fresh",
    unassignedOrders: options?.unassignedOrders ?? [],
    preparingOrders: options?.preparingOrders ?? [],
    pickers: options?.pickers ?? emptyBranchPickers(),
    message: options?.message ?? "This branch exists, but its live snapshot is currently unavailable.",
  };
}

function buildDetailFetchFailedDetail(
  snapshot: BranchSnapshot,
  branch: BranchMapping,
  settings = getSettings(),
  cacheState: BranchDetailCacheState = "fresh",
  message = "Live orders detail is temporarily unavailable.",
): BranchDetailFetchFailed {
  const normalizedSnapshot = applyResolvedThresholds(snapshot, branch, settings);
  return {
    kind: "detail_fetch_failed",
    branch: normalizedSnapshot,
    totals: normalizedSnapshot.metrics,
    fetchedAt: null,
    cacheState,
    unassignedOrders: [],
    preparingOrders: [],
    pickers: emptyBranchPickers(),
    message,
  };
}

function buildOkBranchDetail(
  snapshot: BranchSnapshot,
  branch: BranchMapping,
  settings = getSettings(),
  detail: {
    fetchedAt: string;
    cacheState: BranchDetailCacheState;
    unassignedOrders: BranchDetailOk["unassignedOrders"];
    preparingOrders: BranchDetailOk["preparingOrders"];
    pickers: BranchDetailOk["pickers"];
  },
): BranchDetailOk {
  const normalizedSnapshot = applyResolvedThresholds(snapshot, branch, settings);
  return {
    kind: "ok",
    branch: normalizedSnapshot,
    totals: normalizedSnapshot.metrics,
    fetchedAt: detail.fetchedAt,
    cacheState: detail.cacheState,
    unassignedOrders: detail.unassignedOrders,
    preparingOrders: detail.preparingOrders,
    pickers: detail.pickers,
  };
}

export function listBranchesRoute(_req: Request, res: Response) {
  res.json({ items: listBranches() });
}

export function branchCatalogRoute(_req: Request, res: Response) {
  const settings = getSettings();
  res.json(getBranchCatalogResponse(settings.globalEntityId));
}

export async function refreshBranchCatalogRoute(_req: Request, res: Response) {
  const settings = getSettings();
  const response = await refreshBranchCatalogNow(settings.globalEntityId);
  res.json(response);
}

export function addBranchRoute(req: Request, res: Response) {
  const settings = getSettings();
  const manualShapeRequested = typeof req.body?.name === "string" || typeof req.body?.ordersVendorId === "number" || typeof req.body?.globalEntityId === "string";
  const input = manualShapeRequested
    ? (() => {
        const parsed = BranchBody.parse(req.body);
        return {
          value: {
            ...parsed,
            lateThresholdOverride: parsed.lateThresholdOverride ?? null,
            unassignedThresholdOverride: parsed.unassignedThresholdOverride ?? null,
          },
        } as const;
      })()
    : (() => {
        const parsed = AddBranchFromCatalogBody.parse(req.body);
        const catalogItem = getResolvedCatalogBranchForAdd(settings.globalEntityId, parsed.availabilityVendorId.trim());
        if (!catalogItem || !catalogItem.presentInSource) {
          return { error: { status: 409, message: "This branch is not available in the current source catalog." } } as const;
        }
        if (catalogItem.resolveStatus !== "resolved" || !catalogItem.ordersVendorId || !catalogItem.name?.trim()) {
          return { error: { status: 409, message: "This branch is not resolved yet. Refresh the catalog and try again." } } as const;
        }

        return {
          value: {
            name: catalogItem.name.trim(),
            chainName: parsed.chainName.trim(),
            ordersVendorId: catalogItem.ordersVendorId,
            availabilityVendorId: catalogItem.availabilityVendorId,
            globalEntityId: catalogItem.globalEntityId,
            enabled: parsed.enabled,
            lateThresholdOverride: null,
            unassignedThresholdOverride: null,
          },
        } as const;
      })();

  if ("error" in input) {
    return res.status(input.error.status).json({
      ok: false,
      message: input.error.message,
    });
  }

  try {
    const id = addBranch(input.value as any);
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

export function updateBranchMonitoringRoute(engine?: MonitorEngine) {
  return (req: Request, res: Response) => {
    const id = parseBranchIdParam(req.params.id);
    if (!id) {
      return res.status(400).json({ ok: false, message: "Invalid branch id" });
    }

    const branch = getBranchById(id);
    if (!branch) {
      return res.status(404).json({ ok: false, message: "Branch not found" });
    }

    const parsed = BranchMonitoringBody.parse(req.body);
    if (branch.enabled === parsed.enabled) {
      return res.json({ ok: true, item: branch });
    }

    const updated = { id, ...updateBranch(id, { enabled: parsed.enabled }) };
    engine?.resetBranchTransientState(updated);
    log(
      id,
      "INFO",
      parsed.enabled
        ? "Monitor enabled for this branch. Live cycles will include it again."
        : "Monitor paused for this branch. Live cycles will skip it until re-enabled.",
    );
    return res.json({ ok: true, item: updated });
  };
}

export function branchDetailRoute(engine: MonitorEngine) {
  return async (req: Request, res: Response) => {
    const id = parseBranchIdParam(req.params.id);
    if (!id) {
      return res.status(400).json({ ok: false, message: "Invalid branch id" });
    }

    const branch = getBranchById(id);
    if (!branch) {
      return res.json(buildBranchDetailNotFound(id));
    }

    const settings = getSettings();
    const getSnapshotBranch = () => engine.getSnapshot().branches.find((item) => item.branchId === id);
    const includePickerItems = req.query?.includePickerItems !== "0";
    const localDetail = getMirrorBranchDetail({
      globalEntityId: resolveOrdersGlobalEntityId(branch, settings.globalEntityId),
      vendorId: branch.ordersVendorId,
      ordersRefreshSeconds: settings.ordersRefreshSeconds,
      includePickerItems,
    });

    const latestSnapshotBranch = getSnapshotBranch();
    if (latestSnapshotBranch && localDetail.fetchedAt) {
      return res.json(buildOkBranchDetail(latestSnapshotBranch, branch, settings, {
        fetchedAt: localDetail.fetchedAt,
        cacheState: localDetail.cacheState,
        unassignedOrders: localDetail.unassignedOrders,
        preparingOrders: localDetail.preparingOrders,
        pickers: localDetail.pickers,
      }));
    }

    if (latestSnapshotBranch) {
      return res.json(buildDetailFetchFailedDetail(
        latestSnapshotBranch,
        branch,
        settings,
        localDetail.cacheState,
        localDetail.cacheState === "warming"
          ? "Local orders cache is warming up. Showing the latest monitor snapshot until the branch detail cache is ready."
          : "Local orders cache is stale. Showing the latest monitor snapshot until the next cache sync completes.",
      ));
    }

    if (localDetail.fetchedAt) {
      const unavailableSnapshot = buildUnavailableBranchSnapshot(branch, settings);
      return res.json(buildSnapshotUnavailableDetail(branch, settings, {
        branchSnapshot: {
          ...unavailableSnapshot,
          metrics: localDetail.metrics,
          preparingNow: localDetail.preparingOrders.length,
          preparingPickersNow: localDetail.pickers.activePreparingCount,
        },
        totals: localDetail.metrics,
        fetchedAt: localDetail.fetchedAt,
        cacheState: localDetail.cacheState,
        unassignedOrders: localDetail.unassignedOrders,
        preparingOrders: localDetail.preparingOrders,
        pickers: localDetail.pickers,
        message: branch.enabled
          ? "Live availability snapshot is currently unavailable. Showing branch detail from the local orders cache."
          : "This branch is paused in monitor. Showing the latest local orders cache only.",
      }));
    }

    return res.json(buildSnapshotUnavailableDetail(branch, settings, {
      cacheState: localDetail.cacheState,
      message: branch.enabled
        ? "Local orders cache is warming up while the live snapshot is unavailable."
        : "This branch is paused in monitor and no local orders cache is available yet.",
    }));
  };
}

export function branchPickersRoute() {
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
    const localPickers = getMirrorBranchPickers({
      globalEntityId: resolveOrdersGlobalEntityId(branch, settings.globalEntityId),
      vendorId: branch.ordersVendorId,
      ordersRefreshSeconds: settings.ordersRefreshSeconds,
    });
    if (localPickers.cacheState === "warming" && !localPickers.pickers.items.length) {
      return res.status(503).json({ ok: false, message: "Local picker cache is warming up" });
    }
    return res.json(localPickers.pickers);
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
