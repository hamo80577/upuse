import { describe, expect, it } from "vitest";
import { getAppPermissions } from "./upusePermissions";

describe("getAppPermissions", () => {
  it("grants the user role mapping and token capabilities while keeping user management admin-only", () => {
    expect(getAppPermissions("user")).toEqual({
      isAdmin: false,
      canManage: false,
      canAccessFullWorkspace: true,
      canManageUsers: false,
      canManageMonitor: true,
      canRefreshOrdersNow: false,
      canManageBranches: true,
      canDeleteBranches: true,
      canManageThresholds: true,
      canManageSettings: false,
      canManageTokens: true,
      canTestTokens: true,
      canClearLogs: false,
    });
  });

  it("grants admin the full settings and token capability set", () => {
    expect(getAppPermissions("admin")).toMatchObject({
      isAdmin: true,
      canAccessFullWorkspace: true,
      canManageUsers: true,
      canManageMonitor: true,
      canManageBranches: true,
      canManageThresholds: true,
      canManageSettings: true,
      canManageTokens: true,
      canTestTokens: true,
      canClearLogs: true,
    });
  });

  it("keeps tracker users limited to dashboard-only access", () => {
    expect(getAppPermissions("tracker")).toMatchObject({
      isAdmin: false,
      canManage: false,
      canAccessFullWorkspace: false,
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
    });
  });
});
