import ArrowBackRoundedIcon from "@mui/icons-material/ArrowBackRounded";
import CheckCircleRoundedIcon from "@mui/icons-material/CheckCircleRounded";
import DeleteOutlineRoundedIcon from "@mui/icons-material/DeleteOutlineRounded";
import DownloadRoundedIcon from "@mui/icons-material/DownloadRounded";
import EditRoundedIcon from "@mui/icons-material/EditRounded";
import OpenInNewRoundedIcon from "@mui/icons-material/OpenInNewRounded";
import PlayArrowRoundedIcon from "@mui/icons-material/PlayArrowRounded";
import RestartAltRoundedIcon from "@mui/icons-material/RestartAltRounded";
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Checkbox,
  CircularProgress,
  Container,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControlLabel,
  Grid,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api, describeApiError } from "../../../api/client";
import type {
  SaveScanoTaskProductPayload,
  ScanoTaskDetail,
  ScanoTaskProduct,
  ScanoTaskProductListSourceFilter,
  ScanoTaskProductsPageResponse,
  ScanoTaskScansPageResponse,
  ScanoTaskSummaryPatch,
  ScanoTeamMember,
} from "../../../api/types";
import { useAuth } from "../../../app/providers/AuthProvider";
import { SCANO_TASKS_MANAGE_CAPABILITY } from "../../../routes/capabilities";
import { TopBar } from "../../../widgets/top-bar/ui/TopBar";
import { ScanoAssigneeChips } from "./ScanoAssigneeChips";
import { ScanoConfirmedProductsTable } from "./ScanoConfirmedProductsTable";
import { ScanoTaskProductDialog } from "./ScanoTaskProductDialog";
import { formatCairoFullDateTime, getScanoTaskStatusMeta, withScanoCounters } from "./scanoShared";

type ToastState = { type: "success" | "error"; msg: string } | null;
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

function participantLabel(startedAt: string | null, endedAt: string | null) {
  if (endedAt) return "Ended";
  if (startedAt) return "Active";
  return "Not started";
}

function triggerBlobDownload(blob: Blob, fileName: string) {
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
}

function CounterCard(props: { label: string; total: number; edited?: number }) {
  return (
    <Card variant="outlined" sx={{ borderRadius: 3 }}>
      <CardContent sx={{ p: 1.3 }}>
        <Typography variant="caption" sx={{ color: "text.secondary" }}>{props.label}</Typography>
        <Typography sx={{ fontWeight: 900, fontSize: 24 }}>{props.total}</Typography>
        {typeof props.edited === "number" ? (
          <Typography variant="caption" sx={{ color: "text.secondary" }}>
            Edited {props.edited}
          </Typography>
        ) : null}
      </CardContent>
    </Card>
  );
}

