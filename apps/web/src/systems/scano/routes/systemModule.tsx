import Inventory2RoundedIcon from "@mui/icons-material/Inventory2Rounded";
import QrCodeScannerRoundedIcon from "@mui/icons-material/QrCodeScannerRounded";
import SettingsIcon from "@mui/icons-material/Settings";
import { lazy } from "react";
import { Navigate, Route } from "react-router-dom";
import type { WebSystemModule } from "../../../core/systems/types";
import { SystemRoute } from "../../../app/router/guards";
import { ScanoAdminRoute, ScanoManagerRoute, ScanoScannerRoute } from "./ScanoRouteGuards";

const ScanoPage = lazy(() =>
  import("../pages/scano/ui/ScanoPage").then((module) => ({ default: module.ScanoPage })),
);
const ScanoMyTasksPage = lazy(() =>
  import("../pages/scano/ui/ScanoMyTasksPage").then((module) => ({ default: module.ScanoMyTasksPage })),
);
const ScanoTaskProfilePage = lazy(() =>
  import("../pages/scano/ui/ScanoTaskProfilePage").then((module) => ({ default: module.ScanoTaskProfilePage })),
);
const ScanoTaskRunnerPage = lazy(() =>
  import("../pages/scano/ui/ScanoTaskRunnerPage").then((module) => ({ default: module.ScanoTaskRunnerPage })),
);
const ScanoSettingsPage = lazy(() =>
  import("../pages/scano/ui/ScanoSettingsPage").then((module) => ({ default: module.ScanoSettingsPage })),
);
const ScanoMasterProductPage = lazy(() =>
  import("../pages/scano/ui/ScanoMasterProductPage").then((module) => ({ default: module.ScanoMasterProductPage })),
);

function resolveScanoHomePath(canManageScanoTasks: boolean) {
  return canManageScanoTasks ? "/scano/assign-task" : "/scano/my-tasks";
}

function activeGroup(pathname: string, path: string) {
  return pathname === path || pathname.startsWith(`${path}/`);
}

export const scanoSystemModule: WebSystemModule = {
  id: "scano",
  label: "Scano",
  basePath: "/scano",
  canAccess: (auth) => auth.canAccessScano,
  resolveHomePath: (auth) => resolveScanoHomePath(auth.canManageScanoTasks),
  getNavigation: (auth, location) => [
    ...(auth.canManageScanoTasks ? [{
      key: "assign-task",
      label: "Assign Task",
      caption: "Scano tasks",
      path: "/scano/assign-task",
      icon: <QrCodeScannerRoundedIcon fontSize="small" />,
      isActive: location.pathname === "/scano/assign-task" || activeGroup(location.pathname, "/scano/tasks"),
    }, {
      key: "master-product",
      label: "Master Product",
      caption: "Chain imports",
      path: "/scano/master-product",
      icon: <Inventory2RoundedIcon fontSize="small" />,
      isActive: location.pathname === "/scano/master-product",
    }] : []),
    ...(!auth.canManageScanoTasks && auth.scanoRole === "scanner" ? [{
      key: "my-tasks",
      label: "My Tasks",
      caption: "Assigned work",
      path: "/scano/my-tasks",
      icon: <QrCodeScannerRoundedIcon fontSize="small" />,
      isActive: location.pathname === "/scano/my-tasks" || activeGroup(location.pathname, "/scano/tasks"),
    }] : []),
    ...(auth.canManageScanoSettings ? [{
      key: "settings",
      label: "Scano Settings",
      caption: "Catalog token",
      path: "/scano/settings",
      icon: <SettingsIcon fontSize="small" />,
      isActive: location.pathname === "/scano/settings",
    }] : []),
  ],
  getRoutes: (context) => [
    <Route
      key="scano-root"
      path="/scano"
      element={(
        <SystemRoute systemId="scano">
          <Navigate to={resolveScanoHomePath(context.auth.canManageScanoTasks)} replace />
        </SystemRoute>
      )}
    />,
    <Route
      key="scano-assign"
      path="/scano/assign-task"
      element={(
        <SystemRoute systemId="scano">
          <ScanoManagerRoute>
            <ScanoPage />
          </ScanoManagerRoute>
        </SystemRoute>
      )}
    />,
    <Route
      key="scano-master-product"
      path="/scano/master-product"
      element={(
        <SystemRoute systemId="scano">
          <ScanoManagerRoute>
            <ScanoMasterProductPage />
          </ScanoManagerRoute>
        </SystemRoute>
      )}
    />,
    <Route
      key="scano-my-tasks"
      path="/scano/my-tasks"
      element={(
        <SystemRoute systemId="scano">
          <ScanoScannerRoute>
            <ScanoMyTasksPage />
          </ScanoScannerRoute>
        </SystemRoute>
      )}
    />,
    <Route
      key="scano-task-profile"
      path="/scano/tasks/:id"
      element={(
        <SystemRoute systemId="scano">
          <ScanoTaskProfilePage />
        </SystemRoute>
      )}
    />,
    <Route
      key="scano-task-runner"
      path="/scano/tasks/:id/run"
      element={(
        <SystemRoute systemId="scano">
          <ScanoScannerRoute>
            <ScanoTaskRunnerPage />
          </ScanoScannerRoute>
        </SystemRoute>
      )}
    />,
    <Route
      key="scano-settings"
      path="/scano/settings"
      element={(
        <SystemRoute systemId="scano">
          <ScanoAdminRoute>
            <ScanoSettingsPage />
          </ScanoAdminRoute>
        </SystemRoute>
      )}
    />,
    <Route
      key="scano-fallback"
      path="/scano/*"
      element={(
        <SystemRoute systemId="scano">
          <Navigate to={resolveScanoHomePath(context.auth.canManageScanoTasks)} replace />
        </SystemRoute>
      )}
    />,
  ],
};
