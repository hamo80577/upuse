import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  ScanoExternalProductSearchResult,
  ScanoRunnerBootstrapResponse,
  ScanoTaskDetail,
  ScanoTaskListItem,
  ScanoTaskProduct,
  ScanoTaskScanItem,
  ScanoTaskSummaryPatch,
} from "../../../api/types";
import { ScanoTaskRunnerPage } from "./ScanoTaskRunnerPage";

const TASK_7 = "77777777-7777-4777-8777-777777777777";

const {
  mockUseAuth,
  mockNavigate,
  mockUseParams,
  mockGetScanoTask,
  mockListScanoTaskProducts,
  mockListScanoTaskScans,
  mockGetScanoRunnerBootstrap,
  mockResolveScanoTaskScan,
  mockCreateScanoTaskProduct,
  mockUpdateScanoTaskProduct,
  mockEndScanoTask,
  mockStartScanoTask,
  mockDecodeFromCanvas,
  mockBrowserMultiFormatOneDReader,
  mockGetUserMedia,
} = vi.hoisted(() => ({
  mockUseAuth: vi.fn(),
  mockNavigate: vi.fn(),
  mockUseParams: vi.fn(),
  mockGetScanoTask: vi.fn(),
  mockListScanoTaskProducts: vi.fn(),
  mockListScanoTaskScans: vi.fn(),
  mockGetScanoRunnerBootstrap: vi.fn(),
  mockResolveScanoTaskScan: vi.fn(),
  mockCreateScanoTaskProduct: vi.fn(),
  mockUpdateScanoTaskProduct: vi.fn(),
  mockEndScanoTask: vi.fn(),
  mockStartScanoTask: vi.fn(),
  mockDecodeFromCanvas: vi.fn(),
  mockBrowserMultiFormatOneDReader: vi.fn(),
  mockGetUserMedia: vi.fn(),
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
    getScanoRunnerBootstrap: mockGetScanoRunnerBootstrap,
    resolveScanoTaskScan: mockResolveScanoTaskScan,
    createScanoTaskProduct: mockCreateScanoTaskProduct,
    updateScanoTaskProduct: mockUpdateScanoTaskProduct,
    endScanoTask: mockEndScanoTask,
    startScanoTask: mockStartScanoTask,
  },
}));

