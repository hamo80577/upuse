import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import multer from "multer";
import morgan from "morgan";
import { ZodError } from "zod";

import { migrate } from "./config/db.js";
import { getEnv } from "./config/env.js";
import { resolveWebDistDir } from "./config/paths.js";
import { resolveSecurityConfig } from "./config/security.js";
import { resolveStartupConfig } from "./config/startup.js";
import { getSettings } from "./services/settingsStore.js";
import { initializeLoginThrottleStore } from "./services/loginThrottleStore.js";
import { startOrdersMirrorRuntime } from "./services/ordersMirrorStore.js";
import { initializeScanoRunnerSessionStore } from "./services/scanoRunnerSessionStore.js";
import { attachDashboardWebSocketServer } from "./http/dashboardWebSocket.js";
import { attachPerformanceWebSocketServer } from "./http/performanceWebSocket.js";
import {
  createApiNoStoreMiddleware,
  createContentSecurityPolicyDirectives,
  createCorsOptions,
  createCspNonceMiddleware,
  createTrustedOriginMiddleware,
} from "./http/security.js";
import { createSessionAuthMiddleware, requireAdminRole, requireAuthenticatedApi, requireCapability, requireScanoAccess, requireScanoAdmin, requireScanoLeadAccess, requireScanoTaskManager, requireUpuseAccess } from "./http/auth.js";
import { MonitorEngine } from "./monitor/index.js";

import { health, readiness } from "./routes/health.js";
import { createUserRoute, deleteUserRoute, listUsersRoute, loginRoute, logoutRoute, meRoute, updateUserRoute } from "./routes/auth.js";
import { getSettingsRoute, getTokenTestRoute, putSettingsRoute, testTokensRoute } from "./routes/settings.js";
import { listBranchesRoute, listVendorSourceRoute, addBranchRoute, updateBranchThresholdOverridesRoute, updateBranchMonitoringRoute, branchDetailRoute, branchPickersRoute, deleteBranchRoute } from "./routes/branches.js";
import { dashboardRoute } from "./routes/dashboard.js";
import { clearLogsRoute, logsRoute } from "./routes/logs.js";
import { performanceBranchDetailRoute, performanceSummaryRoute, performanceTrendRoute, performanceVendorDetailRoute } from "./routes/performance.js";
import {
  completeScanoTaskRoute,
  createScanoTaskRoute,
  createScanoTaskExportRoute,
  createScanoTaskProductRoute,
  createScanoTaskScanRoute,
  createScanoTeamRoute,
  createScanoMasterProductRoute,
  deleteScanoTaskRoute,
  deleteScanoTeamRoute,
  deleteScanoMasterProductRoute,
  downloadScanoTaskExportRoute,
  endScanoTaskRoute,
  getScanoRunnerBootstrapRoute,
  getScanoSettingsRoute,
  getScanoTaskDetailRoute,
  getScanoTaskProductImageRoute,
  getScanoTaskProductRoute,
  getScanoMasterProductRoute,
  hydrateScanoRunnerExternalProductRoute,
  listScanoBranchesRoute,
  listScanoChainsRoute,
  listScanoMasterProductsRoute,
  listScanoTaskProductsRoute,
  listScanoTaskScansRoute,
  listScanoTasksRoute,
  listScanoTeamRoute,
  previewScanoMasterProductsRoute,
  resumeScanoTaskRoute,
  searchScanoRunnerExternalProductsRoute,
  scanoMasterProductUpload,
  scanoTaskProductImagesUpload,
  startScanoTaskRoute,
  testScanoSettingsRoute,
  confirmScanoTaskExportDownloadRoute,
  updateScanoMasterProductRoute,
  updateScanoTaskAssigneesRoute,
  updateScanoTaskProductRoute,
  updateScanoTaskRoute,
  updateScanoSettingsRoute,
  updateScanoTeamRoute,
} from "./routes/scano.js";
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
initializeLoginThrottleStore();
initializeScanoRunnerSessionStore();
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

app.get("/api/settings", requireUpuseAccess(), getSettingsRoute);
app.put("/api/settings", requireUpuseAccess(), putSettingsRoute);
app.post("/api/settings/test", requireCapability("test_settings_tokens"), testTokensRoute);
app.get("/api/settings/test/:jobId", requireCapability("test_settings_tokens"), getTokenTestRoute);

