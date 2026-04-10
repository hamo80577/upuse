import type { ReactElement } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "../../../app/providers/AuthProvider";
import { RouteFallback } from "../../../app/router/fallback";

function resolveScanoHomePath(canManageScanoTasks: boolean) {
  return canManageScanoTasks ? "/scano/assign-task" : "/scano/my-tasks";
}

export function ScanoManagerRoute(props: { children: ReactElement }) {
  const { status, canManageScanoTasks } = useAuth();

  if (status === "loading") {
    return <RouteFallback />;
  }

  if (!canManageScanoTasks) {
    return <Navigate to="/scano/my-tasks" replace />;
  }

  return props.children;
}

export function ScanoScannerRoute(props: { children: ReactElement }) {
  const { status, scanoRole, canManageScanoTasks } = useAuth();

  if (status === "loading") {
    return <RouteFallback />;
  }

  if (scanoRole !== "scanner") {
    return <Navigate to={resolveScanoHomePath(canManageScanoTasks)} replace />;
  }

  return props.children;
}

export function ScanoAdminRoute(props: { children: ReactElement }) {
  const { status, canManageScanoSettings, canManageScanoTasks } = useAuth();

  if (status === "loading") {
    return <RouteFallback />;
  }

  if (!canManageScanoSettings) {
    return <Navigate to={resolveScanoHomePath(canManageScanoTasks)} replace />;
  }

  return props.children;
}
