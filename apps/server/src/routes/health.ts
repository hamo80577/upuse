import type { Request, Response } from "express";
import { FIXED_AVAILABILITY_REFRESH_SECONDS } from "../config/monitoring.js";
import type { DashboardSnapshot } from "../types/models.js";
import type { MonitorEngine } from "../monitor/engine/MonitorEngine.js";

type MonitoringStatus = DashboardSnapshot["monitoring"];
type ReadinessState = "ready" | "idle" | "warming" | "degraded";

function fallbackOrdersSync(): NonNullable<MonitoringStatus["ordersSync"]> {
  return {
    mode: "mirror",
    state: "warming",
    cadenceSeconds: 30,
    staleBranchCount: 0,
    consecutiveSourceFailures: 0,
  };
}

function fallbackAvailabilitySync(): NonNullable<MonitoringStatus["availabilitySync"]> {
  return {
    state: "warming",
    cadenceSeconds: FIXED_AVAILABILITY_REFRESH_SECONDS,
    consecutiveFailures: 0,
  };
}

function latestErrorAt(monitoring?: MonitoringStatus) {
  const errors = [
    monitoring?.ordersSync?.error?.at,
    monitoring?.availabilitySync?.error?.at,
    monitoring?.errors?.orders?.at,
    monitoring?.errors?.availability?.at,
  ].filter((value): value is string => typeof value === "string" && value.length > 0);

  if (!errors.length) return null;
  return errors.reduce((latest, current) => (new Date(current).getTime() > new Date(latest).getTime() ? current : latest));
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
    monitoring.availabilitySync?.state === "degraded" ||
    monitoring.errors?.orders ||
    monitoring.errors?.availability
  ) {
    return {
      ready: false,
      state: "degraded" as ReadinessState,
      message:
        monitoring.ordersSync?.error?.message ??
        monitoring.availabilitySync?.error?.message ??
        monitoring.errors?.orders?.message ??
        monitoring.errors?.availability?.message ??
        "Monitor is degraded.",
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
    lastErrorAt: latestErrorAt(monitoring),
    ordersSync: monitoring?.ordersSync ?? fallbackOrdersSync(),
    availabilitySync: monitoring?.availabilitySync ?? fallbackAvailabilitySync(),
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
