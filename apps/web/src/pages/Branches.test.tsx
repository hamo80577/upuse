import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";

const mockApi = vi.hoisted(() => ({
  dashboard: vi.fn(),
  getSettings: vi.fn(),
  listBranches: vi.fn(),
  lookupVendorName: vi.fn(),
  setBranchMonitoring: vi.fn(),
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
    mockApi.dashboard.mockReset();
    mockApi.getSettings.mockReset();
    mockApi.listBranches.mockReset();
    mockApi.lookupVendorName.mockReset();
    mockApi.setBranchMonitoring.mockReset();
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
  });

  it("loads branches without fetching the full dashboard snapshot", async () => {
    render(
      <MemoryRouter>
        <BranchesPage />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(mockApi.getSettings).toHaveBeenCalled();
      expect(mockApi.listBranches).toHaveBeenCalled();
    });

    expect(mockApi.dashboard).not.toHaveBeenCalled();
  });

  it("fills the branch name from the structured lookup response and shows the lookup note", async () => {
    mockApi.lookupVendorName.mockResolvedValue({
      ok: true,
      name: "Saved Branch",
      source: "branch_mapping",
      resolvedGlobalEntityId: "HF_EG",
      checkedSources: ["branch_mapping"],
      note: "Name filled from the saved branch mapping for this vendor.",
    });

    render(
      <MemoryRouter>
        <BranchesPage />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(mockApi.getSettings).toHaveBeenCalled();
      expect(mockApi.listBranches).toHaveBeenCalled();
    });

    fireEvent.change(screen.getByLabelText("Orders Vendor ID"), {
      target: { value: "33" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Auto-fill Name" }));

    await waitFor(() => {
      expect(mockApi.lookupVendorName).toHaveBeenCalledWith(33, "HF_EG");
    });

    expect((screen.getByLabelText("Branch Name") as HTMLInputElement).value).toBe("Saved Branch");
    expect(screen.getByText("Name filled from the saved branch mapping for this vendor.")).toBeInTheDocument();
  });

  it("shows the explicit unresolved lookup note instead of a generic error", async () => {
    mockApi.lookupVendorName.mockResolvedValue({
      ok: true,
      name: null,
      source: "none",
      resolvedGlobalEntityId: "HF_EG",
      checkedSources: ["branch_mapping", "recent_orders"],
      note: "Checked saved branch mappings and recent orders in the last 30 days. No name could be inferred for this vendor right now.",
    });

    render(
      <MemoryRouter>
        <BranchesPage />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(mockApi.getSettings).toHaveBeenCalled();
      expect(mockApi.listBranches).toHaveBeenCalled();
    });

    fireEvent.change(screen.getByLabelText("Orders Vendor ID"), {
      target: { value: "33" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Auto-fill Name" }));

    await waitFor(() => {
      expect(mockApi.lookupVendorName).toHaveBeenCalledWith(33, "HF_EG");
    });

    expect(screen.getByText("Checked saved branch mappings and recent orders in the last 30 days. No name could be inferred for this vendor right now.")).toBeInTheDocument();
  });

  it("surfaces paused branches first and lets operators toggle a branch back into monitor", async () => {
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
        {
          id: 1,
          name: "Live Branch",
          chainName: "Chain A",
          ordersVendorId: 11,
          availabilityVendorId: "101",
          globalEntityId: "HF_EG",
          enabled: true,
          lateThresholdOverride: null,
          unassignedThresholdOverride: null,
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
      expect(screen.getByText("Paused Branch")).toBeInTheDocument();
      expect(screen.getByRole("checkbox", { name: "Toggle monitor for Paused Branch" })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("checkbox", { name: "Toggle monitor for Paused Branch" }));

    await waitFor(() => {
      expect(mockApi.setBranchMonitoring).toHaveBeenCalledWith(2, true);
    });
  });
});
