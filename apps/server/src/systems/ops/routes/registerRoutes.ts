import type { ServerSystemDependencies } from "../../../core/systems/types.js";
import { requireOpsAccess, requireOpsTelemetryWriteAccess } from "../policies/access.js";
import {
  createOpsEndRoute,
  createOpsErrorsRoute,
  createOpsEventsRoute,
  createOpsHeartbeatRoute,
  createOpsIngestRoute,
  createOpsSessionsRoute,
  createOpsSummaryRoute,
} from "./telemetryRoutes.js";

export function registerOpsRoutes({ app, engine }: ServerSystemDependencies) {
  app.get("/api/ops/health", requireOpsAccess(), (_req, res) => {
    res.json({
      ok: true,
      system: "ops",
      status: "ready",
    });
  });
  app.post("/api/ops/ingest", requireOpsTelemetryWriteAccess(), createOpsIngestRoute());
  app.post("/api/ops/presence/heartbeat", requireOpsTelemetryWriteAccess(), createOpsHeartbeatRoute());
  app.post("/api/ops/presence/end", requireOpsTelemetryWriteAccess(), createOpsEndRoute());
  app.get("/api/ops/summary", requireOpsAccess(), createOpsSummaryRoute(engine));
  app.get("/api/ops/sessions", requireOpsAccess(), createOpsSessionsRoute());
  app.get("/api/ops/events", requireOpsAccess(), createOpsEventsRoute());
  app.get("/api/ops/errors", requireOpsAccess(), createOpsErrorsRoute());
}
