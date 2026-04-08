import { Alert, Box, Button, CircularProgress, Stack, Typography } from "@mui/material";
import { lazy, Suspense, useEffect, useState, type ReactElement } from "react";
import { Navigate, Route, Routes, useLocation, useNavigate, useParams } from "react-router-dom";
import { useAuth } from "./providers/AuthProvider";
import { beginPendingSystemSwitch, clearPendingSystemSwitch, isWorkspaceSystem, readActiveSystem, readPendingSystemSwitch, resolveSystemPath, type WorkspaceSystem, writeActiveSystem } from "./systemNavigation";

const DashboardPage = lazy(() =>
  import("../pages/dashboard/ui/DashboardPage").then((module) => ({ default: module.DashboardPage })),
);
const LoginPage = lazy(() =>
  import("../pages/login/ui/LoginPage").then((module) => ({ default: module.LoginPage })),
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

function SystemSwitchLoadingPage(props: {
  system: WorkspaceSystem;
  title?: string;
  subtitle?: string;
}) {
  const systemLabel = props.system === "scano" ? "Scano" : "UPuse";

  return (
    <Box
      sx={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        px: 2,
        bgcolor: "#f4f7fb",
        background:
          "radial-gradient(circle at top left, rgba(14,165,233,0.12), transparent 28%), radial-gradient(circle at bottom right, rgba(15,23,42,0.08), transparent 32%), linear-gradient(180deg, #f7fafc 0%, #edf4f8 100%)",
      }}
    >
      <Stack spacing={1.35} alignItems="center" sx={{ textAlign: "center", maxWidth: 480 }}>
        <CircularProgress size={34} sx={{ color: "#0f172a" }} />
        <Typography sx={{ fontSize: { xs: 28, md: 34 }, lineHeight: 1, fontWeight: 900, letterSpacing: "-0.04em", color: "#0f172a" }}>
          {props.title ?? `Switching to ${systemLabel}`}
        </Typography>
        <Typography sx={{ color: "#64748b", lineHeight: 1.75 }}>
          {props.subtitle ?? `Preparing the ${systemLabel} workspace and refreshing the session shell.`}
        </Typography>
      </Stack>
    </Box>
  );
}

function RouteFallback() {
  const { bootstrapError, retryBootstrap } = useAuth();

  return (
    <Box
      sx={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        bgcolor: "background.default",
        px: 2,
      }}
    >
      {bootstrapError ? (
        <Stack spacing={1.5} sx={{ width: "100%", maxWidth: 420 }}>
          <Alert severity="error" variant="outlined">
            {bootstrapError}
          </Alert>
          <Button variant="contained" onClick={retryBootstrap}>
            Retry
          </Button>
        </Stack>
      ) : (
        <CircularProgress size={28} />
      )}
    </Box>
  );
}

