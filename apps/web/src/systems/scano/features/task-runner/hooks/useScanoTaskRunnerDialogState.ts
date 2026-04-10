import { useState } from "react";
import type { EndDialogState, PendingSelectionState, ProductDialogState } from "../types";
import type { ScanoExternalProductSearchResult, ScanoTaskProduct } from "../../../api/types";

export function useScanoTaskRunnerDialogState() {
  const [endDialogState, setEndDialogState] = useState<EndDialogState>("closed");
  const [selectionItems, setSelectionItems] = useState<ScanoExternalProductSearchResult[]>([]);
  const [pendingSelection, setPendingSelection] = useState<PendingSelectionState | null>(null);
  const [productDialogState, setProductDialogState] = useState<ProductDialogState | null>(null);

  function openProductDialog(state: ProductDialogState) {
    setProductDialogState(state);
  }

  function openExistingProductDialog(
    product: ScanoTaskProduct,
    options?: {
      title?: string;
      warning?: string | null;
      duplicateMeta?: ProductDialogState["duplicateMeta"];
    },
  ) {
    openProductDialog({
      dialogMode: "view",
      title: options?.title ?? "Product Details",
      value: product,
      productId: product.id,
      warning: options?.warning ?? null,
      duplicateMeta: options?.duplicateMeta,
      closeOnSave: false,
    });
  }

  return {
    endDialogState,
    openExistingProductDialog,
    openProductDialog,
    pendingSelection,
    productDialogState,
    selectionItems,
    setEndDialogState,
    setPendingSelection,
    setProductDialogState,
    setSelectionItems,
  };
}
