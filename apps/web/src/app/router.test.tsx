import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, useLocation } from "react-router-dom";
import { AppRouter } from "./router";
import type { AppUser } from "../api/types";

const mockUseAuth = vi.hoisted(() => vi.fn());

vi.setConfig({ testTimeout: 15_000 });

type RouterAuthMock = {
  status: "loading" | "authenticated" | "unauthenticated";
  isAdmin: boolean;
  isPrimaryAdmin: boolean;
  systems?: Record<string, { enabled: boolean; role?: string | null; roleLabel?: string | null; capabilities: string[] }>;
  hasSystemAccess?: (systemId: string) => boolean;
  hasSystemCapability?: (systemId: string, capability: string) => boolean;
  getSystemAccess?: (systemId: string) => { enabled: boolean; role?: string | null; roleLabel?: string | null; capabilities: string[] };
  scanoRole?: "team_lead" | "scanner" | null;
  canAccessUpuse: boolean;
  canAccessScano: boolean;
  canAccessOps: boolean;
  canManageScanoTasks: boolean;
  canManageScanoSettings: boolean;
  canSwitchSystems: boolean;
  bootstrapError?: string | null;
  retryBootstrap?: ReturnType<typeof vi.fn>;
  refreshAuth: ReturnType<typeof vi.fn>;
  user?: AppUser | null;
};

function createAuthState(overrides: Partial<RouterAuthMock> = {}): RouterAuthMock {
  const state: RouterAuthMock = {
    status: "authenticated",
    isAdmin: false,
    isPrimaryAdmin: false,
    scanoRole: null,
    canAccessUpuse: true,
    canAccessScano: false,
    canAccessOps: false,
    canManageScanoTasks: false,
    canManageScanoSettings: false,
    canSwitchSystems: false,
    bootstrapError: null,
    retryBootstrap: vi.fn(),
    refreshAuth: vi.fn().mockResolvedValue(undefined),
    user: null,
    ...overrides,
  };
  const systems = state.systems ?? {
    upuse: {
      enabled: state.canAccessUpuse,
      role: state.isAdmin ? "admin" : "user",
      roleLabel: state.isAdmin ? "Admin" : "User",
      capabilities: [
        ...(state.isAdmin ? ["users.manage"] : []),
      ],
    },
    scano: {
      enabled: state.canAccessScano,
      role: state.scanoRole ?? null,
      roleLabel: state.scanoRole === "team_lead"
        ? "Scano Team Lead"
        : state.scanoRole === "scanner"
          ? "Scano Scanner"
          : state.canManageScanoSettings
            ? "Scano Admin"
            : null,
      capabilities: [
        ...(state.canManageScanoTasks ? ["tasks.manage", "master-products.manage"] : []),
        ...(state.scanoRole === "scanner" ? ["tasks.run_assigned"] : []),
        ...(state.canManageScanoSettings ? ["settings.manage"] : []),
      ],
    },
    ops: {
      enabled: state.canAccessOps,
      role: state.canAccessOps ? "primary_admin" : null,
      roleLabel: state.canAccessOps ? "Primary Admin" : null,
      capabilities: [],
    },
  };

  return {
    ...state,
    systems,
    getSystemAccess: state.getSystemAccess ?? ((systemId) => systems[systemId] ?? { enabled: false, capabilities: [] }),
    hasSystemAccess: state.hasSystemAccess ?? ((systemId) => systems[systemId]?.enabled === true),
    hasSystemCapability: state.hasSystemCapability ?? ((systemId, capability) => systems[systemId]?.capabilities.includes(capability) ?? false),
  };
}

