import express from "express";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Server } from "node:http";

const {
  mockGetPerformanceSummary,
  mockGetPerformanceBranchDetail,
  mockGetPerformanceVendorDetail,
} = vi.hoisted(() => ({
  mockGetPerformanceSummary: vi.fn(),
  mockGetPerformanceBranchDetail: vi.fn(),
  mockGetPerformanceVendorDetail: vi.fn(),
}));

vi.mock("../services/performanceStore.js", () => ({
  getPerformanceSummary: mockGetPerformanceSummary,
  getPerformanceBranchDetail: mockGetPerformanceBranchDetail,
  getPerformanceVendorDetail: mockGetPerformanceVendorDetail,
}));

vi.mock("../services/authStore.js", () => ({
  getSessionUserByToken: vi.fn(() => null),
}));

import { requireAuthenticatedApi } from "../http/auth.js";
import { performanceBranchDetailRoute, performanceSummaryRoute, performanceVendorDetailRoute } from "./performance.js";

function createEngine() {
  return {
    getSnapshot: () => ({
      branches: [
        {
          branchId: 7,
          statusColor: "orange",
        },
      ],
    }),
  } as any;
}

function createApp() {
  const app = express();
  app.use((req, _res, next) => {
    const role = req.header("x-role");
    if (role === "admin" || role === "user") {
      req.authUser = {
        id: role === "admin" ? 1 : 2,
        email: `${role}@example.com`,
        name: role,
        role,
        active: true,
        createdAt: "2026-03-20T10:00:00.000Z",
      };
    }
    next();
  });
  app.use(requireAuthenticatedApi());
  app.get("/api/performance", performanceSummaryRoute(createEngine()));
  app.get("/api/performance/branches/:id", performanceBranchDetailRoute(createEngine()));
  app.get("/api/performance/vendors/:id", performanceVendorDetailRoute());
  return app;
}

