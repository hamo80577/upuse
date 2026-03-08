import { describe, expect, it } from "vitest";
import { getAppPermissions } from "./permissions";

describe("getAppPermissions", () => {
  it("grants the renamed user role the intended non-admin capabilities", () => {
    expect(getAppPermissions("user")).toEqual({
      isAdmin: false,
      canManage: false,
      canManageUsers: false,
      canManageMonitor: true,
      canRefreshOrdersNow: false,
      canManageBranches: true,
      canDeleteBranches: false,
      canLookupBranchVendors: true,
      canManageSettings: false,
      canManageTokens: true,
      canTestTokens: true,
      canClearLogs: false,
    });
  });
});
