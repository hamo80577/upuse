import { requireCapability, requireFullUpuseAccess, requireUpuseAccess } from "../policies/access.js";
import {
  addBranchRoute,
  branchDetailRoute,
  branchPickersRoute,
  deleteBranchRoute,
  listBranchesRoute,
  listVendorSourceRoute,
  resolveVendorSourceRoute,
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
  app.get("/api/settings", requireFullUpuseAccess(), getSettingsRoute);
  app.put("/api/settings", requireFullUpuseAccess(), putSettingsRoute);
  app.post("/api/settings/test", requireCapability("test_settings_tokens"), testTokensRoute);
  app.get("/api/settings/test/:jobId", requireCapability("test_settings_tokens"), getTokenTestRoute);

  app.get("/api/branches", requireFullUpuseAccess(), listBranchesRoute);
  app.get("/api/branches/source", requireFullUpuseAccess(), listVendorSourceRoute);
  app.post("/api/branches/source/resolve", requireFullUpuseAccess(), resolveVendorSourceRoute);
  app.post("/api/branches", requireCapability("manage_branch_mappings"), addBranchRoute);
  app.patch("/api/branches/:id/threshold-overrides", requireCapability("manage_thresholds"), updateBranchThresholdOverridesRoute);
  app.patch("/api/branches/:id/monitoring", requireCapability("manage_branch_mappings"), updateBranchMonitoringRoute(engine));
  app.get("/api/branches/:id/detail", requireUpuseAccess(), branchDetailRoute(engine));
  app.get("/api/branches/:id/pickers", requireUpuseAccess(), branchPickersRoute());
  app.delete("/api/branches/:id", requireCapability("delete_branch_mappings"), deleteBranchRoute);

  app.get("/api/dashboard", requireUpuseAccess(), dashboardRoute(engine));
  app.get("/api/performance", requireFullUpuseAccess(), performanceSummaryRoute(engine));
  app.get("/api/performance/trends", requireFullUpuseAccess(), performanceTrendRoute());
  app.post("/api/performance/trends", requireFullUpuseAccess(), performanceTrendRoute());
  app.get("/api/performance/branches/:id", requireFullUpuseAccess(), performanceBranchDetailRoute(engine));
  app.get("/api/performance/vendors/:id", requireFullUpuseAccess(), performanceVendorDetailRoute());
  app.get("/api/performance/preferences", requireFullUpuseAccess(), getPerformancePreferencesRoute);
  app.put("/api/performance/preferences/current", requireFullUpuseAccess(), putPerformanceCurrentPreferencesRoute);
  app.post("/api/performance/preferences/groups", requireFullUpuseAccess(), createPerformanceGroupRoute);
  app.patch("/api/performance/preferences/groups/:id", requireFullUpuseAccess(), updatePerformanceGroupRoute);
  app.delete("/api/performance/preferences/groups/:id", requireFullUpuseAccess(), deletePerformanceGroupRoute);
  app.post("/api/performance/preferences/views", requireFullUpuseAccess(), createPerformanceViewRoute);
  app.patch("/api/performance/preferences/views/:id", requireFullUpuseAccess(), updatePerformanceViewRoute);
  app.delete("/api/performance/preferences/views/:id", requireFullUpuseAccess(), deletePerformanceViewRoute);
  app.get("/api/logs", requireUpuseAccess(), logsRoute);
  app.delete("/api/logs", requireCapability("clear_logs"), clearLogsRoute);
  app.get("/api/reports/monitor-actions.csv", requireFullUpuseAccess(), downloadMonitorReportRoute);

  app.post("/api/monitor/start", requireCapability("manage_monitor"), startMonitorRoute(engine));
  app.post("/api/monitor/stop", requireCapability("manage_monitor"), stopMonitorRoute(engine));
  app.get("/api/monitor/status", requireUpuseAccess(), monitorStatusRoute(engine));
  app.post("/api/monitor/refresh-orders", requireCapability("refresh_monitor_orders"), refreshOrdersNowRoute(engine));
  app.get("/api/stream", requireUpuseAccess(), streamRoute(engine, {
    maxConnectionsPerUser: securityConfig.maxStreamConnectionsPerUser,
    maxTotalConnections: securityConfig.maxStreamConnectionsTotal,
  }));
}
