import { Box, CircularProgress } from "@mui/material";
import { lazy, Suspense, type ReactElement } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { useAuth } from "./providers/AuthProvider";

const DashboardPage = lazy(() =>
  import("../pages/dashboard/ui/DashboardPage").then((module) => ({ default: module.DashboardPage })),
);
const LoginPage = lazy(() =>
  import("../pages/Login").then((module) => ({ default: module.LoginPage })),
);
const BranchesPage = lazy(() =>
  import("../pages/Branches").then((module) => ({ default: module.BranchesPage })),
);
const SettingsPage = lazy(() =>
  import("../pages/Settings").then((module) => ({ default: module.SettingsPage })),
);
const ThresholdsPage = lazy(() =>
  import("../pages/Thresholds").then((module) => ({ default: module.ThresholdsPage })),
);
const UsersPage = lazy(() =>
  import("../pages/Users").then((module) => ({ default: module.UsersPage })),
);

function RouteFallback() {
  return (
    <Box
      sx={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        bgcolor: "background.default",
      }}
    >
      <CircularProgress size={28} />
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
  const { status, isAdmin } = useAuth();

  if (status === "loading") {
    return <RouteFallback />;
  }

  if (status !== "authenticated") {
    return <Navigate to="/login" replace />;
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
        <Route path="/settings/thresholds" element={<ProtectedRoute><ThresholdsPage /></ProtectedRoute>} />
        <Route path="/settings" element={<ProtectedRoute><SettingsPage /></ProtectedRoute>} />
        <Route path="/branches" element={<ProtectedRoute><BranchesPage /></ProtectedRoute>} />
        <Route path="/users" element={<AdminRoute><UsersPage /></AdminRoute>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
}
