import ArrowBackRoundedIcon from "@mui/icons-material/ArrowBackRounded";
import CheckCircleRoundedIcon from "@mui/icons-material/CheckCircleRounded";
import QrCode2RoundedIcon from "@mui/icons-material/QrCode2Rounded";
import QrCodeScannerRoundedIcon from "@mui/icons-material/QrCodeScannerRounded";
import SearchRoundedIcon from "@mui/icons-material/SearchRounded";
import StopCircleRoundedIcon from "@mui/icons-material/StopCircleRounded";
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Container,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  InputAdornment,
  List,
  ListItemButton,
  ListItemText,
  Stack,
  TextField,
  Tooltip,
  Typography,
  Zoom,
} from "@mui/material";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api, describeApiError } from "../../../api/client";
import type {
  SaveScanoTaskProductPayload,
  ScanoExternalProductSearchResult,
  ScanoRunnerBootstrapResponse,
  ScanoTaskDetail,
  ScanoTaskProduct,
  ScanoTaskProductDraft,
  ScanoTaskProductListSourceFilter,
  ScanoTaskProductSourceMeta,
  ScanoTaskProductsPageResponse,
  ScanoTaskScansPageResponse,
  ScanoTaskSummaryPatch,
} from "../../../api/types";
import { useAuth } from "../../../app/providers/AuthProvider";
import { TopBar } from "../../../widgets/top-bar/ui/TopBar";
import { ScanoConfirmedProductsTable } from "./ScanoConfirmedProductsTable";
import { ScanoTaskProductDialog } from "./ScanoTaskProductDialog";
import { formatCairoFullDateTime, getScanoTaskStatusMeta, matchesScanoTaskProductFilter, withScanoCounters } from "./scanoShared";

type ToastState = { type: "success" | "error"; msg: string } | null;
type ScannerControlsLike = { stop: () => void };
type EndDialogState = "closed" | "confirm" | "success";
type ScanSource = "manual" | "scanner" | "camera";
type PendingSelectionState = {
  barcode: string;
  source: ScanSource;
  selectedExternalProductId?: string;
};
type ProductDialogState = {
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

const PRODUCTS_PAGE_SIZE = 10;
const EMPTY_PRODUCTS_PAGE: ScanoTaskProductsPageResponse = {
  items: [],
  page: 1,
  pageSize: PRODUCTS_PAGE_SIZE,
  total: 0,
  totalPages: 1,
};
const EMPTY_SCANS_PAGE: ScanoTaskScansPageResponse = {
  items: [],
  page: 1,
  pageSize: PRODUCTS_PAGE_SIZE,
  total: 0,
  totalPages: 1,
};

function ProductCounterCard(props: { label: string; total: number; edited?: number }) {
  return (
    <Card variant="outlined" sx={{ borderRadius: 3, minWidth: 128, flex: "1 1 120px" }}>
      <CardContent sx={{ p: 1.3 }}>
        <Typography variant="caption" sx={{ color: "text.secondary" }}>
          {props.label}
        </Typography>
        <Typography sx={{ fontWeight: 900, fontSize: 24 }}>
          {props.total}
        </Typography>
        {typeof props.edited === "number" ? (
          <Typography variant="caption" sx={{ color: "text.secondary" }}>
            Edited {props.edited}
          </Typography>
        ) : null}
      </CardContent>
    </Card>
  );
}

function LatestConfirmedProductCard(props: { product: ScanoTaskProduct; onOpen: () => void }) {
  const previewUrl = props.product.images[0]?.url ?? props.product.previewImageUrl ?? null;

  return (
    <Card
      variant="outlined"
      onClick={props.onOpen}
      sx={{
        borderRadius: 3.2,
        cursor: "pointer",
        borderColor: "rgba(148,163,184,0.2)",
        transition: "transform 160ms ease, box-shadow 160ms ease, border-color 160ms ease",
        "&:hover": {
          transform: "translateY(-1px)",
          boxShadow: "0 18px 32px rgba(15,23,42,0.08)",
          borderColor: "rgba(14,165,233,0.34)",
        },
      }}
    >
      <CardContent sx={{ p: 1.4 }}>
        <Stack direction="row" spacing={1.2} alignItems="center">
          <Box
            sx={{
              width: 74,
              height: 74,
              borderRadius: 3,
              bgcolor: "#ffffff",
              border: "1px solid rgba(148,163,184,0.18)",
              display: "grid",
              placeItems: "center",
              overflow: "hidden",
              flex: "0 0 auto",
            }}
          >
            {previewUrl ? (
              <Box
                component="img"
                src={previewUrl}
                alt={props.product.itemNameEn}
                sx={{ width: "76%", height: "76%", objectFit: "contain", display: "block" }}
              />
            ) : (
              <QrCode2RoundedIcon sx={{ color: "#94a3b8", fontSize: 28 }} />
            )}
          </Box>

          <Stack spacing={0.35} sx={{ minWidth: 0 }}>
            <Typography variant="overline" sx={{ color: "#64748b", fontWeight: 800, letterSpacing: "0.08em", lineHeight: 1.2 }}>
              Latest Confirmed Product
            </Typography>
            <Typography sx={{ fontWeight: 900, color: "#0f172a", overflowWrap: "anywhere", wordBreak: "break-word" }}>
              {props.product.itemNameEn}
            </Typography>
            <Typography variant="body2" sx={{ color: "text.secondary", overflowWrap: "anywhere", wordBreak: "break-word" }}>
              {props.product.barcode} · {props.product.sku}
            </Typography>
          </Stack>
        </Stack>
      </CardContent>
    </Card>
  );
}

function dedupeBarcodes(values: string[]) {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const rawValue of values) {
    const value = rawValue.trim();
    if (!value) continue;
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(value);
  }
  return result;
}

function matchesProductBarcode(product: ScanoTaskProduct, barcode: string) {
  const normalizedBarcode = barcode.trim().toLowerCase();
  if (!normalizedBarcode) return false;
  return product.barcodes.some((value) => value.trim().toLowerCase() === normalizedBarcode);
}

