import { requestJson } from "../../../shared/api/httpClient";
import type {
  OpsErrorItem,
  OpsEventItem,
  OpsListQuery,
  OpsPageResponse,
  OpsSessionItem,
  OpsSummaryQuery,
  OpsSummaryResponse,
  OpsTelemetryEndResponse,
  OpsTelemetryHeartbeatResponse,
  OpsTelemetryIngestPayload,
  OpsTelemetryIngestResponse,
  OpsTelemetrySessionPayload,
} from "./types";

const TELEMETRY_TIMEOUT_MS = 10_000;
const OPS_READ_TIMEOUT_MS = 20_000;

type QueryParams = Record<string, string | number | boolean | null | undefined>;

function buildQuery(params: QueryParams) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value == null || value === "") continue;
    query.set(key, String(value));
  }
  const value = query.toString();
  return value ? `?${value}` : "";
}

export function opsSummary(params: OpsSummaryQuery = {}) {
  return requestJson<OpsSummaryResponse>(
    `/api/ops/summary${buildQuery({ windowMinutes: params.windowMinutes })}`,
    undefined,
    { timeoutMs: OPS_READ_TIMEOUT_MS },
  );
}

export function opsSessions(params: OpsListQuery = {}) {
  return requestJson<OpsPageResponse<OpsSessionItem>>(
    `/api/ops/sessions${buildQuery(params as QueryParams)}`,
    undefined,
    { timeoutMs: OPS_READ_TIMEOUT_MS },
  );
}

export function opsEvents(params: OpsListQuery = {}) {
  return requestJson<OpsPageResponse<OpsEventItem>>(
    `/api/ops/events${buildQuery(params as QueryParams)}`,
    undefined,
    { timeoutMs: OPS_READ_TIMEOUT_MS },
  );
}

export function opsErrors(params: OpsListQuery = {}) {
  return requestJson<OpsPageResponse<OpsErrorItem>>(
    `/api/ops/errors${buildQuery(params as QueryParams)}`,
    undefined,
    { timeoutMs: OPS_READ_TIMEOUT_MS },
  );
}

export function opsTelemetryHeartbeat(payload: OpsTelemetrySessionPayload) {
  return requestJson<OpsTelemetryHeartbeatResponse>("/api/ops/presence/heartbeat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  }, { timeoutMs: TELEMETRY_TIMEOUT_MS, skipTelemetry: true });
}

export function opsTelemetryEnd(payload: { sessionId: string; endedAt?: string }) {
  return requestJson<OpsTelemetryEndResponse>("/api/ops/presence/end", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sessionId: payload.sessionId,
      ...(payload.endedAt ? { endedAt: payload.endedAt } : {}),
    }),
  }, { timeoutMs: TELEMETRY_TIMEOUT_MS, skipTelemetry: true });
}

export function opsTelemetryIngest(payload: OpsTelemetryIngestPayload) {
  return requestJson<OpsTelemetryIngestResponse>("/api/ops/ingest", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  }, { timeoutMs: TELEMETRY_TIMEOUT_MS, skipTelemetry: true });
}

export const opsApi = {
  opsSummary,
  opsSessions,
  opsEvents,
  opsErrors,
  opsTelemetryHeartbeat,
  opsTelemetryEnd,
  opsTelemetryIngest,
};
