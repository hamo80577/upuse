import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ScanoTaskListItem, ScanoTaskStatus } from "../../../api/types";
import { SCANO_TASKS_MANAGE_CAPABILITY } from "../../../routes/capabilities";
import { ScanoPage } from "./ScanoPage";

const TASK_1 = "11111111-1111-4111-8111-111111111111";
const TASK_7 = "77777777-7777-4777-8777-777777777777";

const {
  mockUseAuth,
  mockNavigate,
  mockListScanoBranches,
  mockListScanoChains,
  mockListScanoTasks,
  mockCreateScanoTask,
  mockListScanoTeam,
  mockUpdateScanoTask,
  mockDeleteScanoTask,
} = vi.hoisted(() => ({
  mockUseAuth: vi.fn(),
  mockNavigate: vi.fn(),
  mockListScanoBranches: vi.fn(),
  mockListScanoChains: vi.fn(),
  mockListScanoTasks: vi.fn(),
  mockCreateScanoTask: vi.fn(),
  mockListScanoTeam: vi.fn(),
  mockUpdateScanoTask: vi.fn(),
  mockDeleteScanoTask: vi.fn(),
}));

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

vi.mock("../../../app/providers/AuthProvider", () => ({
  useAuth: mockUseAuth,
}));

vi.mock("../../../widgets/top-bar/ui/TopBar", () => ({
  TopBar: () => <div>top-bar</div>,
}));

vi.mock("../../../api/client", () => ({
  describeApiError: (error: unknown, fallback: string) => {
    if (error instanceof Error && error.message) return error.message;
    return fallback;
  },
  api: {
    listScanoBranches: mockListScanoBranches,
    listScanoChains: mockListScanoChains,
    listScanoTasks: mockListScanoTasks,
    createScanoTask: mockCreateScanoTask,
    listScanoTeam: mockListScanoTeam,
    updateScanoTask: mockUpdateScanoTask,
    deleteScanoTask: mockDeleteScanoTask,
  },
}));

function createTask(overrides?: Partial<ScanoTaskListItem>): ScanoTaskListItem {
  const assignees = overrides?.assignees ?? [
    {
      id: 11,
      name: "Ali",
      linkedUserId: 2,
    },
  ];

  return {
    id: TASK_1,
    chainId: 1037,
    chainName: "Carrefour",
    branchId: 4594,
    branchGlobalId: "vendor-global-4594",
    branchName: "Nasr City",
    globalEntityId: "TB_EG",
    countryCode: "EG",
    additionalRemoteId: "branch-4594",
    scheduledAt: "2026-04-10T08:00:00.000Z",
    status: "pending",
    assignees,
    progress: {
      startedCount: 0,
      endedCount: 0,
      totalCount: assignees.length,
    },
    viewerState: {
      hasStarted: false,
      hasEnded: false,
      canEnter: false,
      canEnd: false,
      canResume: false,
    },
    permissions: {
      canEdit: true,
      canStart: false,
      canManageAssignees: true,
      canComplete: false,
    },
    ...overrides,
  };
}

