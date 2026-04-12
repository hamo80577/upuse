import express from "express";
import type { Server } from "node:http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockGetPerformancePreferences,
  mockSavePerformanceCurrentState,
  mockCreatePerformanceSavedGroup,
  mockUpdatePerformanceSavedGroup,
  mockDeletePerformanceSavedGroup,
  mockCreatePerformanceSavedView,
  mockUpdatePerformanceSavedView,
  mockDeletePerformanceSavedView,
} = vi.hoisted(() => ({
  mockGetPerformancePreferences: vi.fn(),
  mockSavePerformanceCurrentState: vi.fn(),
  mockCreatePerformanceSavedGroup: vi.fn(),
  mockUpdatePerformanceSavedGroup: vi.fn(),
  mockDeletePerformanceSavedGroup: vi.fn(),
  mockCreatePerformanceSavedView: vi.fn(),
  mockUpdatePerformanceSavedView: vi.fn(),
  mockDeletePerformanceSavedView: vi.fn(),
}));

vi.mock("../services/performancePreferencesStore.js", () => ({
  getPerformancePreferences: mockGetPerformancePreferences,
  savePerformanceCurrentState: mockSavePerformanceCurrentState,
  createPerformanceSavedGroup: mockCreatePerformanceSavedGroup,
  updatePerformanceSavedGroup: mockUpdatePerformanceSavedGroup,
  deletePerformanceSavedGroup: mockDeletePerformanceSavedGroup,
  createPerformanceSavedView: mockCreatePerformanceSavedView,
  updatePerformanceSavedView: mockUpdatePerformanceSavedView,
  deletePerformanceSavedView: mockDeletePerformanceSavedView,
}));

vi.mock("../services/authStore.js", () => ({
  getSessionUserByToken: vi.fn(() => null),
}));

vi.mock("../core/systems/auth/registry/index.js", () => ({
  canUserAccessSystem: vi.fn(),
}));

import { requireAuthenticatedApi } from "../shared/http/auth/sessionAuth.js";
import {
  createPerformanceGroupRoute,
  createPerformanceViewRoute,
  deletePerformanceGroupRoute,
  deletePerformanceViewRoute,
  getPerformancePreferencesRoute,
  putPerformanceCurrentPreferencesRoute,
  updatePerformanceGroupRoute,
  updatePerformanceViewRoute,
} from "./performancePreferences.js";

const basePreferences = {
  current: {
    searchQuery: "",
    selectedVendorIds: [111],
    selectedDeliveryTypes: ["logistics"] as const,
    selectedBranchFilters: ["vendor"] as const,
    selectedSortKeys: ["orders"] as const,
    nameSortEnabled: false,
    activeGroupId: 1,
    activeViewId: null,
  },
  groups: [
    {
      id: 1,
      name: "Carrefour",
      vendorIds: [111, 112],
      createdAt: "2026-03-21T09:00:00.000Z",
      updatedAt: "2026-03-21T09:00:00.000Z",
    },
  ],
  views: [
    {
      id: 3,
      name: "Morning watch",
      state: {
        searchQuery: "",
        selectedVendorIds: [111],
        selectedDeliveryTypes: ["logistics"] as const,
        selectedBranchFilters: ["vendor"] as const,
        selectedSortKeys: ["orders"] as const,
        nameSortEnabled: false,
      },
      createdAt: "2026-03-21T09:00:00.000Z",
      updatedAt: "2026-03-21T09:00:00.000Z",
    },
  ],
};

function createApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const role = req.header("x-role");
    if (role === "admin" || role === "user") {
      req.authUser = {
        id: role === "admin" ? 1 : 2,
        email: `${role}@example.com`,
        name: role,
        role,
        active: true,
        createdAt: "2026-03-21T10:00:00.000Z",
      };
    }
    next();
  });
  app.use(requireAuthenticatedApi());
  app.get("/api/performance/preferences", getPerformancePreferencesRoute);
  app.put("/api/performance/preferences/current", putPerformanceCurrentPreferencesRoute);
  app.post("/api/performance/preferences/groups", createPerformanceGroupRoute);
  app.patch("/api/performance/preferences/groups/:id", updatePerformanceGroupRoute);
  app.delete("/api/performance/preferences/groups/:id", deletePerformanceGroupRoute);
  app.post("/api/performance/preferences/views", createPerformanceViewRoute);
  app.patch("/api/performance/preferences/views/:id", updatePerformanceViewRoute);
  app.delete("/api/performance/preferences/views/:id", deletePerformanceViewRoute);
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

