import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import { ZodError } from "zod";

import { migrate } from "./config/db.js";
import { getEnv } from "./config/env.js";
import { resolveWebDistDir } from "./config/paths.js";
import { resolveSecurityConfig } from "./config/security.js";
import { resolveStartupConfig } from "./config/startup.js";
import { getSettings } from "./services/settingsStore.js";
import { startOrdersMirrorRuntime } from "./services/ordersMirrorStore.js";
import { attachDashboardWebSocketServer } from "./http/dashboardWebSocket.js";
import { attachPerformanceWebSocketServer } from "./http/performanceWebSocket.js";
import {
  createApiNoStoreMiddleware,
  createContentSecurityPolicyDirectives,
  createCorsOptions,
  createCspNonceMiddleware,
  createTrustedOriginMiddleware,
} from "./http/security.js";
import { createSessionAuthMiddleware, requireAdminRole, requireAuthenticatedApi, requireCapability } from "./http/auth.js";
import { MonitorEngine } from "./monitor/index.js";

import { health, readiness } from "./routes/health.js";
import { createUserRoute, deleteUserRoute, listUsersRoute, loginRoute, logoutRoute, meRoute, updateUserRoute } from "./routes/auth.js";
import { getSettingsRoute, getTokenTestRoute, putSettingsRoute, testTokensRoute } from "./routes/settings.js";
import { listBranchesRoute, listVendorSourceRoute, addBranchRoute, updateBranchThresholdOverridesRoute, updateBranchMonitoringRoute, branchDetailRoute, branchPickersRoute, deleteBranchRoute } from "./routes/branches.js";
import { dashboardRoute } from "./routes/dashboard.js";
import { clearLogsRoute, logsRoute } from "./routes/logs.js";
import { performanceBranchDetailRoute, performanceSummaryRoute, performanceTrendRoute, performanceVendorDetailRoute } from "./routes/performance.js";
import {
  createPerformanceGroupRoute,
  createPerformanceViewRoute,
  deletePerformanceGroupRoute,
  deletePerformanceViewRoute,
  getPerformancePreferencesRoute,
  putPerformanceCurrentPreferencesRoute,
  updatePerformanceGroupRoute,
  updatePerformanceViewRoute,
} from "./routes/performancePreferences.js";
import { downloadMonitorReportRoute } from "./routes/reports.js";
import { startMonitorRoute, stopMonitorRoute, monitorStatusRoute, refreshOrdersNowRoute, streamRoute } from "./routes/monitor.js";
import { syncVendorCatalogFromCsv } from "./services/vendorCatalogStore.js";

migrate();
const startupConfig = resolveStartupConfig();
if (startupConfig.syncVendorCatalogOnStartup && startupConfig.vendorCatalogCsvPath) {
  syncVendorCatalogFromCsv(startupConfig.vendorCatalogCsvPath);
}
getSettings();
startOrdersMirrorRuntime();

function looksLikeLinkPreviewBot(userAgent: string | undefined) {
  if (!userAgent) return false;

  return /(WhatsApp|facebookexternalhit|Facebot|TelegramBot|Slackbot|Discordbot|LinkedInBot|Twitterbot|SkypeUriPreview)/i.test(
    userAgent,
  );
}

const app = express();
const securityConfig = resolveSecurityConfig();

app.disable("x-powered-by");
app.set("trust proxy", securityConfig.trustProxy);
app.use(cors(createCorsOptions()));
app.use(createCspNonceMiddleware());
app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: true,
    directives: createContentSecurityPolicyDirectives(),
  },
}));
app.use(createApiNoStoreMiddleware());
app.use(createTrustedOriginMiddleware());
app.use(express.json({ limit: "1mb" }));
app.use(morgan("tiny"));
app.use(createSessionAuthMiddleware());

const engine = new MonitorEngine();

// Routes
app.get("/api/health", health(engine));
app.get("/api/ready", readiness(engine));
app.post("/api/auth/login", loginRoute);
app.use(requireAuthenticatedApi());
app.get("/api/auth/me", meRoute);
app.post("/api/auth/logout", logoutRoute());
app.get("/api/auth/users", requireAdminRole(), listUsersRoute);
app.post("/api/auth/users", requireAdminRole(), createUserRoute);
app.patch("/api/auth/users/:id", requireAdminRole(), updateUserRoute);
app.delete("/api/auth/users/:id", requireAdminRole(), deleteUserRoute);

app.get("/api/settings", getSettingsRoute);
app.put("/api/settings", putSettingsRoute);
app.post("/api/settings/test", requireCapability("test_settings_tokens"), testTokensRoute);
app.get("/api/settings/test/:jobId", requireCapability("test_settings_tokens"), getTokenTestRoute);

