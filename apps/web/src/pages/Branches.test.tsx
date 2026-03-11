import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";

const mockApi = vi.hoisted(() => ({
  dashboard: vi.fn(),
  getSettings: vi.fn(),
  listBranches: vi.fn(),
  branchCatalog: vi.fn(),
  refreshBranchCatalog: vi.fn(),
  addBranch: vi.fn(),
  updateBranch: vi.fn(),
  putSettings: vi.fn(),
  setBranchMonitoring: vi.fn(),
  deleteBranch: vi.fn(),
}));

vi.mock("../api/client", () => ({
  api: mockApi,
  describeApiError: (error: unknown, fallback = "Request failed") => (error instanceof Error ? error.message : fallback),
}));

vi.mock("../app/providers/AuthProvider", () => ({
  useAuth: () => ({
    canManageBranches: true,
    canDeleteBranches: true,
    canManageMonitor: true,
    canManageSettings: false,
  }),
}));

vi.mock("../app/providers/MonitorStatusProvider", () => ({
  useMonitorStatus: () => ({
    monitoring: { running: true, degraded: false },
    startMonitoring: vi.fn(),
    stopMonitoring: vi.fn(),
  }),
}));

vi.mock("../components/TopBar", () => ({
  TopBar: () => null,
}));

import { BranchesPage } from "./Branches";

