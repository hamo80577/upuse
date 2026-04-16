import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  SCANO_SETTINGS_MANAGE_CAPABILITY,
  SCANO_TASKS_MANAGE_CAPABILITY,
} from "../../systems/scano/routes/capabilities";
import { AuthProvider, useAuth } from "./AuthProvider";

const mockApi = vi.hoisted(() => ({
  login: vi.fn(),
  logout: vi.fn(),
  me: vi.fn(),
}));

const mockDescribeApiError = vi.hoisted(() => vi.fn((error: unknown, fallback = "Request failed") => {
  return error instanceof Error && error.message ? error.message : fallback;
}));

vi.mock("../../api/client", () => ({
  AUTH_FORBIDDEN_EVENT: "upuse:auth:forbidden",
  AUTH_UNAUTHORIZED_EVENT: "upuse:auth:unauthorized",
  api: mockApi,
  describeApiError: mockDescribeApiError,
}));

function Probe() {
  const {
    status,
    bootstrapError,
    getSystemAccess,
    hasSystemCapability,
    refreshAuth,
    retryBootstrap,
  } = useAuth();

  return (
    <>
      <div data-testid="status">{status}</div>
      <div data-testid="upuse-role">{String(getSystemAccess("upuse").role ?? "")}</div>
      <div data-testid="ops-enabled">{String(getSystemAccess("ops").enabled)}</div>
      <div data-testid="ops-role-label">{String(getSystemAccess("ops").roleLabel ?? "")}</div>
      <div data-testid="bootstrap-error">{bootstrapError ?? ""}</div>
      <div data-testid="can-manage-scano-tasks">{String(hasSystemCapability("scano", SCANO_TASKS_MANAGE_CAPABILITY))}</div>
      <div data-testid="can-manage-scano-settings">{String(hasSystemCapability("scano", SCANO_SETTINGS_MANAGE_CAPABILITY))}</div>
      <button type="button" onClick={() => void refreshAuth()}>
        Refresh auth
      </button>
      <button type="button" onClick={retryBootstrap}>
        Retry bootstrap
      </button>
    </>
  );
}

describe("AuthProvider", () => {
  beforeEach(() => {
    mockApi.login.mockReset();
    mockApi.logout.mockReset();
    mockApi.me.mockReset();
    mockDescribeApiError.mockClear();
  });

  it("keeps the session bootstrap in loading state on non-401 failures", async () => {
    mockApi.me.mockRejectedValue(new Error("Backend unavailable"));

    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("bootstrap-error")).toHaveTextContent("Backend unavailable");
    });

    expect(screen.getByTestId("status")).toHaveTextContent("loading");
  });

  it("retries the bootstrap request after a non-401 failure", async () => {
    mockApi.me
      .mockRejectedValueOnce(new Error("Backend unavailable"))
      .mockResolvedValueOnce({
        user: {
          id: 1,
          email: "admin@example.com",
          name: "Admin",
          role: "admin",
          active: true,
          createdAt: "2026-03-14T00:00:00.000Z",
        },
      });

    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("bootstrap-error")).toHaveTextContent("Backend unavailable");
    });

    fireEvent.click(screen.getByRole("button", { name: "Retry bootstrap" }));

    await waitFor(() => {
      expect(screen.getByTestId("status")).toHaveTextContent("authenticated");
    });

    expect(screen.getByTestId("bootstrap-error")).toHaveTextContent("");
    expect(mockApi.me).toHaveBeenCalledTimes(2);
  });

  it("refreshes the cached role after an admin-only forbidden event", async () => {
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

    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("upuse-role")).toHaveTextContent("admin");
    });

    window.dispatchEvent(new Event("upuse:auth:forbidden"));

    await waitFor(() => {
      expect(screen.getByTestId("upuse-role")).toHaveTextContent("user");
    });

    expect(mockApi.me).toHaveBeenCalledTimes(2);
  });

  it("grants task-management access to team leads without exposing settings access", async () => {
    mockApi.me.mockResolvedValueOnce({
      user: {
        id: 4,
        email: "lead@example.com",
        name: "Lead",
        role: "user",
        active: true,
        createdAt: "2026-04-04T00:00:00.000Z",
        upuseAccess: false,
        isPrimaryAdmin: false,
        scanoRole: "team_lead",
      },
    });

    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("status")).toHaveTextContent("authenticated");
    });

    expect(screen.getByTestId("can-manage-scano-tasks")).toHaveTextContent("true");
    expect(screen.getByTestId("can-manage-scano-settings")).toHaveTextContent("false");
    expect(screen.getByTestId("upuse-role")).toHaveTextContent("user");
  });

  it("enables Ops only for the primary admin", async () => {
    mockApi.me.mockResolvedValueOnce({
      user: {
        id: 1,
        email: "primary@example.com",
        name: "Primary",
        role: "admin",
        active: true,
        createdAt: "2026-04-16T00:00:00.000Z",
        upuseAccess: true,
        isPrimaryAdmin: true,
      },
    });

    const primaryView = render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("status")).toHaveTextContent("authenticated");
    });

    expect(screen.getByTestId("ops-enabled")).toHaveTextContent("true");
    expect(screen.getByTestId("ops-role-label")).toHaveTextContent("Primary Admin");

    primaryView.unmount();
    mockApi.me.mockResolvedValueOnce({
      user: {
        id: 2,
        email: "admin@example.com",
        name: "Admin",
        role: "admin",
        active: true,
        createdAt: "2026-04-16T00:00:00.000Z",
        upuseAccess: true,
        isPrimaryAdmin: false,
      },
    });

    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("status")).toHaveTextContent("authenticated");
    });

    expect(screen.getByTestId("ops-enabled")).toHaveTextContent("false");
    expect(screen.getByTestId("ops-role-label")).toHaveTextContent("");
  });

  it("keeps the newest refreshAuth result when concurrent requests resolve out of order", async () => {
    type AuthMeResult = { user: {
      id: number;
      email: string;
      name: string;
      role: "admin" | "user";
      active: boolean;
      createdAt: string;
      upuseAccess: boolean;
      isPrimaryAdmin: boolean;
    } };

    let resolveFirstRefresh!: (value: AuthMeResult) => void;
    let resolveSecondRefresh!: (value: AuthMeResult) => void;

    const firstRefresh = new Promise<AuthMeResult>((resolve) => {
      resolveFirstRefresh = resolve;
    });
    const secondRefresh = new Promise<AuthMeResult>((resolve) => {
      resolveSecondRefresh = resolve;
    });

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
      .mockImplementationOnce(() => firstRefresh)
      .mockImplementationOnce(() => secondRefresh);

    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("upuse-role")).toHaveTextContent("admin");
    });

    fireEvent.click(screen.getByRole("button", { name: "Refresh auth" }));
    fireEvent.click(screen.getByRole("button", { name: "Refresh auth" }));

    resolveSecondRefresh({
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

    await waitFor(() => {
      expect(screen.getByTestId("upuse-role")).toHaveTextContent("user");
    });

    resolveFirstRefresh({
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
    });

    await waitFor(() => {
      expect(mockApi.me).toHaveBeenCalledTimes(3);
    });

    expect(screen.getByTestId("upuse-role")).toHaveTextContent("user");
  });
});
