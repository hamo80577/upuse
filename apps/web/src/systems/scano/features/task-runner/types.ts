import type {
  ScanoExternalProductSearchResult,
  ScanoTaskProduct,
  ScanoTaskProductDraft,
} from "../../../../api/types";

export type ToastState = { type: "success" | "error"; msg: string } | null;
export type ScannerControlsLike = { stop: () => void };
export type EndDialogState = "closed" | "confirm" | "success";
export type ScanSource = "manual" | "scanner" | "camera";

export type PendingSelectionState = {
  barcode: string;
  source: ScanSource;
  selectedExternalProductId?: string;
};

export type ProductDialogState = {
  dialogMode: "draft" | "view";
  title: string;
  value: ScanoTaskProductDraft | ScanoTaskProduct;
  productId: string | null;
  warning: string | null;
  duplicateMeta?: {
    scannerName: string;
    scannedAt: string;
  };
  closeOnSave: boolean;
};

export type SelectionState = {
  selectionItems: ScanoExternalProductSearchResult[];
  pendingSelection: PendingSelectionState | null;
};