function determineSourceType(flags: Pick<ScanoTaskProductSourceMeta, "vendor" | "chain" | "masterfile">) {
  if (flags.vendor === "yes") return "vendor" as const;
  if (flags.chain === "yes") return "chain" as const;
  if (flags.masterfile === "yes") return "master" as const;
  return "manual" as const;
}

function buildSourceMeta(flags: Pick<ScanoTaskProductSourceMeta, "vendor" | "chain" | "masterfile">): ScanoTaskProductSourceMeta {
  const isExisting = flags.vendor === "yes" || flags.chain === "yes" || flags.masterfile === "yes";
  return {
    sourceType: determineSourceType(flags),
    vendor: flags.vendor,
    chain: flags.chain,
    masterfile: flags.masterfile,
    new: isExisting ? "no" : "yes",
  };
}

function buildPayloadFromDraft(draft: ScanoTaskProductDraft): SaveScanoTaskProductPayload {
  return {
    externalProductId: draft.externalProductId,
    barcode: draft.barcode,
    barcodes: draft.barcodes,
    sku: draft.sku?.trim() ?? "",
    price: draft.price ?? null,
    itemNameEn: draft.itemNameEn?.trim() ?? "",
    itemNameAr: draft.itemNameAr?.trim() || null,
    sourceMeta: buildSourceMeta({
      vendor: draft.vendor,
      chain: draft.chain,
      masterfile: draft.masterfile,
    }),
    imageUrls: draft.images,
    existingImageIds: [],
  };
}

function buildDisplayValueFromSavedProduct(
  product: ScanoTaskProduct,
  previousValue: ScanoTaskProductDraft | ScanoTaskProduct | null,
): ScanoTaskProductDraft | ScanoTaskProduct {
  const previousImages = previousValue
    ? ("createdBy" in previousValue ? previousValue.images.map((image) => image.url) : previousValue.images)
    : [];

  if (product.images.length || previousImages.length < 1) {
    return product;
  }

  return {
    externalProductId: product.externalProductId,
    previewImageUrl: product.previewImageUrl,
    barcode: product.barcode,
    barcodes: product.barcodes,
    sku: product.sku,
    price: product.price,
    itemNameEn: product.itemNameEn,
    itemNameAr: product.itemNameAr,
    chain: product.chain,
    vendor: product.vendor,
    masterfile: product.masterfile,
    new: product.new,
    sourceType: product.sourceType,
    images: previousImages,
    warning: null,
  };
}

function mergeConfirmedProductIntoBootstrap(
  current: ScanoRunnerBootstrapResponse | null,
  product: ScanoTaskProduct,
) {
  if (!current) return current;
  const nextProducts = [product, ...current.confirmedProducts.filter((item) => item.id !== product.id)];
  return {
    ...current,
    confirmedProducts: nextProducts,
    confirmedBarcodes: dedupeBarcodes(nextProducts.flatMap((item) => item.barcodes)),
  };
}

function findDuplicateProductInBootstrap(
  bootstrap: ScanoRunnerBootstrapResponse | null,
  barcode: string,
) {
  if (!bootstrap) return null;
  return bootstrap.confirmedProducts.find((product) => matchesProductBarcode(product, barcode)) ?? null;
}

function draftNeedsImage(draft: ScanoTaskProductDraft) {
  return (draft.sourceType === "manual" || draft.sourceType === "master")
    && draft.images.length < 1
    && !draft.previewImageUrl?.trim();
}

function draftNeedsPrice(draft: ScanoTaskProductDraft) {
  return (draft.sourceType === "manual" || draft.sourceType === "master")
    && !draft.price?.trim();
}

function canAutoSaveDraft(draft: ScanoTaskProductDraft) {
  return !!draft.sku?.trim()
    && !!draft.itemNameEn?.trim()
    && !draftNeedsPrice(draft)
    && !draftNeedsImage(draft);
}

function getDraftReviewWarning(draft: ScanoTaskProductDraft) {
  const requirementWarning = draft.sourceType === "manual"
    ? "Manual products require an image, SKU, price, and English item name before saving."
    : draft.sourceType === "master"
      ? "Master-file products require an image and a price before saving."
      : "Product found, but SKU or item name is missing. Complete it manually before saving.";

  if (!draft.warning?.trim()) {
    return requirementWarning;
  }

  if (draft.warning.includes(requirementWarning)) {
    return draft.warning;
  }

  return `${draft.warning} ${requirementWarning}`;
}

function isDuplicateSaveError(error: unknown) {
  const message = describeApiError(error, "").trim().toLowerCase();
  return message.includes("already exists") || message.includes("already scanned") || message.includes("duplicate");
}

function canSubmitProductDialogValue(value: ScanoTaskProductDraft | ScanoTaskProduct) {
  return !("createdBy" in value) || value.canEdit;
}