describe("ScanoPage", () => {
  beforeEach(() => {
    mockNavigate.mockReset();
    mockUseAuth.mockReturnValue({
      hasSystemCapability: (systemId: string, capability: string) => (
        systemId === "scano" && capability === SCANO_TASKS_MANAGE_CAPABILITY
      ),
    });
    mockListScanoTasks.mockResolvedValue({ items: [] });
    mockListScanoTeam.mockResolvedValue({
      items: [
        {
          id: 11,
          name: "Ali",
          linkedUserId: 2,
          linkedUserName: "Assigned User",
          linkedUserEmail: "ali@example.com",
          role: "scanner",
          active: true,
          createdAt: "2026-04-04T10:00:00.000Z",
          updatedAt: "2026-04-04T10:00:00.000Z",
        },
        {
          id: 12,
          name: "Mona",
          linkedUserId: 3,
          linkedUserName: "Mona User",
          linkedUserEmail: "mona@example.com",
          role: "scanner",
          active: true,
          createdAt: "2026-04-04T10:00:00.000Z",
          updatedAt: "2026-04-04T10:00:00.000Z",
        },
      ],
    });
    mockListScanoChains.mockResolvedValue({
      items: [
        {
          id: 1037,
          active: true,
          name: "Carrefour",
          globalId: "chain-global-1037",
          type: "chain",
        },
      ],
      pageIndex: 1,
      totalPages: 1,
      totalRecords: 1,
    });
    mockListScanoBranches.mockResolvedValue({
      items: [
        {
          id: 4594,
          globalId: "vendor-global-4594",
          name: "Nasr City",
          chainId: 1037,
          chainName: "Carrefour",
          globalEntityId: "TB_EG",
          countryCode: "EG",
          additionalRemoteId: "branch-4594",
        },
      ],
      pageIndex: 1,
      totalPages: 1,
      totalRecords: 1,
    });
    mockCreateScanoTask.mockResolvedValue({
      ok: true,
      item: createTask(),
    });
    mockUpdateScanoTask.mockResolvedValue({
      ok: true,
      item: createTask({ branchName: "Nasr City Updated" }),
    });
    mockDeleteScanoTask.mockResolvedValue({
      ok: true,
      item: { id: TASK_1 },
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("opens the add-task wizard and searches the Scano catalog", async () => {
    render(<ScanoPage />);

    await screen.findByText("No tasks found");

    fireEvent.click(screen.getByRole("button", { name: "Add New Task" }));

    const dialog = await screen.findByRole("dialog", { name: "Add New Task" });
    fireEvent.change(within(dialog).getByLabelText("Search Chains"), {
      target: { value: "car" },
    });

    await new Promise((resolve) => {
      window.setTimeout(resolve, 320);
    });
    await waitFor(() => {
      expect(mockListScanoChains).toHaveBeenCalledWith("car", expect.anything());
    });

    fireEvent.click(await within(dialog).findByRole("button", { name: /Carrefour/i }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Next" }));

    await waitFor(() => {
      expect(mockListScanoBranches).toHaveBeenCalledWith(1037, "", expect.anything());
    });
    expect(await within(dialog).findByRole("button", { name: /Nasr City/i })).toBeInTheDocument();
  }, 15000);

  it("opens the edit wizard with the existing task values prefilled", async () => {
    mockListScanoTasks.mockResolvedValue({
      items: [createTask()],
    });

    render(<ScanoPage />);

    expect((await screen.findAllByText("Nasr City")).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Started 0\/1/i).length).toBeGreaterThan(0);
    fireEvent.click(screen.getAllByRole("button", { name: "Edit" })[0]!);

    const dialog = await screen.findByRole("dialog", { name: "Edit Task" });
    expect(within(dialog).getByText("Selected chain: Carrefour")).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole("button", { name: "Next" }));

    expect(await within(dialog).findByText("Selected branch: Nasr City")).toBeInTheDocument();
  }, 15000);

  it("shows awaiting-review tasks with progress chips and compact assignee overflow", async () => {
    mockListScanoTasks.mockResolvedValue({
      items: [
        createTask({
          id: TASK_7,
          status: "awaiting_review",
          assignees: [
            { id: 11, name: "Ali", linkedUserId: 2 },
            { id: 12, name: "Mona", linkedUserId: 3 },
            { id: 13, name: "Sara", linkedUserId: 4 },
            { id: 14, name: "Omar", linkedUserId: 5 },
          ],
          progress: {
            startedCount: 4,
            endedCount: 4,
            totalCount: 4,
          },
          permissions: {
            canEdit: false,
            canStart: false,
            canManageAssignees: false,
            canComplete: true,
          },
        }),
      ],
    });

    render(<ScanoPage />);

    expect((await screen.findAllByText("Awaiting Review")).length).toBeGreaterThan(0);
    expect(screen.getAllByText("Review").length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Started 4\/4/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Ended 4\/4/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText("+1").length).toBeGreaterThan(0);
  });

  it("reloads the table when the compact date range filter changes", async () => {
    mockListScanoTasks.mockImplementation(async (filters?: { from?: string; to?: string }) => {
      if (filters?.from || filters?.to) {
        return {
          items: [
            createTask({
              id: TASK_1,
              branchName: "Filtered Branch",
            }),
          ],
        };
      }

      return {
        items: [
          createTask({ id: TASK_1, branchName: "Filtered Branch" }),
          createTask({
            id: "22222222-2222-4222-8222-222222222222",
            branchName: "Second Branch",
            scheduledAt: "2026-04-15T08:00:00.000Z",
          }),
        ],
      };
    });

    render(<ScanoPage />);

    expect((await screen.findAllByText("Second Branch")).length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("button", { name: "All dates" }));
    fireEvent.change(await screen.findByLabelText("Start Date"), {
      target: { value: "2026-04-10" },
    });
    fireEvent.change(screen.getByLabelText("End Date"), {
      target: { value: "2026-04-11" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));

    await waitFor(() => {
      expect(mockListScanoTasks).toHaveBeenLastCalledWith(expect.objectContaining({
        from: expect.any(String),
        to: expect.any(String),
      }));
    });
    await waitFor(() => {
      expect(screen.queryAllByText("Second Branch")).toHaveLength(0);
    });
    expect(screen.getAllByText("Filtered Branch").length).toBeGreaterThan(0);
  }, 15000);

  it("shows a delete action for task managers and removes the task after confirmation", async () => {
    mockListScanoTasks.mockResolvedValue({
      items: [createTask()],
    });

    render(<ScanoPage />);

    expect((await screen.findAllByText("Nasr City")).length).toBeGreaterThan(0);
    fireEvent.click(screen.getAllByRole("button", { name: "Delete" })[0]!);
    expect(await screen.findByRole("dialog", { name: "Delete Task" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Delete Task" }));

    await waitFor(() => {
      expect(mockDeleteScanoTask).toHaveBeenCalledWith(TASK_1);
    });
    await waitFor(() => {
      expect(screen.queryAllByText("Nasr City")).toHaveLength(0);
    });
  }, 15000);

  it("hides manager actions for scanners", async () => {
    mockUseAuth.mockReturnValue({
      hasSystemCapability: () => false,
    });
    mockListScanoTasks.mockResolvedValue({
      items: [createTask({
        permissions: {
          canEdit: false,
          canStart: false,
          canManageAssignees: false,
          canComplete: false,
        },
      })],
    });

    render(<ScanoPage />);

    expect((await screen.findAllByText("Nasr City")).length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: "Add New Task" })).not.toBeInTheDocument();
    expect(screen.queryAllByRole("button", { name: "Edit" })).toHaveLength(0);
    expect(mockListScanoTeam).not.toHaveBeenCalled();
  });
});
