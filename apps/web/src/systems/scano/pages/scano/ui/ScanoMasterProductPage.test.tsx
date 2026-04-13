import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  ScanoMasterProductDetail,
  ScanoMasterProductListItem,
  ScanoMasterProductPreviewResponse,
} from "../../../api/types";
import { ScanoMasterProductPage } from "./ScanoMasterProductPage";

const {
  mockListScanoChains,
  mockListScanoMasterProducts,
  mockPreviewScanoMasterProducts,
  mockCreateScanoMasterProduct,
  mockGetScanoMasterProduct,
  mockResumeScanoMasterProductEnrichment,
  mockUpdateScanoMasterProduct,
  mockDeleteScanoMasterProduct,
} = vi.hoisted(() => ({
  mockListScanoChains: vi.fn(),
  mockListScanoMasterProducts: vi.fn(),
  mockPreviewScanoMasterProducts: vi.fn(),
  mockCreateScanoMasterProduct: vi.fn(),
  mockGetScanoMasterProduct: vi.fn(),
  mockResumeScanoMasterProductEnrichment: vi.fn(),
  mockUpdateScanoMasterProduct: vi.fn(),
  mockDeleteScanoMasterProduct: vi.fn(),
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
    listScanoChains: mockListScanoChains,
    listScanoMasterProducts: mockListScanoMasterProducts,
    previewScanoMasterProducts: mockPreviewScanoMasterProducts,
    createScanoMasterProduct: mockCreateScanoMasterProduct,
    getScanoMasterProduct: mockGetScanoMasterProduct,
    resumeScanoMasterProductEnrichment: mockResumeScanoMasterProductEnrichment,
    updateScanoMasterProduct: mockUpdateScanoMasterProduct,
    deleteScanoMasterProduct: mockDeleteScanoMasterProduct,
  },
}));

function createListItem(overrides?: Partial<ScanoMasterProductListItem>): ScanoMasterProductListItem {
  return {
    chainId: 1037,
    chainName: "Carrefour",
    productCount: 2,
    updatedAt: "2026-04-05T12:00:00.000Z",
    enrichmentStatus: "completed",
    enrichedCount: 2,
    processedCount: 2,
    remainingEnrichmentCount: 0,
    canResumeEnrichment: false,
    warningCode: null,
    warningMessage: null,
    ...overrides,
  };
}

function createPreviewResponse(overrides?: Partial<ScanoMasterProductPreviewResponse>): ScanoMasterProductPreviewResponse {
  return {
    headers: ["item number", "barcode value", "english name", "sell price"],
    sampleRows: [
      {
        "item number": "SKU-1",
        "barcode value": "111",
        "english name": "Milk",
        "sell price": "55",
      },
      {
        "item number": "SKU-2",
        "barcode value": "222",
        "english name": "Bread",
        "sell price": "33",
      },
    ],
    suggestedMapping: {
      sku: "item number",
      barcode: "barcode value",
      itemNameEn: "english name",
      price: "sell price",
      itemNameAr: null,
      image: null,
    },
    ...overrides,
  };
}

function createDetail(overrides?: Partial<ScanoMasterProductDetail>): ScanoMasterProductDetail {
  return {
    chainId: 1037,
    chainName: "Carrefour",
    productCount: 2,
    updatedAt: "2026-04-05T12:00:00.000Z",
    enrichmentStatus: "completed",
    enrichedCount: 2,
    processedCount: 2,
    remainingEnrichmentCount: 0,
    canResumeEnrichment: false,
    warningCode: null,
    warningMessage: null,
    enrichmentQueuedAt: "2026-04-05T12:00:00.000Z",
    enrichmentStartedAt: "2026-04-05T12:01:00.000Z",
    enrichmentPausedAt: null,
    enrichmentCompletedAt: "2026-04-05T12:10:00.000Z",
    mapping: {
      sku: "item number",
      barcode: "barcode value",
      itemNameEn: "english name",
      price: "sell price",
      itemNameAr: null,
      image: null,
    },
    exampleRows: [
      {
        rowNumber: 2,
        sku: "SKU-1",
        barcode: "111",
        price: "55",
        itemNameEn: "Milk",
        itemNameAr: null,
        image: null,
      },
    ],
    ...overrides,
  };
}