describe("BranchesPage", () => {
  beforeEach(() => {
    Object.values(mockApi).forEach((mockFn) => mockFn.mockReset());

    mockApi.getSettings.mockResolvedValue({
      ordersToken: "",
      availabilityToken: "",
      globalEntityId: "HF_EG",
      chainNames: ["Chain A"],
      chains: [{ name: "Chain A", lateThreshold: 5, unassignedThreshold: 5 }],
      lateThreshold: 5,
      unassignedThreshold: 5,
      tempCloseMinutes: 30,
      graceMinutes: 5,
      ordersRefreshSeconds: 30,
      availabilityRefreshSeconds: 30,
      maxVendorsPerOrdersRequest: 50,
    });
    mockApi.listBranches.mockResolvedValue({ items: [] });
    mockApi.branchCatalog.mockResolvedValue({
      items: [
        {
          availabilityVendorId: "740921",
          ordersVendorId: 48664,
          name: "Carrefour, Zahraa El Maadi - El Me'arag El Ouloy",
          globalEntityId: "HF_EG",
          availabilityState: "OPEN",
          changeable: true,
          presentInSource: true,
          resolveStatus: "resolved",
          lastSeenAt: "2026-03-11T09:00:00.000Z",
          resolvedAt: "2026-03-11T09:00:00.000Z",
          lastError: null,
          alreadyAdded: false,
          branchId: null,
          chainName: null,
          enabled: null,
        },
      ],
      syncState: "fresh",
      lastSyncedAt: "2026-03-11T09:00:00.000Z",
      lastError: null,
    });
  });

  it("loads settings, saved branches, and the source catalog without fetching the dashboard snapshot", async () => {
    render(
      <MemoryRouter>
        <BranchesPage />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(mockApi.getSettings).toHaveBeenCalled();
      expect(mockApi.listBranches).toHaveBeenCalled();
      expect(mockApi.branchCatalog).toHaveBeenCalled();
    });

    expect(mockApi.dashboard).not.toHaveBeenCalled();
    expect(screen.getByText("Start typing to search source branches.")).toBeInTheDocument();
    expect(screen.queryByText("Carrefour, Zahraa El Maadi - El Me'arag El Ouloy")).not.toBeInTheDocument();
  });

  it("adds a branch from the local source catalog after selecting a chain", async () => {
    mockApi.addBranch.mockResolvedValue({ ok: true, id: 33 });
    mockApi.listBranches
      .mockResolvedValueOnce({ items: [] })
      .mockResolvedValueOnce({
        items: [
          {
            id: 33,
            name: "Carrefour, Zahraa El Maadi - El Me'arag El Ouloy",
            chainName: "Chain A",
            ordersVendorId: 48664,
            availabilityVendorId: "740921",
            globalEntityId: "HF_EG",
            enabled: true,
            lateThresholdOverride: null,
            unassignedThresholdOverride: null,
          },
        ],
      });
    mockApi.branchCatalog
      .mockResolvedValueOnce({
        items: [
          {
            availabilityVendorId: "740921",
            ordersVendorId: 48664,
            name: "Carrefour, Zahraa El Maadi - El Me'arag El Ouloy",
            globalEntityId: "HF_EG",
            availabilityState: "OPEN",
            changeable: true,
            presentInSource: true,
            resolveStatus: "resolved",
            lastSeenAt: "2026-03-11T09:00:00.000Z",
            resolvedAt: "2026-03-11T09:00:00.000Z",
            lastError: null,
            alreadyAdded: false,
            branchId: null,
            chainName: null,
            enabled: null,
          },
        ],
        syncState: "fresh",
        lastSyncedAt: "2026-03-11T09:00:00.000Z",
        lastError: null,
      })
      .mockResolvedValueOnce({
        items: [
          {
            availabilityVendorId: "740921",
            ordersVendorId: 48664,
            name: "Carrefour, Zahraa El Maadi - El Me'arag El Ouloy",
            globalEntityId: "HF_EG",
            availabilityState: "OPEN",
            changeable: true,
            presentInSource: true,
            resolveStatus: "resolved",
            lastSeenAt: "2026-03-11T09:00:00.000Z",
            resolvedAt: "2026-03-11T09:00:00.000Z",
            lastError: null,
            alreadyAdded: true,
            branchId: 33,
            chainName: "Chain A",
            enabled: true,
          },
        ],
        syncState: "fresh",
        lastSyncedAt: "2026-03-11T09:05:00.000Z",
        lastError: null,
      });

    render(
      <MemoryRouter>
        <BranchesPage />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText("Start typing to search source branches.")).toBeInTheDocument();
    });

    fireEvent.change(screen.getByPlaceholderText("Search by branch name or availability ID"), {
      target: { value: "zahraa" },
    });
    fireEvent.click(screen.getByText("Carrefour, Zahraa El Maadi - El Me'arag El Ouloy"));
    fireEvent.mouseDown(screen.getByLabelText("Chain"));
    fireEvent.click(screen.getByRole("option", { name: "Chain A" }));
    fireEvent.click(screen.getByRole("button", { name: "Add Branch" }));

    await waitFor(() => {
      expect(mockApi.addBranch).toHaveBeenCalledWith({
        availabilityVendorId: "740921",
        chainName: "Chain A",
        enabled: true,
      });
    });
  });

  it("lets operators toggle a paused branch back into monitor from the saved branches list", async () => {
    mockApi.listBranches.mockResolvedValue({
      items: [
        {
          id: 2,
          name: "Paused Branch",
          chainName: "Chain A",
          ordersVendorId: 22,
          availabilityVendorId: "202",
          globalEntityId: "HF_EG",
          enabled: false,
          lateThresholdOverride: null,
          unassignedThresholdOverride: null,
        },
      ],
    });
    mockApi.branchCatalog.mockResolvedValue({
      items: [
        {
          availabilityVendorId: "202",
          ordersVendorId: 22,
          name: "Paused Branch",
          globalEntityId: "HF_EG",
          availabilityState: "OPEN",
          changeable: true,
          presentInSource: true,
          resolveStatus: "resolved",
          lastSeenAt: "2026-03-11T09:00:00.000Z",
          resolvedAt: "2026-03-11T09:00:00.000Z",
          lastError: null,
          alreadyAdded: true,
          branchId: 2,
          chainName: "Chain A",
          enabled: false,
        },
      ],
      syncState: "fresh",
      lastSyncedAt: "2026-03-11T09:00:00.000Z",
      lastError: null,
    });
    mockApi.setBranchMonitoring.mockResolvedValue({
      ok: true,
      item: {
        id: 2,
        name: "Paused Branch",
        chainName: "Chain A",
        ordersVendorId: 22,
        availabilityVendorId: "202",
        globalEntityId: "HF_EG",
        enabled: true,
        lateThresholdOverride: null,
        unassignedThresholdOverride: null,
      },
    });

    render(
      <MemoryRouter>
        <BranchesPage />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Paused/i })).toBeInTheDocument();
    });

    expect(screen.queryByRole("checkbox", { name: "Toggle monitor for Paused Branch" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Paused/i }));

    await waitFor(() => {
      expect(screen.getByRole("checkbox", { name: "Toggle monitor for Paused Branch" })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("checkbox", { name: "Toggle monitor for Paused Branch" }));

    await waitFor(() => {
      expect(mockApi.setBranchMonitoring).toHaveBeenCalledWith(2, true);
    });
  });
});
