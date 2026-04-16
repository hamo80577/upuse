import AdminPanelSettingsRoundedIcon from "@mui/icons-material/AdminPanelSettingsRounded";
import InsightsRoundedIcon from "@mui/icons-material/InsightsRounded";
import { lazy } from "react";
import { Navigate, Route } from "react-router-dom";
import type { WebSystemModule } from "../../../core/systems/types";
import { SystemRoute } from "../../../app/router/guards";
import { OpsRouteShell } from "./OpsRouteShell";

const OpsOverviewPage = lazy(() =>
  import("../pages/overview/ui/OpsOverviewPage").then((module) => ({ default: module.OpsOverviewPage })),
);

export const opsSystemModule: WebSystemModule = {
  id: "ops",
  label: "Ops Center",
  basePath: "/ops",
  switcher: {
    icon: <AdminPanelSettingsRoundedIcon fontSize="small" />,
    description: "Admin command center",
    loadingTitle: "Opening Ops Center",
  },
  resolveAccess: (user) => {
    const enabled = user?.isPrimaryAdmin === true;

    return {
      enabled,
      role: enabled ? "primary_admin" : null,
      roleLabel: enabled ? "Primary Admin" : null,
      capabilities: [],
    };
  },
  canAccess: (auth) => auth.hasSystemAccess("ops"),
  resolveHomePath: () => "/ops",
  getNavigation: (_auth, location) => [
    {
      key: "overview",
      label: "Overview",
      caption: "Admin command center",
      path: "/ops",
      icon: <InsightsRoundedIcon fontSize="small" />,
      isActive: location.pathname === "/ops" || location.pathname.startsWith("/ops/"),
    },
  ],
  getRoutes: () => [
    <Route
      key="ops-root"
      path="/ops"
      element={(
        <SystemRoute systemId="ops">
          <OpsRouteShell />
        </SystemRoute>
      )}
    >
      <Route index element={<OpsOverviewPage />} />
    </Route>,
    <Route
      key="ops-fallback"
      path="/ops/*"
      element={(
        <SystemRoute systemId="ops">
          <Navigate to="/ops" replace />
        </SystemRoute>
      )}
    />,
  ],
};