vi.mock("./providers/AuthProvider", () => ({
  useAuth: mockUseAuth,
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

vi.mock("../systems/upuse/pages/performance/ui/PerformancePage", () => ({
  PerformancePage: () => <div>performance-route</div>,
}));

vi.mock("../systems/scano/pages/scano/ui/ScanoPage", () => ({
  ScanoPage: () => <div>scano-assign-route</div>,
}));

vi.mock("../systems/scano/pages/scano/ui/ScanoMyTasksPage", () => ({
  ScanoMyTasksPage: () => <div>scano-my-tasks-route</div>,
}));

vi.mock("../systems/scano/pages/scano/ui/ScanoTaskProfilePage", () => ({
  ScanoTaskProfilePage: () => <div>scano-task-profile-route</div>,
}));

vi.mock("../systems/scano/pages/scano/ui/ScanoTaskRunnerPage", () => ({
  ScanoTaskRunnerPage: () => <div>scano-task-runner-route</div>,
}));

vi.mock("../systems/scano/pages/scano/ui/ScanoSettingsPage", () => ({
  ScanoSettingsPage: () => <div>scano-settings-route</div>,
}));

vi.mock("../systems/scano/pages/scano/ui/ScanoMasterProductPage", () => ({
  ScanoMasterProductPage: () => <div>scano-master-product-route</div>,
}));

vi.mock("../systems/ops/pages/overview/ui/OpsOverviewPage", () => ({
  OpsOverviewPage: () => <div>ops-overview-route</div>,
}));

vi.mock("../systems/upuse/pages/branches/ui/BranchesPage", () => ({
  BranchesPage: () => <div>branches-route</div>,
}));

vi.mock("../systems/upuse/pages/thresholds/ui/ThresholdsPage", () => ({
  ThresholdsPage: () => <div>thresholds-route</div>,
}));

vi.mock("../systems/upuse/pages/users/ui/UsersPage", () => ({
  UsersPage: () => <div>users-route</div>,
}));

function LocationProbe() {
  const location = useLocation();
  const fromPath = (location.state as { from?: { pathname?: string } } | null)?.from?.pathname ?? "";

  return (
    <>
      <div data-testid="pathname">{location.pathname}</div>
      <div data-testid="from-path">{fromPath}</div>
    </>
  );
}

describe("AppRouter", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
  });

  it("routes performance, scano assign-task, master product, branches, and threshold paths to their named pages", async () => {
    mockUseAuth.mockReturnValue(createAuthState({
      isAdmin: true,
      canAccessUpuse: true,
      canAccessScano: true,
      canManageScanoTasks: true,
      scanoRole: "team_lead",
      canManageScanoSettings: true,
      canSwitchSystems: true,
    }));

    const renderAt = (path: string) => render(
      <MemoryRouter initialEntries={[path]}>
        <AppRouter />
      </MemoryRouter>,
    );

    const performanceView = renderAt("/performance");

    await waitFor(() => {
      expect(screen.getByText("performance-route")).toBeInTheDocument();
    });

    performanceView.unmount();

    window.sessionStorage.setItem("upuse.active-system", "scano");

    const scanoView = renderAt("/scano/assign-task");

    await waitFor(() => {
      expect(screen.getByText("scano-assign-route")).toBeInTheDocument();
    });

    scanoView.unmount();
    const scanoSettingsView = renderAt("/scano/settings");

    await waitFor(() => {
      expect(screen.getByText("scano-settings-route")).toBeInTheDocument();
    });

    scanoSettingsView.unmount();
    const scanoMasterProductView = renderAt("/scano/master-product");

    await waitFor(() => {
      expect(screen.getByText("scano-master-product-route")).toBeInTheDocument();
    });

    scanoMasterProductView.unmount();
    window.sessionStorage.setItem("upuse.active-system", "upuse");

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

  it("renders Ops only for the primary admin", async () => {
    mockUseAuth.mockReturnValue(createAuthState({
      isAdmin: true,
      isPrimaryAdmin: true,
      canAccessUpuse: true,
      canAccessOps: true,
    }));

    render(
      <MemoryRouter initialEntries={["/ops"]}>
        <AppRouter />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText("ops-overview-route")).toBeInTheDocument();
    });
    expect(window.sessionStorage.getItem("upuse.active-system")).toBe("ops");
  });

  it("redirects non-primary authenticated users away from Ops", async () => {
    mockUseAuth.mockReturnValue(createAuthState({
      isAdmin: true,
      isPrimaryAdmin: false,
      canAccessUpuse: true,
      canAccessOps: false,
    }));

    render(
      <MemoryRouter initialEntries={["/ops"]}>
        <AppRouter />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText("dashboard-route")).toBeInTheDocument();
    });
    expect(screen.queryByText("ops-overview-route")).not.toBeInTheDocument();
  });

  it("only allows primary admins to open the Ops system switch route", async () => {
    mockUseAuth.mockReturnValue(createAuthState({
      isAdmin: true,
      isPrimaryAdmin: true,
      canAccessUpuse: true,
      canAccessOps: true,
    }));

    const primaryView = render(
      <MemoryRouter initialEntries={["/system-switch/ops"]}>
        <AppRouter />
      </MemoryRouter>,
    );

    expect(screen.getByText("Switching to Ops Center")).toBeInTheDocument();
    primaryView.unmount();

    mockUseAuth.mockReturnValue(createAuthState({
      isAdmin: true,
      isPrimaryAdmin: false,
      canAccessUpuse: true,
      canAccessOps: false,
    }));

    render(
      <MemoryRouter initialEntries={["/system-switch/ops"]}>
        <AppRouter />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText("dashboard-route")).toBeInTheDocument();
    });
    expect(screen.queryByText("Switching to Ops Center")).not.toBeInTheDocument();
  });

  it("redirects the legacy mapping route to branches", async () => {
    mockUseAuth.mockReturnValue(createAuthState({
      isAdmin: true,
      canAccessUpuse: true,
      canAccessScano: true,
      canManageScanoTasks: true,
      scanoRole: "team_lead",
      canManageScanoSettings: true,
      canSwitchSystems: true,
    }));

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
    mockUseAuth.mockReturnValue(createAuthState({
      isAdmin: false,
      canAccessUpuse: true,
      canAccessScano: false,
    }));

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

  it("preserves the requested users route when redirecting unauthenticated visitors to login", async () => {
    mockUseAuth.mockReturnValue(createAuthState({
      status: "unauthenticated",
      canAccessUpuse: false,
    }));

    render(
      <MemoryRouter initialEntries={["/users"]}>
        <LocationProbe />
        <AppRouter />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText("login-route")).toBeInTheDocument();
    });

    expect(screen.getByTestId("pathname")).toHaveTextContent("/login");
    expect(screen.getByTestId("from-path")).toHaveTextContent("/users");
  });

  it("preserves the requested scano route when redirecting unauthenticated visitors to login", async () => {
    mockUseAuth.mockReturnValue(createAuthState({
      status: "unauthenticated",
      canAccessUpuse: false,
    }));

    render(
      <MemoryRouter initialEntries={["/scano/assign-task"]}>
        <LocationProbe />
        <AppRouter />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText("login-route")).toBeInTheDocument();
    });

    expect(screen.getByTestId("pathname")).toHaveTextContent("/login");
    expect(screen.getByTestId("from-path")).toHaveTextContent("/scano/assign-task");
  });

  it("allows direct Scano entry even when the stored active system is still UPuse", async () => {
    window.sessionStorage.setItem("upuse.active-system", "upuse");

    mockUseAuth.mockReturnValue(createAuthState({
      canAccessUpuse: true,
      canAccessScano: true,
      canManageScanoTasks: true,
      scanoRole: "team_lead",
      canManageScanoSettings: true,
      canSwitchSystems: true,
    }));

    render(
      <MemoryRouter initialEntries={["/scano/assign-task"]}>
        <AppRouter />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText("scano-assign-route")).toBeInTheDocument();
    });

    expect(window.sessionStorage.getItem("upuse.active-system")).toBe("scano");
  });

  it("redirects authenticated users back to the active Scano workspace when they open an UPuse route directly", async () => {
    window.sessionStorage.setItem("upuse.active-system", "scano");

    mockUseAuth.mockReturnValue(createAuthState({
      isAdmin: false,
      canAccessUpuse: true,
      canAccessScano: true,
      canManageScanoTasks: true,
      scanoRole: "team_lead",
      canSwitchSystems: true,
    }));

    render(
      <MemoryRouter initialEntries={["/performance"]}>
        <AppRouter />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText("scano-assign-route")).toBeInTheDocument();
    });
    expect(screen.queryByText("performance-route")).not.toBeInTheDocument();
  });

  it("shows a bootstrap retry UI instead of an infinite loading spinner after a non-401 auth bootstrap failure", async () => {
    const retryBootstrap = vi.fn();

    mockUseAuth.mockReturnValue(createAuthState({
        status: "loading",
        canAccessUpuse: false,
        canManageScanoTasks: false,
        bootstrapError: "Backend unavailable",
      retryBootstrap,
    }));

    render(
      <MemoryRouter initialEntries={["/"]}>
        <AppRouter />
      </MemoryRouter>,
    );

    expect(screen.getByText("Backend unavailable")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));

    expect(retryBootstrap).toHaveBeenCalledOnce();
  });

  it("keeps the active Scano workspace during auth bootstrap until access is resolved", async () => {
    window.sessionStorage.setItem("upuse.active-system", "scano");

    const refreshAuth = vi.fn().mockResolvedValue(undefined);
    let authState: RouterAuthMock = {
      ...createAuthState({
        status: "loading",
        canAccessUpuse: false,
        canManageScanoTasks: false,
      }),
      refreshAuth,
    };

    mockUseAuth.mockImplementation(() => authState);

    const view = render(
      <MemoryRouter initialEntries={["/scano/assign-task"]}>
        <AppRouter />
      </MemoryRouter>,
    );

    expect(window.sessionStorage.getItem("upuse.active-system")).toBe("scano");
    expect(screen.queryByText("scano-route")).not.toBeInTheDocument();

    authState = createAuthState({
      status: "authenticated",
      canAccessUpuse: false,
      canAccessScano: true,
      canManageScanoTasks: true,
      scanoRole: "team_lead",
    });

    view.rerender(
      <MemoryRouter initialEntries={["/scano/assign-task"]}>
        <AppRouter />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText("scano-assign-route")).toBeInTheDocument();
    });
    expect(window.sessionStorage.getItem("upuse.active-system")).toBe("scano");
  });

  it("lands scanners on My Tasks inside Scano", async () => {
    mockUseAuth.mockReturnValue(createAuthState({
      canAccessUpuse: false,
      canAccessScano: true,
      canManageScanoTasks: false,
      scanoRole: "scanner",
    }));

    render(
      <MemoryRouter initialEntries={["/scano"]}>
        <AppRouter />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText("scano-my-tasks-route")).toBeInTheDocument();
    });
  });

  it("allows scanner-role users to open the task runner even if they also manage Scano tasks", async () => {
    window.sessionStorage.setItem("upuse.active-system", "scano");

    mockUseAuth.mockReturnValue(createAuthState({
      canAccessUpuse: false,
      canAccessScano: true,
      canManageScanoTasks: true,
      scanoRole: "scanner",
    }));

    render(
      <MemoryRouter initialEntries={["/scano/tasks/42/run"]}>
        <AppRouter />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText("scano-task-runner-route")).toBeInTheDocument();
    });
  });

  it("redirects scanners away from the master product page", async () => {
    window.sessionStorage.setItem("upuse.active-system", "scano");

    mockUseAuth.mockReturnValue(createAuthState({
      canAccessUpuse: false,
      canAccessScano: true,
      canManageScanoTasks: false,
      scanoRole: "scanner",
    }));

    render(
      <MemoryRouter initialEntries={["/scano/master-product"]}>
        <AppRouter />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText("scano-my-tasks-route")).toBeInTheDocument();
    });
    expect(screen.queryByText("scano-master-product-route")).not.toBeInTheDocument();
  });
});
