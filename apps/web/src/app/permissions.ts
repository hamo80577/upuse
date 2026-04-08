import type { AppUserRole } from "../api/types";

export interface AppPermissions {
  isAdmin: boolean;
  canManage: boolean;
  canManageUsers: boolean;
  canManageMonitor: boolean;
  canRefreshOrdersNow: boolean;
  canManageBranches: boolean;
  canDeleteBranches: boolean;
  canManageThresholds: boolean;
  canManageSettings: boolean;
  canManageTokens: boolean;
  canTestTokens: boolean;
  canClearLogs: boolean;
}

const anonymousPermissions: AppPermissions = {
  isAdmin: false,
  canManage: false,
  canManageUsers: false,
  canManageMonitor: false,
  canRefreshOrdersNow: false,
  canManageBranches: false,
  canDeleteBranches: false,
  canManageThresholds: false,
  canManageSettings: false,
  canManageTokens: false,
  canTestTokens: false,
  canClearLogs: false,
};

type UiCapability =
  | "manage_users"
  | "manage_monitor"
  | "refresh_monitor_orders"
  | "manage_branch_mappings"
  | "delete_branch_mappings"
  | "manage_thresholds"
  | "manage_settings"
  | "manage_settings_tokens"
  | "test_settings_tokens"
  | "clear_logs";

const roleCapabilities: Record<AppUserRole, ReadonlySet<UiCapability>> = {
  admin: new Set<UiCapability>([
    "manage_users",
    "manage_monitor",
    "refresh_monitor_orders",
    "manage_branch_mappings",
    "delete_branch_mappings",
    "manage_thresholds",
    "manage_settings",
    "manage_settings_tokens",
    "test_settings_tokens",
    "clear_logs",
  ]),
  user: new Set<UiCapability>([
    "manage_monitor",
    "manage_branch_mappings",
    "delete_branch_mappings",
    "manage_thresholds",
    "manage_settings_tokens",
    "test_settings_tokens",
  ]),
};

function hasUiCapability(role: AppUserRole | null | undefined, capability: UiCapability) {
  if (!role) return false;
  return roleCapabilities[role]?.has(capability) ?? false;
}

export function getAppPermissions(role?: AppUserRole | null): AppPermissions {
  return getAppPermissionsForAccess(role, true);
}

export function getAppPermissionsForAccess(role?: AppUserRole | null, upuseAccess = true): AppPermissions {
  return {
    ...anonymousPermissions,
    isAdmin: upuseAccess && role === "admin",
    canManage: upuseAccess && role === "admin",
    canManageUsers: upuseAccess && hasUiCapability(role, "manage_users"),
    canManageMonitor: upuseAccess && hasUiCapability(role, "manage_monitor"),
    canRefreshOrdersNow: upuseAccess && hasUiCapability(role, "refresh_monitor_orders"),
    canManageBranches: upuseAccess && hasUiCapability(role, "manage_branch_mappings"),
    canDeleteBranches: upuseAccess && hasUiCapability(role, "delete_branch_mappings"),
    canManageThresholds: upuseAccess && hasUiCapability(role, "manage_thresholds"),
    canManageSettings: upuseAccess && hasUiCapability(role, "manage_settings"),
    canManageTokens: upuseAccess && hasUiCapability(role, "manage_settings_tokens"),
    canTestTokens: upuseAccess && hasUiCapability(role, "test_settings_tokens"),
    canClearLogs: upuseAccess && hasUiCapability(role, "clear_logs"),
  };
}
