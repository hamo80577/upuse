import { requestJson } from "../../../shared/api/httpClient";
import type {
  OpsTelemetryEndResponse,
  OpsTelemetryHeartbeatResponse,
  OpsTelemetryIngestPayload,
  OpsTelemetryIngestResponse,
  OpsTelemetrySessionPayload,
} from "./types";

const TELEMETRY_TIMEOUT_MS = 10_000;

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
  opsTelemetryHeartbeat,
  opsTelemetryEnd,
  opsTelemetryIngest,
};
