import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";

const mockApi = vi.hoisted(() => ({
  dashboard: vi.fn(),
  getSettings: vi.fn(),
  listBranches: vi.fn(),
  listBranchSource: vi.fn(),
  addBranch: vi.fn(),
  putSettings: vi.fn(),
  setBranchThresholdOverrides: vi.fn(),
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

vi.mock("../features/settings/ChainThresholdManager", () => ({
  ChainThresholdManager: () => null,
}));

vi.mock("../features/settings/BranchThresholdOverrideManager", () => ({
  BranchThresholdOverrideManager: () => null,
}));

import { BranchesPage } from "./Branches";

describe("BranchesPage", () => {
  beforeEach(() => {
    Object.values(mockApi).forEach((mockFn) => mockFn.mockReset());

    mockApi.getSettings.mockResolvedValue({
      ordersToken: "",
      availabilityToken: "",
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
    mockApi.listBranchSource.mockResolvedValue({
      items: [
        {
          availabilityVendorId: "740921",
          ordersVendorId: 48664,
          name: "Carrefour, Zahraa El Maadi - El Me'arag El Ouloy",
          alreadyAdded: false,
          branchId: null,
          chainName: null,
          enabled: null,
        },
      ],
    });
  });

  it("loads settings, saved branches, and local source catalog without fetching dashboard", async () => {
    render(
      <MemoryRouter>
        <BranchesPage />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(mockApi.getSettings).toHaveBeenCalled();
      expect(mockApi.listBranches).toHaveBeenCalled();
      expect(mockApi.listBranchSource).toHaveBeenCalled();
    });

    expect(mockApi.dashboard).not.toHaveBeenCalled();
    expect(screen.getByText("Start typing to search source branches.")).toBeInTheDocument();
    expect(screen.queryByText("Carrefour, Zahraa El Maadi - El Me'arag El Ouloy")).not.toBeInTheDocument();
  });

  it("adds a branch from the local source catalog", async () => {
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
            enabled: true,
            catalogState: "available",
            lateThresholdOverride: null,
            unassignedThresholdOverride: null,
          },
          {
            id: 34,
            name: "Carrefour, Zahraa El Maadi - Ashgar Darna",
            chainName: "Chain A",
            ordersVendorId: 48665,
            availabilityVendorId: "740922",
            enabled: true,
            catalogState: "available",
            lateThresholdOverride: null,
            unassignedThresholdOverride: null,
          },
        ],
      });
    mockApi.listBranchSource
      .mockResolvedValueOnce({
        items: [
          {
            availabilityVendorId: "740921",
            ordersVendorId: 48664,
            name: "Carrefour, Zahraa El Maadi - El Me'arag El Ouloy",
            alreadyAdded: false,
            branchId: null,
            chainName: null,
            enabled: null,
          },
          {
            availabilityVendorId: "740922",
            ordersVendorId: 48665,
            name: "Carrefour, Zahraa El Maadi - Ashgar Darna",
            alreadyAdded: false,
            branchId: null,
            chainName: null,
            enabled: null,
          },
        ],
      })
      .mockResolvedValueOnce({
        items: [
          {
            availabilityVendorId: "740921",
            ordersVendorId: 48664,
            name: "Carrefour, Zahraa El Maadi - El Me'arag El Ouloy",
            alreadyAdded: true,
            branchId: 33,
            chainName: "Chain A",
            enabled: true,
          },
          {
            availabilityVendorId: "740922",
            ordersVendorId: 48665,
            name: "Carrefour, Zahraa El Maadi - Ashgar Darna",
            alreadyAdded: true,
            branchId: 34,
            chainName: "Chain A",
            enabled: true,
          },
        ],
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
      target: { value: "carrefour" },
    });
    fireEvent.click(screen.getByRole("checkbox", { name: "Select Carrefour, Zahraa El Maadi - El Me'arag El Ouloy" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Select Carrefour, Zahraa El Maadi - Ashgar Darna" }));
    fireEvent.mouseDown(screen.getByRole("combobox", { name: "Chain for selected branches" }));
    fireEvent.click(screen.getByRole("option", { name: "Chain A" }));
    fireEvent.click(screen.getByRole("button", { name: "Add 2 branches" }));

    await waitFor(() => {
      expect(mockApi.addBranch).toHaveBeenCalledWith({
        availabilityVendorId: "740921",
        chainName: "Chain A",
        name: "Carrefour, Zahraa El Maadi - El Me'arag El Ouloy",
        ordersVendorId: 48664,
      });
      expect(mockApi.addBranch).toHaveBeenCalledWith({
        availabilityVendorId: "740922",
        chainName: "Chain A",
        name: "Carrefour, Zahraa El Maadi - Ashgar Darna",
        ordersVendorId: 48665,
      });
    });
  });

  it("lets operators toggle a paused branch back into monitor", async () => {
    mockApi.listBranches.mockResolvedValue({
      items: [
        {
          id: 2,
          name: "Paused Branch",
          chainName: "Chain A",
          ordersVendorId: 22,
          availabilityVendorId: "202",
          enabled: false,
          catalogState: "available",
          lateThresholdOverride: null,
          unassignedThresholdOverride: null,
        },
      ],
    });
    mockApi.listBranchSource.mockResolvedValue({
      items: [
        {
          availabilityVendorId: "202",
          ordersVendorId: 22,
          name: "Paused Branch",
          alreadyAdded: true,
          branchId: 2,
          chainName: "Chain A",
          enabled: false,
        },
      ],
    });
    mockApi.setBranchMonitoring.mockResolvedValue({
      ok: true,
      item: {
        id: 2,
        name: "Paused Branch",
        chainName: "Chain A",
        ordersVendorId: 22,
        availabilityVendorId: "202",
        enabled: true,
        catalogState: "available",
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
      expect(screen.getByRole("button", { name: "Toggle Chain A group" })).toBeInTheDocument();
    });

    expect(screen.queryByRole("checkbox", { name: "Toggle monitor for Paused Branch" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Toggle Chain A group" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Toggle monitor for Paused Branch" }));

    await waitFor(() => {
      expect(mockApi.setBranchMonitoring).toHaveBeenCalledWith(2, true);
    });
  });

  it("allows pausing an entire chain from the chain group header", async () => {
    mockApi.listBranches.mockResolvedValue({
      items: [
        {
          id: 11,
          name: "Chain Branch 1",
          chainName: "Metro Market",
          ordersVendorId: 111,
          availabilityVendorId: "911",
          enabled: true,
          catalogState: "available",
          lateThresholdOverride: null,
          unassignedThresholdOverride: null,
        },
        {
          id: 12,
          name: "Chain Branch 2",
          chainName: "Metro Market",
          ordersVendorId: 112,
          availabilityVendorId: "912",
          enabled: true,
          catalogState: "available",
          lateThresholdOverride: null,
          unassignedThresholdOverride: null,
        },
      ],
    });
    mockApi.listBranchSource.mockResolvedValue({ items: [] });
    mockApi.setBranchMonitoring.mockResolvedValue({
      ok: true,
      item: {
        id: 11,
        name: "Chain Branch 1",
        chainName: "Metro Market",
        ordersVendorId: 111,
        availabilityVendorId: "911",
        enabled: false,
        catalogState: "available",
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
      expect(screen.getByRole("button", { name: "Pause Chain" })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Pause Chain" }));

    await waitFor(() => {
      expect(mockApi.setBranchMonitoring).toHaveBeenCalledWith(11, false);
      expect(mockApi.setBranchMonitoring).toHaveBeenCalledWith(12, false);
    });
  });
});