app.get("/api/branches", listBranchesRoute);
app.get("/api/branches/source", listVendorSourceRoute);
app.post("/api/branches", requireCapability("manage_branch_mappings"), addBranchRoute);
app.patch("/api/branches/:id/threshold-overrides", requireCapability("manage_thresholds"), updateBranchThresholdOverridesRoute);
app.patch("/api/branches/:id/monitoring", requireCapability("manage_branch_mappings"), updateBranchMonitoringRoute(engine));
app.get("/api/branches/:id/detail", branchDetailRoute(engine));
app.get("/api/branches/:id/pickers", branchPickersRoute());
app.delete("/api/branches/:id", requireCapability("delete_branch_mappings"), deleteBranchRoute);

app.get("/api/dashboard", dashboardRoute(engine));
app.get("/api/performance", performanceSummaryRoute(engine));
app.get("/api/performance/trends", performanceTrendRoute());
app.post("/api/performance/trends", performanceTrendRoute());
app.get("/api/performance/branches/:id", performanceBranchDetailRoute(engine));
app.get("/api/performance/vendors/:id", performanceVendorDetailRoute());
app.get("/api/performance/preferences", getPerformancePreferencesRoute);
app.put("/api/performance/preferences/current", putPerformanceCurrentPreferencesRoute);
app.post("/api/performance/preferences/groups", createPerformanceGroupRoute);
app.patch("/api/performance/preferences/groups/:id", updatePerformanceGroupRoute);
app.delete("/api/performance/preferences/groups/:id", deletePerformanceGroupRoute);
app.post("/api/performance/preferences/views", createPerformanceViewRoute);
app.patch("/api/performance/preferences/views/:id", updatePerformanceViewRoute);
app.delete("/api/performance/preferences/views/:id", deletePerformanceViewRoute);
app.get("/api/logs", logsRoute);
app.delete("/api/logs", requireCapability("clear_logs"), clearLogsRoute);
app.get("/api/reports/monitor-actions.csv", downloadMonitorReportRoute);

app.post("/api/monitor/start", requireCapability("manage_monitor"), startMonitorRoute(engine));
app.post("/api/monitor/stop", requireCapability("manage_monitor"), stopMonitorRoute(engine));
app.get("/api/monitor/status", monitorStatusRoute(engine));
app.post("/api/monitor/refresh-orders", requireCapability("refresh_monitor_orders"), refreshOrdersNowRoute(engine));
app.get("/api/stream", streamRoute(engine, {
  maxConnectionsPerUser: securityConfig.maxStreamConnectionsPerUser,
  maxTotalConnections: securityConfig.maxStreamConnectionsTotal,
}));

app.use("/api", (_req, res) => {
  res.status(404).json({
    ok: false,
    message: "Not found",
  });
});

const runtimeEntryPath = fileURLToPath(import.meta.url);
const isCompiledRuntime = runtimeEntryPath.includes(`${path.sep}dist${path.sep}`);
const isProductionRuntime = isCompiledRuntime && process.env.NODE_ENV?.trim().toLowerCase() === "production";

if (isProductionRuntime) {
  const webDistDir = resolveWebDistDir();
  const webIndexPath = path.join(webDistDir, "index.html");

  if (!fs.existsSync(webIndexPath)) {
    throw new Error(
      `Missing frontend build output at ${webIndexPath}. Run "npm run build" before starting production.`,
    );
  }

  const assetDirPrefix = `assets${path.sep}`;
  app.use(express.static(webDistDir, {
    index: false,
    fallthrough: true,
    setHeaders(res, filePath) {
      const relativePath = path.relative(webDistDir, filePath);
      if (relativePath === "index.html") {
        res.setHeader("Cache-Control", "no-cache");
        return;
      }

      if (relativePath.startsWith(assetDirPrefix)) {
        res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
      }
    },
  }));

  app.get("*", (req, res, next) => {
    if (req.path.startsWith("/api/")) {
      next();
      return;
    }

    if (path.extname(req.path)) {
      next();
      return;
    }

    const acceptsHtml = typeof req.headers.accept === "string" && req.headers.accept.includes("text/html");
    const isLinkPreview = looksLikeLinkPreviewBot(typeof req.headers["user-agent"] === "string" ? req.headers["user-agent"] : undefined);
    if (!acceptsHtml && !isLinkPreview) {
      next();
      return;
    }

    res.setHeader("Cache-Control", "no-cache");
    res.sendFile(webIndexPath);
  });
}

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
const server = app.listen(port, () => {
  console.log(`UPuse server listening on http://localhost:${port}`);
});

attachDashboardWebSocketServer({
  server,
  engine,
  securityConfig,
});

attachPerformanceWebSocketServer({
  server,
  engine,
  securityConfig,
});
