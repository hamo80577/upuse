import ArrowBackRoundedIcon from "@mui/icons-material/ArrowBackRounded";
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  CircularProgress,
  Container,
  Stack,
  Zoom,
  useMediaQuery,
  useTheme,
} from "@mui/material";
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api, describeApiError } from "../../../api/client";
import type {
  SaveScanoTaskProductPayload,
  ScanoTaskDetail,
  ScanoTaskProduct,
  ScanoTaskProductDraft,
  ScanoTaskProductListSourceFilter,
  ScanoTaskSummaryPatch,
} from "../../../api/types";
import { useAuth } from "../../../app/providers/AuthProvider";
import { useScanoTaskRunnerCamera } from "../../../features/task-runner/hooks/useScanoTaskRunnerCamera";
import { useScanoTaskRunnerDialogState } from "../../../features/task-runner/hooks/useScanoTaskRunnerDialogState";
import { useScanoTaskRunnerPages } from "../../../features/task-runner/hooks/useScanoTaskRunnerPages";
import { useScanoTaskRunnerTaskData } from "../../../features/task-runner/hooks/useScanoTaskRunnerTaskData";
import {
  buildDisplayValueFromSavedProduct,
  buildPayloadFromDraft,
  canAutoSaveDraft,
  canSubmitProductDialogValue,
  findDuplicateProductInBootstrap,
  getDraftReviewWarning,
  isDuplicateSaveError,
  mergeConfirmedProductIntoBootstrap,
} from "../../../features/task-runner/lib/barcodeFlow";
import type { PendingSelectionState, ToastState } from "../../../features/task-runner/types";
import { RunnerConfirmedProductsSection } from "../../../features/task-runner/ui/RunnerConfirmedProductsSection";
import { RunnerEndTaskDialog, RunnerSelectionDialog } from "../../../features/task-runner/ui/RunnerDialogs";
import { RunnerScanHistorySection } from "../../../features/task-runner/ui/RunnerScanHistorySection";
import { RunnerSearchCard } from "../../../features/task-runner/ui/RunnerSearchCard";
import { RunnerTaskSummaryCard } from "../../../features/task-runner/ui/RunnerTaskSummaryCard";
import { TopBar } from "../../../widgets/top-bar/ui/TopBar";
import { ScanoTaskProductDialog } from "./ScanoTaskProductDialog";
import { withScanoCounters } from "./scanoShared";

