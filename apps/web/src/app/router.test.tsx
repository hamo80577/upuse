import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { AppRouter } from "./router";

const mockUseAuth = vi.hoisted(() => vi.fn());

vi.mock("./providers/AuthProvider", () => ({
  useAuth: mockUseAuth,
}));

vi.mock("../pages/dashboard/ui/DashboardPage", () => ({
  DashboardPage: () => <div>dashboard-route</div>,
}));

vi.mock("../pages/login/ui/LoginPage", () => ({
  LoginPage: () => <div>login-route</div>,
}));

vi.mock("../pages/settings/ui/SettingsPage", () => ({
  SettingsPage: () => <div>settings-route</div>,
}));

vi.mock("../pages/branches/ui/BranchesPage", () => ({
  BranchesPage: () => <div>branches-route</div>,
}));

vi.mock("../pages/thresholds/ui/ThresholdsPage", () => ({
  ThresholdsPage: () => <div>thresholds-route</div>,
}));

vi.mock("../pages/users/ui/UsersPage", () => ({
  UsersPage: () => <div>users-route</div>,
}));

describe("AppRouter", () => {
  it("routes branches and threshold paths to their named pages", async () => {
    mockUseAuth.mockReturnValue({
      status: "authenticated",
      isAdmin: true,
    });

    const renderAt = (path: string) => render(
      <MemoryRouter initialEntries={[path]}>
        <AppRouter />
      </MemoryRouter>,
    );

    const branchesView = renderAt("/branches");

    await waitFor(() => {
      expect(screen.getByText("branches-route")).toBeInTheDocument();
    });

    branchesView.unmount();

    const thresholdsSettingsView = renderAt("/settings/thresholds");

    await waitFor(() => {
      expect(screen.getByText("thresholds-route")).toBeInTheDocument();
    });

    thresholdsSettingsView.unmount();

    renderAt("/thresholds");

    await waitFor(() => {
      expect(screen.getByText("thresholds-route")).toBeInTheDocument();
    });
  });

  it("redirects the legacy mapping route to branches", async () => {
    mockUseAuth.mockReturnValue({
      status: "authenticated",
      isAdmin: true,
    });

    render(
      <MemoryRouter initialEntries={["/mapping"]}>
        <AppRouter />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText("branches-route")).toBeInTheDocument();
    });
    expect(screen.queryByText("login-route")).not.toBeInTheDocument();
  });

  it("redirects restricted users away from the admin-only users route", async () => {
    mockUseAuth.mockReturnValue({
      status: "authenticated",
      isAdmin: false,
    });

    render(
      <MemoryRouter initialEntries={["/users"]}>
        <AppRouter />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText("dashboard-route")).toBeInTheDocument();
    });
    expect(screen.queryByText("users-route")).not.toBeInTheDocument();
  });
});
