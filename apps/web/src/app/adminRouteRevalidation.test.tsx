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

vi.mock("../systems/upuse/pages/dashboard/ui/DashboardPage", () => ({
  DashboardPage: () => <div>dashboard-route</div>,
}));

vi.mock("../pages/login/ui/LoginPage", () => ({
  LoginPage: () => <div>login-route</div>,
}));

vi.mock("../systems/upuse/pages/settings/ui/SettingsPage", () => ({
  SettingsPage: () => <div>settings-route</div>,
}));

vi.mock("../systems/upuse/pages/branches/ui/BranchesPage", () => ({
  BranchesPage: () => <div>branches-route</div>,
}));

vi.mock("../systems/upuse/pages/thresholds/ui/ThresholdsPage", () => ({
  ThresholdsPage: () => <div>thresholds-route</div>,
}));

vi.mock("../systems/upuse/pages/users/ui/UsersPage", () => ({
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

function nextTick() {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });
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
          upuseAccess: true,
          isPrimaryAdmin: false,
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
          upuseAccess: true,
          isPrimaryAdmin: false,
        },
      });

    renderAt("/users");

    await waitFor(() => {
      expect(screen.getByText("users-route")).toBeInTheDocument();
    });
    await nextTick();
    window.dispatchEvent(new Event("upuse:auth:forbidden"));

    await waitFor(() => {
      expect(mockApi.me).toHaveBeenCalledTimes(2);
    });

    await waitFor(() => {
      expect(screen.getByText("dashboard-route")).toBeInTheDocument();
    });

    expect(screen.queryByText("users-route")).not.toBeInTheDocument();
    expect(mockApi.me).toHaveBeenCalledTimes(2);
  });

  it("refreshes auth state for a promoted user without auto-navigating back to users", async () => {
    mockApi.me
      .mockResolvedValueOnce({
        user: {
          id: 1,
          email: "user@example.com",
          name: "User",
          role: "user",
          active: true,
          createdAt: "2026-03-14T00:00:00.000Z",
          upuseAccess: true,
          isPrimaryAdmin: false,
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
          upuseAccess: true,
          isPrimaryAdmin: false,
        },
      });

    renderAt("/users");

    await waitFor(() => {
      expect(screen.getByText("dashboard-route")).toBeInTheDocument();
    });
    await nextTick();
    window.dispatchEvent(new Event("upuse:auth:forbidden"));

    await waitFor(() => {
      expect(mockApi.me).toHaveBeenCalledTimes(2);
    });

    await waitFor(() => {
      expect(screen.getByText("dashboard-route")).toBeInTheDocument();
    });

    expect(screen.queryByText("users-route")).not.toBeInTheDocument();
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
          upuseAccess: true,
          isPrimaryAdmin: false,
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
          upuseAccess: true,
          isPrimaryAdmin: false,
        },
      });
    mockApi.listUsers.mockImplementation(async () => {
      setTimeout(() => {
        window.dispatchEvent(new Event("upuse:auth:forbidden"));
      }, 0);
      throw new Error("Forbidden");
    });

    renderAt("/users");

    await waitFor(() => {
      expect(screen.getByText("users-route")).toBeInTheDocument();
    });

    await waitFor(() => {
      expect(mockApi.me).toHaveBeenCalledTimes(2);
    });

    await waitFor(() => {
      expect(screen.getByText("dashboard-route")).toBeInTheDocument();
    });

    expect(mockApi.me).toHaveBeenCalledTimes(2);
  });
});
