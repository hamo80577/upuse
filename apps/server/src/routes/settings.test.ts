import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockGetSettings,
  mockUpdateSettings,
  mockFetchAvailabilities,
  mockResolveOrdersGlobalEntityId,
  mockLookupVendorName,
  mockListBranches,
} = vi.hoisted(() => ({
  mockGetSettings: vi.fn(),
  mockUpdateSettings: vi.fn(),
  mockFetchAvailabilities: vi.fn(),
  mockResolveOrdersGlobalEntityId: vi.fn(),
  mockLookupVendorName: vi.fn(),
  mockListBranches: vi.fn(),
}));

vi.mock("../services/settingsStore.js", () => ({
  getSettings: mockGetSettings,
  updateSettings: mockUpdateSettings,
}));

vi.mock("../services/availabilityClient.js", () => ({
  fetchAvailabilities: mockFetchAvailabilities,
}));

vi.mock("../services/monitorOrdersPolling.js", () => ({
  resolveOrdersGlobalEntityId: mockResolveOrdersGlobalEntityId,
}));

vi.mock("../services/ordersClient.js", () => ({
  lookupVendorName: mockLookupVendorName,
}));

vi.mock("../services/branchStore.js", () => ({
  listBranches: mockListBranches,
}));

import { putSettingsRoute, testTokensRoute } from "./settings.js";

function createResponse() {
  const res: any = {
    statusCode: 200,
    body: undefined as unknown,
  };
  res.status = vi.fn((statusCode: number) => {
    res.statusCode = statusCode;
    return res;
  });
  res.json = vi.fn((body: unknown) => {
    res.body = body;
    return res;
  });
  return res;
}

describe("testTokensRoute", () => {
  beforeEach(() => {
    mockGetSettings.mockReset();
    mockUpdateSettings.mockReset();
    mockFetchAvailabilities.mockReset();
    mockResolveOrdersGlobalEntityId.mockReset();
    mockLookupVendorName.mockReset();
    mockListBranches.mockReset();

    mockGetSettings.mockReturnValue({
      ordersToken: "orders-token",
      availabilityToken: "availability-token",
      globalEntityId: "HF_EG",
    });
    mockResolveOrdersGlobalEntityId.mockImplementation((branch: { globalEntityId?: string }, fallback: string) => {
      const value = branch?.globalEntityId?.trim();
      return value && value.length ? value : fallback;
    });
    mockFetchAvailabilities.mockResolvedValue([{ id: "ok" }]);
  });

  it("reports all enabled branches when token checks pass", async () => {
    mockListBranches.mockReturnValue([
      { id: 1, name: "A", ordersVendorId: 11, globalEntityId: "", enabled: true },
      { id: 2, name: "B", ordersVendorId: 22, globalEntityId: "HF_SA", enabled: true },
    ]);
    mockLookupVendorName.mockResolvedValueOnce("Branch A").mockResolvedValueOnce("Branch B");

    const res = createResponse();
    await testTokensRoute({} as any, res);

    expect(res.body.orders).toMatchObject({
      configValid: true,
      ok: true,
      enabledBranchCount: 2,
      passedBranchCount: 2,
      failedBranchCount: 0,
    });
    expect(res.body.orders.branches).toEqual([
      expect.objectContaining({
        branchId: 1,
        name: "A",
        ordersVendorId: 11,
        globalEntityId: "HF_EG",
        ok: true,
        sampleVendorName: "Branch A",
      }),
      expect.objectContaining({
        branchId: 2,
        name: "B",
        ordersVendorId: 22,
        globalEntityId: "HF_SA",
        ok: true,
        sampleVendorName: "Branch B",
      }),
    ]);
  });

  it("reports partial branch failures without hiding the successful checks", async () => {
    mockListBranches.mockReturnValue([
      { id: 1, name: "A", ordersVendorId: 11, globalEntityId: "", enabled: true },
      { id: 2, name: "B", ordersVendorId: 22, globalEntityId: "", enabled: true },
    ]);
    mockLookupVendorName.mockResolvedValueOnce("Branch A").mockRejectedValueOnce({
      response: { status: 401, data: { message: "Unauthorized" } },
    });

    const res = createResponse();
    await testTokensRoute({} as any, res);

    expect(res.body.orders).toMatchObject({
      configValid: true,
      ok: false,
      enabledBranchCount: 2,
      passedBranchCount: 1,
      failedBranchCount: 1,
    });
    expect(res.body.orders.branches).toEqual([
      expect.objectContaining({ branchId: 1, ok: true, sampleVendorName: "Branch A" }),
      expect.objectContaining({ branchId: 2, ok: false, status: 401, message: "Unauthorized" }),
    ]);
  });

  it("returns a config warning when there are no enabled branches", async () => {
    mockListBranches.mockReturnValue([]);

    const res = createResponse();
    await testTokensRoute({} as any, res);

    expect(res.body.orders).toEqual({
      configValid: false,
      configMessage: "Enable at least one branch mapping to test Orders token.",
      ok: false,
      enabledBranchCount: 0,
      passedBranchCount: 0,
      failedBranchCount: 0,
      branches: [],
    });
  });
});

describe("putSettingsRoute", () => {
  beforeEach(() => {
    mockUpdateSettings.mockReset();
    mockUpdateSettings.mockImplementation((patch: Record<string, unknown>) => ({
      ordersToken: patch.ordersToken ?? "orders-token",
      availabilityToken: patch.availabilityToken ?? "availability-token",
      globalEntityId: "HF_EG",
      chainNames: [],
      chains: [],
      lateThreshold: 5,
      unassignedThreshold: 5,
      tempCloseMinutes: 30,
      graceMinutes: 5,
      ordersRefreshSeconds: 30,
      availabilityRefreshSeconds: 30,
      maxVendorsPerOrdersRequest: 50,
    }));
  });

  it("allows user accounts to update API tokens", () => {
    const req: any = {
      authUser: { role: "user" },
      body: {
        ordersToken: "user-orders-token",
      },
    };
    const res = createResponse();

    putSettingsRoute(req, res);

    expect(mockUpdateSettings).toHaveBeenCalledWith({
      ordersToken: "user-orders-token",
    });
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ ok: true });
  });

  it("rejects non-token settings changes from user accounts", () => {
    const req: any = {
      authUser: { role: "user" },
      body: {
        ordersToken: "user-orders-token",
        globalEntityId: "HF_SA",
      },
    };
    const res = createResponse();

    putSettingsRoute(req, res);

    expect(mockUpdateSettings).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
    expect(res.body).toEqual({
      ok: false,
      message: "User can update tokens only.",
    });
  });
});
