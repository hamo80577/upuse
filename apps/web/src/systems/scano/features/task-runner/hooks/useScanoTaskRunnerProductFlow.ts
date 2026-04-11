import { useRef, useState, type Dispatch, type SetStateAction } from "react";
import { api, describeApiError } from "../../../api/client";
import type {
  SaveScanoTaskProductPayload,
  ScanoExternalProductSearchResult,
  ScanoRunnerBootstrapResponse,
  ScanoTaskDetail,
  ScanoTaskProduct,
  ScanoTaskProductDraft,
} from "../../../api/types";
import {
  buildDisplayValueFromSavedProduct,
  buildPayloadFromDraft,
  canAutoSaveDraft,
  findDuplicateProductInBootstrap,
  getDraftReviewWarning,
  isDuplicateSaveError,
  mergeConfirmedProductIntoBootstrap,
} from "../lib/barcodeFlow";
import { buildTaskSummaryFromResolveResponse, mergeTaskSummaryIntoDetail } from "../lib/taskSummary";
import type { PendingSelectionState, ProductDialogState, ToastState } from "../types";

export function useScanoTaskRunnerProductFlow(params: {
  closeScanHistory: (resetLoaded?: boolean) => void;
  loadRunnerBootstrap: (signal?: AbortSignal) => Promise<ScanoRunnerBootstrapResponse | null>;
  onToast: (toast: ToastState) => void;
  openExistingProductDialog: (
    product: ScanoTaskProduct,
    options?: {
      title?: string;
      warning?: string | null;
      duplicateMeta?: ProductDialogState["duplicateMeta"];
    },
  ) => void;
  openProductDialog: (state: ProductDialogState) => void;
  productDialogState: ProductDialogState | null;
  runnerBootstrap: ScanoRunnerBootstrapResponse | null;
  setBarcodeInput: Dispatch<SetStateAction<string>>;
  setPendingSelection: Dispatch<SetStateAction<PendingSelectionState | null>>;
  setProductDialogState: Dispatch<SetStateAction<ProductDialogState | null>>;
  setRunnerBootstrap: Dispatch<SetStateAction<ScanoRunnerBootstrapResponse | null>>;
  setSelectionItems: Dispatch<SetStateAction<ScanoExternalProductSearchResult[]>>;
  setTask: Dispatch<SetStateAction<ScanoTaskDetail | null>>;
  task: ScanoTaskDetail | null;
  updateProductsPageWithSavedItem: (item: ScanoTaskProduct) => void;
}) {
  const [resolvingScan, setResolvingScan] = useState(false);
  const [savingProduct, setSavingProduct] = useState(false);
  const lookupGenerationRef = useRef(0);

  function invalidateActiveLookup() {
    lookupGenerationRef.current += 1;
  }

  function isActiveLookup(generation: number) {
    return lookupGenerationRef.current === generation;
  }

  function closeProductDialog() {
    if (savingProduct) return;
    invalidateActiveLookup();
    params.setProductDialogState(null);
  }

  function openDuplicateState(barcode: string, fallbackMessage = "This barcode was already scanned before.") {
    const existingProduct = findDuplicateProductInBootstrap(params.runnerBootstrap, barcode);
    if (existingProduct) {
      params.openExistingProductDialog(existingProduct, {
        title: "Already Scanned",
        warning: fallbackMessage,
        duplicateMeta: {
          scannerName: existingProduct.createdBy.name,
          scannedAt: existingProduct.confirmedAt,
        },
      });
    }
    params.onToast({ type: "error", msg: fallbackMessage });
  }

  async function saveProductToServer(options: {
    payload: SaveScanoTaskProductPayload;
    images: File[];
    productId: string | null;
    closeOnSuccess: boolean;
    showSuccessToast: boolean;
    generation?: number;
  }) {
    if (!params.task) {
      throw new Error("Task runner is unavailable.");
    }

    try {
      setSavingProduct(true);
      const response = options.productId
        ? await api.updateScanoTaskProduct(params.task.id, options.productId, options.payload, options.images)
        : await api.createScanoTaskProduct(params.task.id, options.payload, options.images);

      params.setTask((current) => mergeTaskSummaryIntoDetail(current, response.taskSummary));
      params.setRunnerBootstrap((current) => mergeConfirmedProductIntoBootstrap(current, response.item));
      params.updateProductsPageWithSavedItem(response.item);
      params.closeScanHistory(true);

      if (options.closeOnSuccess) {
        params.setProductDialogState(null);
      } else if (options.generation == null || isActiveLookup(options.generation)) {
        params.setProductDialogState((current) => {
          if (!current) {
            return current;
          }

          return {
            ...current,
            dialogMode: "view",
            productId: response.item.id,
            value: buildDisplayValueFromSavedProduct(response.item, current.value),
            warning: null,
            duplicateMeta: current.duplicateMeta,
            closeOnSave: false,
          };
        });
      }

      if (options.showSuccessToast) {
        params.onToast({ type: "success", msg: options.productId ? "Changes saved" : "Product confirmed" });
      }

      return response.item;
    } finally {
      setSavingProduct(false);
    }
  }

  async function handleAutoSaveDuplicate(barcode: string) {
    const refreshedBootstrap = await params.loadRunnerBootstrap();
    const existingProduct = findDuplicateProductInBootstrap(refreshedBootstrap, barcode);
    if (existingProduct) {
      params.openExistingProductDialog(existingProduct, {
        title: "Already Scanned",
        warning: "This barcode was already scanned before.",
        duplicateMeta: {
          scannerName: existingProduct.createdBy.name,
          scannedAt: existingProduct.confirmedAt,
        },
      });
      return;
    }

    params.setProductDialogState(null);
    params.onToast({ type: "error", msg: "This barcode was already scanned before." });
  }

  async function autoSaveDraft(draft: ScanoTaskProductDraft, generation: number) {
    if (!canAutoSaveDraft(draft)) {
      if (!isActiveLookup(generation)) return;
      params.openProductDialog({
        dialogMode: "draft",
        title: "Review Product",
        value: draft,
        productId: null,
        warning: getDraftReviewWarning(draft),
        closeOnSave: true,
      });
      return;
    }

    if (!isActiveLookup(generation)) return;
    params.openProductDialog({
      dialogMode: "view",
      title: "Review Product",
      value: draft,
      productId: null,
      warning: draft.warning,
      closeOnSave: false,
    });

    try {
      await saveProductToServer({
        payload: buildPayloadFromDraft(draft),
        images: [],
        productId: null,
        closeOnSuccess: false,
        showSuccessToast: false,
        generation,
      });
    } catch (error) {
      if (isDuplicateSaveError(error)) {
        await handleAutoSaveDuplicate(draft.barcode);
        return;
      }

      if (!isActiveLookup(generation)) return;
      params.openProductDialog({
        dialogMode: "draft",
        title: "Review Product",
        value: draft,
        productId: null,
        warning: describeApiError(error, "Failed to save the product automatically. Review and save it manually."),
        closeOnSave: true,
      });
    }
  }

  async function handleSubmitBarcode(nextSelection: PendingSelectionState) {
    if (!params.task) return;

    const barcode = nextSelection.barcode.trim();
    if (!barcode) return;

    const generation = lookupGenerationRef.current + 1;
    lookupGenerationRef.current = generation;

    params.setSelectionItems([]);
    params.setPendingSelection(null);
    setResolvingScan(true);
    params.closeScanHistory(true);

    try {
      const response = await api.resolveScanoTaskScan(params.task.id, {
        barcode,
        source: nextSelection.source,
        selectedExternalProductId: nextSelection.selectedExternalProductId,
      });
      if (!isActiveLookup(generation)) return;

      if (response.kind !== "selection") {
        params.setTask((current) => mergeTaskSummaryIntoDetail(
          current,
          buildTaskSummaryFromResolveResponse(response.task, response.counters),
        ));
      }

      if (response.kind === "selection") {
        params.setPendingSelection({
          barcode,
          source: nextSelection.source,
        });
        params.setSelectionItems(response.items);
        return;
      }

      params.setBarcodeInput("");

      if (response.kind === "duplicate") {
        params.setRunnerBootstrap((current) => mergeConfirmedProductIntoBootstrap(current, response.existingProduct));
        params.openExistingProductDialog(response.existingProduct, {
          title: "Already Scanned",
          warning: response.message,
          duplicateMeta: {
            scannerName: response.existingScannerName,
            scannedAt: response.existingScannedAt,
          },
        });
        return;
      }

      setResolvingScan(false);
      await autoSaveDraft(response.draft, generation);
    } catch (error) {
      if (!isActiveLookup(generation)) return;
      params.onToast({ type: "error", msg: describeApiError(error, "Failed to search for the product") });
    } finally {
      if (isActiveLookup(generation)) {
        setResolvingScan(false);
      }
    }
  }

  async function handleDialogSubmit(payload: SaveScanoTaskProductPayload, images: File[]) {
    if (!params.productDialogState) return;

    try {
      await saveProductToServer({
        payload,
        images,
        productId: params.productDialogState.productId,
        closeOnSuccess: params.productDialogState.closeOnSave,
        showSuccessToast: true,
      });
    } catch (error) {
      if (isDuplicateSaveError(error)) {
        await handleAutoSaveDuplicate(payload.barcode);
        return;
      }

      params.onToast({ type: "error", msg: describeApiError(error, "Failed to save the product") });
    }
  }

  return {
    closeProductDialog,
    handleDialogSubmit,
    handleSubmitBarcode,
    openDuplicateState,
    resolvingScan,
    savingProduct,
  };
}