describe("performance preference routes", () => {
  let server: Server | null = null;
  let baseUrl = "";

  beforeEach(async () => {
    mockGetPerformancePreferences.mockReset();
    mockSavePerformanceCurrentState.mockReset();
    mockCreatePerformanceSavedGroup.mockReset();
    mockUpdatePerformanceSavedGroup.mockReset();
    mockDeletePerformanceSavedGroup.mockReset();
    mockCreatePerformanceSavedView.mockReset();
    mockUpdatePerformanceSavedView.mockReset();
    mockDeletePerformanceSavedView.mockReset();

    mockGetPerformancePreferences.mockReturnValue(basePreferences);
    mockSavePerformanceCurrentState.mockImplementation((_userId, current) => current);
    mockCreatePerformanceSavedGroup.mockImplementation((_userId, payload) => ({
      id: 9,
      createdAt: "2026-03-21T11:00:00.000Z",
      updatedAt: "2026-03-21T11:00:00.000Z",
      ...payload,
    }));
    mockUpdatePerformanceSavedGroup.mockImplementation((_userId, id, payload) => ({
      id,
      name: payload.name ?? "Updated group",
      vendorIds: payload.vendorIds ?? [111],
      createdAt: "2026-03-21T09:00:00.000Z",
      updatedAt: "2026-03-21T11:00:00.000Z",
    }));
    mockCreatePerformanceSavedView.mockImplementation((_userId, payload) => ({
      id: 10,
      name: payload.name,
      state: payload.state,
      createdAt: "2026-03-21T11:00:00.000Z",
      updatedAt: "2026-03-21T11:00:00.000Z",
    }));
    mockUpdatePerformanceSavedView.mockImplementation((_userId, id, payload) => ({
      id,
      name: payload.name ?? "Updated view",
      state: payload.state ?? basePreferences.views[0].state,
      createdAt: "2026-03-21T09:00:00.000Z",
      updatedAt: "2026-03-21T11:00:00.000Z",
    }));

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

  it("requires authentication for preferences reads", async () => {
    const response = await fetch(`${baseUrl}/api/performance/preferences`);
    expect(response.status).toBe(401);
  });

  it("returns user-scoped performance preferences for authenticated callers", async () => {
    const response = await fetch(`${baseUrl}/api/performance/preferences`, {
      headers: { "x-role": "user" },
    });

    expect(response.status).toBe(200);
    expect(mockGetPerformancePreferences).toHaveBeenCalledWith(2);
    await expect(response.json()).resolves.toMatchObject(basePreferences);
  });

  it("saves the current state for the authenticated user", async () => {
    const payload = {
      ...basePreferences.current,
      selectedVendorIds: [111, 112],
      activeGroupId: null,
      activeViewId: 3,
    };

    const response = await fetch(`${baseUrl}/api/performance/preferences/current`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        "x-role": "user",
      },
      body: JSON.stringify(payload),
    });

    expect(response.status).toBe(200);
    expect(mockSavePerformanceCurrentState).toHaveBeenCalledWith(2, expect.objectContaining({
      selectedVendorIds: [111, 112],
      activeViewId: 3,
    }));
  });

  it("creates, updates, and deletes groups for the authenticated user", async () => {
    const createResponse = await fetch(`${baseUrl}/api/performance/preferences/groups`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-role": "user",
      },
      body: JSON.stringify({
        name: "Carrefour",
        vendorIds: [111, 112],
      }),
    });
    const patchResponse = await fetch(`${baseUrl}/api/performance/preferences/groups/9`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        "x-role": "user",
      },
      body: JSON.stringify({
        name: "Carrefour Plus",
      }),
    });
    const deleteResponse = await fetch(`${baseUrl}/api/performance/preferences/groups/9`, {
      method: "DELETE",
      headers: {
        "x-role": "user",
      },
    });

    expect(createResponse.status).toBe(201);
    expect(patchResponse.status).toBe(200);
    expect(deleteResponse.status).toBe(200);
    expect(mockCreatePerformanceSavedGroup).toHaveBeenCalledWith(2, expect.objectContaining({
      name: "Carrefour",
      vendorIds: [111, 112],
    }));
    expect(mockUpdatePerformanceSavedGroup).toHaveBeenCalledWith(2, 9, expect.objectContaining({
      name: "Carrefour Plus",
    }));
    expect(mockDeletePerformanceSavedGroup).toHaveBeenCalledWith(2, 9);
  });

  it("creates, updates, and deletes views for the authenticated user", async () => {
    const createResponse = await fetch(`${baseUrl}/api/performance/preferences/views`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-role": "admin",
      },
      body: JSON.stringify({
        name: "Morning watch",
        state: basePreferences.views[0].state,
      }),
    });
    const patchResponse = await fetch(`${baseUrl}/api/performance/preferences/views/10`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        "x-role": "admin",
      },
      body: JSON.stringify({
        name: "Evening watch",
      }),
    });
    const deleteResponse = await fetch(`${baseUrl}/api/performance/preferences/views/10`, {
      method: "DELETE",
      headers: {
        "x-role": "admin",
      },
    });

    expect(createResponse.status).toBe(201);
    expect(patchResponse.status).toBe(200);
    expect(deleteResponse.status).toBe(200);
    expect(mockCreatePerformanceSavedView).toHaveBeenCalledWith(1, expect.objectContaining({
      name: "Morning watch",
    }));
    expect(mockUpdatePerformanceSavedView).toHaveBeenCalledWith(1, 10, expect.objectContaining({
      name: "Evening watch",
    }));
    expect(mockDeletePerformanceSavedView).toHaveBeenCalledWith(1, 10);
  });
});
