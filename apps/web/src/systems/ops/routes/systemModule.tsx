import AdminPanelSettingsRoundedIcon from "@mui/icons-material/AdminPanelSettingsRounded";
import ErrorOutlineRoundedIcon from "@mui/icons-material/ErrorOutlineRounded";
import InsightsRoundedIcon from "@mui/icons-material/InsightsRounded";
import KeyRoundedIcon from "@mui/icons-material/KeyRounded";
import TimelineRoundedIcon from "@mui/icons-material/TimelineRounded";
import { lazy } from "react";
import { Navigate, Route } from "react-router-dom";
import type { WebSystemModule } from "../../../core/systems/types";
import { SystemRoute } from "../../../app/router/guards";
import { OpsRouteShell } from "./OpsRouteShell";

const OpsOverviewPage = lazy(() =>
  import("../pages/overview/ui/OpsOverviewPage").then((module) => ({ default: module.OpsOverviewPage })),
);
const OpsActivityPage = lazy(() =>
  import("../pages/overview/ui/OpsOverviewPage").then((module) => ({ default: module.OpsActivityPage })),
);
const OpsEventsPage = lazy(() =>
  import("../pages/overview/ui/OpsOverviewPage").then((module) => ({ default: module.OpsEventsPage })),
);
const OpsTokensPage = lazy(() =>
  import("../pages/overview/ui/OpsOverviewPage").then((module) => ({ default: module.OpsTokensPage })),
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
  getNavigation: (_auth, location) => {
    const pathname = location.pathname.replace(/\/+$/, "") || "/ops";
    return [
      {
        key: "overview",
        label: "Overview",
        caption: "Quality and health",
        path: "/ops",
        icon: <InsightsRoundedIcon fontSize="small" />,
        isActive: pathname === "/ops",
      },
      {
        key: "activity",
        label: "Activity",
        caption: "Traffic and sessions",
        path: "/ops/activity",
        icon: <TimelineRoundedIcon fontSize="small" />,
        isActive: pathname === "/ops/activity",
      },
      {
        key: "events",
        label: "Events",
        caption: "Events and errors",
        path: "/ops/events",
        icon: <ErrorOutlineRoundedIcon fontSize="small" />,
        isActive: pathname === "/ops/events",
      },
      {
        key: "tokens",
        label: "Tokens",
        caption: "Integration keys",
        path: "/ops/tokens",
        icon: <KeyRoundedIcon fontSize="small" />,
        isActive: pathname === "/ops/tokens",
      },
    ];
  },
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
      <Route path="activity" element={<OpsActivityPage />} />
      <Route path="events" element={<OpsEventsPage />} />
      <Route path="tokens" element={<OpsTokensPage />} />
      <Route path="*" element={<Navigate to="/ops" replace />} />
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
