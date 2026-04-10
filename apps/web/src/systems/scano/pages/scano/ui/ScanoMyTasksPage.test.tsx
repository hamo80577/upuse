import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ScanoTaskListItem } from "../../../api/types";
import { ScanoMyTasksPage } from "./ScanoMyTasksPage";

const TASK_1 = "11111111-1111-4111-8111-111111111111";
const TASK_2 = "22222222-2222-4222-8222-222222222222";
const TASK_3 = "33333333-3333-4333-8333-333333333333";
const TASK_4 = "44444444-4444-4444-8444-444444444444";
const TASK_9 = "99999999-9999-4999-8999-999999999999";
const TASK_12 = "12121212-1212-4212-8212-121212121212";

const {
  mockUseAuth,
  mockNavigate,
  mockListScanoTasks,
  mockStartScanoTask,
  mockResumeScanoTask,
} = vi.hoisted(() => ({
  mockUseAuth: vi.fn(),
  mockNavigate: vi.fn(),
  mockListScanoTasks: vi.fn(),
  mockStartScanoTask: vi.fn(),
  mockResumeScanoTask: vi.fn(),
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
    listScanoTasks: mockListScanoTasks,
    startScanoTask: mockStartScanoTask,
    resumeScanoTask: mockResumeScanoTask,
  },
}));

function createTask(overrides?: Partial<ScanoTaskListItem>): ScanoTaskListItem {
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
    assignees: [{ id: 11, name: "Ali", linkedUserId: 2 }],
    progress: {
      startedCount: 0,
      endedCount: 0,
      totalCount: 1,
    },
    viewerState: {
      hasStarted: false,
      hasEnded: false,
      canEnter: false,
      canEnd: false,
      canResume: false,
    },
    permissions: {
      canEdit: false,
      canStart: true,
      canManageAssignees: false,
      canComplete: false,
    },
    ...overrides,
  };
}

describe("ScanoMyTasksPage", () => {
  beforeEach(() => {
    mockNavigate.mockReset();
    mockUseAuth.mockReturnValue({
      canManageScanoTasks: false,
    });
    mockListScanoTasks.mockResolvedValue({
      items: [],
    });
    mockStartScanoTask.mockResolvedValue({
      ok: true,
      item: createTask({
        status: "in_progress",
        progress: { startedCount: 1, endedCount: 0, totalCount: 1 },
        permissions: {
          canEdit: false,
          canStart: false,
          canManageAssignees: false,
          canComplete: false,
        },
        viewerState: {
          hasStarted: true,
          hasEnded: false,
          canEnter: true,
          canEnd: true,
          canResume: false,
        },
      }),
    });
    mockResumeScanoTask.mockResolvedValue({
      ok: true,
      item: createTask({
        status: "in_progress",
        permissions: {
          canEdit: false,
          canStart: false,
          canManageAssignees: false,
          canComplete: false,
        },
        viewerState: {
          hasStarted: true,
          hasEnded: false,
          canEnter: true,
          canEnd: true,
          canResume: false,
        },
      }),
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("renders start, continue, resume, and waiting states from viewer state", async () => {
    mockListScanoTasks.mockResolvedValue({
      items: [
        createTask({ id: TASK_1 }),
        createTask({
          id: TASK_2,
          status: "in_progress",
          permissions: {
            canEdit: false,
            canStart: false,
            canManageAssignees: false,
            canComplete: false,
          },
          viewerState: {
            hasStarted: true,
            hasEnded: false,
            canEnter: true,
            canEnd: true,
            canResume: false,
          },
          progress: { startedCount: 1, endedCount: 0, totalCount: 1 },
        }),
        createTask({
          id: TASK_3,
          status: "in_progress",
          permissions: {
            canEdit: false,
            canStart: false,
            canManageAssignees: false,
            canComplete: false,
          },
          viewerState: {
            hasStarted: true,
            hasEnded: true,
            canEnter: false,
            canEnd: false,
            canResume: true,
          },
          progress: { startedCount: 1, endedCount: 1, totalCount: 1 },
        }),
        createTask({
          id: TASK_4,
          status: "awaiting_review",
          permissions: {
            canEdit: false,
            canStart: false,
            canManageAssignees: false,
            canComplete: false,
          },
          viewerState: {
            hasStarted: true,
            hasEnded: true,
            canEnter: false,
            canEnd: false,
            canResume: false,
          },
          progress: { startedCount: 1, endedCount: 1, totalCount: 1 },
        }),
      ],
    });

    render(<ScanoMyTasksPage />);

    expect(await screen.findByRole("button", { name: "Start" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Continue" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Resume" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Waiting For Review" })).toBeDisabled();
  }, 15000);

  it("starts a task and enters the mobile runner", async () => {
    mockListScanoTasks.mockResolvedValue({
      items: [createTask({ id: TASK_9 })],
    });

    render(<ScanoMyTasksPage />);

    fireEvent.click(await screen.findByRole("button", { name: "Start" }));

    await waitFor(() => {
      expect(mockStartScanoTask).toHaveBeenCalledWith(TASK_9);
    });
    expect(mockNavigate).toHaveBeenCalledWith(`/scano/tasks/${TASK_9}/run`);
  });

  it("resumes a task and returns to the runner", async () => {
    mockListScanoTasks.mockResolvedValue({
      items: [
        createTask({
          id: TASK_12,
          status: "in_progress",
          permissions: {
            canEdit: false,
            canStart: false,
            canManageAssignees: false,
            canComplete: false,
          },
          viewerState: {
            hasStarted: true,
            hasEnded: true,
            canEnter: false,
            canEnd: false,
            canResume: true,
          },
          progress: { startedCount: 1, endedCount: 1, totalCount: 1 },
        }),
      ],
    });

    render(<ScanoMyTasksPage />);

    fireEvent.click(await screen.findByRole("button", { name: "Resume" }));

    await waitFor(() => {
      expect(mockResumeScanoTask).toHaveBeenCalledWith(TASK_12);
    });
    expect(mockNavigate).toHaveBeenCalledWith(`/scano/tasks/${TASK_12}/run`);
  });
});
