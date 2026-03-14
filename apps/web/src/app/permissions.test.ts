import { describe, expect, it } from "vitest";
import { getAppPermissions } from "./permissions";

describe("getAppPermissions", () => {
  it("keeps the user role limited to the backend-allowed non-admin capabilities", () => {
    expect(getAppPermissions("user")).toEqual({
      isAdmin: false,
      canManage: false,
      canManageUsers: false,
      canManageMonitor: true,
      canRefreshOrdersNow: false,
      canManageBranches: true,
      canDeleteBranches: false,
      canManageSettings: false,
      canManageTokens: false,
      canTestTokens: false,
      canClearLogs: false,
    });
  });

  it("grants admin the full settings and token capability set", () => {
    expect(getAppPermissions("admin")).toMatchObject({
      isAdmin: true,
      canManageUsers: true,
      canManageMonitor: true,
      canManageBranches: true,
      canManageSettings: true,
      canManageTokens: true,
      canTestTokens: true,
      canClearLogs: true,
    });
  });
});
