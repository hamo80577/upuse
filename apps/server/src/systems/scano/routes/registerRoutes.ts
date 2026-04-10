import { requireScanoAccess, requireScanoAdmin, requireScanoLeadAccess, requireScanoTaskManager } from "../policies/access.js";
import {
  completeScanoTaskRoute,
  confirmScanoTaskExportDownloadRoute,
  createScanoMasterProductRoute,
  createScanoTaskExportRoute,
  createScanoTaskProductRoute,
  createScanoTaskRoute,
  createScanoTeamRoute,
  createScanoTaskScanRoute,
  deleteScanoMasterProductRoute,
  deleteScanoTaskRoute,
  deleteScanoTeamRoute,
  downloadScanoTaskExportRoute,
  endScanoTaskRoute,
  getScanoMasterProductRoute,
  getScanoRunnerBootstrapRoute,
  getScanoSettingsRoute,
  getScanoTaskDetailRoute,
  getScanoTaskProductImageRoute,
  getScanoTaskProductRoute,
  hydrateScanoRunnerExternalProductRoute,
  listScanoBranchesRoute,
  listScanoChainsRoute,
  listScanoMasterProductsRoute,
  listScanoTaskProductsRoute,
  listScanoTaskScansRoute,
  listScanoTasksRoute,
  listScanoTeamRoute,
  previewScanoMasterProductsRoute,
  resumeScanoMasterProductRoute,
  resumeScanoTaskRoute,
  scanoMasterProductUpload,
  scanoTaskProductImagesUpload,
  searchScanoRunnerExternalProductsRoute,
  startScanoTaskRoute,
  testScanoSettingsRoute,
  updateScanoMasterProductRoute,
  updateScanoSettingsRoute,
  updateScanoTaskAssigneesRoute,
  updateScanoTaskProductRoute,
  updateScanoTaskRoute,
  updateScanoTeamRoute,
} from "../../../routes/scano.js";
import type { ServerSystemDependencies } from "../../../core/systems/types.js";

export function registerScanoRoutes({ app }: ServerSystemDependencies) {
  app.get("/api/scano/chains", requireScanoLeadAccess(), listScanoChainsRoute);
  app.get("/api/scano/branches", requireScanoTaskManager(), listScanoBranchesRoute);
  app.get("/api/scano/master-products", requireScanoLeadAccess(), listScanoMasterProductsRoute);
  app.post("/api/scano/master-products/preview", requireScanoLeadAccess(), scanoMasterProductUpload, previewScanoMasterProductsRoute);
  app.post("/api/scano/master-products", requireScanoLeadAccess(), scanoMasterProductUpload, createScanoMasterProductRoute);
  app.get("/api/scano/master-products/:chainId", requireScanoLeadAccess(), getScanoMasterProductRoute);
  app.post("/api/scano/master-products/:chainId/resume", requireScanoLeadAccess(), resumeScanoMasterProductRoute);
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
}
