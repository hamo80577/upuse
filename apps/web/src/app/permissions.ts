import type { AppUserRole } from "../api/types";

export interface AppPermissions {
  isAdmin: boolean;
  canManage: boolean;
  canManageUsers: boolean;
  canManageMonitor: boolean;
  canRefreshOrdersNow: boolean;
  canManageBranches: boolean;
  canDeleteBranches: boolean;
  canLookupBranchVendors: boolean;
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
  canLookupBranchVendors: false,
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
  | "manage_settings"
  | "manage_settings_tokens"
  | "test_settings_tokens"
  | "clear_logs"
  | "lookup_branch_vendors";

const roleCapabilities: Record<AppUserRole, ReadonlySet<UiCapability>> = {
  admin: new Set<UiCapability>([
    "manage_users",
    "manage_monitor",
    "refresh_monitor_orders",
    "manage_branch_mappings",
    "delete_branch_mappings",
    "manage_settings",
    "manage_settings_tokens",
    "test_settings_tokens",
    "clear_logs",
    "lookup_branch_vendors",
  ]),
  user: new Set<UiCapability>([
    "manage_monitor",
    "manage_branch_mappings",
    "lookup_branch_vendors",
  ]),
};

function hasUiCapability(role: AppUserRole | null | undefined, capability: UiCapability) {
  if (!role) return false;
  return roleCapabilities[role]?.has(capability) ?? false;
}

export function getAppPermissions(role?: AppUserRole | null): AppPermissions {
  return {
    ...anonymousPermissions,
    isAdmin: role === "admin",
    canManage: role === "admin",
    canManageUsers: hasUiCapability(role, "manage_users"),
    canManageMonitor: hasUiCapability(role, "manage_monitor"),
    canRefreshOrdersNow: hasUiCapability(role, "refresh_monitor_orders"),
    canManageBranches: hasUiCapability(role, "manage_branch_mappings"),
    canDeleteBranches: hasUiCapability(role, "delete_branch_mappings"),
    canLookupBranchVendors: hasUiCapability(role, "lookup_branch_vendors"),
    canManageSettings: hasUiCapability(role, "manage_settings"),
    canManageTokens: hasUiCapability(role, "manage_settings_tokens"),
    canTestTokens: hasUiCapability(role, "test_settings_tokens"),
    canClearLogs: hasUiCapability(role, "clear_logs"),
  };
}
