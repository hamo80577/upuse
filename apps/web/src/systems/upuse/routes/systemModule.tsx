import HubIcon from "@mui/icons-material/Hub";
import LeaderboardRoundedIcon from "@mui/icons-material/LeaderboardRounded";
import SettingsIcon from "@mui/icons-material/Settings";
import StorefrontIcon from "@mui/icons-material/Storefront";
import TuneRoundedIcon from "@mui/icons-material/TuneRounded";
import ManageAccountsRoundedIcon from "@mui/icons-material/ManageAccountsRounded";
import { lazy } from "react";
import { Route } from "react-router-dom";
import type { AppUserRole } from "../../../api/types";
import type { SystemCapability, WebSystemModule } from "../../../core/systems/types";
import { getAppPermissionsForAccess } from "../../../core/systems/permissions/upusePermissions";
import { CapabilityRoute, SystemRoute } from "../../../app/router/guards";
import { UpuseRouteShell } from "./UpuseRouteShell";
import {
  UPUSE_BRANCHES_DELETE_CAPABILITY,
  UPUSE_BRANCHES_MANAGE_CAPABILITY,
  UPUSE_LOGS_CLEAR_CAPABILITY,
  UPUSE_MONITOR_MANAGE_CAPABILITY,
  UPUSE_MONITOR_ORDERS_REFRESH_CAPABILITY,
  UPUSE_SETTINGS_MANAGE_CAPABILITY,
  UPUSE_SETTINGS_TOKENS_MANAGE_CAPABILITY,
  UPUSE_SETTINGS_TOKENS_TEST_CAPABILITY,
  UPUSE_THRESHOLDS_MANAGE_CAPABILITY,
  UPUSE_USERS_MANAGE_CAPABILITY,
} from "./capabilities";

const DashboardPage = lazy(() =>
  import("../pages/dashboard/ui/DashboardPage").then((module) => ({ default: module.DashboardPage })),
);
const SettingsPage = lazy(() =>
  import("../pages/settings/ui/SettingsPage").then((module) => ({ default: module.SettingsPage })),
);
const BranchesPage = lazy(() =>
  import("../pages/branches/ui/BranchesPage").then((module) => ({ default: module.BranchesPage })),
);
const ThresholdsPage = lazy(() =>
  import("../pages/thresholds/ui/ThresholdsPage").then((module) => ({ default: module.ThresholdsPage })),
);
const UsersPage = lazy(() =>
  import("../pages/users/ui/UsersPage").then((module) => ({ default: module.UsersPage })),
);
const PerformancePage = lazy(() =>
  import("../pages/performance/ui/PerformancePage").then((module) => ({ default: module.PerformancePage })),
);

function isActivePath(pathname: string, path: string) {
  return pathname === path || pathname.startsWith(`${path}/`);
}

const upuseCapabilityByPermission = {
  canManageUsers: UPUSE_USERS_MANAGE_CAPABILITY,
  canManageMonitor: UPUSE_MONITOR_MANAGE_CAPABILITY,
  canRefreshOrdersNow: UPUSE_MONITOR_ORDERS_REFRESH_CAPABILITY,
  canManageBranches: UPUSE_BRANCHES_MANAGE_CAPABILITY,
  canDeleteBranches: UPUSE_BRANCHES_DELETE_CAPABILITY,
  canManageThresholds: UPUSE_THRESHOLDS_MANAGE_CAPABILITY,
  canManageSettings: UPUSE_SETTINGS_MANAGE_CAPABILITY,
  canManageTokens: UPUSE_SETTINGS_TOKENS_MANAGE_CAPABILITY,
  canTestTokens: UPUSE_SETTINGS_TOKENS_TEST_CAPABILITY,
  canClearLogs: UPUSE_LOGS_CLEAR_CAPABILITY,
} satisfies Record<string, SystemCapability>;

function getUpuseRoleLabel(role?: AppUserRole | null) {
  return role === "admin" ? "Admin" : "User";
}

export const upuseSystemModule: WebSystemModule = {
  id: "upuse",
  label: "UPuse",
  basePath: "/",
  switcher: {
    icon: <HubIcon fontSize="small" />,
    description: "Operations workspace",
    loadingTitle: "Returning to UPuse",
  },
  resolveAccess: (user) => {
    const enabled = user?.upuseAccess === true;
    const permissions = getAppPermissionsForAccess(user?.role, enabled);
    const capabilities = Object.entries(upuseCapabilityByPermission)
      .filter(([permissionKey]) => permissions[permissionKey as keyof typeof permissions] === true)
      .map(([, capability]) => capability);

    return {
      enabled,
      role: user?.role ?? null,
      roleLabel: getUpuseRoleLabel(user?.role),
      capabilities,
    };
  },
  canAccess: (auth) => auth.hasSystemAccess("upuse"),
  resolveHomePath: () => "/",
  getNavigation: (_auth, location) => [
    {
      key: "dashboard",
      label: "Dashboard",
      caption: "Live board",
      path: "/",
      icon: <HubIcon fontSize="small" />,
      isActive: location.pathname === "/",
    },
    {
      key: "performance",
      label: "Performance",
      caption: "Chains and branches",
      path: "/performance",
      icon: <LeaderboardRoundedIcon fontSize="small" />,
      isActive: location.pathname === "/performance",
    },
    {
      key: "branches",
      label: "Branches",
      caption: "Branch mappings",
      path: "/branches",
      icon: <StorefrontIcon fontSize="small" />,
      isActive: location.pathname === "/branches",
    },
    {
      key: "thresholds",
      label: "Thresholds",
      caption: "Rules and overrides",
      path: "/thresholds",
      icon: <TuneRoundedIcon fontSize="small" />,
      isActive: location.pathname === "/thresholds" || isActivePath(location.pathname, "/settings/thresholds"),
    },
    {
      key: "settings",
      label: "Settings",
      caption: "Tokens and timings",
      path: "/settings",
      icon: <SettingsIcon fontSize="small" />,
      isActive: location.pathname === "/settings",
    },
  ],
  getAccountNavigation: (auth, location) => auth.hasSystemCapability("upuse", UPUSE_USERS_MANAGE_CAPABILITY)
    ? [{
        key: "users",
        label: "User Management",
        caption: "Admin only",
        path: "/users",
        icon: <ManageAccountsRoundedIcon fontSize="small" />,
        isActive: location.pathname === "/users",
        requiredCapability: UPUSE_USERS_MANAGE_CAPABILITY,
      }]
    : [],
  getRoutes: () => [
    <Route
      key="upuse-shell"
      element={(
        <SystemRoute systemId="upuse">
          <UpuseRouteShell />
        </SystemRoute>
      )}
    >
      <Route index element={<DashboardPage />} />
      <Route path="/performance" element={<PerformancePage />} />
      <Route path="/branches" element={<BranchesPage />} />
      <Route path="/thresholds" element={<ThresholdsPage />} />
      <Route path="/settings/thresholds" element={<ThresholdsPage />} />
      <Route path="/settings" element={<SettingsPage />} />
      <Route
        path="/users"
        element={(
          <CapabilityRoute systemId="upuse" capability={UPUSE_USERS_MANAGE_CAPABILITY} fallbackPath="/">
            <UsersPage />
          </CapabilityRoute>
        )}
      />
    </Route>,
  ],
};