export function ScanoTaskProfilePage() {
  const navigate = useNavigate();
  const params = useParams<{ id: string }>();
  const taskId = params.id?.trim() ?? "";
  const { hasSystemCapability } = useAuth();
  const canManageScanoTasks = hasSystemCapability("scano", SCANO_TASKS_MANAGE_CAPABILITY);
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
  const [actionLoading, setActionLoading] = useState(false);
  const [assigneeDialogOpen, setAssigneeDialogOpen] = useState(false);
  const [teamMembers, setTeamMembers] = useState<ScanoTeamMember[]>([]);
  const [teamLoading, setTeamLoading] = useState(false);
  const [selectedAssigneeIds, setSelectedAssigneeIds] = useState<number[]>([]);
  const [selectedProduct, setSelectedProduct] = useState<ScanoTaskProduct | null>(null);
  const [productDialogMode, setProductDialogMode] = useState<"view" | "edit">("view");
  const [savingProduct, setSavingProduct] = useState(false);
  const [confirmExportDialogOpen, setConfirmExportDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);

  const assignableTeamMembers = useMemo(
    () => teamMembers.filter((member) => member.active && member.role === "scanner"),
    [teamMembers],
  );

  function mergeTaskSummaryIntoDetail(nextTask: ScanoTaskDetail | null, summary?: ScanoTaskSummaryPatch) {
    if (!nextTask || !summary) return nextTask;
    return {
      ...nextTask,
      ...summary,
    };
  }

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
      setSelectedAssigneeIds(response.item.assignees.map((assignee) => assignee.id));
    } catch (error) {
      if (signal?.aborted) return;
      const message = describeApiError(error, "Failed to load Scano task");
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
      setToast({ type: "error", msg: describeApiError(error, "Failed to load raw scan history") });
    } finally {
      if (!signal?.aborted) {
        setScanHistoryLoading(false);
      }
    }
  }, [taskId]);

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
    if (!toast) return;
    const timer = window.setTimeout(() => {
      setToast(null);
    }, 3400);
    return () => window.clearTimeout(timer);
  }, [toast]);

  async function ensureTeamMembersLoaded() {
    if (teamMembers.length || !canManageScanoTasks) return;
    try {
      setTeamLoading(true);
      const response = await api.listScanoTeam();
      setTeamMembers(response.items);
    } catch (error) {
      setToast({ type: "error", msg: describeApiError(error, "Failed to load Scano team") });
    } finally {
      setTeamLoading(false);
    }
  }

  async function handleStart() {
    if (!task) return;
    try {
      setActionLoading(true);
      await api.startScanoTask(task.id);
      navigate(`/scano/tasks/${task.id}/run`);
    } catch (error) {
      setToast({ type: "error", msg: describeApiError(error, "Failed to start task") });
    } finally {
      setActionLoading(false);
    }
  }

  async function handleResume() {
    if (!task) return;
    try {
      setActionLoading(true);
      await api.resumeScanoTask(task.id);
      navigate(`/scano/tasks/${task.id}/run`);
    } catch (error) {
      setToast({ type: "error", msg: describeApiError(error, "Failed to resume task") });
    } finally {
      setActionLoading(false);
    }
  }

  async function handleComplete() {
    if (!task) return;
    try {
      setActionLoading(true);
      const response = await api.completeScanoTask(task.id);
      setTask((current) => current ? { ...current, ...response.item } : current);
      setToast({ type: "success", msg: "Task marked as completed" });
      await loadTask();
    } catch (error) {
      setToast({ type: "error", msg: describeApiError(error, "Failed to complete task") });
    } finally {
      setActionLoading(false);
    }
  }

  async function handleSaveAssignees() {
    if (!task) return;
    try {
      setActionLoading(true);
      await api.updateScanoTaskAssignees(task.id, { assigneeIds: selectedAssigneeIds });
      setAssigneeDialogOpen(false);
      setToast({ type: "success", msg: "Assignees updated" });
      await loadTask();
    } catch (error) {
      setToast({ type: "error", msg: describeApiError(error, "Failed to update assignees") });
    } finally {
      setActionLoading(false);
    }
  }

  async function handleCreateExport() {
    if (!task) return;
    try {
      setActionLoading(true);
      const response = await api.createScanoTaskExport(task.id);
      setTask(response.task);
      const file = await api.downloadScanoTaskExport(task.id, response.item.id);
      triggerBlobDownload(file.blob, file.fileName);
      if (response.item.requiresConfirmation) {
        setConfirmExportDialogOpen(true);
      }
      setToast({ type: "success", msg: "Review package downloaded" });
    } catch (error) {
      setToast({ type: "error", msg: describeApiError(error, "Failed to create review package") });
    } finally {
      setActionLoading(false);
    }
  }

  async function handleDownloadLatestExport() {
    if (!task?.latestExport) return;
    try {
      setActionLoading(true);
      const file = await api.downloadScanoTaskExport(task.id, task.latestExport.id);
      triggerBlobDownload(file.blob, file.fileName);
      if (task.latestExport.requiresConfirmation) {
        setConfirmExportDialogOpen(true);
      }
    } catch (error) {
      setToast({ type: "error", msg: describeApiError(error, "Failed to download review package") });
    } finally {
      setActionLoading(false);
    }
  }

  async function handleConfirmExport() {
    if (!task?.latestExport) return;
    try {
      setActionLoading(true);
      const response = await api.confirmScanoTaskExportDownload(task.id, task.latestExport.id);
      setTask(response.task);
      setConfirmExportDialogOpen(false);
      setToast({ type: "success", msg: "Temporary product images were purged from the server" });
    } catch (error) {
      setToast({ type: "error", msg: describeApiError(error, "Failed to confirm export") });
    } finally {
      setActionLoading(false);
    }
  }

  async function handleDeleteTask() {
    if (!task) return;
    try {
      setActionLoading(true);
      await api.deleteScanoTask(task.id);
      setDeleteDialogOpen(false);
      navigate(fallbackPath, { replace: true });
    } catch (error) {
      setToast({ type: "error", msg: describeApiError(error, "Failed to delete task") });
    } finally {
      setActionLoading(false);
    }
  }

  async function handleSaveProduct(payload: SaveScanoTaskProductPayload, images: File[]) {
    if (!task || !selectedProduct) return;
    try {
      setSavingProduct(true);
      const response = await api.updateScanoTaskProduct(task.id, selectedProduct.id, payload, images);
      setTask((current) => mergeTaskSummaryIntoDetail(current, response.taskSummary));
      setSelectedProduct(response.item);
      setProductDialogMode("view");
      await loadProductsPage(productsPage.page);
      setToast({ type: "success", msg: "Product updated" });
    } catch (error) {
      setToast({ type: "error", msg: describeApiError(error, "Failed to update product") });
    } finally {
      setSavingProduct(false);
    }
  }

  function toggleAssignee(memberId: number) {
    setSelectedAssigneeIds((current) =>
      current.includes(memberId)
        ? current.filter((id) => id !== memberId)
        : [...current, memberId],
    );
  }

  if (loading) {
    return (
      <Box sx={{ minHeight: "100vh", bgcolor: "#f5f7fb" }}>
        <TopBar />
        <Container maxWidth="md" sx={{ py: 3 }}>
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
        <Container maxWidth="md" sx={{ py: 3 }}>
          <Alert severity="error" variant="outlined">
            {pageError || "Scano task not found"}
          </Alert>
        </Container>
      </Box>
    );
  }

  const statusMeta = getScanoTaskStatusMeta(task.status);
  const counters = withScanoCounters(task.counters);

  return (
    <Box
      sx={{
        minHeight: "100vh",
        bgcolor: "#f5f7fb",
        background:
          "radial-gradient(circle at top left, rgba(14,165,233,0.11), transparent 28%), radial-gradient(circle at bottom right, rgba(15,23,42,0.08), transparent 32%), linear-gradient(180deg, #f7fafc 0%, #edf4f8 100%)",
      }}
    >
      <TopBar />

      <Container maxWidth="md" sx={{ py: { xs: 2, md: 3 } }}>
        <Stack spacing={2}>
          <Stack direction="row" spacing={1} alignItems="center">
            <Button startIcon={<ArrowBackRoundedIcon />} onClick={() => navigate(fallbackPath)}>
              Back To Tasks
            </Button>
          </Stack>

          <Card sx={{ borderRadius: 4, bgcolor: "rgba(255,255,255,0.88)" }}>
            <CardContent sx={{ p: 2 }}>
              <Stack spacing={1.5}>
                <Stack direction="row" justifyContent="space-between" alignItems="flex-start" spacing={1}>
                  <Box>
                    <Typography variant="h4" sx={{ fontWeight: 950, letterSpacing: "-0.04em" }}>
                      {task.chainName}
                    </Typography>
                    <Typography variant="body1" sx={{ color: "text.secondary" }}>
                      {task.branchName}
                    </Typography>
                  </Box>
                  <Chip size="small" label={statusMeta.label} sx={{ fontWeight: 800, ...statusMeta.sx }} />
                </Stack>

                <ScanoAssigneeChips names={task.assignees.map((assignee) => assignee.name)} />

                <Grid container spacing={1.2}>
                  <Grid item xs={12} sm={6}>
                    <Card variant="outlined" sx={{ borderRadius: 3 }}>
                      <CardContent sx={{ p: 1.4 }}>
                        <Typography variant="caption" sx={{ color: "text.secondary" }}>Scheduled At</Typography>
                        <Typography sx={{ fontWeight: 800 }}>{formatCairoFullDateTime(task.scheduledAt)}</Typography>
                      </CardContent>
                    </Card>
                  </Grid>
                  <Grid item xs={6} sm={3}>
                    <Card variant="outlined" sx={{ borderRadius: 3 }}>
                      <CardContent sx={{ p: 1.4 }}>
                        <Typography variant="caption" sx={{ color: "text.secondary" }}>Started</Typography>
                        <Typography sx={{ fontWeight: 800 }}>{task.progress.startedCount}/{task.progress.totalCount}</Typography>
                      </CardContent>
                    </Card>
                  </Grid>
                  <Grid item xs={6} sm={3}>
                    <Card variant="outlined" sx={{ borderRadius: 3 }}>
                      <CardContent sx={{ p: 1.4 }}>
                        <Typography variant="caption" sx={{ color: "text.secondary" }}>Ended</Typography>
                        <Typography sx={{ fontWeight: 800 }}>{task.progress.endedCount}/{task.progress.totalCount}</Typography>
                      </CardContent>
                    </Card>
                  </Grid>
                </Grid>

                <Stack direction={{ xs: "column", sm: "row" }} spacing={1}>
                  {task.permissions.canStart ? (
                    <Button
                      variant="contained"
                      color="success"
                      startIcon={actionLoading ? <CircularProgress size={16} color="inherit" /> : <PlayArrowRoundedIcon />}
                      onClick={() => void handleStart()}
                      disabled={actionLoading}
                    >
                      Start
                    </Button>
                  ) : null}
                  {task.viewerState.canEnter && task.viewerState.hasStarted && !task.viewerState.hasEnded ? (
                    <Button variant="contained" onClick={() => navigate(`/scano/tasks/${task.id}/run`)}>
                      Continue
                    </Button>
                  ) : null}
                  {task.viewerState.canResume ? (
                    <Button
                      variant="outlined"
                      startIcon={actionLoading ? <CircularProgress size={16} color="inherit" /> : <RestartAltRoundedIcon />}
                      onClick={() => void handleResume()}
                      disabled={actionLoading}
                    >
                      Resume
                    </Button>
                  ) : null}
                  {task.permissions.canManageAssignees && canManageScanoTasks ? (
                    <Button
                      variant="outlined"
                      startIcon={<EditRoundedIcon />}
                      onClick={() => {
                        void ensureTeamMembersLoaded();
                        setSelectedAssigneeIds(task.assignees.map((assignee) => assignee.id));
                        setAssigneeDialogOpen(true);
                      }}
                    >
                      Edit Assignees
                    </Button>
                  ) : null}
                  {task.permissions.canDownloadReviewPackage ? (
                    <Button
                      variant="outlined"
                      startIcon={<DownloadRoundedIcon />}
                      onClick={() => void handleCreateExport()}
                      disabled={actionLoading}
                    >
                      Download Review Package
                    </Button>
                  ) : null}
                  {task.latestExport?.canDownload ? (
                    <Button
                      variant="text"
                      startIcon={<OpenInNewRoundedIcon />}
                      onClick={() => void handleDownloadLatestExport()}
                      disabled={actionLoading}
                    >
                      Download Latest Export
                    </Button>
                  ) : null}
                  {task.permissions.canComplete ? (
                    <Button
                      variant="contained"
                      color="success"
                      startIcon={<CheckCircleRoundedIcon />}
                      onClick={() => void handleComplete()}
                      disabled={actionLoading}
                    >
                      Complete Task
                    </Button>
                  ) : null}
                  {canManageScanoTasks ? (
                    <Button
                      variant="outlined"
                      color="error"
                      startIcon={<DeleteOutlineRoundedIcon />}
                      onClick={() => setDeleteDialogOpen(true)}
                      disabled={actionLoading}
                    >
                      Delete Task
                    </Button>
                  ) : null}
                </Stack>

                {task.latestExport ? (
                  <Alert severity={task.latestExport.requiresConfirmation ? "warning" : "success"} variant="outlined">
                    Review export created {formatCairoFullDateTime(task.latestExport.createdAt)}.
                    {task.latestExport.requiresConfirmation
                      ? " Confirm download to purge temporary images from the server."
                      : " Temporary images were already purged."}
                  </Alert>
                ) : null}
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
              <Stack spacing={1.4}>
                <Typography variant="h6" sx={{ fontWeight: 900 }}>
                  Scanner Details
                </Typography>
                {task.assignees.map((assignee) => {
                  const participant = task.participants.find((item) => item.id === assignee.id) ?? null;
                  return (
                    <Card key={assignee.id} variant="outlined" sx={{ borderRadius: 3 }}>
                      <CardContent sx={{ p: 1.4 }}>
                        <Stack spacing={0.5}>
                          <Typography sx={{ fontWeight: 800 }}>{assignee.name}</Typography>
                          <Typography variant="body2" sx={{ color: "text.secondary" }}>
                            {participantLabel(participant?.startedAt ?? null, participant?.endedAt ?? null)}
                          </Typography>
                          <Typography variant="caption" sx={{ color: "text.secondary" }}>
                            Started: {formatCairoFullDateTime(participant?.startedAt ?? undefined)}
                          </Typography>
                          <Typography variant="caption" sx={{ color: "text.secondary" }}>
                            Ended: {formatCairoFullDateTime(participant?.endedAt ?? undefined)}
                          </Typography>
                        </Stack>
                      </CardContent>
                    </Card>
                  );
                })}
              </Stack>
            </CardContent>
          </Card>

          <Card sx={{ borderRadius: 4 }}>
            <CardContent sx={{ p: 2 }}>
              <Stack spacing={1.2}>
                <Typography variant="h6" sx={{ fontWeight: 900 }}>
                  Product Counters
                </Typography>
                <Grid container spacing={1.1}>
                  <Grid item xs={6} sm={3}><CounterCard label="Vendor" total={counters.vendorCount} edited={counters.vendorEditedCount} /></Grid>
                  <Grid item xs={6} sm={3}><CounterCard label="Chain" total={counters.chainCount} edited={counters.chainEditedCount} /></Grid>
                  <Grid item xs={6} sm={3}><CounterCard label="Master" total={counters.masterCount} /></Grid>
                  <Grid item xs={6} sm={3}><CounterCard label="Manual" total={counters.manualCount} /></Grid>
                </Grid>
              </Stack>
            </CardContent>
          </Card>

          <Card sx={{ borderRadius: 4 }}>
            <CardContent sx={{ p: 2 }}>
              <Stack spacing={1.2}>
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
                    {confirmedProductsOpen ? "Hide" : "Show"}
                  </Button>
                </Stack>

                {confirmedProductsOpen ? (
                  <ScanoConfirmedProductsTable
                    title="Confirmed Products"
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
                      setSelectedProduct(product);
                      setProductDialogMode("view");
                    }}
                  />
                ) : (
                  <Alert severity="info" variant="outlined">
                    Confirmed products stay hidden until you open them.
                  </Alert>
                )}
              </Stack>
            </CardContent>
          </Card>

          <Card sx={{ borderRadius: 4 }}>
            <CardContent sx={{ p: 2 }}>
              <Stack spacing={1.3}>
                <Stack direction="row" justifyContent="space-between" alignItems="center">
                  <Typography variant="h6" sx={{ fontWeight: 900 }}>
                    Raw Scan History
                  </Typography>
                  <Button
                    size="small"
                    onClick={() => {
                      if (scanHistoryOpen) {
                        setScanHistoryOpen(false);
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

      <Dialog open={assigneeDialogOpen} onClose={() => setAssigneeDialogOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle>Edit Assignees</DialogTitle>
        <DialogContent dividers>
          <Stack spacing={1.2}>
            {teamLoading ? (
              <Stack direction="row" spacing={1} alignItems="center">
                <CircularProgress size={18} />
                <Typography variant="body2">Loading scanners...</Typography>
              </Stack>
            ) : (
              assignableTeamMembers.map((member) => (
                <FormControlLabel
                  key={member.id}
                  control={(
                    <Checkbox
                      checked={selectedAssigneeIds.includes(member.id)}
                      onChange={() => toggleAssignee(member.id)}
                    />
                  )}
                  label={`${member.name} (${member.linkedUserEmail})`}
                />
              ))
            )}
            <Divider />
            <Typography variant="caption" sx={{ color: "text.secondary" }}>
              Started scanners cannot be removed once task progress begins. New scanners can still be added until the task moves to review.
            </Typography>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setAssigneeDialogOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={() => void handleSaveAssignees()} disabled={actionLoading || !selectedAssigneeIds.length}>
            Save
          </Button>
        </DialogActions>
      </Dialog>

      <ScanoTaskProductDialog
        open={!!selectedProduct}
        mode={productDialogMode}
        title={productDialogMode === "edit" ? "Edit Product" : "Product Details"}
        value={selectedProduct}
        submitting={savingProduct}
        onClose={() => {
          setSelectedProduct(null);
          setProductDialogMode("view");
        }}
        onSubmit={selectedProduct?.canEdit ? ((payload, images) => void handleSaveProduct(payload, images)) : undefined}
      />

      <Dialog open={confirmExportDialogOpen} onClose={() => setConfirmExportDialogOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle>Confirm Export Download</DialogTitle>
        <DialogContent dividers>
          <Typography variant="body2" sx={{ color: "text.secondary", lineHeight: 1.8 }}>
            After confirmation, temporary product images will be deleted from the server. The final export file will remain available for review and archive.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmExportDialogOpen(false)}>Cancel</Button>
          <Button variant="contained" color="warning" onClick={() => void handleConfirmExport()} disabled={actionLoading}>
            Confirm And Purge Images
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={deleteDialogOpen} onClose={() => (actionLoading ? undefined : setDeleteDialogOpen(false))} fullWidth maxWidth="xs">
        <DialogTitle>Delete Task</DialogTitle>
        <DialogContent dividers>
          <Typography variant="body2" sx={{ color: "text.secondary", lineHeight: 1.8 }}>
            This will permanently delete the task, confirmed products, scans, review exports, and local scanner images.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteDialogOpen(false)} disabled={actionLoading}>Cancel</Button>
          <Button variant="contained" color="error" onClick={() => void handleDeleteTask()} disabled={actionLoading}>
            Delete Task
          </Button>
        </DialogActions>
      </Dialog>

      {toast ? (
        <Alert
          severity={toast.type}
          variant="filled"
          onClose={() => setToast(null)}
          sx={{
            position: "fixed",
            left: "50%",
            bottom: 18,
            transform: "translateX(-50%)",
            zIndex: 1600,
            minWidth: 220,
          }}
        >
          {toast.msg}
        </Alert>
      ) : null}
    </Box>
  );
}
