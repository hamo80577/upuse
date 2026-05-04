import type { Request, Response } from "express";
import type { MonitorEngine } from "../monitor/engine/MonitorEngine.js";
import { filterDashboardSnapshotForUser } from "../systems/upuse/services/trackerAccess.js";

export function dashboardRoute(engine: MonitorEngine) {
  return (req: Request, res: Response) => {
    res.json(filterDashboardSnapshotForUser(engine.getSnapshot(), req.authUser));
  };
}
