import { Alert, Box, Button, CircularProgress, Stack } from "@mui/material";
import { lazy, Suspense, useEffect, useState, type ReactElement } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { useAuth } from "./providers/AuthProvider";

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
  const { status } = useAuth();
  if (status === "loading") {
    return <RouteFallback />;
  }

  if (status === "authenticated") {
    return <Navigate to="/" replace />;
  }

  return props.children;
}

function AdminRoute(props: { children: ReactElement }) {
  const location = useLocation();
  const { status, isAdmin, refreshAuth } = useAuth();
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

  if (!isAdmin) {
    return <Navigate to="/" replace />;
  }

  return props.children;
}

export function AppRouter() {
  return (
    <Suspense fallback={<RouteFallback />}>
      <Routes>
        <Route path="/login" element={<GuestRoute><LoginPage /></GuestRoute>} />
        <Route path="/" element={<ProtectedRoute><DashboardPage /></ProtectedRoute>} />
        <Route path="/mapping" element={<Navigate to="/branches" replace />} />
        <Route path="/branches" element={<ProtectedRoute><BranchesPage /></ProtectedRoute>} />
        <Route path="/thresholds" element={<ProtectedRoute><ThresholdsPage /></ProtectedRoute>} />
        <Route path="/settings/thresholds" element={<ProtectedRoute><ThresholdsPage /></ProtectedRoute>} />
        <Route path="/settings" element={<ProtectedRoute><SettingsPage /></ProtectedRoute>} />
        <Route path="/users" element={<AdminRoute><UsersPage /></AdminRoute>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
}
