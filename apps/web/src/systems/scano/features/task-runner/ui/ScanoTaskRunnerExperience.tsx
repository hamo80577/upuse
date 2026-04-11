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
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import type { ScanoTaskProductListSourceFilter } from "../../../api/types";
import { useAuth } from "../../../app/providers/AuthProvider";
import { useScanoTaskRunnerCamera } from "../hooks/useScanoTaskRunnerCamera";
import { useScanoTaskRunnerDerivedState } from "../hooks/useScanoTaskRunnerDerivedState";
import { useScanoTaskRunnerDialogState } from "../hooks/useScanoTaskRunnerDialogState";
import { useScanoTaskRunnerLifecycle } from "../hooks/useScanoTaskRunnerLifecycle";
import { useScanoTaskRunnerPages } from "../hooks/useScanoTaskRunnerPages";
import { useScanoTaskRunnerProductFlow } from "../hooks/useScanoTaskRunnerProductFlow";
import { useScanoTaskRunnerTaskData } from "../hooks/useScanoTaskRunnerTaskData";
import { canSubmitProductDialogValue } from "../lib/barcodeFlow";
import { SCANO_TASKS_MANAGE_CAPABILITY } from "../../../routes/capabilities";
import type { ToastState } from "../types";
import { RunnerConfirmedProductsSection } from "./RunnerConfirmedProductsSection";
import { RunnerEndTaskDialog, RunnerSelectionDialog } from "./RunnerDialogs";
import { RunnerScanHistorySection } from "./RunnerScanHistorySection";
import { RunnerSearchCard } from "./RunnerSearchCard";
import { RunnerTaskSummaryCard } from "./RunnerTaskSummaryCard";
import { TopBar } from "../../../widgets/top-bar/ui/TopBar";
import { ScanoTaskProductDialog } from "../../../pages/scano/ui/ScanoTaskProductDialog";
import { withScanoCounters } from "../../../pages/scano/ui/scanoShared";

export function ScanoTaskRunnerExperience() {
  const navigate = useNavigate();
  const params = useParams<{ id: string }>();
  const taskId = params.id?.trim() ?? "";
  const { hasSystemCapability, user } = useAuth();
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("sm"));
  const fallbackPath = hasSystemCapability("scano", SCANO_TASKS_MANAGE_CAPABILITY) ? "/scano/assign-task" : "/scano/my-tasks";

  const [toast, setToast] = useState<ToastState>(null);
  const [productQuery, setProductQuery] = useState("");
  const [productSourceFilter, setProductSourceFilter] = useState<ScanoTaskProductListSourceFilter>("all");
  const [confirmedProductsOpen, setConfirmedProductsOpen] = useState(false);
  const [barcodeInput, setBarcodeInput] = useState("");
  const [taskSummaryExpanded, setTaskSummaryExpanded] = useState(false);

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
  const {
    closeProductDialog,
    handleDialogSubmit,
    handleSubmitBarcode,
    resolvingScan,
    savingProduct,
  } = useScanoTaskRunnerProductFlow({
    closeScanHistory,
    loadRunnerBootstrap,
    onToast: setToast,
    openExistingProductDialog,
    openProductDialog,
    productDialogState,
    runnerBootstrap,
    setBarcodeInput,
    setPendingSelection,
    setProductDialogState,
    setRunnerBootstrap,
    setSelectionItems,
    setTask,
    task,
    updateProductsPageWithSavedItem,
  });
  const {
    cameraActionDisabled,
    cameraPreviewVisible,
    cameraToggleLabel,
    latestConfirmedProduct,
    myConfirmedLabel,
    searchDisabled,
    showSearchCard,
    showStartAction,
    taskSummarySubtitle,
    taskSummaryTitle,
    taskTotalLabel,
  } = useScanoTaskRunnerDerivedState({
    task,
    runnerBootstrap,
    productsPage,
    userId: user?.id,
    cameraOpen,
    cameraLoading,
    resolvingScan,
    runnerBootstrapLoading,
    runnerBootstrapError,
  });
  const {
    actionLoading,
    confirmEndTask,
    handleStart,
  } = useScanoTaskRunnerLifecycle({
    task,
    loadTask,
    navigate,
    onToast: setToast,
    setEndDialogState,
    setRunnerBootstrap,
    setTask,
    stopCamera,
  });

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
