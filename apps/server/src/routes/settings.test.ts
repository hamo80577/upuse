import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockGetSettings,
  mockUpdateSettings,
  mockStartSettingsTokenTestJob,
  mockGetSettingsTokenTestSnapshot,
} = vi.hoisted(() => ({
  mockGetSettings: vi.fn(),
  mockUpdateSettings: vi.fn(),
  mockStartSettingsTokenTestJob: vi.fn(),
  mockGetSettingsTokenTestSnapshot: vi.fn(),
}));

vi.mock("../services/settingsStore.js", () => ({
  getSettings: mockGetSettings,
  updateSettings: mockUpdateSettings,
}));

vi.mock("../services/settingsTokenTestStore.js", () => ({
  startSettingsTokenTestJob: mockStartSettingsTokenTestJob,
  getSettingsTokenTestSnapshot: mockGetSettingsTokenTestSnapshot,
}));

import { getTokenTestRoute, putSettingsRoute, testTokensRoute } from "./settings.js";

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
    mockStartSettingsTokenTestJob.mockReset();
    mockGetSettingsTokenTestSnapshot.mockReset();
  });

  it("starts an async token test job and returns 202 with the initial snapshot", async () => {
    mockStartSettingsTokenTestJob.mockReturnValue({
      jobId: "job-123",
      snapshot: {
        jobId: "job-123",
        status: "pending",
        createdAt: "2026-03-13T00:00:00.000Z",
        progress: {
          totalBranches: 2,
          processedBranches: 0,
          passedBranches: 0,
          failedBranches: 0,
          percent: 0,
        },
        availability: { configured: true, ok: false, status: null },
        orders: {
          configValid: true,
          ok: false,
          probe: { configured: true, ok: false, status: null },
          enabledBranchCount: 2,
          passedBranchCount: 0,
          failedBranchCount: 0,
          branches: [],
        },
      },
    });

    const res = createResponse();
    await testTokensRoute({} as any, res);

    expect(res.statusCode).toBe(202);
    expect(res.body).toEqual({
      ok: true,
      jobId: "job-123",
      snapshot: expect.objectContaining({
        jobId: "job-123",
        status: "pending",
        progress: expect.objectContaining({
          totalBranches: 2,
          processedBranches: 0,
        }),
        orders: expect.objectContaining({
          configValid: true,
          enabledBranchCount: 2,
        }),
      }),
    });
  });

  it("returns a stored token test snapshot by job id", () => {
    mockGetSettingsTokenTestSnapshot.mockReturnValue({
      jobId: "job-123",
      status: "completed",
      createdAt: "2026-03-13T00:00:00.000Z",
      startedAt: "2026-03-13T00:00:01.000Z",
      completedAt: "2026-03-13T00:00:05.000Z",
      progress: {
        totalBranches: 2,
        processedBranches: 2,
        passedBranches: 1,
        failedBranches: 1,
        percent: 100,
      },
      availability: { configured: true, ok: true, status: null },
      orders: {
        configValid: true,
        ok: false,
        probe: { configured: true, ok: true, status: null },
        enabledBranchCount: 2,
        passedBranchCount: 1,
        failedBranchCount: 1,
        branches: [
          { branchId: 1, name: "A", ordersVendorId: 11, ok: true, status: null, sampleVendorName: "Branch A" },
          { branchId: 2, name: "B", ordersVendorId: 22, ok: false, status: 401, message: "Unauthorized" },
        ],
      },
    });

    const res = createResponse();
    getTokenTestRoute({ params: { jobId: "job-123" } } as any, res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({
      jobId: "job-123",
      status: "completed",
      orders: {
        passedBranchCount: 1,
        failedBranchCount: 1,
      },
    });
  });

  it("returns 404 when the token test job is missing", () => {
    mockGetSettingsTokenTestSnapshot.mockReturnValue(null);
    const res = createResponse();
    getTokenTestRoute({ params: { jobId: "missing-job" } } as any, res);

    expect(res.statusCode).toBe(404);
    expect(res.body).toEqual({
      ok: false,
      message: "Token test job not found",
    });
  });
});

describe("putSettingsRoute", () => {
  beforeEach(() => {
    mockUpdateSettings.mockReset();
    mockUpdateSettings.mockImplementation((patch: Record<string, unknown>) => ({
      ordersToken: patch.ordersToken ?? "orders-token",
      availabilityToken: patch.availabilityToken ?? "availability-token",
      globalEntityId: patch.globalEntityId ?? "HF_EG",
      chainNames: [],
      chains: [],
      lateThreshold: patch.lateThreshold ?? 5,
      unassignedThreshold: patch.unassignedThreshold ?? 5,
      tempCloseMinutes: patch.tempCloseMinutes ?? 30,
      graceMinutes: patch.graceMinutes ?? 5,
      ordersRefreshSeconds: patch.ordersRefreshSeconds ?? 30,
      availabilityRefreshSeconds: patch.availabilityRefreshSeconds ?? 30,
      maxVendorsPerOrdersRequest: patch.maxVendorsPerOrdersRequest ?? 50,
    }));
  });

  it("accepts admin settings updates and returns masked tokens", () => {
    const req: any = {
      body: {
        ordersToken: "updated-orders-token",
        lateThreshold: 9,
      },
    };
    const res = createResponse();

    putSettingsRoute(req, res);

    expect(mockUpdateSettings).toHaveBeenCalledWith({
      ordersToken: "updated-orders-token",
      lateThreshold: 9,
    });
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({
      ok: true,
      settings: {
        ordersToken: "upda…oken",
        availabilityToken: "avai…oken",
        lateThreshold: 9,
      },
    });
  });

  it("accepts global entity updates without requiring token changes", () => {
    const req: any = {
      body: {
        globalEntityId: "HF_SA",
      },
    };
    const res = createResponse();

    putSettingsRoute(req, res);

    expect(mockUpdateSettings).toHaveBeenCalledWith({
      globalEntityId: "HF_SA",
    });
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({
      ok: true,
      settings: {
        globalEntityId: "HF_SA",
      },
    });
  });
});