app.get("/api/branches", requireUpuseAccess(), listBranchesRoute);
app.get("/api/branches/source", requireUpuseAccess(), listVendorSourceRoute);
app.post("/api/branches", requireCapability("manage_branch_mappings"), addBranchRoute);
app.patch("/api/branches/:id/threshold-overrides", requireCapability("manage_thresholds"), updateBranchThresholdOverridesRoute);
app.patch("/api/branches/:id/monitoring", requireCapability("manage_branch_mappings"), updateBranchMonitoringRoute(engine));
app.get("/api/branches/:id/detail", requireUpuseAccess(), branchDetailRoute(engine));
app.get("/api/branches/:id/pickers", requireUpuseAccess(), branchPickersRoute());
app.delete("/api/branches/:id", requireCapability("delete_branch_mappings"), deleteBranchRoute);

app.get("/api/dashboard", requireUpuseAccess(), dashboardRoute(engine));
app.get("/api/performance", requireUpuseAccess(), performanceSummaryRoute(engine));
app.get("/api/performance/trends", requireUpuseAccess(), performanceTrendRoute());
app.post("/api/performance/trends", requireUpuseAccess(), performanceTrendRoute());
app.get("/api/performance/branches/:id", requireUpuseAccess(), performanceBranchDetailRoute(engine));
app.get("/api/performance/vendors/:id", requireUpuseAccess(), performanceVendorDetailRoute());
app.get("/api/performance/preferences", requireUpuseAccess(), getPerformancePreferencesRoute);
app.put("/api/performance/preferences/current", requireUpuseAccess(), putPerformanceCurrentPreferencesRoute);
app.post("/api/performance/preferences/groups", requireUpuseAccess(), createPerformanceGroupRoute);
app.patch("/api/performance/preferences/groups/:id", requireUpuseAccess(), updatePerformanceGroupRoute);
app.delete("/api/performance/preferences/groups/:id", requireUpuseAccess(), deletePerformanceGroupRoute);
app.post("/api/performance/preferences/views", requireUpuseAccess(), createPerformanceViewRoute);
app.patch("/api/performance/preferences/views/:id", requireUpuseAccess(), updatePerformanceViewRoute);
app.delete("/api/performance/preferences/views/:id", requireUpuseAccess(), deletePerformanceViewRoute);
app.get("/api/logs", requireUpuseAccess(), logsRoute);
app.delete("/api/logs", requireCapability("clear_logs"), clearLogsRoute);
app.get("/api/reports/monitor-actions.csv", requireUpuseAccess(), downloadMonitorReportRoute);