describe("ScanoMasterProductPage", () => {
  beforeEach(() => {
    mockListScanoMasterProducts.mockResolvedValue({
      items: [createListItem()],
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
    mockPreviewScanoMasterProducts.mockResolvedValue(createPreviewResponse());
    mockCreateScanoMasterProduct.mockResolvedValue({
      ok: true,
      item: createListItem({ productCount: 12 }),
    });
    mockUpdateScanoMasterProduct.mockResolvedValue({
      ok: true,
      item: createListItem({ updatedAt: "2026-04-06T09:00:00.000Z", productCount: 4 }),
    });
    mockGetScanoMasterProduct.mockResolvedValue({
      item: createDetail(),
    });
    mockResumeScanoMasterProductEnrichment.mockResolvedValue({
      ok: true,
      item: createListItem({
        enrichmentStatus: "queued",
        enrichedCount: 1,
        processedCount: 1,
        remainingEnrichmentCount: 1,
        canResumeEnrichment: true,
        warningCode: null,
        warningMessage: null,
      }),
    });
    mockDeleteScanoMasterProduct.mockResolvedValue({ ok: true });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("creates a master product import through the wizard", async () => {
    const view = render(<ScanoMasterProductPage />);

    expect(await screen.findByText("Carrefour")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Add Chain" }));

    const dialog = await screen.findByRole("dialog", { name: "Add Chain" });
    fireEvent.change(within(dialog).getByLabelText("Search Chains"), {
      target: { value: "car" },
    });

    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 320));
    });
    await waitFor(() => {
      expect(mockListScanoChains).toHaveBeenCalledWith("car", expect.anything());
    });

    fireEvent.click(within(dialog).getByText("Carrefour"));
    fireEvent.click(within(dialog).getByRole("button", { name: "Next" }));

    const fileInput = dialog.querySelector('input[type="file"]') as HTMLInputElement | null;
    expect(fileInput).not.toBeNull();
    const file = new File(["item number,barcode value,english name\nSKU-1,111,Milk"], "products.csv", { type: "text/csv" });
    fireEvent.change(fileInput!, { target: { files: [file] } });

    await waitFor(() => {
      expect(mockPreviewScanoMasterProducts).toHaveBeenCalledWith(file);
    });

    fireEvent.click(within(dialog).getByRole("button", { name: "Next" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Save Chain" }));

    await waitFor(() => {
      expect(mockCreateScanoMasterProduct).toHaveBeenCalledWith({
        chainId: 1037,
        chainName: "Carrefour",
        mapping: createPreviewResponse().suggestedMapping,
        file,
      });
    });

    expect(await screen.findByText("Chain import saved.")).toBeInTheDocument();
    view.unmount();
  }, 10_000);

  it("replaces an existing chain import with a fresh csv on edit", async () => {
    render(<ScanoMasterProductPage />);

    expect(await screen.findByText("Carrefour")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));

    const dialog = await screen.findByRole("dialog", { name: "Replace Chain Import" });
    expect(within(dialog).getByText("Selected chain")).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole("button", { name: "Next" }));

    const fileInput = dialog.querySelector('input[type="file"]') as HTMLInputElement | null;
    const file = new File(["item number,barcode value,english name\nSKU-3,333,Eggs"], "replacement.csv", { type: "text/csv" });
    fireEvent.change(fileInput!, { target: { files: [file] } });

    await waitFor(() => {
      expect(mockPreviewScanoMasterProducts).toHaveBeenCalledWith(file);
    });

    fireEvent.click(within(dialog).getByRole("button", { name: "Next" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Replace Import" }));

    await waitFor(() => {
      expect(mockUpdateScanoMasterProduct).toHaveBeenCalledWith(1037, {
        chainId: 1037,
        chainName: "Carrefour",
        mapping: createPreviewResponse().suggestedMapping,
        file,
      });
    });
  }, 10_000);

  it("opens the view dialog and renders mapping plus example rows", async () => {
    render(<ScanoMasterProductPage />);

    expect(await screen.findByText("Carrefour")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "View" }));

    const dialog = await screen.findByRole("dialog", { name: "Chain Import Details" });
    await waitFor(() => {
      expect(mockGetScanoMasterProduct).toHaveBeenCalledWith(1037, expect.anything());
    });

    expect(await within(dialog).findByText("Header Mapping")).toBeInTheDocument();
    expect(within(dialog).getByText("SKU-1")).toBeInTheDocument();
    expect(within(dialog).getByText("Milk")).toBeInTheDocument();
    expect(within(dialog).getByText("2/2")).toBeInTheDocument();
    expect(within(dialog).getByText("Completed")).toBeInTheDocument();
    expect(within(dialog).getByText("2 of 2 products enriched successfully. Processed 2.")).toBeInTheDocument();
  });

  it("deletes a saved chain import after confirmation", async () => {
    render(<ScanoMasterProductPage />);

    expect(await screen.findByText("Carrefour")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));

    const dialog = await screen.findByRole("dialog", { name: "Delete Chain Import" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }));

    await waitFor(() => {
      expect(mockDeleteScanoMasterProduct).toHaveBeenCalledWith(1037);
    });

    await waitFor(() => {
      expect(screen.queryByText("Carrefour")).not.toBeInTheDocument();
    });
  });

  it("shows resume actions for resumable chains and refreshes the open detail after resuming", async () => {
    mockListScanoMasterProducts.mockResolvedValue({
      items: [
        createListItem({
          enrichmentStatus: "paused_auth",
          enrichedCount: 1,
          processedCount: 2,
          remainingEnrichmentCount: 1,
          canResumeEnrichment: true,
          warningCode: "SCANO_MASTER_ENRICHMENT_AUTH_PAUSED",
          warningMessage: "Scano catalog token is invalid.",
        }),
      ],
    });
    mockGetScanoMasterProduct
      .mockResolvedValueOnce({
        item: createDetail({
          enrichmentStatus: "paused_auth",
          enrichedCount: 1,
          processedCount: 2,
          remainingEnrichmentCount: 1,
          canResumeEnrichment: true,
          warningCode: "SCANO_MASTER_ENRICHMENT_AUTH_PAUSED",
          warningMessage: "Scano catalog token is invalid.",
          enrichmentPausedAt: "2026-04-05T12:12:00.000Z",
          enrichmentCompletedAt: null,
        }),
      })
      .mockResolvedValueOnce({
        item: createDetail({
          enrichmentStatus: "queued",
          enrichedCount: 1,
          processedCount: 1,
          remainingEnrichmentCount: 1,
          canResumeEnrichment: true,
          warningCode: null,
          warningMessage: null,
          enrichmentPausedAt: null,
          enrichmentCompletedAt: null,
        }),
      });

    render(<ScanoMasterProductPage />);

    expect(await screen.findByText("Carrefour")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Resume" }));

    await waitFor(() => {
      expect(mockResumeScanoMasterProductEnrichment).toHaveBeenCalledWith(1037);
    });
    expect(await screen.findByText("Enrichment resumed from the current saved progress.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "View" }));
    const dialog = await screen.findByRole("dialog", { name: "Chain Import Details" });
    expect(await within(dialog).findByText("Resume Enrichment")).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole("button", { name: "Resume Enrichment" }));

    await waitFor(() => {
      expect(mockResumeScanoMasterProductEnrichment).toHaveBeenCalledTimes(2);
      expect(mockGetScanoMasterProduct).toHaveBeenCalledTimes(2);
    });
    expect(await within(dialog).findByText("Queued")).toBeInTheDocument();
  });

  it("labels completed partial imports as retry-missing and keeps existing enriched products", async () => {
    mockListScanoMasterProducts.mockResolvedValue({
      items: [
        createListItem({
          productCount: 1000,
          enrichedCount: 900,
          processedCount: 1000,
          remainingEnrichmentCount: 100,
          enrichmentStatus: "completed",
          canResumeEnrichment: true,
        }),
      ],
    });
    mockGetScanoMasterProduct.mockResolvedValue({
      item: createDetail({
        productCount: 1000,
        enrichedCount: 900,
        processedCount: 1000,
        remainingEnrichmentCount: 100,
        enrichmentStatus: "completed",
        canResumeEnrichment: true,
      }),
    });
    mockResumeScanoMasterProductEnrichment.mockResolvedValue({
      ok: true,
      item: createListItem({
        productCount: 1000,
        enrichedCount: 900,
        processedCount: 900,
        remainingEnrichmentCount: 100,
        enrichmentStatus: "queued",
        canResumeEnrichment: true,
      }),
    });

    render(<ScanoMasterProductPage />);

    expect(await screen.findByText("Carrefour")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry Missing (100)" }));

    await waitFor(() => {
      expect(mockResumeScanoMasterProductEnrichment).toHaveBeenCalledWith(1037);
    });
    expect(await screen.findByText("Missing products were queued for another enrichment pass.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "View" }));
    const dialog = await screen.findByRole("dialog", { name: "Chain Import Details" });
    expect(await within(dialog).findByText("Retry Missing (100)")).toBeInTheDocument();
    expect(within(dialog).getByText("900 of 1000 products enriched successfully. Processed 1000. 100 missing products can be retried.")).toBeInTheDocument();
  });

  it("shows enrichment ratio, paused warning, and polls while the queue is active", async () => {
    let pollCallback: (() => void) | null = null;
    const setIntervalSpy = vi.spyOn(window, "setInterval").mockImplementation(((handler: TimerHandler) => {
      if (typeof handler === "function") {
        pollCallback = handler as () => void;
      }
      return 1;
    }) as typeof window.setInterval);
    const clearIntervalSpy = vi.spyOn(window, "clearInterval").mockImplementation(() => {});
    mockListScanoMasterProducts
      .mockResolvedValueOnce({
        items: [
          createListItem({
            productCount: 15000,
            enrichedCount: 3000,
            processedCount: 4200,
            remainingEnrichmentCount: 12000,
            enrichmentStatus: "paused_auth",
            canResumeEnrichment: true,
            warningCode: "SCANO_MASTER_ENRICHMENT_AUTH_PAUSED",
            warningMessage: "Scano catalog token is invalid.",
          }),
        ],
      })
      .mockResolvedValue({
        items: [
          createListItem({
            productCount: 15000,
            enrichedCount: 3001,
            processedCount: 4201,
            remainingEnrichmentCount: 11999,
            enrichmentStatus: "running",
            canResumeEnrichment: false,
          }),
        ],
      });

    render(<ScanoMasterProductPage />);

    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.getByText("15000/3000")).toBeInTheDocument();
    expect(screen.getByText("Paused")).toBeInTheDocument();
    expect(screen.getByTitle("Scano catalog token is invalid.")).toBeInTheDocument();

    await act(async () => {
      pollCallback?.();
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(mockListScanoMasterProducts).toHaveBeenCalledTimes(2);
    });
    expect(screen.getByText("15000/3001")).toBeInTheDocument();
    expect(screen.getByText("Running")).toBeInTheDocument();
    setIntervalSpy.mockRestore();
    clearIntervalSpy.mockRestore();
  });
});
