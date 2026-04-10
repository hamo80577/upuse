import HubIcon from "@mui/icons-material/Hub";
import LeaderboardRoundedIcon from "@mui/icons-material/LeaderboardRounded";
import SettingsIcon from "@mui/icons-material/Settings";
import StorefrontIcon from "@mui/icons-material/Storefront";
import TuneRoundedIcon from "@mui/icons-material/TuneRounded";
import { lazy } from "react";
import { Route } from "react-router-dom";
import type { WebSystemModule } from "../../../core/systems/types";
import { SystemRoute, UpuseAdminRoute } from "../../../app/router/guards";
import { UpuseRouteShell } from "./UpuseRouteShell";

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

export const upuseSystemModule: WebSystemModule = {
  id: "upuse",
  label: "UPuse",
  basePath: "/",
  canAccess: (auth) => auth.canAccessUpuse,
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
          <UpuseAdminRoute>
            <UsersPage />
          </UpuseAdminRoute>
        )}
      />
    </Route>,
  ],
};
