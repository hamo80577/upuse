import type { Request, Response } from "express";
import { z } from "zod";
import type { MonitorEngine } from "../services/monitorEngine.js";
import {
  addBranch,
  deleteBranch,
  getBranchById,
  getResolvedBranchById,
  listBranches,
  setBranchMonitoringEnabled,
  setBranchThresholdOverrides,
} from "../services/branchStore.js";
import { listVendorCatalog } from "../services/vendorCatalogStore.js";
import { getSettings } from "../services/settingsStore.js";
import { getMirrorBranchDetail, getMirrorBranchPickers } from "../services/ordersMirrorStore.js";
import { resolveBranchThresholdProfile } from "../services/thresholds.js";
import { log } from "../services/logger.js";
import { buildDeleteBranchResponse, parseBranchIdParam } from "./branchRouteHelpers.js";
import type {
  BranchDetailCacheState,
  BranchDetailFetchFailed,
  BranchDetailOk,
  BranchDetailResult,
  BranchDetailSnapshotUnavailable,
  BranchMapping,
  BranchPickersSummary,
  BranchSnapshot,
  OrdersMetrics,
  ResolvedBranchMapping,
} from "../types/models.js";

const AddBranchBody = z.object({
  availabilityVendorId: z.string().trim().min(1),
  chainName: z.string().trim().max(120).default(""),
});

const BranchMonitoringBody = z.object({
  enabled: z.boolean(),
});

const BranchThresholdOverrideBody = z.object({
  lateThresholdOverride: z.number().int().min(0).max(999).nullable(),
  unassignedThresholdOverride: z.number().int().min(0).max(999).nullable(),
  capacityRuleEnabledOverride: z.boolean().nullable().optional().default(null),
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

function parseBranchUniqueField(error: unknown) {
  const code = (error as any)?.code;
  if (typeof code === "string" && code !== "SQLITE_CONSTRAINT_UNIQUE") {
    return null;
  }

  const message = typeof (error as any)?.message === "string" ? (error as any).message : "";
  if (!message || !/unique constraint failed/i.test(message)) return null;

  return message.includes("branches.availabilityVendorId") ? "availabilityVendorId" : null;
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
    recentActiveCount: 0,
    items: [],
  };
}

function buildUnavailableBranchSnapshot(branch: ResolvedBranchMapping, settings = getSettings()): BranchSnapshot {
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
    ordersDataState: "warming",
    ordersLastSyncedAt: undefined,
  };
}

function buildBranchDetailNotFound(branchId: number): BranchDetailResult {
  return {
    kind: "branch_not_found",
    branchId,
    message: "Branch not found",
  };
}

function applyResolvedThresholds(snapshot: BranchSnapshot, branch: ResolvedBranchMapping, settings = getSettings()): BranchSnapshot {
  return {
    ...snapshot,
    metrics: snapshot.metrics,
    thresholds: snapshot.thresholds ?? resolveBranchThresholdProfile(branch, settings),
  };
}

function buildSnapshotUnavailableDetail(
  branch: ResolvedBranchMapping,
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
  branch: ResolvedBranchMapping,
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
  branch: ResolvedBranchMapping,
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

function ensureResolvedBranch(branchId: number) {
  const savedBranch = getBranchById(branchId);
  if (!savedBranch) return { status: "not_found" as const };
  const branch = getResolvedBranchById(branchId);
  if (!branch) {
    return {
      status: "missing_catalog" as const,
      savedBranch,
    };
  }
  return {
    status: "ok" as const,
    branch,
  };
}

function buildMissingCatalogResponse(branch: BranchMapping) {
  return {
    ok: false,
    branchId: branch.id,
    availabilityVendorId: branch.availabilityVendorId,
    message: "Local vendor catalog data is unavailable for this branch.",
  };
}

export function listBranchesRoute(_req: Request, res: Response) {
  res.json({ items: listBranches() });
}

export function listVendorSourceRoute(_req: Request, res: Response) {
  res.json({ items: listVendorCatalog() });
}

export function addBranchRoute(req: Request, res: Response) {
  const parsed = AddBranchBody.parse(req.body);

  try {
    const id = addBranch({
      availabilityVendorId: parsed.availabilityVendorId,
      chainName: parsed.chainName,
      enabled: true,
    });
    res.json({ ok: true, id });
  } catch (error: unknown) {
    if ((error as Error)?.message === "Vendor catalog item not found") {
      return res.status(409).json({
        ok: false,
        message: "This branch is not available in the local vendor catalog.",
      });
    }

    const field = parseBranchUniqueField(error);
    if (field) {
      return res.status(409).json({
        ok: false,
        message: "Availability Vendor ID already exists",
        field,
      });
    }
    throw error;
  }
}

export function updateBranchThresholdOverridesRoute(req: Request, res: Response) {
  const id = parseBranchIdParam(req.params.id);
  if (!id) {
    return res.status(400).json({ ok: false, message: "Invalid branch id" });
  }

  const parsed = BranchThresholdOverrideBody.parse(req.body);
  try {
    const updated = setBranchThresholdOverrides(id, parsed);
    if (!updated) {
      return res.status(404).json({ ok: false, message: "Branch not found" });
    }
    res.json({ ok: true, item: updated });
  } catch (error: unknown) {
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

    if (branch.catalogState === "missing" && parsed.enabled) {
      return res.status(409).json({
        ok: false,
        message: "Cannot enable monitor for a branch missing from the local vendor catalog.",
      });
    }

    const updated = setBranchMonitoringEnabled(id, parsed.enabled);
    if (!updated) {
      return res.status(404).json({ ok: false, message: "Branch not found" });
    }
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

    const resolved = ensureResolvedBranch(id);
    if (resolved.status === "not_found") {
      return res.json(buildBranchDetailNotFound(id));
    }
    if (resolved.status === "missing_catalog") {
      return res.status(409).json(buildMissingCatalogResponse(resolved.savedBranch));
    }

    const branch = resolved.branch;
    const settings = getSettings();
    const getSnapshotBranch = () => engine.getSnapshot().branches.find((item) => item.branchId === id);
    const includePickerItems = req.query?.includePickerItems !== "0";
    const localDetail = getMirrorBranchDetail({
      globalEntityId: branch.globalEntityId,
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

    const resolved = ensureResolvedBranch(id);
    if (resolved.status === "not_found") {
      return res.status(404).json({ ok: false, message: "Branch not found" });
    }
    if (resolved.status === "missing_catalog") {
      return res.status(409).json(buildMissingCatalogResponse(resolved.savedBranch));
    }

    const settings = getSettings();
    const localPickers = getMirrorBranchPickers({
      globalEntityId: resolved.branch.globalEntityId,
      vendorId: resolved.branch.ordersVendorId,
      ordersRefreshSeconds: settings.ordersRefreshSeconds,
    });
    if (localPickers.cacheState === "warming" && !localPickers.pickers.items.length) {
      return res.status(503).json({ ok: false, message: "Local picker cache is warming up" });
    }
    return res.json(localPickers.pickers);
  };
}
