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

export function getAppPermissions(role?: AppUserRole | null): AppPermissions {
  if (role === "admin") {
    return {
      isAdmin: true,
      canManage: true,
      canManageUsers: true,
      canManageMonitor: true,
      canRefreshOrdersNow: true,
      canManageBranches: true,
      canDeleteBranches: true,
      canLookupBranchVendors: true,
      canManageSettings: true,
      canManageTokens: true,
      canTestTokens: true,
      canClearLogs: true,
    };
  }

  if (role === "user") {
    return {
      ...anonymousPermissions,
      canManageMonitor: true,
      canManageBranches: true,
      canLookupBranchVendors: true,
      canManageTokens: true,
      canTestTokens: true,
    };
  }

  return anonymousPermissions;
}
