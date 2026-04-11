import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ScanoTaskDetail, ScanoTaskListItem, ScanoTaskProduct } from "../../../api/types";
import { SCANO_TASKS_MANAGE_CAPABILITY } from "../../../routes/capabilities";
import { ScanoTaskProfilePage } from "./ScanoTaskProfilePage";

const TASK_7 = "77777777-7777-4777-8777-777777777777";

const {
  mockUseAuth,
  mockNavigate,
  mockUseParams,
  mockGetScanoTask,
  mockListScanoTaskProducts,
  mockListScanoTaskScans,
  mockListScanoTeam,
  mockUpdateScanoTaskAssignees,
  mockCompleteScanoTask,
  mockDeleteScanoTask,
} = vi.hoisted(() => ({
  mockUseAuth: vi.fn(),
  mockNavigate: vi.fn(),
  mockUseParams: vi.fn(),
  mockGetScanoTask: vi.fn(),
  mockListScanoTaskProducts: vi.fn(),
  mockListScanoTaskScans: vi.fn(),
  mockListScanoTeam: vi.fn(),
  mockUpdateScanoTaskAssignees: vi.fn(),
  mockCompleteScanoTask: vi.fn(),
  mockDeleteScanoTask: vi.fn(),
}));

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return {
    ...actual,
    useNavigate: () => mockNavigate,
    useParams: () => mockUseParams(),
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
    getScanoTask: mockGetScanoTask,
    listScanoTaskProducts: mockListScanoTaskProducts,
    listScanoTaskScans: mockListScanoTaskScans,
    listScanoTeam: mockListScanoTeam,
    updateScanoTaskAssignees: mockUpdateScanoTaskAssignees,
    completeScanoTask: mockCompleteScanoTask,
    deleteScanoTask: mockDeleteScanoTask,
    startScanoTask: vi.fn(),
    resumeScanoTask: vi.fn(),
  },
}));

function createTaskListItem(overrides?: Partial<ScanoTaskListItem>): ScanoTaskListItem {
  return {
    id: TASK_7,
    chainId: 1037,
    chainName: "Carrefour",
    branchId: 4594,
    branchGlobalId: "vendor-global-4594",
    branchName: "Nasr City",
    globalEntityId: "TB_EG",
    countryCode: "EG",
    additionalRemoteId: "branch-4594",
    scheduledAt: "2026-04-10T08:00:00.000Z",
    status: "in_progress",
    assignees: [{ id: 11, name: "Ali", linkedUserId: 2 }],
    progress: {
      startedCount: 1,
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
      canStart: false,
      canManageAssignees: true,
      canComplete: false,
    },
    ...overrides,
  };
}

function createTaskDetail(overrides?: Partial<ScanoTaskDetail>): ScanoTaskDetail {
  const listItem = createTaskListItem(overrides);
  return {
    ...listItem,
    participants: overrides?.participants ?? [
      {
        id: 11,
        name: "Ali",
        linkedUserId: 2,
        startedAt: "2026-04-10T08:15:00.000Z",
        lastEnteredAt: "2026-04-10T08:20:00.000Z",
        endedAt: null,
      },
    ],
    counters: overrides?.counters ?? {
      scannedProductsCount: 0,
      placeholderMetricOneCount: 0,
      placeholderMetricTwoCount: 0,
      placeholderMetricThreeCount: 0,
    },
  };
}

function createProduct(overrides?: Partial<ScanoTaskProduct>): ScanoTaskProduct {
  return {
    id: "product-1",
    sourceType: "manual",
    externalProductId: null,
    previewImageUrl: null,
    barcode: "123456789",
    barcodes: ["123456789"],
    sku: "SKU-1",
    price: "100",
    itemNameEn: "Imported Product",
    itemNameAr: null,
    chain: "no",
    vendor: "no",
    masterfile: "no",
    new: "yes",
    edited: false,
    images: [],
    edits: [],
    createdBy: { id: 11, name: "Ali", linkedUserId: 2 },
    confirmedAt: "2026-04-10T08:30:00.000Z",
    updatedAt: "2026-04-10T08:30:00.000Z",
    canEdit: true,
    ...overrides,
  };
}

