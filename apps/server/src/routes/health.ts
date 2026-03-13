import type { Request, Response } from "express";
import type { DashboardSnapshot } from "../types/models.js";
import type { MonitorEngine } from "../services/monitorEngine.js";

type MonitoringStatus = DashboardSnapshot["monitoring"];
type ReadinessState = "ready" | "idle" | "warming" | "degraded";

function fallbackOrdersSync(): NonNullable<MonitoringStatus["ordersSync"]> {
  return {
    mode: "mirror",
    state: "warming",
    staleBranchCount: 0,
    consecutiveSourceFailures: 0,
  };
}

function summarizeReadiness(monitoring?: MonitoringStatus) {
  if (!monitoring?.running) {
    return {
      ready: true,
      state: "idle" as ReadinessState,
      message: "Monitor is stopped.",
    };
  }

  if (
    monitoring.degraded ||
    monitoring.ordersSync?.state === "degraded" ||
    monitoring.errors?.orders ||
    monitoring.errors?.availability
  ) {
    return {
      ready: false,
      state: "degraded" as ReadinessState,
      message: monitoring.errors?.orders?.message ?? monitoring.errors?.availability?.message ?? "Monitor is degraded.",
    };
  }

  if (!monitoring.lastOrdersFetchAt || !monitoring.lastAvailabilityFetchAt) {
    return {
      ready: false,
      state: "warming" as ReadinessState,
      message: "Monitor is warming and has not completed its initial data fetches yet.",
    };
  }

  return {
    ready: true,
    state: "ready" as ReadinessState,
    message: "Monitor is healthy.",
  };
}

export function buildHealthPayload(engine?: MonitorEngine) {
  const monitoring = engine?.getSnapshot().monitoring;
  const readiness = summarizeReadiness(monitoring);
  const lastErrorAt =
    monitoring?.errors?.orders?.at ??
    monitoring?.errors?.availability?.at;

  return {
    name: "UPuse",
    live: true,
    ready: readiness.ready,
    readiness: {
      state: readiness.state,
      message: readiness.message,
    },
    monitorRunning: monitoring?.running ?? false,
    monitorDegraded: monitoring?.degraded ?? false,
    lastSnapshotAt: monitoring?.lastHealthyAt ?? monitoring?.lastOrdersFetchAt ?? monitoring?.lastAvailabilityFetchAt ?? null,
    lastErrorAt: lastErrorAt ?? null,
    ordersSync: monitoring?.ordersSync ?? fallbackOrdersSync(),
  };
}

export function health(engine?: MonitorEngine) {
  return (_req: Request, res: Response) => {
    res.json({
      ok: true,
      ...buildHealthPayload(engine),
    });
  };
}

export function readiness(engine?: MonitorEngine) {
  return (_req: Request, res: Response) => {
    const payload = buildHealthPayload(engine);
    res.status(payload.ready ? 200 : 503).json({
      ok: payload.ready,
      ...payload,
    });
  };
}