vi.mock("@zxing/browser", () => ({
  BrowserMultiFormatOneDReader: mockBrowserMultiFormatOneDReader.mockImplementation(() => ({
    decodeFromCanvas: mockDecodeFromCanvas,
  })),
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
    progress: { startedCount: 1, endedCount: 0, totalCount: 1 },
    viewerState: {
      hasStarted: true,
      hasEnded: false,
      canEnter: true,
      canEnd: true,
      canResume: false,
    },
    permissions: {
      canEdit: false,
      canStart: false,
      canManageAssignees: false,
      canComplete: false,
    },
    ...overrides,
  };
}

function createTaskSummaryPatch(overrides?: Partial<ScanoTaskSummaryPatch>): ScanoTaskSummaryPatch {
  return {
    status: "in_progress",
    progress: { startedCount: 1, endedCount: 0, totalCount: 1 },
    counters: {
      scannedProductsCount: 1,
      vendorCount: 0,
      vendorEditedCount: 0,
      chainCount: 0,
      chainEditedCount: 0,
      masterCount: 0,
      manualCount: 0,
    },
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
    latestExport: null,
    ...overrides,
  };
}

function createScan(overrides?: Partial<ScanoTaskScanItem>): ScanoTaskScanItem {
  return {
    id: 91,
    barcode: "123456789",
    source: "manual",
    outcome: "manual_only",
    lookupStatus: "resolved",
    resolvedProduct: null,
    scannedAt: "2026-04-10T08:30:00.000Z",
    taskProductId: null,
    scannedBy: {
      id: 11,
      name: "Ali",
      linkedUserId: 2,
    },
    ...overrides,
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

function createTaskDetail(overrides?: Partial<ScanoTaskDetail>): ScanoTaskDetail {
  return {
    ...createTaskListItem(overrides),
    participants: overrides?.participants ?? [
      {
        id: 11,
        name: "Ali",
        linkedUserId: 2,
        startedAt: "2026-04-10T08:05:00.000Z",
        lastEnteredAt: "2026-04-10T08:25:00.000Z",
        endedAt: null,
      },
    ],
    counters: overrides?.counters ?? {
      scannedProductsCount: 0,
      vendorCount: 0,
      vendorEditedCount: 0,
      chainCount: 0,
      chainEditedCount: 0,
      masterCount: 0,
      manualCount: 0,
    },
  };
}

function createBootstrap(overrides?: Partial<ScanoRunnerBootstrapResponse>): ScanoRunnerBootstrapResponse {
  return {
    runnerToken: "runner-token",
    confirmedBarcodes: [],
    confirmedProducts: [],
    masterIndex: [],
    ...overrides,
  };
}

function createExternalSearchResult(overrides?: Partial<ScanoExternalProductSearchResult>): ScanoExternalProductSearchResult {
  return {
    id: "ext-1",
    barcode: "123456789",
    barcodes: ["123456789"],
    itemNameEn: "Imported Product",
    itemNameAr: "منتج",
    image: "https://images.example.com/product.jpg",
    ...overrides,
  };
}

describe("ScanoTaskRunnerPage", () => {
  beforeEach(() => {
    mockGetUserMedia.mockReset();
    mockGetUserMedia.mockResolvedValue({
      getTracks: () => [{ stop: vi.fn() }],
    });
    mockDecodeFromCanvas.mockReset();
    mockDecodeFromCanvas.mockImplementation(() => {
      throw new Error("No barcode found");
    });
    mockBrowserMultiFormatOneDReader.mockClear();
    mockNavigate.mockReset();
    mockUseParams.mockReturnValue({ id: TASK_7 });
    mockUseAuth.mockReturnValue({
      canManageScanoTasks: false,
      user: {
        id: 2,
        email: "ali@example.com",
        name: "Ali",
        role: "user",
        active: true,
        createdAt: "2026-04-01T08:00:00.000Z",
        updatedAt: "2026-04-01T08:00:00.000Z",
        isPrimaryAdmin: false,
        scanoRole: "scanner",
        upuseAccess: false,
      },
    });
    mockGetScanoTask.mockResolvedValue({
      item: createTaskDetail(),
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
    mockGetScanoRunnerBootstrap.mockResolvedValue({
      item: createBootstrap(),
    });
    mockResolveScanoTaskScan.mockResolvedValue({
      kind: "draft",
      draft: {
        externalProductId: null,
        previewImageUrl: null,
        barcode: "999000111",
        barcodes: ["999000111"],
        sku: null,
        price: null,
        itemNameEn: null,
        itemNameAr: null,
        chain: "no",
        vendor: "no",
        masterfile: "no",
        new: "yes",
        sourceType: "manual",
        images: [],
        warning: "Not found in chain master file. Continue manually.",
      },
      rawScan: createScan({ barcode: "999000111" }),
      task: createTaskListItem(),
      counters: createTaskSummaryPatch().counters,
    });
    mockCreateScanoTaskProduct.mockResolvedValue({
      ok: true,
      item: createProduct(),
      rawScan: createScan({ taskProductId: "product-1" }),
      taskSummary: createTaskSummaryPatch(),
    });
    mockUpdateScanoTaskProduct.mockResolvedValue({
      ok: true,
      item: createProduct(),
      taskSummary: createTaskSummaryPatch(),
    });
    mockEndScanoTask.mockResolvedValue({
      ok: true,
      item: createTaskListItem({
        status: "awaiting_review",
        progress: { startedCount: 1, endedCount: 1, totalCount: 1 },
        viewerState: {
          hasStarted: true,
          hasEnded: true,
          canEnter: false,
          canEnd: false,
          canResume: false,
        },
      }),
    });
    mockStartScanoTask.mockResolvedValue({
      ok: true,
      item: createTaskListItem(),
    });

    Object.defineProperty(window, "isSecureContext", {
      configurable: true,
      value: true,
    });
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        getUserMedia: mockGetUserMedia,
      },
    });
    Object.defineProperty(HTMLVideoElement.prototype, "videoWidth", {
      configurable: true,
      get: () => 1280,
    });
    Object.defineProperty(HTMLVideoElement.prototype, "videoHeight", {
      configurable: true,
      get: () => 720,
    });
    Object.defineProperty(HTMLMediaElement.prototype, "readyState", {
      configurable: true,
      get: () => 4,
    });
    vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(() => ({
      drawImage: vi.fn(),
    } as unknown as CanvasRenderingContext2D));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  async function waitForRunnerReady() {
    const input = await screen.findByPlaceholderText("Type or scan barcode here");
    await waitFor(() => {
      expect(mockGetScanoRunnerBootstrap).toHaveBeenCalledWith(TASK_7, expect.any(Object));
      expect(input).toBeEnabled();
    });
  }

  it("uses an inline camera icon, keeps the search button compact, and hides task details by default", async () => {
    render(<ScanoTaskRunnerPage />);
    await waitForRunnerReady();

    expect(screen.queryByText("Open Camera Scanner")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open Camera Scanner" })).toBeInTheDocument();
    expect(screen.queryByText("Assigned Scanners")).not.toBeInTheDocument();
    expect(screen.queryByText("Scheduled At")).not.toBeInTheDocument();

    const searchButton = screen.getByRole("button", { name: "Find Product" });
    expect(searchButton.className).toContain("MuiButton-sizeSmall");
  });

  it("shows the current user's confirmed count in the collapsed summary and expands task details on demand", async () => {
    mockGetScanoTask.mockResolvedValue({
      item: createTaskDetail({
        counters: {
          scannedProductsCount: 2,
          vendorCount: 1,
          vendorEditedCount: 0,
          chainCount: 1,
          chainEditedCount: 0,
          masterCount: 0,
          manualCount: 0,
        },
      }),
    });
    mockGetScanoRunnerBootstrap.mockResolvedValue({
      item: createBootstrap({
        confirmedProducts: [
          createProduct({
            id: "product-1",
            sourceType: "vendor",
            chain: "yes",
            vendor: "yes",
            new: "no",
            createdBy: { id: 11, name: "Ali", linkedUserId: 2 },
          }),
          createProduct({
            id: "product-2",
            barcode: "555444333",
            barcodes: ["555444333"],
            sourceType: "chain",
            chain: "yes",
            vendor: "no",
            new: "no",
            createdBy: { id: 12, name: "Mona", linkedUserId: 3 },
          }),
        ],
      }),
    });

    render(<ScanoTaskRunnerPage />);
    await waitForRunnerReady();

    expect(screen.getByText("My Confirmed: 1")).toBeInTheDocument();
    expect(screen.getByText("Task Total: 2")).toBeInTheDocument();
    expect(screen.queryByText("Assigned Scanners")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Show Task Details" }));

    expect(await screen.findByText("Assigned Scanners")).toBeInTheDocument();
    expect(screen.getByText("Scheduled At")).toBeInTheDocument();
  });

  it("reuses the existing runner bootstrap state across repeated lookups on the same task", async () => {
    mockResolveScanoTaskScan
      .mockResolvedValueOnce({
        kind: "draft",
        draft: {
          externalProductId: null,
          previewImageUrl: null,
          barcode: "999000111",
          barcodes: ["999000111"],
          sku: null,
          price: null,
          itemNameEn: null,
          itemNameAr: null,
          chain: "no",
          vendor: "no",
          masterfile: "no",
          new: "yes",
          sourceType: "manual",
          images: [],
          warning: "Not found in chain master file. Continue manually.",
        },
        rawScan: createScan({ barcode: "999000111" }),
        task: createTaskListItem(),
        counters: createTaskSummaryPatch().counters,
      })
      .mockResolvedValueOnce({
        kind: "draft",
        draft: {
          externalProductId: null,
          previewImageUrl: null,
          barcode: "999000222",
          barcodes: ["999000222"],
          sku: null,
          price: null,
          itemNameEn: null,
          itemNameAr: null,
          chain: "no",
          vendor: "no",
          masterfile: "no",
          new: "yes",
          sourceType: "manual",
          images: [],
          warning: "Not found in chain master file. Continue manually.",
        },
        rawScan: createScan({ barcode: "999000222" }),
        task: createTaskListItem(),
        counters: createTaskSummaryPatch().counters,
      });

    render(<ScanoTaskRunnerPage />);
    await waitForRunnerReady();

    const input = screen.getByPlaceholderText("Type or scan barcode here");

    fireEvent.change(input, {
      target: { value: "999000111" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Find Product" }));

    expect(await screen.findByText("Review Product")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    await waitFor(() => {
      expect(screen.queryByText("Review Product")).not.toBeInTheDocument();
    });

    fireEvent.change(input, {
      target: { value: "999000222" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Find Product" }));

    expect(await screen.findByText("Review Product")).toBeInTheDocument();
    expect(mockGetScanoRunnerBootstrap).toHaveBeenCalledTimes(1);
    expect(mockResolveScanoTaskScan).toHaveBeenNthCalledWith(1, TASK_7, {
      barcode: "999000111",
      source: "manual",
    });
    expect(mockResolveScanoTaskScan).toHaveBeenNthCalledWith(2, TASK_7, {
      barcode: "999000222",
      source: "manual",
    });
  });

  it("opens the camera scanner and resolves barcodes with the camera source", async () => {
    mockDecodeFromCanvas.mockReturnValueOnce({
      getText: () => "5544332211",
    });

    render(<ScanoTaskRunnerPage />);
    await waitForRunnerReady();

    fireEvent.click(screen.getByRole("button", { name: "Open Camera Scanner" }));

    await waitFor(() => {
      expect(mockGetUserMedia).toHaveBeenCalledWith(expect.objectContaining({
        audio: false,
        video: expect.objectContaining({
          facingMode: { ideal: "environment" },
        }),
      }));
    });

    await waitFor(() => {
      expect(mockResolveScanoTaskScan).toHaveBeenCalledWith(TASK_7, {
        barcode: "5544332211",
        source: "camera",
      });
      expect(mockBrowserMultiFormatOneDReader).toHaveBeenCalled();
    });
  });

  it("shows a clear error when camera permission is denied", async () => {
    mockGetUserMedia.mockRejectedValue(Object.assign(new Error("Permission denied"), {
      name: "NotAllowedError",
    }));

    render(<ScanoTaskRunnerPage />);
    await waitForRunnerReady();

    fireEvent.click(screen.getByRole("button", { name: "Open Camera Scanner" }));

    expect(await screen.findByText("Camera access was denied. Allow camera permission and try again.")).toBeInTheDocument();
    expect(mockResolveScanoTaskScan).not.toHaveBeenCalled();
  });

  it("requires a secure context before opening the camera", async () => {
    Object.defineProperty(window, "isSecureContext", {
      configurable: true,
      value: false,
    });

    render(<ScanoTaskRunnerPage />);
    await waitForRunnerReady();

    fireEvent.click(screen.getByRole("button", { name: "Open Camera Scanner" }));

    expect(await screen.findByText("Camera access requires HTTPS or localhost on mobile browsers.")).toBeInTheDocument();
    expect(mockGetUserMedia).not.toHaveBeenCalled();
  });

  it("uses resolve for exact matches and auto-saves without runner hydrate calls", async () => {
    const imageUrls = [
      "https://images.example.com/product-1.jpg",
      "https://images.example.com/product-2.jpg",
      "https://images.example.com/product-3.jpg",
    ];
    mockResolveScanoTaskScan.mockResolvedValue({
      kind: "draft",
      draft: {
        externalProductId: "ext-1",
        previewImageUrl: imageUrls[0],
        barcode: "123456789",
        barcodes: ["123456789"],
        sku: "SKU-1",
        price: "100",
        itemNameEn: "Imported Product",
        itemNameAr: "منتج",
        chain: "yes",
        vendor: "yes",
        masterfile: "no",
        new: "no",
        sourceType: "vendor",
        images: imageUrls,
        warning: null,
      },
      rawScan: createScan({ barcode: "123456789" }),
      task: createTaskListItem(),
      counters: createTaskSummaryPatch({
        counters: {
          scannedProductsCount: 1,
          vendorCount: 1,
          vendorEditedCount: 0,
          chainCount: 0,
          chainEditedCount: 0,
          masterCount: 0,
          manualCount: 0,
        },
      }).counters,
    });
    mockCreateScanoTaskProduct.mockResolvedValue({
      ok: true,
      item: createProduct({
        externalProductId: "ext-1",
        previewImageUrl: imageUrls[0],
        sourceType: "vendor",
        chain: "yes",
        vendor: "yes",
      }),
      rawScan: createScan({ taskProductId: "product-1" }),
      taskSummary: createTaskSummaryPatch({
        counters: {
          scannedProductsCount: 1,
          vendorCount: 1,
          vendorEditedCount: 0,
          chainCount: 0,
          chainEditedCount: 0,
          masterCount: 0,
          manualCount: 0,
        },
      }),
    });

    render(<ScanoTaskRunnerPage />);
    await waitForRunnerReady();

    fireEvent.change(screen.getByPlaceholderText("Type or scan barcode here"), {
      target: { value: "123456789" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Find Product" }));

    await waitFor(() => {
      expect(mockResolveScanoTaskScan).toHaveBeenCalledWith(TASK_7, {
        barcode: "123456789",
        source: "manual",
      });
      expect(mockCreateScanoTaskProduct).toHaveBeenCalledWith(
        TASK_7,
        expect.objectContaining({
          imageUrls,
        }),
        [],
      );
    });

    expect(await screen.findByText("Review Product")).toBeInTheDocument();
    expect(screen.getByAltText("Image 2")).toBeInTheDocument();
    expect(screen.getByAltText("Image 3")).toBeInTheDocument();
    expect(screen.getByText("Latest Confirmed Product")).toBeInTheDocument();
    expect(document.body.textContent).toContain("My Confirmed: 1");
    expect(document.body.textContent).toContain("Task Total: 1");
    expect(mockGetScanoRunnerBootstrap).toHaveBeenCalledTimes(1);
    expect(screen.getAllByText("Imported Product").length).toBeGreaterThan(0);
  }, 15000);

  it("shows selection results and resolves again with the chosen external product", async () => {
    mockResolveScanoTaskScan
      .mockResolvedValueOnce({
        kind: "selection",
        items: [
          createExternalSearchResult(),
          createExternalSearchResult({
            id: "ext-2",
            barcode: "123456789-2",
            barcodes: ["123456789-2"],
            itemNameEn: "Imported Product B",
            itemNameAr: "منتج ثاني",
          }),
        ],
      })
      .mockResolvedValueOnce({
        kind: "draft",
        draft: {
          externalProductId: "ext-2",
          previewImageUrl: "https://images.example.com/product.jpg",
          barcode: "123456789",
          barcodes: ["123456789", "123456789-2"],
          sku: "SKU-2",
          price: "200",
          itemNameEn: "Imported Product B",
          itemNameAr: "منتج ثاني",
          chain: "yes",
          vendor: "yes",
          masterfile: "no",
          new: "no",
          sourceType: "vendor",
          images: ["https://images.example.com/product.jpg"],
          warning: null,
        },
        rawScan: createScan({ barcode: "123456789" }),
        task: createTaskListItem(),
        counters: createTaskSummaryPatch().counters,
      });
    mockCreateScanoTaskProduct.mockResolvedValue({
      ok: true,
      item: createProduct({
        id: "product-2",
        externalProductId: "ext-2",
        barcode: "123456789",
        barcodes: ["123456789", "123456789-2"],
        sku: "SKU-2",
        price: "200",
        itemNameEn: "Imported Product B",
        itemNameAr: "منتج ثاني",
        sourceType: "vendor",
        chain: "yes",
        vendor: "yes",
        new: "no",
      }),
      rawScan: createScan({ taskProductId: "product-2" }),
      taskSummary: createTaskSummaryPatch(),
    });

    render(<ScanoTaskRunnerPage />);
    await waitForRunnerReady();

    fireEvent.change(screen.getByPlaceholderText("Type or scan barcode here"), {
      target: { value: "123456789" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Find Product" }));

    expect(await screen.findByText("Imported Product B")).toBeInTheDocument();
    fireEvent.click(screen.getAllByText("Imported Product B")[0]!);

    await waitFor(() => {
      expect(mockResolveScanoTaskScan).toHaveBeenNthCalledWith(1, TASK_7, {
        barcode: "123456789",
        source: "manual",
      });
      expect(mockResolveScanoTaskScan).toHaveBeenNthCalledWith(2, TASK_7, {
        barcode: "123456789",
        source: "manual",
        selectedExternalProductId: "ext-2",
      });
      expect(mockCreateScanoTaskProduct).toHaveBeenCalled();
    });

    expect(screen.getAllByText("Imported Product B").length).toBeGreaterThan(0);
  }, 15000);

  it("re-scanning a saved barcode reopens the existing product and allows editing for assigned scanners", async () => {
    mockResolveScanoTaskScan.mockResolvedValue({
      kind: "duplicate",
      message: "This barcode was already scanned before.",
      existingProduct: createProduct({
        externalProductId: "ext-1",
        sourceType: "vendor",
        chain: "yes",
        vendor: "yes",
        new: "no",
        canEdit: true,
      }),
      existingScannerName: "Ali",
      existingScannedAt: "2026-04-10T08:30:00.000Z",
      rawScan: createScan({
        outcome: "duplicate_blocked",
        barcode: "123456789",
        taskProductId: "product-1",
      }),
      task: createTaskListItem(),
      counters: createTaskSummaryPatch().counters!,
    });
    mockUpdateScanoTaskProduct.mockResolvedValue({
      ok: true,
      item: createProduct({
        externalProductId: "ext-1",
        sourceType: "vendor",
        chain: "yes",
        vendor: "yes",
        new: "no",
        sku: "SKU-2",
        itemNameEn: "Imported Product Updated",
        updatedAt: "2026-04-10T08:45:00.000Z",
        canEdit: true,
      }),
      taskSummary: createTaskSummaryPatch(),
    });

    render(<ScanoTaskRunnerPage />);
    await waitForRunnerReady();

    fireEvent.change(screen.getByPlaceholderText("Type or scan barcode here"), {
      target: { value: "123456789" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Find Product" }));

    expect(await screen.findByText(/Already scanned by Ali/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.change(screen.getByLabelText("SKU"), {
      target: { value: "SKU-2" },
    });
    fireEvent.change(screen.getByLabelText("Item Name EN"), {
      target: { value: "Imported Product Updated" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));

    await waitFor(() => {
      expect(mockUpdateScanoTaskProduct).toHaveBeenCalledWith(
        TASK_7,
        "product-1",
        expect.objectContaining({
          sku: "SKU-2",
          itemNameEn: "Imported Product Updated",
        }),
        [],
      );
    });
  }, 15000);

  it("keeps duplicate reopen read-only when the existing product is not editable", async () => {
    mockResolveScanoTaskScan.mockResolvedValue({
      kind: "duplicate",
      message: "This barcode was already scanned before.",
      existingProduct: createProduct({
        externalProductId: "ext-1",
        sourceType: "vendor",
        chain: "yes",
        vendor: "yes",
        new: "no",
        canEdit: false,
      }),
      existingScannerName: "Ali",
      existingScannedAt: "2026-04-10T08:30:00.000Z",
      rawScan: createScan({
        outcome: "duplicate_blocked",
        barcode: "123456789",
        taskProductId: "product-1",
      }),
      task: createTaskListItem(),
      counters: createTaskSummaryPatch().counters!,
    });

    render(<ScanoTaskRunnerPage />);
    await waitForRunnerReady();

    fireEvent.change(screen.getByPlaceholderText("Type or scan barcode here"), {
      target: { value: "123456789" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Find Product" }));

    expect(await screen.findByText(/Already scanned by Ali/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit" })).not.toBeInTheDocument();
  });

  it("shows a manual review dialog when both external and master lookups miss", async () => {
    render(<ScanoTaskRunnerPage />);
    await waitForRunnerReady();

    fireEvent.change(screen.getByPlaceholderText("Type or scan barcode here"), {
      target: { value: "999000111" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Find Product" }));

    expect(await screen.findByText("Review Product")).toBeInTheDocument();
    expect(await screen.findByText(/Continue manually/i)).toBeInTheDocument();
    expect(mockCreateScanoTaskProduct).not.toHaveBeenCalled();
  });

  it("asks for confirmation before ending the task and returns to the profile", async () => {
    render(<ScanoTaskRunnerPage />);

    fireEvent.click(await screen.findByRole("button", { name: "Show Task Details" }));
    fireEvent.click(await screen.findByRole("button", { name: "End Task" }));
    fireEvent.click(await screen.findByRole("button", { name: "Confirm" }));

    await waitFor(() => {
      expect(mockEndScanoTask).toHaveBeenCalledWith(TASK_7);
    });
    expect(await screen.findByText("Task Ended")).toBeInTheDocument();
    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith(`/scano/tasks/${TASK_7}`);
    }, { timeout: 1500 });
  });
});