app.get("/api/scano/chains", requireScanoLeadAccess(), listScanoChainsRoute);
app.get("/api/scano/branches", requireScanoTaskManager(), listScanoBranchesRoute);
app.get("/api/scano/master-products", requireScanoLeadAccess(), listScanoMasterProductsRoute);
app.post("/api/scano/master-products/preview", requireScanoLeadAccess(), scanoMasterProductUpload, previewScanoMasterProductsRoute);
app.post("/api/scano/master-products", requireScanoLeadAccess(), scanoMasterProductUpload, createScanoMasterProductRoute);
app.get("/api/scano/master-products/:chainId", requireScanoLeadAccess(), getScanoMasterProductRoute);
app.put("/api/scano/master-products/:chainId", requireScanoLeadAccess(), scanoMasterProductUpload, updateScanoMasterProductRoute);
app.delete("/api/scano/master-products/:chainId", requireScanoLeadAccess(), deleteScanoMasterProductRoute);
app.get("/api/scano/tasks", requireScanoAccess(), listScanoTasksRoute);
app.get("/api/scano/tasks/:id", requireScanoAccess(), getScanoTaskDetailRoute);
app.get("/api/scano/tasks/:id/runner/bootstrap", requireScanoAccess(), getScanoRunnerBootstrapRoute);
app.post("/api/scano/tasks/:id/runner/search", requireScanoAccess(), searchScanoRunnerExternalProductsRoute);
app.post("/api/scano/tasks/:id/runner/hydrate", requireScanoAccess(), hydrateScanoRunnerExternalProductRoute);
app.get("/api/scano/tasks/:id/products", requireScanoAccess(), listScanoTaskProductsRoute);
app.get("/api/scano/tasks/:id/scans", requireScanoAccess(), listScanoTaskScansRoute);
app.post("/api/scano/tasks", requireScanoTaskManager(), createScanoTaskRoute);
app.patch("/api/scano/tasks/:id", requireScanoTaskManager(), updateScanoTaskRoute);
app.delete("/api/scano/tasks/:id", requireScanoLeadAccess(), deleteScanoTaskRoute);
app.post("/api/scano/tasks/:id/start", requireScanoAccess(), startScanoTaskRoute);
app.post("/api/scano/tasks/:id/end", requireScanoAccess(), endScanoTaskRoute);
app.post("/api/scano/tasks/:id/resume", requireScanoAccess(), resumeScanoTaskRoute);
app.post("/api/scano/tasks/:id/complete", requireScanoLeadAccess(), completeScanoTaskRoute);
app.patch("/api/scano/tasks/:id/assignees", requireScanoTaskManager(), updateScanoTaskAssigneesRoute);
app.post("/api/scano/tasks/:id/scans/resolve", requireScanoAccess(), createScanoTaskScanRoute);
app.post("/api/scano/tasks/:id/products", requireScanoAccess(), scanoTaskProductImagesUpload, createScanoTaskProductRoute);
app.patch("/api/scano/tasks/:id/products/:productId", requireScanoAccess(), scanoTaskProductImagesUpload, updateScanoTaskProductRoute);
app.get("/api/scano/tasks/:id/products/:productId", requireScanoAccess(), getScanoTaskProductRoute);
app.get("/api/scano/tasks/:id/products/:productId/images/:imageId", requireScanoAccess(), getScanoTaskProductImageRoute);
app.post("/api/scano/tasks/:id/exports", requireScanoLeadAccess(), createScanoTaskExportRoute);
app.get("/api/scano/tasks/:id/exports/:exportId/download", requireScanoLeadAccess(), downloadScanoTaskExportRoute);
app.post("/api/scano/tasks/:id/exports/:exportId/confirm-download", requireScanoLeadAccess(), confirmScanoTaskExportDownloadRoute);
app.get("/api/scano/team", requireScanoTaskManager(), listScanoTeamRoute);
app.post("/api/scano/team", requireScanoAdmin(), createScanoTeamRoute);
app.patch("/api/scano/team/:id", requireScanoAdmin(), updateScanoTeamRoute);
app.delete("/api/scano/team/:id", requireScanoAdmin(), deleteScanoTeamRoute);
app.get("/api/scano/settings", requireScanoAdmin(), getScanoSettingsRoute);
app.put("/api/scano/settings", requireScanoAdmin(), updateScanoSettingsRoute);
app.post("/api/scano/settings/test", requireScanoAdmin(), testScanoSettingsRoute);

app.post("/api/monitor/start", requireCapability("manage_monitor"), startMonitorRoute(engine));
app.post("/api/monitor/stop", requireCapability("manage_monitor"), stopMonitorRoute(engine));
app.get("/api/monitor/status", requireUpuseAccess(), monitorStatusRoute(engine));
app.post("/api/monitor/refresh-orders", requireCapability("refresh_monitor_orders"), refreshOrdersNowRoute(engine));
app.get("/api/stream", requireUpuseAccess(), streamRoute(engine, {
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
      code: "VALIDATION_ERROR",
      errorOrigin: "validation",
      issues: error.issues.map((issue) => issue.message),
    });
    return;
  }

  if (error instanceof multer.MulterError) {
    res.status(400).json({
      ok: false,
      message: error.message || "Invalid uploaded file",
      code: "UPLOAD_ERROR",
      errorOrigin: "validation",
    });
    return;
  }

  const typedError = error as {
    status?: unknown;
    message?: unknown;
    code?: unknown;
    errorOrigin?: unknown;
    integration?: unknown;
    exposeMessage?: unknown;
  };
  const status =
    typeof typedError.status === "number" &&
    typedError.status >= 400 &&
    typedError.status < 600
      ? typedError.status
      : 500;
  if (status >= 500) {
    console.error("Unhandled API error", error);
  }
  const errorOrigin =
    typedError.errorOrigin === "session" ||
    typedError.errorOrigin === "authorization" ||
    typedError.errorOrigin === "integration" ||
    typedError.errorOrigin === "validation" ||
    typedError.errorOrigin === "server"
      ? typedError.errorOrigin
      : status === 401
        ? "session"
        : status === 403
          ? "authorization"
          : "server";
  const code = typeof typedError.code === "string" ? typedError.code : undefined;
  const integration = typeof typedError.integration === "string" ? typedError.integration : undefined;
  const message =
    status >= 500 && typedError.exposeMessage !== true
      ? "Internal server error"
      : (typeof typedError.message === "string" && typedError.message.length
        ? typedError.message
        : "Request failed");

  res.status(status).json({
    ok: false,
    message,
    ...(code ? { code } : {}),
    ...(errorOrigin ? { errorOrigin } : {}),
    ...(integration ? { integration } : {}),
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
