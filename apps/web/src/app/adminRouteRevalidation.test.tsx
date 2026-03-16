import { render, screen, waitFor } from "@testing-library/react";
import { useEffect } from "react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { AuthProvider } from "./providers/AuthProvider";
import { AppRouter } from "./router";

const mockApi = vi.hoisted(() => ({
  createUser: vi.fn(),
  deleteUser: vi.fn(),
  listUsers: vi.fn(),
  login: vi.fn(),
  logout: vi.fn(),
  me: vi.fn(),
  updateUser: vi.fn(),
}));

const mockDescribeApiError = vi.hoisted(() => vi.fn((error: unknown, fallback = "Request failed") => {
  return error instanceof Error && error.message ? error.message : fallback;
}));

vi.mock("../api/client", () => ({
  AUTH_FORBIDDEN_EVENT: "upuse:auth:forbidden",
  AUTH_UNAUTHORIZED_EVENT: "upuse:auth:unauthorized",
  api: mockApi,
  describeApiError: mockDescribeApiError,
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
  UsersPage: () => {
    useEffect(() => {
      void mockApi.listUsers().catch(() => {});
    }, []);

    return <div>users-route</div>;
  },
}));

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AuthProvider>
        <AppRouter />
      </AuthProvider>
    </MemoryRouter>,
  );
}

describe("admin route auth revalidation", () => {
  beforeEach(() => {
    mockApi.createUser.mockReset();
    mockApi.deleteUser.mockReset();
    mockApi.listUsers.mockReset();
    mockApi.login.mockReset();
    mockApi.logout.mockReset();
    mockApi.me.mockReset();
    mockApi.updateUser.mockReset();
    mockDescribeApiError.mockClear();

    mockApi.listUsers.mockResolvedValue({ items: [] });
  });

  it("redirects a demoted admin away from the users route without a full reload", async () => {
    mockApi.me
      .mockResolvedValueOnce({
        user: {
          id: 1,
          email: "admin@example.com",
          name: "Admin",
          role: "admin",
          active: true,
          createdAt: "2026-03-14T00:00:00.000Z",
        },
      })
      .mockResolvedValueOnce({
        user: {
          id: 1,
          email: "admin@example.com",
          name: "Admin",
          role: "user",
          active: true,
          createdAt: "2026-03-14T00:00:00.000Z",
        },
      });

    renderAt("/users");

    await waitFor(() => {
      expect(screen.getByText("dashboard-route")).toBeInTheDocument();
    });

    expect(screen.queryByText("users-route")).not.toBeInTheDocument();
    expect(mockApi.me).toHaveBeenCalledTimes(2);
  });

  it("allows a promoted user onto the users route after revalidation", async () => {
    mockApi.me
      .mockResolvedValueOnce({
        user: {
          id: 1,
          email: "user@example.com",
          name: "User",
          role: "user",
          active: true,
          createdAt: "2026-03-14T00:00:00.000Z",
        },
      })
      .mockResolvedValueOnce({
        user: {
          id: 1,
          email: "user@example.com",
          name: "User",
          role: "admin",
          active: true,
          createdAt: "2026-03-14T00:00:00.000Z",
        },
      });

    renderAt("/users");

    await waitFor(() => {
      expect(screen.getByText("users-route")).toBeInTheDocument();
    });

    expect(screen.queryByText("dashboard-route")).not.toBeInTheDocument();
    expect(mockApi.me).toHaveBeenCalledTimes(2);
  });

  it("refreshes auth state after a forbidden admin-only request", async () => {
    mockApi.me
      .mockResolvedValueOnce({
        user: {
          id: 1,
          email: "admin@example.com",
          name: "Admin",
          role: "admin",
          active: true,
          createdAt: "2026-03-14T00:00:00.000Z",
        },
      })
      .mockResolvedValueOnce({
        user: {
          id: 1,
          email: "admin@example.com",
          name: "Admin",
          role: "admin",
          active: true,
          createdAt: "2026-03-14T00:00:00.000Z",
        },
      })
      .mockResolvedValueOnce({
        user: {
          id: 1,
          email: "admin@example.com",
          name: "Admin",
          role: "user",
          active: true,
          createdAt: "2026-03-14T00:00:00.000Z",
        },
      });
    mockApi.listUsers.mockImplementation(async () => {
      window.dispatchEvent(new Event("upuse:auth:forbidden"));
      throw new Error("Forbidden");
    });

    renderAt("/users");

    await waitFor(() => {
      expect(screen.getByText("dashboard-route")).toBeInTheDocument();
    });

    expect(mockApi.me).toHaveBeenCalledTimes(3);
  });
});