async function startServer() {
  const app = createApp();
  const server = await new Promise<Server>((resolve) => {
    const nextServer = app.listen(0, () => resolve(nextServer));
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Failed to resolve test server address");
  }

  return {
    server,
    baseUrl: `http://127.0.0.1:${address.port}`,
  };
}

describe("performance routes", () => {
  let server: Server | null = null;
  let baseUrl = "";

  beforeEach(async () => {
    mockGetPerformanceSummary.mockReset();
    mockGetPerformanceBranchDetail.mockReset();
    mockGetPerformanceVendorDetail.mockReset();

    const started = await startServer();
    server = started.server;
    baseUrl = started.baseUrl;
  });

  afterEach(async () => {
    await new Promise<void>((resolve, reject) => {
      if (!server) {
        resolve();
        return;
      }
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
    server = null;
  });

  it("requires authentication for the performance summary route", async () => {
    const response = await fetch(`${baseUrl}/api/performance`);
    expect(response.status).toBe(401);
  });

  it("returns performance summary for authenticated user and admin roles", async () => {
    mockGetPerformanceSummary.mockResolvedValue({
      cards: {
        branchCount: 1,
        totalOrders: 10,
        totalCancelledOrders: 2,
        activeOrders: 4,
        lateNow: 1,
        onHoldOrders: 1,
        unassignedOrders: 1,
        inPrepOrders: 2,
        readyToPickupOrders: 1,
        vfr: 20,
        lfr: 10,
        vlfr: 30,
        vendorOwnerCancelledCount: 2,
        transportOwnerCancelledCount: 1,
      },
      statusCounts: [],
      ownerCoverage: {
        totalCancelledOrders: 2,
        resolvedOwnerCount: 2,
        unresolvedOwnerCount: 0,
        vendorOwnerCancelledCount: 2,
        transportOwnerCancelledCount: 1,
        lookupErrorCount: 0,
        coverageRatio: 1,
        warning: null,
      },
      branches: [],
      chains: [],
      unmappedVendors: [],
      fetchedAt: "2026-03-20T10:00:00.000Z",
      cacheState: "fresh",
      scope: {
        dayKey: "2026-03-20",
        timezone: "Africa/Cairo",
        startUtcIso: "2026-03-19T22:00:00.000Z",
        endUtcIso: "2026-03-20T21:59:59.999Z",
      },
    });

    const userResponse = await fetch(`${baseUrl}/api/performance`, {
      headers: { "x-role": "user" },
    });
    const adminResponse = await fetch(`${baseUrl}/api/performance`, {
      headers: { "x-role": "admin" },
    });

    expect(userResponse.status).toBe(200);
    expect(adminResponse.status).toBe(200);
    expect(mockGetPerformanceSummary).toHaveBeenCalledTimes(2);
  });

  it("returns branch performance detail for authenticated callers", async () => {
    mockGetPerformanceBranchDetail.mockResolvedValue({
      kind: "mapped_branch",
      branch: {
        branchId: 7,
        name: "Branch 7",
        chainName: "Chain A",
        ordersVendorId: 111,
        availabilityVendorId: "222",
        statusColor: "orange",
      },
      summary: {
        totalOrders: 8,
        totalCancelledOrders: 1,
        activeOrders: 0,
        lateNow: 0,
        onHoldOrders: 0,
        unassignedOrders: 0,
        inPrepOrders: 0,
        readyToPickupOrders: 0,
        vendorOwnerCancelledCount: 1,
        transportOwnerCancelledCount: 0,
        customerOwnerCancelledCount: 0,
        unknownOwnerCancelledCount: 0,
        vfr: 12.5,
        lfr: 0,
        vlfr: 12.5,
        deliveryMode: "logistics",
        lfrApplicable: true,
      },
      statusCounts: [{ status: "CANCELLED", count: 1 }],
      ownerCoverage: {
        totalCancelledOrders: 1,
        resolvedOwnerCount: 1,
        unresolvedOwnerCount: 0,
        vendorOwnerCancelledCount: 1,
        transportOwnerCancelledCount: 0,
        lookupErrorCount: 0,
        coverageRatio: 1,
        warning: null,
      },
      onHoldOrders: [],
      unassignedOrders: [],
      inPrepOrders: [],
      readyToPickupOrders: [],
      cancelledOrders: [],
      vendorOwnerCancelledOrders: [],
      unknownOwnerCancelledOrders: [],
      pickers: {
        todayCount: 0,
        activePreparingCount: 0,
        recentActiveCount: 0,
        items: [],
      },
      fetchedAt: "2026-03-20T10:00:00.000Z",
      cacheState: "fresh",
    });

    const response = await fetch(`${baseUrl}/api/performance/branches/7`, {
      headers: { "x-role": "user" },
    });

    expect(response.status).toBe(200);
    expect(mockGetPerformanceBranchDetail).toHaveBeenCalledWith(7, new Map([[7, "orange"]]));
  });

  it("returns unmapped vendor detail for authenticated callers", async () => {
    mockGetPerformanceVendorDetail.mockResolvedValue({
      kind: "vendor",
      vendor: {
        vendorId: 991,
        vendorName: "Loose Vendor",
        globalEntityId: "TB_EG",
        statusColor: "grey",
      },
      mappedBranch: null,
      summary: {
        totalOrders: 4,
        totalCancelledOrders: 1,
        activeOrders: 0,
        lateNow: 0,
        onHoldOrders: 0,
        unassignedOrders: 0,
        inPrepOrders: 0,
        readyToPickupOrders: 0,
        vendorOwnerCancelledCount: 1,
        transportOwnerCancelledCount: 0,
        customerOwnerCancelledCount: 0,
        unknownOwnerCancelledCount: 0,
        vfr: 25,
        lfr: 0,
        vlfr: 25,
        deliveryMode: "self",
        lfrApplicable: false,
      },
      statusCounts: [{ status: "CANCELLED", count: 1 }],
      ownerCoverage: {
        totalCancelledOrders: 1,
        resolvedOwnerCount: 1,
        unresolvedOwnerCount: 0,
        vendorOwnerCancelledCount: 1,
        transportOwnerCancelledCount: 0,
        lookupErrorCount: 0,
        coverageRatio: 1,
        warning: null,
      },
      onHoldOrders: [],
      unassignedOrders: [],
      inPrepOrders: [],
      readyToPickupOrders: [],
      cancelledOrders: [],
      vendorOwnerCancelledOrders: [],
      unknownOwnerCancelledOrders: [],
      pickers: {
        todayCount: 0,
        activePreparingCount: 0,
        recentActiveCount: 0,
        items: [],
      },
      fetchedAt: "2026-03-20T10:00:00.000Z",
      cacheState: "fresh",
    });

    const response = await fetch(`${baseUrl}/api/performance/vendors/991`, {
      headers: { "x-role": "user" },
    });

    expect(response.status).toBe(200);
    expect(mockGetPerformanceVendorDetail).toHaveBeenCalledWith(991);
  });

  it("returns 400 for invalid branch and vendor ids", async () => {
    const branchResponse = await fetch(`${baseUrl}/api/performance/branches/not-a-number`, {
      headers: { "x-role": "user" },
    });
    const vendorResponse = await fetch(`${baseUrl}/api/performance/vendors/not-a-number`, {
      headers: { "x-role": "user" },
    });

    expect(branchResponse.status).toBe(400);
    expect(vendorResponse.status).toBe(400);
  });

  it("returns 404 when a branch or vendor detail cannot be found", async () => {
    mockGetPerformanceBranchDetail.mockResolvedValue(null);
    mockGetPerformanceVendorDetail.mockResolvedValue(null);

    const branchResponse = await fetch(`${baseUrl}/api/performance/branches/999`, {
      headers: { "x-role": "user" },
    });
    const vendorResponse = await fetch(`${baseUrl}/api/performance/vendors/999`, {
      headers: { "x-role": "user" },
    });

    expect(branchResponse.status).toBe(404);
    expect(vendorResponse.status).toBe(404);
  });
});