describe("ScanoTaskProfilePage", () => {
  beforeEach(() => {
    mockNavigate.mockReset();
    mockUseParams.mockReturnValue({ id: TASK_7 });
    mockUseAuth.mockReturnValue({
      hasSystemCapability: (systemId: string, capability: string) => (
        systemId === "scano" && capability === SCANO_TASKS_MANAGE_CAPABILITY
      ),
    });
    mockListScanoTaskProducts.mockResolvedValue({
      items: [],
      page: 1,
      pageSize: 10,
      total: 0,
      totalPages: 1,
    });
    mockListScanoTaskScans.mockResolvedValue({
      items: [],
      page: 1,
      pageSize: 10,
      total: 0,
      totalPages: 1,
    });
    mockListScanoTeam.mockResolvedValue({
      items: [
        {
          id: 11,
          name: "Ali",
          linkedUserId: 2,
          linkedUserName: "Ali User",
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
    mockUpdateScanoTaskAssignees.mockResolvedValue({
      ok: true,
      item: createTaskListItem({
        assignees: [
          { id: 11, name: "Ali", linkedUserId: 2 },
          { id: 12, name: "Mona", linkedUserId: 3 },
        ],
        progress: { startedCount: 1, endedCount: 0, totalCount: 2 },
      }),
    });
    mockCompleteScanoTask.mockResolvedValue({
      ok: true,
      item: createTaskListItem({
        status: "completed",
        permissions: {
          canEdit: false,
          canStart: false,
          canManageAssignees: false,
          canComplete: false,
        },
      }),
    });
    mockDeleteScanoTask.mockResolvedValue({
      ok: true,
      item: { id: TASK_7 },
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("lets managers edit assignees while the task is active", async () => {
    mockGetScanoTask
      .mockResolvedValueOnce({
        item: createTaskDetail(),
      })
      .mockResolvedValueOnce({
        item: createTaskDetail({
          assignees: [
            { id: 11, name: "Ali", linkedUserId: 2 },
            { id: 12, name: "Mona", linkedUserId: 3 },
          ],
          participants: [
            {
              id: 11,
              name: "Ali",
              linkedUserId: 2,
              startedAt: "2026-04-10T08:15:00.000Z",
              lastEnteredAt: "2026-04-10T08:20:00.000Z",
              endedAt: null,
            },
            {
              id: 12,
              name: "Mona",
              linkedUserId: 3,
              startedAt: null,
              lastEnteredAt: null,
              endedAt: null,
            },
          ],
          progress: { startedCount: 1, endedCount: 0, totalCount: 2 },
        }),
      });

    render(<ScanoTaskProfilePage />);

    fireEvent.click(await screen.findByRole("button", { name: "Edit Assignees" }));
    fireEvent.click(await screen.findByLabelText("Mona (mona@example.com)"));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(mockUpdateScanoTaskAssignees).toHaveBeenCalledWith(TASK_7, { assigneeIds: [11, 12] });
    });
  }, 15000);

  it("lets managers complete a task from awaiting review", async () => {
    mockGetScanoTask
      .mockResolvedValueOnce({
        item: createTaskDetail({
          status: "awaiting_review",
          progress: { startedCount: 2, endedCount: 2, totalCount: 2 },
          permissions: {
            canEdit: false,
            canStart: false,
            canManageAssignees: false,
            canComplete: true,
          },
          assignees: [
            { id: 11, name: "Ali", linkedUserId: 2 },
            { id: 12, name: "Mona", linkedUserId: 3 },
          ],
        }),
      })
      .mockResolvedValueOnce({
        item: createTaskDetail({
          status: "completed",
          progress: { startedCount: 2, endedCount: 2, totalCount: 2 },
          permissions: {
            canEdit: false,
            canStart: false,
            canManageAssignees: false,
            canComplete: false,
          },
          assignees: [
            { id: 11, name: "Ali", linkedUserId: 2 },
            { id: 12, name: "Mona", linkedUserId: 3 },
          ],
        }),
      });

    render(<ScanoTaskProfilePage />);

    fireEvent.click(await screen.findByRole("button", { name: "Complete Task" }));

    await waitFor(() => {
      expect(mockCompleteScanoTask).toHaveBeenCalledWith(TASK_7);
    });
    expect(await screen.findByText("Task marked as completed")).toBeInTheDocument();
  });

  it("keeps confirmed products collapsed until opened and exposes task deletion to managers", async () => {
    mockGetScanoTask.mockResolvedValue({
      item: createTaskDetail(),
    });
    mockListScanoTaskProducts.mockResolvedValue({
      items: [createProduct()],
      page: 1,
      pageSize: 10,
      total: 1,
      totalPages: 1,
    });

    render(<ScanoTaskProfilePage />);

    expect(await screen.findByRole("button", { name: "Delete Task" })).toBeInTheDocument();
    expect(await screen.findByText("Confirmed products stay hidden until you open them.")).toBeInTheDocument();
    expect(screen.queryByText("Item Name")).not.toBeInTheDocument();

    fireEvent.click(screen.getAllByRole("button", { name: "Show" })[0]!);
    expect(await screen.findByText("Imported Product")).toBeInTheDocument();
  }, 15000);

  it("does not load assignee management for scanners", async () => {
    mockUseAuth.mockReturnValue({
      hasSystemCapability: () => false,
    });
    mockGetScanoTask.mockResolvedValue({
      item: createTaskDetail({
        permissions: {
          canEdit: false,
          canStart: false,
          canManageAssignees: false,
          canComplete: false,
        },
      }),
    });

    render(<ScanoTaskProfilePage />);

    await screen.findByText("Nasr City");
    expect(screen.queryByRole("button", { name: "Edit Assignees" })).not.toBeInTheDocument();
    expect(mockListScanoTeam).not.toHaveBeenCalled();
  });
});
