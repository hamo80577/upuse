import type { HealthStatusResponse } from "../../api/types";
import { requestJson } from "./httpClient";

export const healthApi = {
  health: () => requestJson<HealthStatusResponse>("/api/health", undefined, { timeoutMs: 10_000 }),
  readiness: () => requestJson<HealthStatusResponse>("/api/ready", undefined, { timeoutMs: 10_000 }),
};