function ProtectedRoute(props: { children: ReactElement }) {
  const location = useLocation();
  const { status } = useAuth();

  if (status === "loading") {
    return <RouteFallback />;
  }

  if (status !== "authenticated") {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  return props.children;
}

function GuestRoute(props: { children: ReactElement }) {
  const { status, canAccessScano, canAccessUpuse, canManageScanoTasks } = useAuth();
  if (status === "loading") {
    return <RouteFallback />;
  }

  if (status === "authenticated") {
    return <Navigate to={resolveAccessiblePath(canAccessUpuse, canAccessScano, canManageScanoTasks)} replace />;
  }

  return props.children;
}

function WorkspaceRoute(props: { system: WorkspaceSystem; children: ReactElement }) {
  const { canManageScanoTasks } = useAuth();
  const activeSystem = readActiveSystem();

  if (activeSystem !== props.system) {
    if (props.system === "scano" && activeSystem === "upuse") {
      writeActiveSystem("scano");
      return props.children;
    }
    return <Navigate to={resolveSystemPath(activeSystem, { scanoPath: resolveScanoHomePath(canManageScanoTasks) })} replace />;
  }

  return props.children;
}

function resolveScanoHomePath(canManageScanoTasks: boolean) {
  return canManageScanoTasks ? "/scano/assign-task" : "/scano/my-tasks";
}

function resolveAccessiblePath(canAccessUpuse: boolean, canAccessScano: boolean, canManageScanoTasks: boolean) {
  if (canAccessUpuse && !canAccessScano) {
    return "/";
  }
  if (!canAccessUpuse && canAccessScano) {
    return resolveScanoHomePath(canManageScanoTasks);
  }

  return resolveSystemPath(readActiveSystem(), { scanoPath: resolveScanoHomePath(canManageScanoTasks) });
}

function UpuseAccessRoute(props: { children: ReactElement }) {
  const { status, canAccessScano, canAccessUpuse, canManageScanoTasks } = useAuth();

  if (status === "loading") {
    return <RouteFallback />;
  }

  if (!canAccessUpuse) {
    if (readActiveSystem() === "upuse" && canAccessScano) {
      writeActiveSystem("scano");
    }
    return <Navigate to={canAccessScano ? resolveScanoHomePath(canManageScanoTasks) : "/login"} replace />;
  }

  return props.children;
}

function ScanoAccessRoute(props: { children: ReactElement }) {
  const { status, canAccessScano, canAccessUpuse, canManageScanoTasks } = useAuth();

  if (status === "loading") {
    return <RouteFallback />;
  }

  if (!canAccessScano) {
    if (readActiveSystem() === "scano" && canAccessUpuse) {
      writeActiveSystem("upuse");
    }
    return <Navigate to={canAccessUpuse ? "/" : "/login"} replace />;
  }

  return props.children;
}

function ScanoManagerRoute(props: { children: ReactElement }) {
  const { status, canManageScanoTasks } = useAuth();

  if (status === "loading") {
    return <RouteFallback />;
  }

  if (!canManageScanoTasks) {
    return <Navigate to="/scano/my-tasks" replace />;
  }

  return props.children;
}

function ScanoScannerRoute(props: { children: ReactElement }) {
  const { status, scanoRole, canManageScanoTasks } = useAuth();

  if (status === "loading") {
    return <RouteFallback />;
  }

  if (scanoRole !== "scanner") {
    return <Navigate to={resolveScanoHomePath(canManageScanoTasks)} replace />;
  }

  return props.children;
}

function ScanoAdminRoute(props: { children: ReactElement }) {
  const { status, canManageScanoSettings, canManageScanoTasks } = useAuth();

  if (status === "loading") {
    return <RouteFallback />;
  }

  if (!canManageScanoSettings) {
    return <Navigate to={resolveScanoHomePath(canManageScanoTasks)} replace />;
  }

  return props.children;
}

function AdminRoute(props: { children: ReactElement }) {
  const location = useLocation();
  const { status, isAdmin, refreshAuth, canAccessScano, canAccessUpuse, canManageScanoTasks } = useAuth();
  const [checkingAccess, setCheckingAccess] = useState(true);

  useEffect(() => {
    let active = true;

    if (status === "loading") {
      return () => {
        active = false;
      };
    }

    if (status !== "authenticated") {
      setCheckingAccess(false);
      return () => {
        active = false;
      };
    }

    setCheckingAccess(true);
    void refreshAuth()
      .catch(() => {})
      .finally(() => {
        if (!active) return;
        setCheckingAccess(false);
      });

    return () => {
      active = false;
    };
  }, [location.pathname, refreshAuth, status]);

  if (status === "loading" || (status === "authenticated" && checkingAccess)) {
    return <RouteFallback />;
  }

  if (status !== "authenticated") {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  if (!canAccessUpuse) {
    return <Navigate to={canAccessScano ? resolveScanoHomePath(canManageScanoTasks) : "/login"} replace />;
  }

  if (!isAdmin) {
    return <Navigate to="/" replace />;
  }

  return props.children;
}

function SystemSwitchRoute() {
  const navigate = useNavigate();
  const params = useParams<{ system: string }>();
  const { canAccessScano, canAccessUpuse, canManageScanoTasks } = useAuth();
  const system = isWorkspaceSystem(params.system) ? params.system : null;
  const scanoPath = resolveScanoHomePath(canManageScanoTasks);

  useEffect(() => {
    if (!system) {
      navigate(resolveAccessiblePath(canAccessUpuse, canAccessScano, canManageScanoTasks), { replace: true });
      return;
    }

    if ((system === "upuse" && !canAccessUpuse) || (system === "scano" && !canAccessScano)) {
      navigate(resolveAccessiblePath(canAccessUpuse, canAccessScano, canManageScanoTasks), { replace: true });
      return;
    }

    const targetPath = resolveSystemPath(system, { scanoPath });
    writeActiveSystem(system);
    beginPendingSystemSwitch(system, { targetPath, scanoPath });
    const timer = window.setTimeout(() => {
      window.location.assign(targetPath);
    }, 260);

    return () => {
      window.clearTimeout(timer);
    };
  }, [canAccessScano, canAccessUpuse, canManageScanoTasks, navigate, scanoPath, system]);

  if (!system) {
    return null;
  }

  return <SystemSwitchLoadingPage system={system} />;
}

export function AppRouter() {
  const location = useLocation();
  const { status, canAccessScano, canAccessUpuse, canManageScanoTasks } = useAuth();
  const [pendingSystemSwitch, setPendingSystemSwitch] = useState(() => {
    const pending = readPendingSystemSwitch();
    return pending && pending.targetPath === location.pathname ? pending : null;
  });

  useEffect(() => {
    if (status === "loading") {
      return;
    }
    if (canAccessUpuse && !canAccessScano && readActiveSystem() !== "upuse") {
      writeActiveSystem("upuse");
      return;
    }
    if (!canAccessUpuse && canAccessScano && readActiveSystem() !== "scano") {
      writeActiveSystem("scano");
    }
  }, [canAccessScano, canAccessUpuse, status]);

  useEffect(() => {
    const pending = readPendingSystemSwitch();
    if (!pending || pending.targetPath !== location.pathname) {
      setPendingSystemSwitch(null);
      return;
    }

    setPendingSystemSwitch(pending);
    const timer = window.setTimeout(() => {
      clearPendingSystemSwitch();
      setPendingSystemSwitch(null);
    }, 620);

    return () => {
      window.clearTimeout(timer);
    };
  }, [location.pathname]);

  if (pendingSystemSwitch) {
    return (
      <SystemSwitchLoadingPage
        system={pendingSystemSwitch.system}
        title={pendingSystemSwitch.system === "scano" ? "Opening Scano" : "Returning to UPuse"}
      />
    );
  }

  return (
    <Suspense fallback={<RouteFallback />}>
      <Routes>
        <Route path="/login" element={<GuestRoute><LoginPage /></GuestRoute>} />
        <Route path="/system-switch/:system" element={<ProtectedRoute><SystemSwitchRoute /></ProtectedRoute>} />
        <Route path="/" element={<ProtectedRoute><UpuseAccessRoute><WorkspaceRoute system="upuse"><DashboardPage /></WorkspaceRoute></UpuseAccessRoute></ProtectedRoute>} />
        <Route path="/performance" element={<ProtectedRoute><UpuseAccessRoute><WorkspaceRoute system="upuse"><PerformancePage /></WorkspaceRoute></UpuseAccessRoute></ProtectedRoute>} />
        <Route path="/scano" element={<ProtectedRoute><ScanoAccessRoute><WorkspaceRoute system="scano"><Navigate to={resolveScanoHomePath(canManageScanoTasks)} replace /></WorkspaceRoute></ScanoAccessRoute></ProtectedRoute>} />
        <Route path="/scano/assign-task" element={<ProtectedRoute><ScanoAccessRoute><ScanoManagerRoute><WorkspaceRoute system="scano"><ScanoPage /></WorkspaceRoute></ScanoManagerRoute></ScanoAccessRoute></ProtectedRoute>} />
        <Route path="/scano/master-product" element={<ProtectedRoute><ScanoAccessRoute><ScanoManagerRoute><WorkspaceRoute system="scano"><ScanoMasterProductPage /></WorkspaceRoute></ScanoManagerRoute></ScanoAccessRoute></ProtectedRoute>} />
        <Route path="/scano/my-tasks" element={<ProtectedRoute><ScanoAccessRoute><ScanoScannerRoute><WorkspaceRoute system="scano"><ScanoMyTasksPage /></WorkspaceRoute></ScanoScannerRoute></ScanoAccessRoute></ProtectedRoute>} />
        <Route path="/scano/tasks/:id" element={<ProtectedRoute><ScanoAccessRoute><WorkspaceRoute system="scano"><ScanoTaskProfilePage /></WorkspaceRoute></ScanoAccessRoute></ProtectedRoute>} />
        <Route path="/scano/tasks/:id/run" element={<ProtectedRoute><ScanoAccessRoute><ScanoScannerRoute><WorkspaceRoute system="scano"><ScanoTaskRunnerPage /></WorkspaceRoute></ScanoScannerRoute></ScanoAccessRoute></ProtectedRoute>} />
        <Route path="/scano/settings" element={<ProtectedRoute><ScanoAdminRoute><ScanoAccessRoute><WorkspaceRoute system="scano"><ScanoSettingsPage /></WorkspaceRoute></ScanoAccessRoute></ScanoAdminRoute></ProtectedRoute>} />
        <Route path="/scano/*" element={<ProtectedRoute><ScanoAccessRoute><WorkspaceRoute system="scano"><Navigate to={resolveScanoHomePath(canManageScanoTasks)} replace /></WorkspaceRoute></ScanoAccessRoute></ProtectedRoute>} />
        <Route path="/mapping" element={<Navigate to="/branches" replace />} />
        <Route path="/branches" element={<ProtectedRoute><UpuseAccessRoute><WorkspaceRoute system="upuse"><BranchesPage /></WorkspaceRoute></UpuseAccessRoute></ProtectedRoute>} />
        <Route path="/thresholds" element={<ProtectedRoute><UpuseAccessRoute><WorkspaceRoute system="upuse"><ThresholdsPage /></WorkspaceRoute></UpuseAccessRoute></ProtectedRoute>} />
        <Route path="/settings/thresholds" element={<ProtectedRoute><UpuseAccessRoute><WorkspaceRoute system="upuse"><ThresholdsPage /></WorkspaceRoute></UpuseAccessRoute></ProtectedRoute>} />
        <Route path="/settings" element={<ProtectedRoute><UpuseAccessRoute><WorkspaceRoute system="upuse"><SettingsPage /></WorkspaceRoute></UpuseAccessRoute></ProtectedRoute>} />
        <Route path="/users" element={<AdminRoute><WorkspaceRoute system="upuse"><UsersPage /></WorkspaceRoute></AdminRoute>} />
        <Route path="*" element={<Navigate to={resolveAccessiblePath(canAccessUpuse, canAccessScano, canManageScanoTasks)} replace />} />
      </Routes>
    </Suspense>
  );
}
