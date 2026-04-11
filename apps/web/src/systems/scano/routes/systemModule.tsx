import Inventory2RoundedIcon from "@mui/icons-material/Inventory2Rounded";
import QrCodeScannerRoundedIcon from "@mui/icons-material/QrCodeScannerRounded";
import SettingsIcon from "@mui/icons-material/Settings";
import { lazy } from "react";
import { Navigate, Route } from "react-router-dom";
import type { WebSystemModule } from "../../../core/systems/types";
import { CapabilityRoute, SystemRoute } from "../../../app/router/guards";
import {
  SCANO_MASTER_PRODUCTS_MANAGE_CAPABILITY,
  SCANO_SETTINGS_MANAGE_CAPABILITY,
  SCANO_TASKS_MANAGE_CAPABILITY,
  SCANO_TASKS_RUN_ASSIGNED_CAPABILITY,
} from "./capabilities";

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

function hasCapability(auth: Parameters<WebSystemModule["getNavigation"]>[0], capability: string) {
  return auth.hasSystemCapability("scano", capability);
}

function resolveScanoHomePath(canManageTasks: boolean) {
  return canManageTasks ? "/scano/assign-task" : "/scano/my-tasks";
}

function activeGroup(pathname: string, path: string) {
  return pathname === path || pathname.startsWith(`${path}/`);
}

export const scanoSystemModule: WebSystemModule = {
  id: "scano",
  label: "Scano",
  basePath: "/scano",
  switcher: {
    icon: <QrCodeScannerRoundedIcon fontSize="small" />,
    description: "Standalone workspace",
    loadingTitle: "Opening Scano",
  },
  resolveAccess: (user) => {
    const isPrimaryAdmin = user?.isPrimaryAdmin === true;
    const role = user?.scanoRole ?? null;
    const canManageTasks = isPrimaryAdmin || role === "team_lead";
    const capabilities = [
      ...(canManageTasks ? [SCANO_TASKS_MANAGE_CAPABILITY, SCANO_MASTER_PRODUCTS_MANAGE_CAPABILITY] : []),
      ...(role === "scanner" ? [SCANO_TASKS_RUN_ASSIGNED_CAPABILITY] : []),
      ...(isPrimaryAdmin ? [SCANO_SETTINGS_MANAGE_CAPABILITY] : []),
    ];

    return {
      enabled: isPrimaryAdmin || role === "team_lead" || role === "scanner",
      role,
      roleLabel: isPrimaryAdmin
        ? "Scano Admin"
        : role === "team_lead"
          ? "Scano Team Lead"
          : role === "scanner"
            ? "Scano Scanner"
            : null,
      capabilities,
    };
  },
  canAccess: (auth) => auth.hasSystemAccess("scano"),
  resolveHomePath: (auth) => resolveScanoHomePath(hasCapability(auth, SCANO_TASKS_MANAGE_CAPABILITY)),
  getNavigation: (auth, location) => [
    ...(hasCapability(auth, SCANO_TASKS_MANAGE_CAPABILITY) ? [{
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
    ...(!hasCapability(auth, SCANO_TASKS_MANAGE_CAPABILITY) && hasCapability(auth, SCANO_TASKS_RUN_ASSIGNED_CAPABILITY) ? [{
      key: "my-tasks",
      label: "My Tasks",
      caption: "Assigned work",
      path: "/scano/my-tasks",
      icon: <QrCodeScannerRoundedIcon fontSize="small" />,
      isActive: location.pathname === "/scano/my-tasks" || activeGroup(location.pathname, "/scano/tasks"),
    }] : []),
    ...(hasCapability(auth, SCANO_SETTINGS_MANAGE_CAPABILITY) ? [{
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
          <Navigate to={resolveScanoHomePath(hasCapability(context.auth, SCANO_TASKS_MANAGE_CAPABILITY))} replace />
        </SystemRoute>
      )}
    />,
    <Route
      key="scano-assign"
      path="/scano/assign-task"
      element={(
        <SystemRoute systemId="scano">
          <CapabilityRoute systemId="scano" capability={SCANO_TASKS_MANAGE_CAPABILITY} fallbackPath="/scano/my-tasks">
            <ScanoPage />
          </CapabilityRoute>
        </SystemRoute>
      )}
    />,
    <Route
      key="scano-master-product"
      path="/scano/master-product"
      element={(
        <SystemRoute systemId="scano">
          <CapabilityRoute systemId="scano" capability={SCANO_TASKS_MANAGE_CAPABILITY} fallbackPath="/scano/my-tasks">
            <ScanoMasterProductPage />
          </CapabilityRoute>
        </SystemRoute>
      )}
    />,
    <Route
      key="scano-my-tasks"
      path="/scano/my-tasks"
      element={(
        <SystemRoute systemId="scano">
          <CapabilityRoute systemId="scano" capability={SCANO_TASKS_RUN_ASSIGNED_CAPABILITY} fallbackPath={resolveScanoHomePath(hasCapability(context.auth, SCANO_TASKS_MANAGE_CAPABILITY))}>
            <ScanoMyTasksPage />
          </CapabilityRoute>
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
          <CapabilityRoute systemId="scano" capability={SCANO_TASKS_RUN_ASSIGNED_CAPABILITY} fallbackPath={resolveScanoHomePath(hasCapability(context.auth, SCANO_TASKS_MANAGE_CAPABILITY))}>
            <ScanoTaskRunnerPage />
          </CapabilityRoute>
        </SystemRoute>
      )}
    />,
    <Route
      key="scano-settings"
      path="/scano/settings"
      element={(
        <SystemRoute systemId="scano">
          <CapabilityRoute systemId="scano" capability={SCANO_SETTINGS_MANAGE_CAPABILITY} fallbackPath={resolveScanoHomePath(hasCapability(context.auth, SCANO_TASKS_MANAGE_CAPABILITY))}>
            <ScanoSettingsPage />
          </CapabilityRoute>
        </SystemRoute>
      )}
    />,
    <Route
      key="scano-fallback"
      path="/scano/*"
      element={(
        <SystemRoute systemId="scano">
          <Navigate to={resolveScanoHomePath(hasCapability(context.auth, SCANO_TASKS_MANAGE_CAPABILITY))} replace />
        </SystemRoute>
      )}
    />,
  ],
};
