import type { Request, Response } from "express";
import type { MonitorEngine } from "../services/monitorEngine.js";

export function health(engine?: MonitorEngine) {
  return (_req: Request, res: Response) => {
    const monitoring = engine?.getSnapshot().monitoring;
    const lastErrorAt =
      monitoring?.errors?.orders?.at ??
      monitoring?.errors?.availability?.at;

    res.json({
      ok: true,
      name: "UPuse",
      monitorRunning: monitoring?.running ?? false,
      monitorDegraded: monitoring?.degraded ?? false,
      lastSnapshotAt: monitoring?.lastHealthyAt ?? monitoring?.lastOrdersFetchAt ?? monitoring?.lastAvailabilityFetchAt ?? null,
      lastErrorAt: lastErrorAt ?? null,
    });
  };
}