export function ScanoTaskRunnerPage() {
  const navigate = useNavigate();
  const params = useParams<{ id: string }>();
  const taskId = params.id?.trim() ?? "";
  const { canManageScanoTasks } = useAuth();
  const fallbackPath = canManageScanoTasks ? "/scano/assign-task" : "/scano/my-tasks";

  const [task, setTask] = useState<ScanoTaskDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [pageError, setPageError] = useState("");
  const [toast, setToast] = useState<ToastState>(null);
  const [productsPage, setProductsPage] = useState<ScanoTaskProductsPageResponse>(EMPTY_PRODUCTS_PAGE);
  const [productsLoading, setProductsLoading] = useState(false);
  const [productQuery, setProductQuery] = useState("");
  const [productSourceFilter, setProductSourceFilter] = useState<ScanoTaskProductListSourceFilter>("all");
  const [confirmedProductsOpen, setConfirmedProductsOpen] = useState(false);
  const [scanHistoryOpen, setScanHistoryOpen] = useState(false);
  const [scanHistoryLoading, setScanHistoryLoading] = useState(false);
  const [scanHistoryLoaded, setScanHistoryLoaded] = useState(false);
  const [scansPage, setScansPage] = useState<ScanoTaskScansPageResponse>(EMPTY_SCANS_PAGE);
  const [barcodeInput, setBarcodeInput] = useState("");
  const [resolvingScan, setResolvingScan] = useState(false);
  const [savingProduct, setSavingProduct] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [cameraLoading, setCameraLoading] = useState(false);
  const [cameraError, setCameraError] = useState("");
  const [endDialogState, setEndDialogState] = useState<EndDialogState>("closed");
  const [selectionItems, setSelectionItems] = useState<ScanoExternalProductSearchResult[]>([]);
  const [pendingSelection, setPendingSelection] = useState<PendingSelectionState | null>(null);
  const [productDialogState, setProductDialogState] = useState<ProductDialogState | null>(null);
  const [runnerBootstrap, setRunnerBootstrap] = useState<ScanoRunnerBootstrapResponse | null>(null);
  const [runnerBootstrapLoading, setRunnerBootstrapLoading] = useState(false);
  const [runnerBootstrapError, setRunnerBootstrapError] = useState("");

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const scannerControlsRef = useRef<ScannerControlsLike | null>(null);
  const lastDecodedBarcodeRef = useRef("");
  const endSuccessTimerRef = useRef<number | null>(null);
  const lookupGenerationRef = useRef(0);

  function invalidateActiveLookup() {
    lookupGenerationRef.current += 1;
  }

  function isActiveLookup(generation: number) {
    return lookupGenerationRef.current === generation;
  }

  function buildTaskSummaryFromResolveResponse(taskItem: {
    status: ScanoTaskSummaryPatch["status"];
    progress: ScanoTaskSummaryPatch["progress"];
    counters?: ScanoTaskSummaryPatch["counters"];
    viewerState: ScanoTaskSummaryPatch["viewerState"];
    permissions: ScanoTaskSummaryPatch["permissions"];
    latestExport?: ScanoTaskSummaryPatch["latestExport"];
  }, counters?: ScanoTaskSummaryPatch["counters"]): ScanoTaskSummaryPatch {
    return {
      status: taskItem.status,
      progress: taskItem.progress,
      counters: counters ?? taskItem.counters,
      viewerState: taskItem.viewerState,
      permissions: taskItem.permissions,
      latestExport: taskItem.latestExport ?? null,
    };
  }

  function mergeTaskSummaryIntoDetail(nextTask: ScanoTaskDetail | null, summary?: ScanoTaskSummaryPatch) {
    if (!nextTask || !summary) return nextTask;
    return {
      ...nextTask,
      ...summary,
    };
  }

  const confirmedProductsByBarcode = useMemo(() => {
    const result = new Map<string, ScanoTaskProduct>();
    for (const product of runnerBootstrap?.confirmedProducts ?? []) {
      for (const barcode of product.barcodes) {
        result.set(barcode.trim().toLowerCase(), product);
      }
    }
    return result;
  }, [runnerBootstrap]);

  const latestConfirmedProduct = runnerBootstrap?.confirmedProducts[0] ?? productsPage.items[0] ?? null;

  const loadTask = useCallback(async (signal?: AbortSignal) => {
    if (!taskId) {
      navigate(fallbackPath, { replace: true });
      return;
    }

    try {
      setLoading(true);
      setPageError("");
      const response = await api.getScanoTask(taskId, { signal });
      if (signal?.aborted) return;
      setTask(response.item);
    } catch (error) {
      if (signal?.aborted) return;
      const message = describeApiError(error, "Failed to load task runner");
      if (message.trim().toLowerCase() === "forbidden") {
        navigate(fallbackPath, { replace: true });
        return;
      }
      setPageError(message);
    } finally {
      if (!signal?.aborted) {
        setLoading(false);
      }
    }
  }, [fallbackPath, navigate, taskId]);

  const loadProductsPage = useCallback(async (page = 1, signal?: AbortSignal) => {
    if (!taskId) return;
    try {
      setProductsLoading(true);
      const response = await api.listScanoTaskProducts(taskId, {
        page,
        pageSize: PRODUCTS_PAGE_SIZE,
        query: productQuery,
        source: productSourceFilter,
        signal,
      });
      if (signal?.aborted) return;
      setProductsPage(response);
    } catch (error) {
      if (signal?.aborted) return;
      setToast({ type: "error", msg: describeApiError(error, "Failed to load confirmed products") });
    } finally {
      if (!signal?.aborted) {
        setProductsLoading(false);
      }
    }
  }, [productQuery, productSourceFilter, taskId]);

  const loadScanHistory = useCallback(async (page = 1, signal?: AbortSignal) => {
    if (!taskId) return;
    try {
      setScanHistoryLoading(true);
      const response = await api.listScanoTaskScans(taskId, {
        page,
        pageSize: PRODUCTS_PAGE_SIZE,
        signal,
      });
      if (signal?.aborted) return;
      setScansPage(response);
      setScanHistoryLoaded(true);
    } catch (error) {
      if (signal?.aborted) return;
      setToast({ type: "error", msg: describeApiError(error, "Failed to load scan history") });
    } finally {
      if (!signal?.aborted) {
        setScanHistoryLoading(false);
      }
    }
  }, [taskId]);

  const loadRunnerBootstrap = useCallback(async (signal?: AbortSignal) => {
    if (!taskId) return null;
    try {
      setRunnerBootstrapLoading(true);
      setRunnerBootstrapError("");
      const response = await api.getScanoRunnerBootstrap(taskId, { signal });
      if (signal?.aborted) return null;
      setRunnerBootstrap(response.item);
      return response.item;
    } catch (error) {
      if (signal?.aborted) return null;
      setRunnerBootstrap(null);
      setRunnerBootstrapError(describeApiError(error, "Failed to prepare fast barcode lookup"));
      return null;
    } finally {
      if (!signal?.aborted) {
        setRunnerBootstrapLoading(false);
      }
    }
  }, [taskId]);

  function closeScanHistory(resetLoaded = false) {
    setScanHistoryOpen(false);
    if (resetLoaded) {
      setScanHistoryLoaded(false);
      setScansPage(EMPTY_SCANS_PAGE);
    }
  }

  const stopCamera = useCallback(() => {
    scannerControlsRef.current?.stop();
    scannerControlsRef.current = null;

    const mediaStream = videoRef.current?.srcObject;
    const canStopTracks = typeof mediaStream === "object"
      && mediaStream !== null
      && "getTracks" in mediaStream
      && typeof mediaStream.getTracks === "function";
    if (canStopTracks) {
      mediaStream.getTracks().forEach((track) => track.stop());
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setCameraOpen(false);
  }, []);

  useEffect(() => () => {
    stopCamera();
    if (endSuccessTimerRef.current) {
      window.clearTimeout(endSuccessTimerRef.current);
    }
  }, [stopCamera]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => {
      setToast(null);
    }, 3400);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    const controller = new AbortController();
    void loadTask(controller.signal);
    return () => controller.abort();
  }, [loadTask]);

  useEffect(() => {
    const controller = new AbortController();
    void loadProductsPage(1, controller.signal);
    return () => controller.abort();
  }, [loadProductsPage]);

  useEffect(() => {
    if (!scanHistoryOpen || scanHistoryLoaded) return;
    const controller = new AbortController();
    void loadScanHistory(1, controller.signal);
    return () => controller.abort();
  }, [loadScanHistory, scanHistoryLoaded, scanHistoryOpen]);

  useEffect(() => {
    if (!task || task.status !== "in_progress" || !task.viewerState.canEnter) {
      setRunnerBootstrap(null);
      setRunnerBootstrapError("");
      setRunnerBootstrapLoading(false);
      return;
    }

    const controller = new AbortController();
    void loadRunnerBootstrap(controller.signal);
    return () => controller.abort();
  }, [loadRunnerBootstrap, task]);

  function closeProductDialog() {
    if (savingProduct) return;
    invalidateActiveLookup();
    setProductDialogState(null);
  }

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

  function openDuplicateState(barcode: string, fallbackMessage = "This barcode was already scanned before.") {
    const existingProduct = confirmedProductsByBarcode.get(barcode.trim().toLowerCase())
      ?? findDuplicateProductInBootstrap(runnerBootstrap, barcode);
    if (existingProduct) {
      openExistingProductDialog(existingProduct, {
        title: "Already Scanned",
        warning: fallbackMessage,
        duplicateMeta: {
          scannerName: existingProduct.createdBy.name,
          scannedAt: existingProduct.confirmedAt,
        },
      });
    }
    setToast({ type: "error", msg: fallbackMessage });
  }

  function updateProductsPageWithSavedItem(item: ScanoTaskProduct) {
    setProductsPage((current) => {
      const exists = current.items.some((entry) => entry.id === item.id);
      const matchesFilter = matchesScanoTaskProductFilter(item, productQuery, productSourceFilter);

      if (!matchesFilter) {
        if (!exists) return current;
        const nextItems = current.items.filter((entry) => entry.id !== item.id);
        const nextTotal = Math.max(0, current.total - 1);
        return {
          ...current,
          items: nextItems,
          total: nextTotal,
          totalPages: Math.max(1, Math.ceil(nextTotal / current.pageSize)),
        };
      }

      if (current.page !== 1 && !exists) {
        return current;
      }

      const nextItems = [item, ...current.items.filter((entry) => entry.id !== item.id)]
        .slice(0, current.pageSize);
      const nextTotal = exists ? current.total : current.total + 1;

      return {
        ...current,
        items: nextItems,
        total: nextTotal,
        totalPages: Math.max(1, Math.ceil(nextTotal / current.pageSize)),
      };
    });
  }

  async function saveProductToServer(params: {
    payload: SaveScanoTaskProductPayload;
    images: File[];
    productId: string | null;
    closeOnSuccess: boolean;
    showSuccessToast: boolean;
    generation?: number;
  }) {
    if (!task) {
      throw new Error("Task runner is unavailable.");
    }

    try {
      setSavingProduct(true);
      const response = params.productId
        ? await api.updateScanoTaskProduct(task.id, params.productId, params.payload, params.images)
        : await api.createScanoTaskProduct(task.id, params.payload, params.images);

      setTask((current) => mergeTaskSummaryIntoDetail(current, response.taskSummary));
      setRunnerBootstrap((current) => mergeConfirmedProductIntoBootstrap(current, response.item));
      updateProductsPageWithSavedItem(response.item);
      closeScanHistory(true);

      if (params.closeOnSuccess) {
        setProductDialogState(null);
      } else if (params.generation == null || isActiveLookup(params.generation)) {
        setProductDialogState((current) => {
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

      if (params.showSuccessToast) {
        setToast({ type: "success", msg: params.productId ? "Changes saved" : "Product confirmed" });
      }

      return response.item;
    } finally {
      setSavingProduct(false);
    }
  }

  async function handleAutoSaveDuplicate(barcode: string) {
    const refreshedBootstrap = await loadRunnerBootstrap();
    const existingProduct = findDuplicateProductInBootstrap(refreshedBootstrap, barcode);
    if (existingProduct) {
      openExistingProductDialog(existingProduct, {
        title: "Already Scanned",
        warning: "This barcode was already scanned before.",
        duplicateMeta: {
          scannerName: existingProduct.createdBy.name,
          scannedAt: existingProduct.confirmedAt,
        },
      });
      return;
    }

    setProductDialogState(null);
    setToast({ type: "error", msg: "This barcode was already scanned before." });
  }

  async function autoSaveDraft(draft: ScanoTaskProductDraft, generation: number) {
    if (!canAutoSaveDraft(draft)) {
      if (!isActiveLookup(generation)) return;
      openProductDialog({
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
    openProductDialog({
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
      openProductDialog({
        dialogMode: "draft",
        title: "Review Product",
        value: draft,
        productId: null,
        warning: describeApiError(error, "Failed to save the product automatically. Review and save it manually."),
        closeOnSave: true,
      });
    }
  }

  async function handleSubmitBarcode(params: PendingSelectionState) {
    if (!task) return;

    const barcode = params.barcode.trim();
    if (!barcode) return;

    const generation = lookupGenerationRef.current + 1;
    lookupGenerationRef.current = generation;

    setSelectionItems([]);
    setPendingSelection(null);
    setResolvingScan(true);
    closeScanHistory(true);

    try {
      const response = await api.resolveScanoTaskScan(task.id, {
        barcode,
        source: params.source,
        selectedExternalProductId: params.selectedExternalProductId,
      });
      if (!isActiveLookup(generation)) return;

      if (response.kind !== "selection") {
        setTask((current) => mergeTaskSummaryIntoDetail(
          current,
          buildTaskSummaryFromResolveResponse(response.task, response.counters),
        ));
      }

      if (response.kind === "selection") {
        setPendingSelection({
          barcode,
          source: params.source,
        });
        setSelectionItems(response.items);
        return;
      }

      setBarcodeInput("");

      if (response.kind === "duplicate") {
        setRunnerBootstrap((current) => mergeConfirmedProductIntoBootstrap(current, response.existingProduct));
        openExistingProductDialog(response.existingProduct, {
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
      setToast({ type: "error", msg: describeApiError(error, "Failed to search for the product") });
    } finally {
      if (isActiveLookup(generation)) {
        setResolvingScan(false);
      }
    }
  }

  async function handleDialogSubmit(payload: SaveScanoTaskProductPayload, images: File[]) {
    if (!productDialogState) return;

    try {
      await saveProductToServer({
        payload,
        images,
        productId: productDialogState.productId,
        closeOnSuccess: productDialogState.closeOnSave,
        showSuccessToast: true,
      });
    } catch (error) {
      if (isDuplicateSaveError(error)) {
        await handleAutoSaveDuplicate(payload.barcode);
        return;
      }

      setToast({ type: "error", msg: describeApiError(error, "Failed to save the product") });
    }
  }

  async function handleStart() {
    if (!task) return;
    try {
      setActionLoading(true);
      await api.startScanoTask(task.id);
      await loadTask();
    } catch (error) {
      setToast({ type: "error", msg: describeApiError(error, "Failed to start task") });
    } finally {
      setActionLoading(false);
    }
  }

  async function confirmEndTask() {
    if (!task) return;

    try {
      setActionLoading(true);
      const response = await api.endScanoTask(task.id);
      stopCamera();
      setTask((current) => current ? { ...current, ...response.item } : current);
      setRunnerBootstrap(null);
      setEndDialogState("success");
      endSuccessTimerRef.current = window.setTimeout(() => {
        navigate(`/scano/tasks/${task.id}`);
      }, 900);
    } catch (error) {
      setEndDialogState("closed");
      setToast({ type: "error", msg: describeApiError(error, "Failed to end task") });
    } finally {
      setActionLoading(false);
    }
  }

  async function toggleCamera() {
    if (cameraOpen) {
      stopCamera();
      return;
    }

    if (!navigator.mediaDevices?.getUserMedia || !videoRef.current) {
      setCameraError("Camera scanning is not supported on this device.");
      return;
    }

    try {
      setCameraLoading(true);
      setCameraError("");
      const { BrowserMultiFormatReader } = await import("@zxing/browser");
      const reader = new BrowserMultiFormatReader();
      const controls = await reader.decodeFromConstraints(
        {
          audio: false,
          video: {
            facingMode: { ideal: "environment" },
          },
        },
        videoRef.current,
        (result) => {
          const barcode = result?.getText()?.trim() ?? "";
          if (!barcode || barcode === lastDecodedBarcodeRef.current) {
            return;
          }

          lastDecodedBarcodeRef.current = barcode;
          setBarcodeInput(barcode);
          void handleSubmitBarcode({ barcode, source: "camera" });
          stopCamera();
        },
      );

      scannerControlsRef.current = controls;
      setCameraOpen(true);
    } catch (error) {
      stopCamera();
      setCameraError(describeApiError(error, "Camera access was denied"));
    } finally {
      setCameraLoading(false);
    }
  }

  if (loading) {
    return (
      <Box sx={{ minHeight: "100vh", bgcolor: "#f5f7fb" }}>
        <TopBar />
        <Container maxWidth="sm" sx={{ py: 3 }}>
          <Card sx={{ borderRadius: 4 }}>
            <CardContent sx={{ minHeight: 240, display: "grid", placeItems: "center" }}>
              <CircularProgress size={28} />
            </CardContent>
          </Card>
        </Container>
      </Box>
    );
  }

  if (!task) {
    return (
      <Box sx={{ minHeight: "100vh", bgcolor: "#f5f7fb" }}>
        <TopBar />
        <Container maxWidth="sm" sx={{ py: 3 }}>
          <Alert severity="error" variant="outlined">
            {pageError || "Task runner is unavailable"}
          </Alert>
        </Container>
      </Box>
    );
  }

  const statusMeta = getScanoTaskStatusMeta(task.status);
  const counters = withScanoCounters(task.counters);
  const taskAssigneeNames = task.assignees.map((assignee) => assignee.name).join(", ");
  const showStartAction = task.permissions.canStart;
  const showSearchCard = task.viewerState.canEnter && task.status === "in_progress" && !task.viewerState.hasEnded;
  const searchDisabled = resolvingScan
    || showStartAction
    || !task.viewerState.canEnter
    || runnerBootstrapLoading
    || !!runnerBootstrapError
    || !runnerBootstrap;

  return (
    <Box
      sx={{
        minHeight: "100vh",
        bgcolor: "#eef5f7",
        background:
          "radial-gradient(circle at top left, rgba(14,165,233,0.10), transparent 30%), linear-gradient(180deg, #f8fbfd 0%, #edf4f6 100%)",
      }}
    >
      <TopBar />
      <Container maxWidth="md" sx={{ py: { xs: 2, md: 3 } }}>
        <Stack spacing={2}>
          <Stack direction="row" spacing={1} alignItems="center">
            <Button startIcon={<ArrowBackRoundedIcon />} onClick={() => navigate(`/scano/tasks/${task.id}`)}>
              Task Profile
            </Button>
          </Stack>

          {showSearchCard ? (
            <Card sx={{ borderRadius: 4, overflow: "hidden" }}>
              <CardContent sx={{ p: { xs: 1.5, sm: 1.8 } }}>
                <Stack spacing={1.2}>
                  {runnerBootstrapLoading ? (
                    <Alert severity="info" variant="outlined">
                      Preparing fast barcode lookup...
                    </Alert>
                  ) : null}

                  {runnerBootstrapError ? (
                    <Alert severity="error" variant="outlined">
                      {runnerBootstrapError}
                    </Alert>
                  ) : null}

                  <Stack
                    component="form"
                    spacing={1.15}
                    onSubmit={(event) => {
                      event.preventDefault();
                      void handleSubmitBarcode({ barcode: barcodeInput, source: "manual" });
                    }}
                    sx={{
                      p: { xs: 1.05, sm: 1.2 },
                      borderRadius: 3.6,
                      bgcolor: "rgba(255,255,255,0.82)",
                      border: "1px solid rgba(148,163,184,0.14)",
                      boxShadow: "0 18px 36px rgba(15,23,42,0.05)",
                      backdropFilter: "blur(16px)",
                    }}
                  >
                    <TextField
                      fullWidth
                      value={barcodeInput}
                      onChange={(event) => setBarcodeInput(event.target.value)}
                      label="Barcode"
                      placeholder="Type or scan barcode here"
                      disabled={searchDisabled}
                      sx={{
                        "& .MuiInputLabel-root": {
                          color: "#64748b",
                          fontWeight: 700,
                        },
                        "& .MuiOutlinedInput-root": {
                          borderRadius: 3,
                          bgcolor: "#ffffff",
                          boxShadow: "0 12px 28px rgba(15,23,42,0.06)",
                          "& fieldset": {
                            borderColor: "rgba(148,163,184,0.18)",
                          },
                          "&:hover fieldset": {
                            borderColor: "rgba(14,165,233,0.3)",
                          },
                          "&.Mui-focused fieldset": {
                            borderColor: "rgba(14,165,233,0.55)",
                            borderWidth: "1px",
                          },
                        },
                        "& .MuiOutlinedInput-input": {
                          py: 1.2,
                        },
                      }}
                      InputProps={{
                        startAdornment: <QrCode2RoundedIcon sx={{ mr: 1, color: "text.secondary" }} />,
                        endAdornment: (
                          <InputAdornment position="end">
                            <Tooltip title={cameraOpen ? "Stop scanner" : "Open scanner"}>
                              <span>
                                <IconButton
                                  color={cameraOpen ? "error" : "primary"}
                                  onClick={() => void toggleCamera()}
                                  disabled={cameraLoading || runnerBootstrapLoading || !!runnerBootstrapError || !runnerBootstrap}
                                  aria-label={cameraOpen ? "Stop scanner" : "Open scanner"}
                                  edge="end"
                                  sx={{
                                    width: 40,
                                    height: 40,
                                    borderRadius: 2.2,
                                    bgcolor: cameraOpen ? "rgba(254,226,226,0.92)" : "rgba(240,249,255,0.96)",
                                    border: cameraOpen
                                      ? "1px solid rgba(248,113,113,0.22)"
                                      : "1px solid rgba(14,165,233,0.16)",
                                    boxShadow: "0 10px 22px rgba(15,23,42,0.06)",
                                    color: cameraOpen ? "#dc2626" : "#0284c7",
                                  }}
                                >
                                  {cameraLoading ? <CircularProgress size={18} color="inherit" /> : <QrCodeScannerRoundedIcon />}
                                </IconButton>
                              </span>
                            </Tooltip>
                          </InputAdornment>
                        ),
                      }}
                    />

                    <Button
                      type="submit"
                      variant="contained"
                      disabled={searchDisabled || !barcodeInput.trim()}
                      startIcon={resolvingScan ? <CircularProgress size={16} color="inherit" /> : <SearchRoundedIcon />}
                      sx={{
                        minHeight: 48,
                        borderRadius: 3,
                        px: 2.3,
                        fontWeight: 800,
                        letterSpacing: "0.01em",
                        background: "linear-gradient(135deg, #0ea5e9 0%, #2563eb 100%)",
                        boxShadow: resolvingScan ? "none" : "0 16px 34px rgba(37,99,235,0.18)",
                        "&:hover": {
                          background: "linear-gradient(135deg, #0284c7 0%, #1d4ed8 100%)",
                          boxShadow: "0 18px 36px rgba(37,99,235,0.22)",
                        },
                      }}
                    >
                      {resolvingScan ? "Searching..." : "Find Product"}
                    </Button>
                  </Stack>

                  {cameraOpen ? (
                    <Card variant="outlined" sx={{ borderRadius: 3 }}>
                      <CardContent sx={{ p: 1.2 }}>
                        <Stack spacing={1}>
                          <Box
                            component="video"
                            ref={videoRef}
                            autoPlay
                            muted
                            playsInline
                            sx={{
                              width: "100%",
                              minHeight: 240,
                              borderRadius: 3,
                              bgcolor: "#0f172a",
                              objectFit: "cover",
                            }}
                          />
                          <Button variant="text" color="inherit" startIcon={<StopCircleRoundedIcon />} onClick={stopCamera}>
                            Stop Scanner
                          </Button>
                        </Stack>
                      </CardContent>
                    </Card>
                  ) : null}

                  {cameraError ? (
                    <Alert severity="warning" variant="outlined">
                      {cameraError}
                    </Alert>
                  ) : null}
                </Stack>
              </CardContent>
            </Card>
          ) : (
            <Alert severity={showStartAction ? "info" : "warning"} variant="outlined">
              {showStartAction
                ? "Start the task first to enable barcode search."
                : "You can no longer scan products in this task."}
            </Alert>
          )}

          <Card sx={{ borderRadius: 4, bgcolor: "rgba(255,255,255,0.88)" }}>
            <CardContent sx={{ p: 2 }}>
              <Stack spacing={1.5}>
                <Stack direction={{ xs: "column", sm: "row" }} justifyContent="space-between" spacing={1.5}>
                  <Box>
                    <Typography variant="h4" sx={{ fontWeight: 950, letterSpacing: "-0.04em" }}>
                      {task.chainName}
                    </Typography>
                    <Typography variant="body1" sx={{ color: "text.secondary" }}>
                      {task.branchName}
                    </Typography>
                  </Box>
                  <Chip size="small" label={statusMeta.label} sx={{ fontWeight: 800, alignSelf: "flex-start", ...statusMeta.sx }} />
                </Stack>

                <Stack direction={{ xs: "column", sm: "row" }} spacing={1}>
                  <ProductCounterCard label="Products" total={counters.scannedProductsCount} />
                  <ProductCounterCard label="Vendor" total={counters.vendorCount} edited={counters.vendorEditedCount} />
                  <ProductCounterCard label="Chain" total={counters.chainCount} edited={counters.chainEditedCount} />
                  <ProductCounterCard label="Master" total={counters.masterCount} />
                  <ProductCounterCard label="Manual" total={counters.manualCount} />
                </Stack>

                <Stack direction={{ xs: "column", sm: "row" }} spacing={1.2}>
                  <Card variant="outlined" sx={{ borderRadius: 3, flex: "1 1 0" }}>
                    <CardContent sx={{ p: 1.4 }}>
                      <Typography variant="caption" sx={{ color: "text.secondary" }}>
                        Scheduled At
                      </Typography>
                      <Typography sx={{ fontWeight: 800 }}>
                        {formatCairoFullDateTime(task.scheduledAt)}
                      </Typography>
                    </CardContent>
                  </Card>
                  <Card variant="outlined" sx={{ borderRadius: 3, flex: "1 1 0" }}>
                    <CardContent sx={{ p: 1.4 }}>
                      <Typography variant="caption" sx={{ color: "text.secondary" }}>
                        Assigned Scanners
                      </Typography>
                      <Typography sx={{ fontWeight: 800 }}>
                        {taskAssigneeNames || "-"}
                      </Typography>
                    </CardContent>
                  </Card>
                </Stack>

                <Stack direction={{ xs: "column", sm: "row" }} spacing={1}>
                  {showStartAction ? (
                    <Button
                      variant="contained"
                      color="success"
                      startIcon={actionLoading ? <CircularProgress size={16} color="inherit" /> : <CheckCircleRoundedIcon />}
                      onClick={() => void handleStart()}
                      disabled={actionLoading}
                    >
                      Start Task
                    </Button>
                  ) : null}

                  {task.viewerState.canEnd ? (
                    <Button
                      variant="contained"
                      color="error"
                      startIcon={actionLoading ? <CircularProgress size={16} color="inherit" /> : <StopCircleRoundedIcon />}
                      onClick={() => setEndDialogState("confirm")}
                      disabled={actionLoading}
                    >
                      End Task
                    </Button>
                  ) : null}
                </Stack>
              </Stack>
            </CardContent>
          </Card>

          {pageError ? (
            <Alert severity="error" variant="outlined">
              {pageError}
            </Alert>
          ) : null}

          <Card sx={{ borderRadius: 4 }}>
            <CardContent sx={{ p: 2 }}>
              <Stack spacing={1.25}>
                <Stack direction="row" justifyContent="space-between" alignItems="center">
                  <Box>
                    <Typography variant="h6" sx={{ fontWeight: 900 }}>
                      Confirmed Products
                    </Typography>
                    <Typography variant="caption" sx={{ color: "text.secondary" }}>
                      {productsPage.total} confirmed item{productsPage.total === 1 ? "" : "s"}
                    </Typography>
                  </Box>
                  <Button size="small" onClick={() => setConfirmedProductsOpen((current) => !current)}>
                    {confirmedProductsOpen ? "Hide All" : "Show All"}
                  </Button>
                </Stack>

                {latestConfirmedProduct ? (
                  <LatestConfirmedProductCard
                    product={latestConfirmedProduct}
                    onOpen={() => {
                      openProductDialog({
                        dialogMode: "view",
                        title: "Product Details",
                        value: latestConfirmedProduct,
                        productId: latestConfirmedProduct.id,
                        warning: null,
                        closeOnSave: false,
                      });
                    }}
                  />
                ) : (
                  <Alert severity="info" variant="outlined">
                    No products were confirmed yet.
                  </Alert>
                )}

                {confirmedProductsOpen ? (
                  <ScanoConfirmedProductsTable
                    title="All Confirmed Products"
                    items={productsPage.items}
                    loading={productsLoading}
                    page={productsPage.page}
                    totalPages={productsPage.totalPages}
                    total={productsPage.total}
                    query={productQuery}
                    sourceFilter={productSourceFilter}
                    emptyMessage="No products were confirmed yet."
                    onQueryChange={setProductQuery}
                    onSourceFilterChange={setProductSourceFilter}
                    onPrevious={() => void loadProductsPage(productsPage.page - 1)}
                    onNext={() => void loadProductsPage(productsPage.page + 1)}
                    onRowClick={(product) => {
                      openProductDialog({
                        dialogMode: "view",
                        title: "Product Details",
                        value: product,
                        productId: product.id,
                        warning: null,
                        closeOnSave: false,
                      });
                    }}
                  />
                ) : null}
              </Stack>
            </CardContent>
          </Card>

          <Card sx={{ borderRadius: 4 }}>
            <CardContent sx={{ p: 2 }}>
              <Stack spacing={1.3}>
                <Stack direction="row" justifyContent="space-between" alignItems="center">
                  <Box>
                    <Typography variant="h6" sx={{ fontWeight: 900 }}>
                      Raw Scan History
                    </Typography>
                    <Typography variant="caption" sx={{ color: "text.secondary" }}>
                      Duplicate blocks and saved products appear here after the lookup flow finishes.
                    </Typography>
                  </Box>
                  <Button
                    size="small"
                    onClick={() => {
                      if (scanHistoryOpen) {
                        closeScanHistory();
                        return;
                      }
                      setScanHistoryOpen(true);
                    }}
                  >
                    {scanHistoryOpen ? "Hide" : "Show"}
                  </Button>
                </Stack>

                {scanHistoryOpen ? (
                  <>
                    {scanHistoryLoading && !scansPage.items.length ? (
                      <Stack direction="row" spacing={1} alignItems="center">
                        <CircularProgress size={18} />
                        <Typography variant="body2">Loading raw scan history...</Typography>
                      </Stack>
                    ) : null}

                    {!scanHistoryLoading && !scansPage.items.length ? (
                      <Alert severity="info" variant="outlined">
                        No raw scan attempts were recorded.
                      </Alert>
                    ) : null}

                    {scansPage.items.map((scan) => (
                      <Card key={scan.id} variant="outlined" sx={{ borderRadius: 3 }}>
                        <CardContent sx={{ p: 1.4 }}>
                          <Stack spacing={0.4}>
                            <Typography sx={{ fontWeight: 800 }}>{scan.barcode}</Typography>
                            <Typography variant="body2" sx={{ color: "text.secondary" }}>
                              {scan.scannedBy.name} · {scan.source} · {scan.outcome ?? scan.lookupStatus ?? "captured"}
                            </Typography>
                            <Typography variant="caption" sx={{ color: "text.secondary" }}>
                              {formatCairoFullDateTime(scan.scannedAt)}
                            </Typography>
                          </Stack>
                        </CardContent>
                      </Card>
                    ))}

                    {scansPage.items.length ? (
                      <Stack direction="row" justifyContent="space-between" alignItems="center">
                        <Typography variant="caption" sx={{ color: "text.secondary" }}>
                          Page {scansPage.page} of {scansPage.totalPages}
                        </Typography>
                        <Stack direction="row" spacing={1}>
                          <Button size="small" disabled={scanHistoryLoading || scansPage.page <= 1} onClick={() => void loadScanHistory(scansPage.page - 1)}>
                            Previous
                          </Button>
                          <Button size="small" disabled={scanHistoryLoading || scansPage.page >= scansPage.totalPages} onClick={() => void loadScanHistory(scansPage.page + 1)}>
                            Next
                          </Button>
                        </Stack>
                      </Stack>
                    ) : null}
                  </>
                ) : null}
              </Stack>
            </CardContent>
          </Card>
        </Stack>
      </Container>

      <Dialog
        open={selectionItems.length > 0}
        onClose={() => {
          setSelectionItems([]);
          setPendingSelection(null);
        }}
        fullWidth
        maxWidth="sm"
      >
        <DialogTitle>Select Product</DialogTitle>
        <DialogContent dividers>
          <List disablePadding>
            {selectionItems.map((item) => (
              <ListItemButton
                key={item.id}
                onClick={() => {
                  const barcode = pendingSelection?.barcode?.trim() ?? "";
                  const source = pendingSelection?.source ?? "manual";
                  setSelectionItems([]);
                  setPendingSelection(null);
                  if (!barcode) return;
                  void handleSubmitBarcode({
                    barcode,
                    source,
                    selectedExternalProductId: item.id,
                  });
                }}
              >
                <ListItemText
                  primary={item.itemNameEn || item.itemNameAr || item.barcode}
                  secondary={[item.barcode, item.itemNameAr].filter(Boolean).join(" · ")}
                />
              </ListItemButton>
            ))}
          </List>
        </DialogContent>
        <DialogActions>
          <Button
            onClick={() => {
              setSelectionItems([]);
              setPendingSelection(null);
            }}
          >
            Cancel
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={endDialogState !== "closed"}
        onClose={() => {
          if (endDialogState === "confirm") {
            setEndDialogState("closed");
          }
        }}
        fullWidth
        maxWidth="xs"
      >
        {endDialogState === "confirm" ? (
          <>
            <DialogTitle>End Task</DialogTitle>
            <DialogContent dividers>
              <Typography>
                Confirm ending this task. After that, barcode search will be disabled and the runner will return to the task profile.
              </Typography>
            </DialogContent>
            <DialogActions>
              <Button onClick={() => setEndDialogState("closed")} disabled={actionLoading}>
                Cancel
              </Button>
              <Button variant="contained" color="error" onClick={() => void confirmEndTask()} disabled={actionLoading}>
                Confirm
              </Button>
            </DialogActions>
          </>
        ) : (
          <>
            <DialogTitle>Task Ended</DialogTitle>
            <DialogContent dividers>
              <Stack direction="row" spacing={1} alignItems="center">
                <CheckCircleRoundedIcon color="success" />
                <Typography>The task was ended successfully.</Typography>
              </Stack>
            </DialogContent>
            <DialogActions>
              <Button onClick={() => navigate(`/scano/tasks/${task.id}`)}>Back To Profile</Button>
            </DialogActions>
          </>
        )}
      </Dialog>

      <ScanoTaskProductDialog
        open={!!productDialogState}
        mode={productDialogState?.dialogMode ?? "draft"}
        title={productDialogState?.title ?? "Review Product"}
        value={productDialogState?.value ?? null}
        warning={productDialogState?.warning}
        busyState={savingProduct ? "saving" : null}
        duplicateMeta={productDialogState?.duplicateMeta}
        submitting={savingProduct}
        onClose={closeProductDialog}
        onSubmit={
          productDialogState && canSubmitProductDialogValue(productDialogState.value)
            ? (payload, images) => {
              void handleDialogSubmit(payload, images);
            }
            : undefined
        }
      />

      <Zoom in={!!toast}>
        <Box
          sx={{
            position: "fixed",
            left: "50%",
            bottom: 24,
            transform: "translateX(-50%)",
            zIndex: 1600,
            width: "min(calc(100vw - 32px), 560px)",
          }}
        >
          {toast ? (
            <Alert severity={toast.type} onClose={() => setToast(null)} variant="filled">
              {toast.msg}
            </Alert>
          ) : null}
        </Box>
      </Zoom>
    </Box>
  );
}
