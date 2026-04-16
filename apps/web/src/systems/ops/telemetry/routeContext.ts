import { resolveSystemFromPath } from "../../../core/systems/navigation";
import type { OpsSystemId } from "../api/types";
import { sanitizeOpsPath, sanitizeOpsText } from "./sanitize";

export interface OpsTelemetryRouteContext {
  system: OpsSystemId;
  path: string;
  routePattern: string;
  pageTitle?: string;
}

function normalizeSystemId(systemId: string): OpsSystemId {
  if (systemId === "upuse" || systemId === "scano" || systemId === "ops") {
    return systemId;
  }
  return "unknown";
}

function resolveRoutePattern(path: string) {
  if (path === "/") return "/";
  if (path === "/branches") return "/branches";
  if (/^\/branches\/[^/]+$/.test(path)) return "/branches/:id";
  if (path === "/thresholds") return "/thresholds";
  if (path === "/settings") return "/settings";
  if (path === "/performance") return "/performance";
  if (path === "/users") return "/users";

  if (path === "/scano") return "/scano";
  if (path === "/scano/assign-task") return "/scano/assign-task";
  if (path === "/scano/my-tasks") return "/scano/my-tasks";
  if (path === "/scano/settings") return "/scano/settings";
  if (path === "/scano/master-product") return "/scano/master-product";
  if (/^\/scano\/tasks\/[^/]+$/.test(path)) return "/scano/tasks/:id";
  if (/^\/scano\/tasks\/[^/]+\/run$/.test(path)) return "/scano/tasks/:id/run";

  if (path === "/ops") return "/ops";
  return path;
}

export function resolveOpsTelemetryRouteContext(pathname: string, pageTitle?: string): OpsTelemetryRouteContext {
  const path = sanitizeOpsPath(pathname) ?? "/";
  const system = normalizeSystemId(resolveSystemFromPath(path).id);
  return {
    system,
    path,
    routePattern: resolveRoutePattern(path),
    ...(sanitizeOpsText(pageTitle ?? (typeof document === "undefined" ? "" : document.title), 180)
      ? { pageTitle: sanitizeOpsText(pageTitle ?? (typeof document === "undefined" ? "" : document.title), 180) }
      : {}),
  };
}
