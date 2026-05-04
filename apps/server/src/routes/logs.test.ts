import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockGetBranchById, mockGetLogsDayPage } = vi.hoisted(() => ({
  mockGetBranchById: vi.fn(),
  mockGetLogsDayPage: vi.fn(),
}));

vi.mock("../services/branchStore.js", () => ({
  getBranchById: mockGetBranchById,
}));

vi.mock("../services/logger.js", () => ({
  clearLogs: vi.fn(),
  getLogsDayPage: mockGetLogsDayPage,
}));

import { logsRoute } from "./logs.js";

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

describe("logsRoute", () => {
  beforeEach(() => {
    mockGetBranchById.mockReset();
    mockGetLogsDayPage.mockReset();
  });

  it("allows tracker users to read logs for assigned branch chains", () => {
    mockGetBranchById.mockReturnValue({
      id: 7,
      chainName: "Chain A",
    });
    mockGetLogsDayPage.mockReturnValue({
      items: [{ id: 1, message: "ok" }],
      nextBeforeDay: null,
    });
    const res = createResponse();

    logsRoute({
      authUser: {
        id: 4,
        role: "tracker",
        upuseAccess: true,
        assignedChains: ["chain a"],
      },
      query: { branchId: "7" },
    } as any, res as any);

    expect(res.statusCode).toBe(200);
    expect(mockGetLogsDayPage).toHaveBeenCalledWith(7, undefined);
    expect(res.body).toEqual({
      items: [{ id: 1, message: "ok" }],
      nextBeforeDay: null,
    });
  });

  it("rejects tracker users from logs for unassigned branch chains", () => {
    mockGetBranchById.mockReturnValue({
      id: 8,
      chainName: "Chain B",
    });
    const res = createResponse();

    logsRoute({
      authUser: {
        id: 4,
        role: "tracker",
        upuseAccess: true,
        assignedChains: ["Chain A"],
      },
      query: { branchId: "8" },
    } as any, res as any);

    expect(res.statusCode).toBe(403);
    expect(mockGetLogsDayPage).not.toHaveBeenCalled();
    expect(res.body).toMatchObject({
      ok: false,
      code: "FORBIDDEN",
    });
  });
});
