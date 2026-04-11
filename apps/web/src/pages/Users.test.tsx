import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { UPUSE_USERS_MANAGE_CAPABILITY } from "../systems/upuse/routes/capabilities";

const mockApi = vi.hoisted(() => ({
  listUsers: vi.fn(),
  createUser: vi.fn(),
  updateUser: vi.fn(),
  deleteUser: vi.fn(),
}));

const mockAuthState = vi.hoisted(() => ({
  value: {
    status: "authenticated" as const,
    user: {
      id: 1,
      email: "admin@example.com",
      name: "Admin One",
      role: "admin",
      active: true,
      createdAt: "2026-03-14T10:00:00.000Z",
      upuseAccess: true,
      isPrimaryAdmin: true,
      scanoRole: "team_lead" as const,
    },
    logout: vi.fn(),
    hasSystemAccess: (systemId: string) => systemId === "upuse",
    hasSystemCapability: (systemId: string, capability: string) => (
      systemId === "upuse" && capability === UPUSE_USERS_MANAGE_CAPABILITY
    ),
    getSystemAccess: (systemId: string) => (
      systemId === "upuse"
        ? {
            enabled: true,
            role: "admin",
            roleLabel: "Admin",
            capabilities: [UPUSE_USERS_MANAGE_CAPABILITY],
          }
        : {
            enabled: false,
            role: null,
            roleLabel: null,
            capabilities: [],
          }
    ),
  },
}));

vi.mock("../systems/upuse/api/client", () => ({
  api: mockApi,
  describeApiError: (error: unknown, fallback = "Request failed") => (error instanceof Error ? error.message : fallback),
}));

vi.mock("../app/providers/AuthProvider", () => ({
  useAuth: () => mockAuthState.value,
}));

vi.mock("../app/providers/MonitorStatusProvider", () => ({
  useMonitorStatus: () => ({
    monitoring: { running: true, degraded: false },
    startMonitoring: vi.fn(),
    stopMonitoring: vi.fn(),
  }),
}));

vi.mock("../systems/upuse/widgets/top-bar/ui/TopBar", () => ({
  TopBar: () => null,
}));

import { UsersPage } from "./users/ui/UsersPage";

describe("UsersPage", () => {
  beforeEach(() => {
    mockApi.listUsers.mockReset();
    mockApi.createUser.mockReset();
    mockApi.updateUser.mockReset();
    mockApi.deleteUser.mockReset();
    mockApi.createUser.mockResolvedValue({ ok: true });
    mockApi.updateUser.mockResolvedValue({ ok: true });
    mockApi.deleteUser.mockResolvedValue({ ok: true });
    mockApi.listUsers.mockResolvedValue({
      items: [
        {
          id: 1,
          email: "admin@example.com",
          name: "Admin One",
          role: "admin",
          active: true,
          createdAt: "2026-03-14T10:00:00.000Z",
          upuseAccess: true,
          isPrimaryAdmin: true,
          scanoRole: "team_lead",
        },
        {
          id: 2,
          email: "user@example.com",
          name: "User Two",
          role: "user",
          active: true,
          createdAt: "2026-03-14T10:10:00.000Z",
          upuseAccess: true,
          isPrimaryAdmin: false,
          scanoRole: undefined,
        },
        {
          id: 3,
          email: "archived@example.com",
          name: "Archived User",
          role: "user",
          active: false,
          createdAt: "2026-03-14T10:20:00.000Z",
          upuseAccess: false,
          isPrimaryAdmin: false,
          scanoRole: "scanner",
        },
      ],
    });
  });

  it("opens the edit wizard with the current access values and keeps self-archive disabled", async () => {
    render(
      <MemoryRouter>
        <UsersPage />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(mockApi.listUsers).toHaveBeenCalled();
    });

    expect(screen.getByText("Current session")).toBeInTheDocument();
    expect(screen.getByText("Archived")).toBeInTheDocument();

    const editButtons = screen.getAllByRole("button", { name: "Edit" });
    const archiveButtons = screen.getAllByRole("button", { name: "Archive" });

    expect(archiveButtons[0]).toBeDisabled();
    expect(archiveButtons[1]).not.toBeDisabled();
    expect(editButtons[2]).toBeDisabled();
    expect(archiveButtons[2]).toBeDisabled();

    fireEvent.click(editButtons[1]);

    expect(screen.getByDisplayValue("User Two")).toBeInTheDocument();
    expect(screen.getByDisplayValue("user@example.com")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    expect(screen.getByLabelText("UPuse access")).toBeChecked();
    expect(screen.getByLabelText("Scano access")).not.toBeChecked();
    expect(screen.getByDisplayValue("user")).toBeInTheDocument();
    expect(mockApi.updateUser).not.toHaveBeenCalled();
  }, 10000);

  it("creates a Scano-only user from the wizard", async () => {
    render(
      <MemoryRouter>
        <UsersPage />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(mockApi.listUsers).toHaveBeenCalled();
    });

    fireEvent.click(screen.getByRole("button", { name: "Create New User" }));

    fireEvent.change(screen.getByLabelText("Full Name"), { target: { value: "Scanner User" } });
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "scanner@example.com" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "secret-123" } });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    fireEvent.click(screen.getByLabelText("UPuse access"));
    fireEvent.click(screen.getByLabelText("Scano access"));
    fireEvent.click(screen.getByRole("button", { name: "Create User" }));

    await waitFor(() => {
      expect(mockApi.createUser).toHaveBeenCalledWith({
        email: "scanner@example.com",
        name: "Scanner User",
        password: "secret-123",
        upuseAccess: false,
        scanoAccessRole: "scanner",
      });
    });
  }, 10000);

  it("lets admins archive another user", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);

    render(
      <MemoryRouter>
        <UsersPage />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(mockApi.listUsers).toHaveBeenCalled();
    });

    fireEvent.click(screen.getAllByRole("button", { name: "Archive" })[1]);

    await waitFor(() => {
      expect(mockApi.deleteUser).toHaveBeenCalledWith(2);
    });

    confirmSpy.mockRestore();
  });

  it("surfaces archive conflicts returned by the api", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    mockApi.deleteUser.mockRejectedValueOnce(new Error("This user cannot be archived while assigned to non-completed Scano tasks."));

    render(
      <MemoryRouter>
        <UsersPage />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(mockApi.listUsers).toHaveBeenCalled();
    });

    fireEvent.click(screen.getAllByRole("button", { name: "Archive" })[1]);

    expect(await screen.findByText("This user cannot be archived while assigned to non-completed Scano tasks.")).toBeInTheDocument();

    confirmSpy.mockRestore();
  });
});
