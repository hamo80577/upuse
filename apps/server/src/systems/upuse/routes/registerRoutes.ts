import { requireCapability, requireUpuseAccess } from "../policies/access.js";
import {
  addBranchRoute,
  branchDetailRoute,
  branchPickersRoute,
  deleteBranchRoute,
  listBranchesRoute,
  listVendorSourceRoute,
  updateBranchMonitoringRoute,
  updateBranchThresholdOverridesRoute,
} from "../../../routes/branches.js";
import { dashboardRoute } from "../../../routes/dashboard.js";
import { clearLogsRoute, logsRoute } from "../../../routes/logs.js";
import { monitorStatusRoute, refreshOrdersNowRoute, startMonitorRoute, stopMonitorRoute, streamRoute } from "../../../routes/monitor.js";
import { createPerformanceGroupRoute, createPerformanceViewRoute, deletePerformanceGroupRoute, deletePerformanceViewRoute, getPerformancePreferencesRoute, putPerformanceCurrentPreferencesRoute, updatePerformanceGroupRoute, updatePerformanceViewRoute } from "../../../routes/performancePreferences.js";
import { performanceBranchDetailRoute, performanceSummaryRoute, performanceTrendRoute, performanceVendorDetailRoute } from "../../../routes/performance.js";
import { downloadMonitorReportRoute } from "../../../routes/reports.js";
import { getSettingsRoute, getTokenTestRoute, putSettingsRoute, testTokensRoute } from "../../../routes/settings.js";
import type { ServerSystemDependencies } from "../../../core/systems/types.js";

export function registerUpuseRoutes({ app, engine, securityConfig }: ServerSystemDependencies) {
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

  app.post("/api/monitor/start", requireCapability("manage_monitor"), startMonitorRoute(engine));
  app.post("/api/monitor/stop", requireCapability("manage_monitor"), stopMonitorRoute(engine));
  app.get("/api/monitor/status", requireUpuseAccess(), monitorStatusRoute(engine));
  app.post("/api/monitor/refresh-orders", requireCapability("refresh_monitor_orders"), refreshOrdersNowRoute(engine));
  app.get("/api/stream", requireUpuseAccess(), streamRoute(engine, {
    maxConnectionsPerUser: securityConfig.maxStreamConnectionsPerUser,
    maxTotalConnections: securityConfig.maxStreamConnectionsTotal,
  }));
}
