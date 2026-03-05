import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import { ZodError } from "zod";

import { migrate } from "./config/db.js";
import { getEnv } from "./config/env.js";
import { createApiAccessMiddleware, createCorsOptions } from "./http/security.js";
import { MonitorEngine } from "./monitor/index.js";

import { health } from "./routes/health.js";
import { getSettingsRoute, putSettingsRoute, testTokensRoute } from "./routes/settings.js";
import { listBranchesRoute, addBranchRoute, updateBranchRoute, branchDetailRoute, deleteBranchRoute, lookupVendorNameRoute, parseMappingRoute } from "./routes/branches.js";
import { dashboardRoute } from "./routes/dashboard.js";
import { clearLogsRoute, logsRoute } from "./routes/logs.js";
import { downloadMonitorReportRoute } from "./routes/reports.js";
import { startMonitorRoute, stopMonitorRoute, monitorStatusRoute, refreshOrdersNowRoute, streamRoute } from "./routes/monitor.js";

migrate();

const app = express();
app.use(cors(createCorsOptions()));
app.use(helmet());
app.use(express.json({ limit: "1mb" }));
app.use(morgan("tiny"));
app.use(createApiAccessMiddleware());

const engine = new MonitorEngine();

// Routes
app.get("/api/health", health(engine));

app.get("/api/settings", getSettingsRoute);
app.put("/api/settings", putSettingsRoute);
app.post("/api/settings/test", testTokensRoute);

app.get("/api/branches", listBranchesRoute);
app.post("/api/branches", addBranchRoute);
app.put("/api/branches/:id", updateBranchRoute);
app.get("/api/branches/:id/detail", branchDetailRoute(engine));
app.delete("/api/branches/:id", deleteBranchRoute);
app.get("/api/branches/lookup-vendor-name", lookupVendorNameRoute);
app.post("/api/branches/parse-mapping", parseMappingRoute);

app.get("/api/dashboard", dashboardRoute(engine));
app.get("/api/logs", logsRoute);
app.delete("/api/logs", clearLogsRoute);
app.get("/api/reports/monitor-actions.csv", downloadMonitorReportRoute);

app.post("/api/monitor/start", startMonitorRoute(engine));
app.post("/api/monitor/stop", stopMonitorRoute(engine));
app.get("/api/monitor/status", monitorStatusRoute(engine));
app.post("/api/monitor/refresh-orders", refreshOrdersNowRoute(engine));
app.get("/api/stream", streamRoute(engine));

app.use("/api", (_req, res) => {
  res.status(404).json({
    ok: false,
    message: "Not found",
  });
});

app.use((error: unknown, _req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (res.headersSent) {
    next(error);
    return;
  }

  if (error instanceof ZodError) {
    res.status(400).json({
      ok: false,
      message: "Invalid request payload",
      issues: error.issues.map((issue) => issue.message),
    });
    return;
  }

  const status =
    typeof (error as any)?.status === "number" &&
    (error as any).status >= 400 &&
    (error as any).status < 600
      ? (error as any).status
      : 500;
  if (status >= 500) {
    console.error("Unhandled API error", error);
  }
  const message = status >= 500 ? "Internal server error" : ((error as any)?.message || "Request failed");

  res.status(status).json({
    ok: false,
    message,
  });
});

const port = Number(getEnv("PORT", "8080"));
app.listen(port, () => {
  console.log(`UPuse server listening on http://localhost:${port}`);
});
