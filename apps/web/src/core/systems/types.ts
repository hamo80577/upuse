import type { ReactElement, ReactNode } from "react";
import type { Location } from "react-router-dom";
import type { AppUser } from "../../api/types";
import type { AppPermissions } from "./permissions/upusePermissions";

export type SystemId = string;
export type WorkspaceSystem = SystemId;
export type SystemCapability = string;

export interface SystemAccessState {
  enabled: boolean;
  role?: string | null;
  roleLabel?: string | null;
  capabilities: readonly SystemCapability[];
}

export type SystemAccessMap = Record<SystemId, SystemAccessState>;

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
  user: AppUser | null;
  systems: SystemAccessMap;
  hasSystemAccess: (systemId: SystemId) => boolean;
  hasSystemCapability: (systemId: SystemId, capability: SystemCapability) => boolean;
  getSystemAccess: (systemId: SystemId) => SystemAccessState;
  permissions: AppPermissions;
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

export interface WebSystemAuthContext {
  user: AppUser | null;
  systems: SystemAccessMap;
}

export interface WebSystemSwitcherManifest {
  icon: ReactNode;
  description: string;
  loadingTitle?: string;
}

export interface WebSystemAccountNavigationItem {
  key: string;
  label: string;
  caption: string;
  path: string;
  icon: ReactNode;
  isActive: boolean;
  requiredCapability?: SystemCapability;
}

export interface WebSystemModule {
  id: SystemId;
  label: string;
  basePath: string;
  switcher: WebSystemSwitcherManifest;
  resolveAccess: (user: AppUser | null) => SystemAccessState;
  resolveLegacyAuth?: (context: WebSystemAuthContext) => Partial<AuthSystemState>;
  canAccess: (auth: AuthSystemState) => boolean;
  resolveHomePath: (auth: AuthSystemState) => string;
  getNavigation: (auth: AuthSystemState, location: Location) => SystemNavigationItem[];
  getAccountNavigation?: (auth: AuthSystemState, location: Location) => WebSystemAccountNavigationItem[];
  getRoutes: (context: WebSystemRouteContext) => ReactElement[];
}