export function ScanoTaskRunnerPage() {
  const navigate = useNavigate();
  const params = useParams<{ id: string }>();
  const taskId = params.id?.trim() ?? "";
  const { canManageScanoTasks, user } = useAuth();
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("sm"));
  const fallbackPath = canManageScanoTasks ? "/scano/assign-task" : "/scano/my-tasks";

  const [toast, setToast] = useState<ToastState>(null);
  const [productQuery, setProductQuery] = useState("");
  const [productSourceFilter, setProductSourceFilter] = useState<ScanoTaskProductListSourceFilter>("all");
  const [confirmedProductsOpen, setConfirmedProductsOpen] = useState(false);
  const [barcodeInput, setBarcodeInput] = useState("");
  const [resolvingScan, setResolvingScan] = useState(false);
  const [savingProduct, setSavingProduct] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [taskSummaryExpanded, setTaskSummaryExpanded] = useState(false);
  const endSuccessTimerRef = useRef<number | null>(null);
  const lookupGenerationRef = useRef(0);

  const {
    loadRunnerBootstrap,
    loadTask,
    loading,
    pageError,
    runnerBootstrap,
    runnerBootstrapError,
    runnerBootstrapLoading,
    setRunnerBootstrap,
    setTask,
    task,
  } = useScanoTaskRunnerTaskData({
    taskId,
    fallbackPath,
    navigate,
  });
  const {
    closeScanHistory,
    loadProductsPage,
    loadScanHistory,
    productsLoading,
    productsPage,
    scanHistoryLoading,
    scanHistoryOpen,
    scansPage,
    setScanHistoryOpen,
    updateProductsPageWithSavedItem,
  } = useScanoTaskRunnerPages({
    taskId,
    productQuery,
    productSourceFilter,
    onToast: setToast,
  });
  const {
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
  } = useScanoTaskRunnerDialogState();
  const { cameraError, cameraLoading, cameraOpen, stopCamera, toggleCamera, videoRef } = useScanoTaskRunnerCamera({
    isMobile,
    onBarcodeDetected: (barcode) => {
      setBarcodeInput(barcode);
      void handleSubmitBarcode({ barcode, source: "camera" });
    },
  });

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
  const myConfirmedCount = useMemo(() => {
    if (!user?.id) return 0;
    return (runnerBootstrap?.confirmedProducts ?? []).filter((product) => product.createdBy.linkedUserId === user.id).length;
  }, [runnerBootstrap, user?.id]);

  useEffect(() => () => {
    if (endSuccessTimerRef.current) {
      window.clearTimeout(endSuccessTimerRef.current);
    }
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => {
      setToast(null);
    }, 3400);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    setTaskSummaryExpanded(false);
  }, [taskId]);

  function closeProductDialog() {
    if (savingProduct) return;
    invalidateActiveLookup();
    setProductDialogState(null);
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
  const cameraPreviewVisible = cameraOpen || cameraLoading;
  const cameraActionDisabled = resolvingScan || runnerBootstrapLoading || !!runnerBootstrapError || !runnerBootstrap;
  const cameraToggleLabel = cameraLoading
    ? "Opening Camera..."
    : cameraOpen
      ? "Stop Camera"
      : "Open Camera Scanner";
  const taskSummaryTitle = task.branchName || task.chainName;
  const taskSummarySubtitle = task.branchName && task.branchName !== task.chainName ? task.chainName : null;
  const taskTotalLabel = `Task Total: ${counters.scannedProductsCount}`;
  const myConfirmedLabel = `My Confirmed: ${myConfirmedCount}`;

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
      <Container maxWidth="lg" sx={{ py: { xs: 1.5, md: 3 } }}>
        <Stack spacing={2}>
          <Stack direction="row" spacing={1} alignItems="center">
            <Button startIcon={<ArrowBackRoundedIcon />} onClick={() => navigate(`/scano/tasks/${task.id}`)}>
              Task Profile
            </Button>
          </Stack>

          <RunnerSearchCard
            barcodeInput={barcodeInput}
            cameraActionDisabled={cameraActionDisabled}
            cameraError={cameraError}
            cameraLoading={cameraLoading}
            cameraOpen={cameraOpen}
            cameraPreviewVisible={cameraPreviewVisible}
            cameraToggleLabel={cameraToggleLabel}
            onBarcodeInputChange={setBarcodeInput}
            onSubmit={() => {
              void handleSubmitBarcode({ barcode: barcodeInput, source: "manual" });
            }}
            onToggleCamera={() => {
              void toggleCamera();
            }}
            resolvingScan={resolvingScan}
            runnerBootstrapError={runnerBootstrapError}
            runnerBootstrapLoading={runnerBootstrapLoading}
            searchDisabled={searchDisabled}
            showSearchCard={showSearchCard}
            showStartAction={showStartAction}
            videoRef={videoRef}
          />

          <RunnerTaskSummaryCard
            actionLoading={actionLoading}
            counters={counters}
            myConfirmedLabel={myConfirmedLabel}
            onEndTask={() => setEndDialogState("confirm")}
            onStartTask={() => {
              void handleStart();
            }}
            setTaskSummaryExpanded={setTaskSummaryExpanded}
            task={task}
            taskAssigneeNames={taskAssigneeNames}
            taskSummaryExpanded={taskSummaryExpanded}
            taskSummarySubtitle={taskSummarySubtitle}
            taskSummaryTitle={taskSummaryTitle}
            taskTotalLabel={taskTotalLabel}
          />

          {pageError ? (
            <Alert severity="error" variant="outlined">
              {pageError}
            </Alert>
          ) : null}

          <RunnerConfirmedProductsSection
            confirmedProductsOpen={confirmedProductsOpen}
            latestConfirmedProduct={latestConfirmedProduct}
            loadProductsPage={loadProductsPage}
            onOpenProduct={(product) => {
              openProductDialog({
                dialogMode: "view",
                title: "Product Details",
                value: product,
                productId: product.id,
                warning: null,
                closeOnSave: false,
              });
            }}
            page={productsPage}
            productQuery={productQuery}
            productSourceFilter={productSourceFilter}
            productsLoading={productsLoading}
            setConfirmedProductsOpen={setConfirmedProductsOpen}
            setProductQuery={setProductQuery}
            setProductSourceFilter={setProductSourceFilter}
          />

          <RunnerScanHistorySection
            closeScanHistory={closeScanHistory}
            loadScanHistory={loadScanHistory}
            scanHistoryLoading={scanHistoryLoading}
            scanHistoryOpen={scanHistoryOpen}
            scansPage={scansPage}
            setScanHistoryOpen={setScanHistoryOpen}
          />
        </Stack>
      </Container>

      <RunnerSelectionDialog
        onClose={() => {
          setSelectionItems([]);
          setPendingSelection(null);
        }}
        onSelect={(item, currentPendingSelection) => {
          const barcode = currentPendingSelection?.barcode?.trim() ?? "";
          const source = currentPendingSelection?.source ?? "manual";
          setSelectionItems([]);
          setPendingSelection(null);
          if (!barcode) return;
          void handleSubmitBarcode({
            barcode,
            source,
            selectedExternalProductId: item.id,
          });
        }}
        pendingSelection={pendingSelection}
        selectionItems={selectionItems}
      />

      <RunnerEndTaskDialog
        actionLoading={actionLoading}
        endDialogState={endDialogState}
        onBackToProfile={() => navigate(`/scano/tasks/${task.id}`)}
        onClose={() => {
          if (endDialogState === "confirm") {
            setEndDialogState("closed");
          }
        }}
        onConfirm={() => {
          void confirmEndTask();
        }}
        taskId={task.id}
      />

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
