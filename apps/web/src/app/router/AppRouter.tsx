import { lazy, Suspense, useEffect, useState } from "react";
import { Navigate, Route, Routes, useLocation, useNavigate, useParams } from "react-router-dom";
import { getDefaultWebSystem, getWebSystemById, getWebSystems } from "../../core/systems/registry";
import {
  beginPendingSystemSwitch,
  clearPendingSystemSwitch,
  readPendingSystemSwitch,
  resolveAccessiblePath,
  resolveSystemPath,
  syncActiveSystemForPath,
  writeActiveSystem,
} from "../../core/systems/navigation";
import { useAuth } from "../providers/AuthProvider";
import { GuestRoute, ProtectedRoute } from "./guards";
import { RouteFallback, SystemSwitchLoadingPage } from "./fallback";

const LoginPage = lazy(() =>
  import("../../pages/login/ui/LoginPage").then((module) => ({ default: module.LoginPage })),
);

function SystemSwitchRoute() {
  const navigate = useNavigate();
  const params = useParams<{ system: string }>();
  const auth = useAuth();
  const system = getWebSystemById(params.system);

  useEffect(() => {
    if (!system) {
      navigate(resolveAccessiblePath(auth), { replace: true });
      return;
    }

    if (!system.canAccess(auth)) {
      navigate(resolveAccessiblePath(auth), { replace: true });
      return;
    }

    const targetPath = resolveSystemPath(system.id, auth);
    writeActiveSystem(system.id);
    beginPendingSystemSwitch(system.id, { targetPath });
    const timer = window.setTimeout(() => {
      window.location.assign(targetPath);
    }, 260);

    return () => {
      window.clearTimeout(timer);
    };
  }, [auth, navigate, system]);

  if (!system) {
    return null;
  }

  return <SystemSwitchLoadingPage systemLabel={system.label} />;
}

export function AppRouter() {
  const location = useLocation();
  const auth = useAuth();
  const [pendingSystemSwitch, setPendingSystemSwitch] = useState(() => {
    const pending = readPendingSystemSwitch();
    return pending && pending.targetPath === location.pathname ? pending : null;
  });

  useEffect(() => {
    if (auth.status !== "authenticated") {
      return;
    }

    syncActiveSystemForPath(location.pathname, auth);
  }, [auth, location.pathname]);

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
    const system = getWebSystemById(pendingSystemSwitch.system) ?? getDefaultWebSystem();
    return (
      <SystemSwitchLoadingPage
        systemLabel={system.label}
        title={system.switcher.loadingTitle ?? `Opening ${system.label}`}
      />
    );
  }

  return (
    <Suspense fallback={<RouteFallback />}>
      <Routes>
        <Route path="/login" element={<GuestRoute><LoginPage /></GuestRoute>} />
        <Route path="/system-switch/:system" element={<ProtectedRoute><SystemSwitchRoute /></ProtectedRoute>} />
        <Route path="/mapping" element={<Navigate to="/branches" replace />} />
        {getWebSystems().flatMap((system) => system.getRoutes({ auth }))}
        <Route path="*" element={<Navigate to={resolveAccessiblePath(auth)} replace />} />
      </Routes>
    </Suspense>
  );
}
