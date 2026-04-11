import type { ReactElement } from "react";
import { Navigate, Outlet, useLocation } from "react-router-dom";
import { getWebSystemById } from "../../core/systems/registry";
import { readActiveSystem, resolveAccessiblePath, writeActiveSystem } from "../../core/systems/navigation";
import { useAuth } from "../providers/AuthProvider";
import { RouteFallback } from "./fallback";

export function ProtectedRoute(props: { children: ReactElement }) {
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

export function GuestRoute(props: { children: ReactElement }) {
  const auth = useAuth();
  if (auth.status === "loading") {
    return <RouteFallback />;
  }

  if (auth.status === "authenticated") {
    return <Navigate to={resolveAccessiblePath(auth)} replace />;
  }

  return props.children;
}

export function SystemRoute(props: { systemId: string; children?: ReactElement }) {
  const auth = useAuth();
  const location = useLocation();
  const system = getWebSystemById(props.systemId);

  if (auth.status === "loading") {
    return <RouteFallback />;
  }

  if (auth.status !== "authenticated") {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  if (!system || !system.canAccess(auth)) {
    return <Navigate to={resolveAccessiblePath(auth)} replace />;
  }

  const activeSystem = getWebSystemById(readActiveSystem());
  if (
    activeSystem &&
    activeSystem.id !== system.id &&
    activeSystem.canAccess(auth) &&
    system.basePath === "/" &&
    activeSystem.basePath !== "/"
  ) {
    return <Navigate to={activeSystem.resolveHomePath(auth)} replace />;
  }

  writeActiveSystem(system.id);

  if (props.children) {
    return props.children;
  }

  return <Outlet />;
}

export function CapabilityRoute(props: {
  systemId: string;
  capability: string;
  fallbackPath?: string;
  children: ReactElement;
}) {
  const location = useLocation();
  const auth = useAuth();
  const system = getWebSystemById(props.systemId);

  if (auth.status === "loading") {
    return <RouteFallback />;
  }

  if (auth.status !== "authenticated") {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  if (!system || !system.canAccess(auth)) {
    return <Navigate to={resolveAccessiblePath(auth)} replace />;
  }

  if (!auth.hasSystemCapability(props.systemId, props.capability)) {
    return <Navigate to={props.fallbackPath ?? system.resolveHomePath(auth)} replace />;
  }

  return props.children;
}
