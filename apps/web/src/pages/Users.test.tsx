import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";

const mockApi = vi.hoisted(() => ({
  listUsers: vi.fn(),
  createUser: vi.fn(),
  updateUser: vi.fn(),
  deleteUser: vi.fn(),
}));

const mockAuthState = vi.hoisted(() => ({
  value: {
    user: {
      id: 1,
      email: "admin@example.com",
      name: "Admin One",
      role: "admin",
      active: true,
      createdAt: "2026-03-14T10:00:00.000Z",
    },
  },
}));

vi.mock("../api/client", () => ({
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

vi.mock("../widgets/top-bar/ui/TopBar", () => ({
  TopBar: () => null,
}));

import { UsersPage } from "./users/ui/UsersPage";

describe("UsersPage", () => {
  beforeEach(() => {
    mockApi.listUsers.mockReset();
    mockApi.createUser.mockReset();
    mockApi.updateUser.mockReset();
    mockApi.deleteUser.mockReset();
    mockApi.listUsers.mockResolvedValue({
      items: [
        {
          id: 1,
          email: "admin@example.com",
          name: "Admin One",
          role: "admin",
          active: true,
          createdAt: "2026-03-14T10:00:00.000Z",
        },
        {
          id: 2,
          email: "user@example.com",
          name: "User Two",
          role: "user",
          active: true,
          createdAt: "2026-03-14T10:10:00.000Z",
        },
      ],
    });
  });

  it("lets admins edit existing users and keeps self-delete disabled", async () => {
    render(
      <MemoryRouter>
        <UsersPage />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(mockApi.listUsers).toHaveBeenCalled();
    });

    expect(screen.getByText("Current session")).toBeInTheDocument();

    const editButtons = screen.getAllByRole("button", { name: "Edit" });
    const deleteButtons = screen.getAllByRole("button", { name: "Delete" });

    expect(deleteButtons[0]).toBeDisabled();
    expect(deleteButtons[1]).not.toBeDisabled();

    fireEvent.click(editButtons[1]);

    const nameInput = screen.getByLabelText("Full Name");
    fireEvent.change(nameInput, { target: { value: "Updated User Two" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));

    await waitFor(() => {
      expect(mockApi.updateUser).toHaveBeenCalledWith(2, {
        email: "user@example.com",
        name: "Updated User Two",
        role: "user",
        password: undefined,
      });
    });
  });

  it("lets admins delete another user", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);

    render(
      <MemoryRouter>
        <UsersPage />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(mockApi.listUsers).toHaveBeenCalled();
    });

    fireEvent.click(screen.getAllByRole("button", { name: "Delete" })[1]);

    await waitFor(() => {
      expect(mockApi.deleteUser).toHaveBeenCalledWith(2);
    });

    confirmSpy.mockRestore();
  });
});
