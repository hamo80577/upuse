import type { Request, Response } from "express";
import type { MonitorEngine } from "../services/monitorEngine.js";
import { getPerformanceBranchDetail, getPerformanceSummary, getPerformanceVendorDetail } from "../services/performanceStore.js";
import { parseBranchIdParam } from "./branchRouteHelpers.js";

function buildStatusColorMap(engine: MonitorEngine) {
  return new Map(engine.getSnapshot().branches.map((branch) => [branch.branchId, branch.statusColor]));
}

export function performanceSummaryRoute(engine: MonitorEngine) {
  return async (_req: Request, res: Response) => {
    res.json(await getPerformanceSummary(buildStatusColorMap(engine)));
  };
}

export function performanceBranchDetailRoute(engine: MonitorEngine) {
  return async (req: Request, res: Response) => {
    const branchId = parseBranchIdParam(req.params.id);
    if (!branchId) {
      return res.status(400).json({ ok: false, message: "Invalid branch id" });
    }

    const detail = await getPerformanceBranchDetail(branchId, buildStatusColorMap(engine));
    if (!detail) {
      return res.status(404).json({ ok: false, message: "Branch not found" });
    }

    return res.json(detail);
  };
}

export function performanceVendorDetailRoute() {
  return async (req: Request, res: Response) => {
    const vendorId = parseBranchIdParam(req.params.id);
    if (!vendorId) {
      return res.status(400).json({ ok: false, message: "Invalid vendor id" });
    }

    const detail = await getPerformanceVendorDetail(vendorId);
    if (!detail) {
      return res.status(404).json({ ok: false, message: "Vendor not found" });
    }

    return res.json(detail);
  };
}
