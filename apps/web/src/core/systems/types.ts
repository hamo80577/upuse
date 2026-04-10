import type { ReactElement, ReactNode } from "react";
import type { Location } from "react-router-dom";

export type SystemId = string;
export type WorkspaceSystem = SystemId;

export interface SystemNavigationItem {
  key: string;
  label: string;
  caption: string;
  path: string;
  icon: ReactNode;
  isActive: boolean;
}

export interface AuthSystemState {
  status: "loading" | "authenticated" | "unauthenticated";
  isAdmin: boolean;
  scanoRole: "team_lead" | "scanner" | null | undefined;
  canAccessUpuse: boolean;
  canAccessScano: boolean;
  canManageScanoTasks: boolean;
  canManageScanoSettings: boolean;
  canManageMonitor: boolean;
  canSwitchSystems: boolean;
  refreshAuth: () => Promise<void>;
}

export interface WebSystemRouteContext {
  auth: AuthSystemState;
}

export interface WebSystemModule {
  id: SystemId;
  label: string;
  basePath: string;
  canAccess: (auth: AuthSystemState) => boolean;
  resolveHomePath: (auth: AuthSystemState) => string;
  getNavigation: (auth: AuthSystemState, location: Location) => SystemNavigationItem[];
  getRoutes: (context: WebSystemRouteContext) => ReactElement[];
}
