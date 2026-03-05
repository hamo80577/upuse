import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockAddBranch,
  mockUpdateBranch,
  mockDeleteBranch,
  mockGetBranchById,
  mockListBranches,
  mockResolveOrdersGlobalEntityId,
  mockGetSettings,
  mockFetchVendorOrdersDetail,
  mockLookupVendorName,
} = vi.hoisted(() => ({
  mockAddBranch: vi.fn(),
  mockUpdateBranch: vi.fn(),
  mockDeleteBranch: vi.fn(),
  mockGetBranchById: vi.fn(),
  mockListBranches: vi.fn(),
  mockResolveOrdersGlobalEntityId: vi.fn((_branch: unknown, fallback: string) => fallback),
  mockGetSettings: vi.fn(),
  mockFetchVendorOrdersDetail: vi.fn(),
  mockLookupVendorName: vi.fn(),
}));

vi.mock("../services/branchStore.js", () => ({
  addBranch: mockAddBranch,
  updateBranch: mockUpdateBranch,
  deleteBranch: mockDeleteBranch,
  getBranchById: mockGetBranchById,
  listBranches: mockListBranches,
}));

vi.mock("../services/monitorOrdersPolling.js", () => ({
  resolveOrdersGlobalEntityId: mockResolveOrdersGlobalEntityId,
}));

vi.mock("../services/settingsStore.js", () => ({
  getSettings: mockGetSettings,
}));

vi.mock("../services/ordersClient.js", () => ({
  fetchVendorOrdersDetail: mockFetchVendorOrdersDetail,
  lookupVendorName: mockLookupVendorName,
}));

import { addBranchRoute, updateBranchRoute } from "./branches.js";

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

function validBranchBody() {
  return {
    name: "Branch 1",
    chainName: "Chain A",
    ordersVendorId: 111,
    availabilityVendorId: "222",
    globalEntityId: "HF_EG",
    enabled: true,
  };
}

describe("branches routes unique-constraint handling", () => {
  beforeEach(() => {
    mockAddBranch.mockReset();
    mockUpdateBranch.mockReset();
  });

  it("returns 409 + field for duplicate availabilityVendorId on add", () => {
    mockAddBranch.mockImplementation(() => {
      const error: any = new Error("SqliteError: UNIQUE constraint failed: branches.availabilityVendorId");
      error.code = "SQLITE_CONSTRAINT_UNIQUE";
      throw error;
    });

    const req: any = { body: validBranchBody() };
    const res = createResponse();

    addBranchRoute(req, res);

    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.body).toEqual({
      ok: false,
      message: "Availability Vendor ID already exists",
      field: "availabilityVendorId",
    });
  });

  it("returns 409 + field for duplicate ordersVendorId on update", () => {
    mockUpdateBranch.mockImplementation(() => {
      const error: any = new Error("SqliteError: UNIQUE constraint failed: branches.ordersVendorId");
      error.code = "SQLITE_CONSTRAINT_UNIQUE";
      throw error;
    });

    const req: any = {
      params: { id: "7" },
      body: validBranchBody(),
    };
    const res = createResponse();

    updateBranchRoute(req, res);

    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.body).toEqual({
      ok: false,
      message: "Orders Vendor ID already exists",
      field: "ordersVendorId",
    });
  });
});
