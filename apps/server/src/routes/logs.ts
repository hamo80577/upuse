import type { Request, Response } from "express";
import { z } from "zod";
import { clearLogs, getLogsDayPage } from "../services/logger.js";
import { getBranchById } from "../services/branchStore.js";
import { canUserAccessUpuseBranch } from "../systems/upuse/services/trackerAccess.js";

const LogsQuery = z.object({
  branchId: z.string().regex(/^[0-9]+$/),
  beforeDay: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

export function logsRoute(req: Request, res: Response) {
  const q = LogsQuery.parse(req.query);
  const branchId = Number(q.branchId);
  const branch = getBranchById(branchId);
  if (!branch) {
    return res.status(404).json({ ok: false, message: "Branch not found" });
  }
  if (!canUserAccessUpuseBranch(req.authUser, branch)) {
    return res.status(403).json({
      ok: false,
      message: "Forbidden",
      code: "FORBIDDEN",
      errorOrigin: "authorization",
    });
  }
  res.json(getLogsDayPage(branchId, q.beforeDay));
}

export function clearLogsRoute(req: Request, res: Response) {
  const q = LogsQuery.parse(req.query);
  const branchId = Number(q.branchId);
  clearLogs(branchId);
  res.json({ ok: true });
}
