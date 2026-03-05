import type { Request, Response } from "express";
import type { MonitorEngine } from "../services/monitorEngine.js";

export function dashboardRoute(engine: MonitorEngine) {
  return (_req: Request, res: Response) => {
    res.json(engine.getSnapshot());
  };
}
