import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import { ZodError } from "zod";
import { migrate } from "./config/db.js";
import { getEnv } from "./config/env.js";
import { createCorsOptions } from "./http/security.js";
import { createSessionAuthMiddleware, requireAdminRole, requireAuthenticatedApi, requireCapability } from "./http/auth.js";
import { MonitorEngine } from "./monitor/index.js";
import { health } from "./routes/health.js";
import { createUserRoute, listUsersRoute, loginRoute, logoutRoute, meRoute } from "./routes/auth.js";
import { getSettingsRoute, putSettingsRoute, testTokensRoute } from "./routes/settings.js";
import { listBranchesRoute, addBranchRoute, updateBranchRoute, updateBranchMonitoringRoute, branchDetailRoute, deleteBranchRoute, lookupVendorNameRoute, parseMappingRoute } from "./routes/branches.js";
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
app.use(createSessionAuthMiddleware());
const engine = new MonitorEngine();
// Routes
app.get("/api/health", health(engine));
app.post("/api/auth/login", loginRoute);
app.use(requireAuthenticatedApi());
app.get("/api/auth/me", meRoute);
app.post("/api/auth/logout", logoutRoute());
app.get("/api/auth/users", requireAdminRole(), listUsersRoute);
app.post("/api/auth/users", requireAdminRole(), createUserRoute);
app.get("/api/settings", getSettingsRoute);
app.put("/api/settings", requireCapability("manage_settings_tokens"), putSettingsRoute);
app.post("/api/settings/test", requireCapability("test_settings_tokens"), testTokensRoute);
app.get("/api/branches", listBranchesRoute);
app.post("/api/branches", requireCapability("manage_branch_mappings"), addBranchRoute);
app.put("/api/branches/:id", requireCapability("manage_branch_mappings"), updateBranchRoute);
app.patch("/api/branches/:id/monitoring", requireCapability("manage_branch_mappings"), updateBranchMonitoringRoute(engine));
app.get("/api/branches/:id/detail", branchDetailRoute(engine));
app.delete("/api/branches/:id", requireCapability("delete_branch_mappings"), deleteBranchRoute);
app.get("/api/branches/lookup-vendor-name", requireCapability("lookup_branch_vendors"), lookupVendorNameRoute);
app.post("/api/branches/parse-mapping", requireCapability("lookup_branch_vendors"), parseMappingRoute);
app.get("/api/dashboard", dashboardRoute(engine));
app.get("/api/logs", logsRoute);
app.delete("/api/logs", requireCapability("clear_logs"), clearLogsRoute);
app.get("/api/reports/monitor-actions.csv", downloadMonitorReportRoute);
app.post("/api/monitor/start", requireCapability("manage_monitor"), startMonitorRoute(engine));
app.post("/api/monitor/stop", requireCapability("manage_monitor"), stopMonitorRoute(engine));
app.get("/api/monitor/status", monitorStatusRoute(engine));
app.post("/api/monitor/refresh-orders", requireCapability("refresh_monitor_orders"), refreshOrdersNowRoute(engine));
app.get("/api/stream", streamRoute(engine));
app.use("/api", (_req, res) => {
    res.status(404).json({
        ok: false,
        message: "Not found",
    });
});
app.use((error, _req, res, next) => {
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
    const status = typeof error?.status === "number" &&
        error.status >= 400 &&
        error.status < 600
        ? error.status
        : 500;
    if (status >= 500) {
        console.error("Unhandled API error", error);
    }
    const message = status >= 500 ? "Internal server error" : (error?.message || "Request failed");
    res.status(status).json({
        ok: false,
        message,
    });
});
const port = Number(getEnv("PORT", "8080"));
app.listen(port, () => {
    console.log(`UPuse server listening on http://localhost:${port}`);
});
