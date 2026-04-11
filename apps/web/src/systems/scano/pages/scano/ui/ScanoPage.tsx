import AddRoundedIcon from "@mui/icons-material/AddRounded";
import DeleteOutlineRoundedIcon from "@mui/icons-material/DeleteOutlineRounded";
import DownloadRoundedIcon from "@mui/icons-material/DownloadRounded";
import EditRoundedIcon from "@mui/icons-material/EditRounded";
import OpenInNewRoundedIcon from "@mui/icons-material/OpenInNewRounded";
import SearchRoundedIcon from "@mui/icons-material/SearchRounded";
import TaskAltRoundedIcon from "@mui/icons-material/TaskAltRounded";
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Checkbox,
  Chip,
  CircularProgress,
  Container,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControlLabel,
  MenuItem,
  Stack,
  Step,
  StepLabel,
  Stepper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from "@mui/material";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, describeApiError } from "../../../api/client";
import type {
  ScanoBranchOption,
  ScanoChainOption,
  ScanoTaskListItem,
  ScanoTeamMember,
} from "../../../api/types";
import { useAuth } from "../../../app/providers/AuthProvider";
import { SCANO_TASKS_MANAGE_CAPABILITY } from "../../../routes/capabilities";
import { TopBar } from "../../../widgets/top-bar/ui/TopBar";
import { ScanoAssigneeChips } from "./ScanoAssigneeChips";
import { ScanoDateRangeField } from "./ScanoDateRangeField";
import {
  formatCairoDateTime,
  getScanoTaskStatusMeta,
  sortTaskItems,
  toCairoIsoString,
  toCairoRangeEndIso,
  toCairoRangeStartIso,
  toDateTimeLocalValue,
  upsertTaskItem,
  withScanoCounters,
} from "./scanoShared";

const WIZARD_STEPS = ["Search Chain", "Select Branch", "Assign & Schedule", "Review & Save"] as const;

type ToastState = { type: "success" | "error"; msg: string } | null;
type WizardMode = "create" | "edit";
type ScanoTaskFilterStatus = "all" | "pending" | "in_progress" | "awaiting_review" | "completed";
type SortKey = "scheduled_asc" | "scheduled_desc" | "chain_asc" | "branch_asc";

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

function useDebouncedValue<T>(value: T, delayMs: number) {
  const [debouncedValue, setDebouncedValue] = useState(value);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setDebouncedValue(value);
    }, delayMs);

    return () => {
      window.clearTimeout(timeout);
    };
  }, [delayMs, value]);

  return debouncedValue;
}

export function ScanoPage() {
  const navigate = useNavigate();
  const { hasSystemCapability } = useAuth();
  const canManageScanoTasks = hasSystemCapability("scano", SCANO_TASKS_MANAGE_CAPABILITY);
  const [tasks, setTasks] = useState<ScanoTaskListItem[]>([]);
  const [tasksLoading, setTasksLoading] = useState(true);
  const [pageError, setPageError] = useState("");
  const [toast, setToast] = useState<ToastState>(null);
  const [fromFilter, setFromFilter] = useState("");
  const [toFilter, setToFilter] = useState("");
  const [searchFilter, setSearchFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState<ScanoTaskFilterStatus>("all");
  const [sortKey, setSortKey] = useState<SortKey>("scheduled_asc");

  const [wizardOpen, setWizardOpen] = useState(false);
  const [wizardMode, setWizardMode] = useState<WizardMode>("create");
  const [activeStep, setActiveStep] = useState(0);
  const [editingTask, setEditingTask] = useState<ScanoTaskListItem | null>(null);
  const [chainSearch, setChainSearch] = useState("");
  const [chainOptions, setChainOptions] = useState<ScanoChainOption[]>([]);
  const [chainLoading, setChainLoading] = useState(false);
  const [chainError, setChainError] = useState("");
  const [selectedChain, setSelectedChain] = useState<ScanoChainOption | null>(null);
  const [branchSearch, setBranchSearch] = useState("");
  const [branchOptions, setBranchOptions] = useState<ScanoBranchOption[]>([]);
  const [branchLoading, setBranchLoading] = useState(false);
  const [branchError, setBranchError] = useState("");
  const [selectedBranch, setSelectedBranch] = useState<ScanoBranchOption | null>(null);
  const [selectedAssigneeIds, setSelectedAssigneeIds] = useState<number[]>([]);
  const [scheduledAtInput, setScheduledAtInput] = useState("");
  const [savingTask, setSavingTask] = useState(false);
  const [taskPendingDelete, setTaskPendingDelete] = useState<ScanoTaskListItem | null>(null);

  const [teamLoading, setTeamLoading] = useState(false);
  const [teamLoaded, setTeamLoaded] = useState(false);
  const [teamMembers, setTeamMembers] = useState<ScanoTeamMember[]>([]);

  const debouncedChainSearch = useDebouncedValue(chainSearch, 280);
  const debouncedBranchSearch = useDebouncedValue(branchSearch, 280);

  const assignableTeamMembers = useMemo(
    () => teamMembers.filter((member) => member.active && member.role === "scanner"),
    [teamMembers],
  );

  const selectedAssignees = useMemo(() => {
    const selectedSet = new Set(selectedAssigneeIds);
    return assignableTeamMembers.filter((member) => selectedSet.has(member.id));
  }, [assignableTeamMembers, selectedAssigneeIds]);

  const scheduledAtIso = useMemo(
    () => (scheduledAtInput ? toCairoIsoString(scheduledAtInput) : null),
    [scheduledAtInput],
  );

  const visibleTasks = useMemo(() => {
    const normalizedSearch = searchFilter.trim().toLowerCase();
    const filtered = tasks.filter((task) => {
      if (statusFilter !== "all" && task.status !== statusFilter) {
        return false;
      }
      if (!normalizedSearch) {
        return true;
      }

      return [
        task.chainName,
        task.branchName,
        ...task.assignees.map((assignee) => assignee.name),
      ].some((value) => value.toLowerCase().includes(normalizedSearch));
    });

    return filtered.sort((left, right) => {
      if (sortKey === "scheduled_desc") {
        return Date.parse(right.scheduledAt) - Date.parse(left.scheduledAt) || right.id.localeCompare(left.id);
      }
      if (sortKey === "chain_asc") {
        return left.chainName.localeCompare(right.chainName, "en", { sensitivity: "base" })
          || left.branchName.localeCompare(right.branchName, "en", { sensitivity: "base" })
          || left.id.localeCompare(right.id);
      }
      if (sortKey === "branch_asc") {
        return left.branchName.localeCompare(right.branchName, "en", { sensitivity: "base" })
          || left.chainName.localeCompare(right.chainName, "en", { sensitivity: "base" })
          || left.id.localeCompare(right.id);
      }

      return Date.parse(left.scheduledAt) - Date.parse(right.scheduledAt) || right.id.localeCompare(left.id);
    });
  }, [searchFilter, sortKey, statusFilter, tasks]);

  const loadTasks = useCallback(async (signal?: AbortSignal) => {
    const fromIso = fromFilter ? (toCairoRangeStartIso(fromFilter) ?? undefined) : undefined;
    const toIso = toFilter ? (toCairoRangeEndIso(toFilter) ?? undefined) : undefined;

    if ((fromFilter && !fromIso) || (toFilter && !toIso)) {
      setTasks([]);
      setTasksLoading(false);
      setPageError("Invalid date range.");
      return;
    }

    try {
      setTasksLoading(true);
      setPageError("");
      const response = await api.listScanoTasks({
        from: fromIso,
        to: toIso,
        signal,
      });
      if (signal?.aborted) return;
      setTasks(sortTaskItems(response.items));
    } catch (error) {
      if (signal?.aborted) return;
      setPageError(describeApiError(error, "Failed to load Scano tasks"));
    } finally {
      if (!signal?.aborted) {
        setTasksLoading(false);
      }
    }
  }, [fromFilter, toFilter]);

  useEffect(() => {
    const controller = new AbortController();
    void loadTasks(controller.signal);
    return () => controller.abort();
  }, [loadTasks]);

  const loadTeamMembers = useCallback(async () => {
    if (!canManageScanoTasks) return;

    try {
      setTeamLoading(true);
      const response = await api.listScanoTeam();
      setTeamMembers(response.items);
      setTeamLoaded(true);
    } catch (error) {
      setToast({ type: "error", msg: describeApiError(error, "Failed to load Scano team") });
    } finally {
      setTeamLoading(false);
    }
  }, [canManageScanoTasks]);

  const ensureSupportDataLoaded = useCallback(async () => {
    if (!canManageScanoTasks || teamLoaded) return;
    await loadTeamMembers();
  }, [canManageScanoTasks, loadTeamMembers, teamLoaded]);

  useEffect(() => {
    if (!wizardOpen || !canManageScanoTasks || activeStep !== 0) return;

    const query = debouncedChainSearch.trim();
    if (!query) {
      setChainOptions(selectedChain ? [selectedChain] : []);
      setChainLoading(false);
      setChainError("");
      return;
    }

    const controller = new AbortController();
    setChainLoading(true);
    setChainError("");

    void api.listScanoChains(query, { signal: controller.signal })
      .then((response) => {
        if (controller.signal.aborted) return;
        const nextItems = selectedChain && !response.items.some((item) => item.id === selectedChain.id)
          ? [selectedChain, ...response.items]
          : response.items;
        setChainOptions(nextItems);
      })
      .catch((error) => {
        if (controller.signal.aborted) return;
        setChainError(describeApiError(error, "Failed to search chains"));
        setChainOptions(selectedChain ? [selectedChain] : []);
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setChainLoading(false);
        }
      });

    return () => controller.abort();
  }, [activeStep, canManageScanoTasks, debouncedChainSearch, selectedChain, wizardOpen]);

  useEffect(() => {
    if (!wizardOpen || !canManageScanoTasks || activeStep !== 1 || !selectedChain) return;

    const controller = new AbortController();
    setBranchLoading(true);
    setBranchError("");

    void api.listScanoBranches(selectedChain.id, debouncedBranchSearch.trim(), { signal: controller.signal })
      .then((response) => {
        if (controller.signal.aborted) return;
        const nextItems = selectedBranch && !response.items.some((item) => item.id === selectedBranch.id)
          ? [selectedBranch, ...response.items]
          : response.items;
        setBranchOptions(nextItems);
      })
      .catch((error) => {
        if (controller.signal.aborted) return;
        setBranchError(describeApiError(error, "Failed to load chain branches"));
        setBranchOptions(selectedBranch ? [selectedBranch] : []);
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setBranchLoading(false);
        }
      });

    return () => controller.abort();
  }, [activeStep, canManageScanoTasks, debouncedBranchSearch, selectedBranch, selectedChain, wizardOpen]);

  function resetWizardState() {
    setActiveStep(0);
    setEditingTask(null);
    setChainSearch("");
    setChainOptions([]);
    setChainLoading(false);
    setChainError("");
    setSelectedChain(null);
    setBranchSearch("");
    setBranchOptions([]);
    setBranchLoading(false);
    setBranchError("");
    setSelectedBranch(null);
    setSelectedAssigneeIds([]);
    setScheduledAtInput("");
    setSavingTask(false);
  }

  async function openCreateWizard() {
    if (!canManageScanoTasks) return;
    await ensureSupportDataLoaded();
    resetWizardState();
    setWizardMode("create");
    setWizardOpen(true);
  }

  async function handleDownloadReviewPackage(task: ScanoTaskListItem) {
    try {
      const download = task.latestExport?.canDownload
        ? await api.downloadScanoTaskExport(task.id, task.latestExport.id)
        : (() => {
            if (!task.permissions.canDownloadReviewPackage) {
              throw new Error("Review package is not available yet.");
            }
            return api.createScanoTaskExport(task.id).then(async (response) => {
              setTasks((current) => upsertTaskItem(current, response.task));
              return api.downloadScanoTaskExport(task.id, response.item.id);
            });
          })();
      const file = await download;
      triggerBlobDownload(file.blob, file.fileName);
      await loadTasks();
      setToast({ type: "success", msg: "Review package downloaded" });
    } catch (error) {
      setToast({ type: "error", msg: describeApiError(error, "Failed to download review package") });
    }
  }

  async function openEditWizard(task: ScanoTaskListItem) {
    if (!canManageScanoTasks) return;
    await ensureSupportDataLoaded();

    const chain: ScanoChainOption = {
      id: task.chainId,
      name: task.chainName,
      active: true,
      globalId: "",
      type: "",
    };

    const branch: ScanoBranchOption = {
      id: task.branchId,
      globalId: task.branchGlobalId,
      name: task.branchName,
      chainId: task.chainId,
      chainName: task.chainName,
      globalEntityId: task.globalEntityId,
      countryCode: task.countryCode,
      additionalRemoteId: task.additionalRemoteId,
    };

    resetWizardState();
    setWizardMode("edit");
    setEditingTask(task);
    setChainSearch(task.chainName);
    setChainOptions([chain]);
    setSelectedChain(chain);
    setBranchSearch(task.branchName);
    setBranchOptions([branch]);
    setSelectedBranch(branch);
    setSelectedAssigneeIds(task.assignees.map((assignee) => assignee.id));
    setScheduledAtInput(toDateTimeLocalValue(task.scheduledAt));
    setWizardOpen(true);
  }

  function closeWizard() {
    setWizardOpen(false);
    resetWizardState();
  }

  function toggleAssigneeSelection(memberId: number) {
    setSelectedAssigneeIds((current) =>
      current.includes(memberId)
        ? current.filter((value) => value !== memberId)
        : [...current, memberId],
    );
  }

  async function handleSaveTask() {
    if (!selectedChain || !selectedBranch || !scheduledAtIso || !selectedAssigneeIds.length) {
      setToast({ type: "error", msg: "Complete all wizard steps first" });
      return;
    }

    try {
      setSavingTask(true);

      const payload = {
        chainId: selectedChain.id,
        chainName: selectedChain.name,
        branch: {
          id: selectedBranch.id,
          globalId: selectedBranch.globalId,
          name: selectedBranch.name,
          globalEntityId: selectedBranch.globalEntityId,
          countryCode: selectedBranch.countryCode,
          additionalRemoteId: selectedBranch.additionalRemoteId,
        },
        assigneeIds: selectedAssigneeIds,
        scheduledAt: scheduledAtIso,
      };

      const response = wizardMode === "edit" && editingTask
        ? await api.updateScanoTask(editingTask.id, payload)
        : await api.createScanoTask(payload);

      setTasks((current) => upsertTaskItem(current, response.item));
      setToast({ type: "success", msg: wizardMode === "edit" ? "Task updated" : "Task created" });
      closeWizard();
    } catch (error) {
      setToast({
        type: "error",
        msg: describeApiError(error, wizardMode === "edit" ? "Failed to update task" : "Failed to create task"),
      });
    } finally {
      setSavingTask(false);
    }
  }

  async function handleDeleteTask() {
    if (!taskPendingDelete) return;
    try {
      setSavingTask(true);
      await api.deleteScanoTask(taskPendingDelete.id);
      setTasks((current) => current.filter((task) => task.id !== taskPendingDelete.id));
      setTaskPendingDelete(null);
      setToast({ type: "success", msg: "Task deleted" });
    } catch (error) {
      setToast({ type: "error", msg: describeApiError(error, "Failed to delete task") });
    } finally {
      setSavingTask(false);
    }
  }

  const canMoveNext = (
    activeStep === 0 && !!selectedChain
  ) || (
    activeStep === 1 && !!selectedBranch
  ) || (
    activeStep === 2 && !!scheduledAtIso && selectedAssigneeIds.length > 0
  );

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

      <Container maxWidth="xl" sx={{ py: { xs: 2.25, md: 3.5 } }}>
        <Stack spacing={2.2}>
          <Card
            sx={{
              borderRadius: 5,
              bgcolor: "rgba(255,255,255,0.76)",
              border: "1px solid rgba(148,163,184,0.18)",
              boxShadow: "0 24px 80px rgba(15,23,42,0.08)",
              backdropFilter: "blur(14px)",
            }}
          >
            <CardContent sx={{ px: { xs: 2, md: 3.2 }, py: { xs: 2.1, md: 2.7 } }}>
              <Stack spacing={2}>
                <Stack direction={{ xs: "column", md: "row" }} spacing={1.5} justifyContent="space-between" alignItems={{ xs: "flex-start", md: "center" }}>
                  <Box>
                    <Typography variant="h4" sx={{ fontWeight: 950, letterSpacing: "-0.04em", color: "#0f172a" }}>
                      Assign Task
                    </Typography>
                    <Typography variant="body2" sx={{ color: "#64748b", mt: 0.5 }}>
                      Plan new Scano work, track scanner progress, and review tasks waiting for final completion.
                    </Typography>
                  </Box>

                  {canManageScanoTasks ? (
                    <Button
                      variant="contained"
                      startIcon={<AddRoundedIcon />}
                      onClick={() => void openCreateWizard()}
                      sx={{
                        borderRadius: 999,
                        px: 2.4,
                        py: 1.1,
                        boxShadow: "0 16px 34px rgba(37,99,235,0.22)",
                      }}
                    >
                      Add New Task
                    </Button>
                  ) : null}
                </Stack>

                <Stack direction={{ xs: "column", md: "row" }} spacing={1.2} alignItems={{ xs: "stretch", md: "center" }}>
                  <ScanoDateRangeField
                    startDate={fromFilter}
                    endDate={toFilter}
                    onChange={({ startDate, endDate }) => {
                      setFromFilter(startDate);
                      setToFilter(endDate);
                    }}
                  />
                  <TextField
                    label="Search"
                    value={searchFilter}
                    onChange={(event) => setSearchFilter(event.target.value)}
                    placeholder="Chain, branch, or scanner"
                    InputProps={{
                      endAdornment: <SearchRoundedIcon fontSize="small" />,
                    }}
                    sx={{ minWidth: { xs: "100%", md: 240 } }}
                  />
                  <TextField
                    select
                    label="Status"
                    value={statusFilter}
                    onChange={(event) => setStatusFilter(event.target.value as ScanoTaskFilterStatus)}
                    sx={{ minWidth: { xs: "100%", md: 170 } }}
                  >
                    <MenuItem value="all">All statuses</MenuItem>
                    <MenuItem value="pending">Pending</MenuItem>
                    <MenuItem value="in_progress">In Progress</MenuItem>
                    <MenuItem value="awaiting_review">Awaiting Review</MenuItem>
                    <MenuItem value="completed">Completed</MenuItem>
                  </TextField>
                  <TextField
                    select
                    label="Sort"
                    value={sortKey}
                    onChange={(event) => setSortKey(event.target.value as SortKey)}
                    sx={{ minWidth: { xs: "100%", md: 170 } }}
                  >
                    <MenuItem value="scheduled_asc">Scheduled earliest</MenuItem>
                    <MenuItem value="scheduled_desc">Scheduled latest</MenuItem>
                    <MenuItem value="chain_asc">Chain A-Z</MenuItem>
                    <MenuItem value="branch_asc">Branch A-Z</MenuItem>
                  </TextField>
                  <Button
                    variant="text"
                    onClick={() => {
                      setFromFilter("");
                      setToFilter("");
                      setSearchFilter("");
                      setStatusFilter("all");
                      setSortKey("scheduled_asc");
                    }}
                    sx={{ alignSelf: { xs: "stretch", md: "center" }, minWidth: { md: 120 } }}
                  >
                    Clear
                  </Button>
                </Stack>
              </Stack>
            </CardContent>
          </Card>
          {pageError ? (
            <Alert severity="error" variant="outlined">
              {pageError}
            </Alert>
          ) : null}

          <Card
            sx={{
              borderRadius: 4,
              border: "1px solid rgba(148,163,184,0.14)",
              bgcolor: "rgba(255,255,255,0.92)",
            }}
          >
            <CardContent sx={{ p: 0 }}>
              <Box sx={{ px: { xs: 2, md: 2.5 }, py: 1.6, borderBottom: "1px solid rgba(148,163,184,0.12)" }}>
                <Stack direction={{ xs: "column", sm: "row" }} spacing={1} justifyContent="space-between" alignItems={{ xs: "flex-start", sm: "center" }}>
                  <Typography variant="h6" sx={{ fontWeight: 900 }}>
                    Scano Tasks
                  </Typography>
                  <Chip
                    size="small"
                    label={`${visibleTasks.length} task${visibleTasks.length === 1 ? "" : "s"}`}
                    sx={{ fontWeight: 900, bgcolor: "rgba(15,23,42,0.06)", color: "#0f172a" }}
                  />
                </Stack>
              </Box>

              {tasksLoading ? (
                <Stack spacing={1} alignItems="center" justifyContent="center" sx={{ minHeight: 220 }}>
                  <CircularProgress size={28} />
                  <Typography variant="body2" sx={{ color: "text.secondary" }}>
                    Loading Scano tasks...
                  </Typography>
                </Stack>
              ) : visibleTasks.length ? (
                <>
                  <Stack spacing={1.15} sx={{ display: { xs: "flex", md: "none" }, p: 1.5 }}>
                    {visibleTasks.map((task) => {
                      const statusMeta = getScanoTaskStatusMeta(task.status);
                      const counters = withScanoCounters(task.counters);

                      return (
                        <Card key={task.id} variant="outlined" sx={{ borderRadius: 3 }}>
                          <CardContent sx={{ p: 1.6 }}>
                            <Stack spacing={1.2}>
                              <Stack direction="row" justifyContent="space-between" alignItems="flex-start" spacing={1}>
                                <Box>
                                  <Typography sx={{ fontWeight: 900 }}>{task.chainName}</Typography>
                                  <Typography variant="body2" sx={{ color: "text.secondary" }}>
                                    {task.branchName}
                                  </Typography>
                                </Box>
                                <Chip size="small" label={statusMeta.label} sx={{ fontWeight: 800, ...statusMeta.sx }} />
                              </Stack>

                              <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                                <Chip size="small" label={`Started ${task.progress.startedCount}/${task.progress.totalCount}`} />
                                <Chip size="small" label={`Ended ${task.progress.endedCount}/${task.progress.totalCount}`} />
                                <Chip size="small" label={`Products ${counters.scannedProductsCount}`} />
                              </Stack>

                              <ScanoAssigneeChips names={task.assignees.map((assignee) => assignee.name)} compact />

                              <Typography variant="body2" sx={{ color: "text.secondary" }}>
                                {formatCairoDateTime(task.scheduledAt)}
                              </Typography>

                              <Stack direction="row" spacing={1}>
                                <Button
                                  size="small"
                                  variant="outlined"
                                  startIcon={<OpenInNewRoundedIcon />}
                                  onClick={() => navigate(`/scano/tasks/${task.id}`)}
                                >
                                  Open
                                </Button>
                                {task.permissions.canEdit ? (
                                  <Button size="small" startIcon={<EditRoundedIcon />} onClick={() => void openEditWizard(task)}>
                                    Edit
                                  </Button>
                                ) : null}
                                {canManageScanoTasks ? (
                                  <Button size="small" color="error" startIcon={<DeleteOutlineRoundedIcon />} onClick={() => setTaskPendingDelete(task)}>
                                    Delete
                                  </Button>
                                ) : null}
                                {task.permissions.canComplete ? (
                                  <Button size="small" color="success" variant="contained" startIcon={<TaskAltRoundedIcon />} onClick={() => navigate(`/scano/tasks/${task.id}`)}>
                                    Review
                                  </Button>
                                ) : null}
                                {(task.permissions.canDownloadReviewPackage || task.latestExport?.canDownload) ? (
                                  <Button size="small" startIcon={<DownloadRoundedIcon />} onClick={() => void handleDownloadReviewPackage(task)}>
                                    Export
                                  </Button>
                                ) : null}
                              </Stack>
                            </Stack>
                          </CardContent>
                        </Card>
                      );
                    })}
                  </Stack>

                  <TableContainer sx={{ display: { xs: "none", md: "block" } }}>
                    <Table sx={{ minWidth: 980 }}>
                      <TableHead>
                        <TableRow>
                          <TableCell>Status</TableCell>
                          <TableCell>Chain</TableCell>
                          <TableCell>Branch</TableCell>
                          <TableCell>Assigned To</TableCell>
                          <TableCell>Progress</TableCell>
                          <TableCell>Scheduled At</TableCell>
                          <TableCell align="right">Actions</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {visibleTasks.map((task) => {
                          const statusMeta = getScanoTaskStatusMeta(task.status);
                          const counters = withScanoCounters(task.counters);

                          return (
                            <TableRow key={task.id} hover>
                              <TableCell sx={{ width: 170 }}>
                                <Chip size="small" label={statusMeta.label} sx={{ fontWeight: 800, ...statusMeta.sx }} />
                              </TableCell>
                              <TableCell sx={{ fontWeight: 800 }}>{task.chainName}</TableCell>
                              <TableCell>{task.branchName}</TableCell>
                              <TableCell sx={{ minWidth: 240 }}>
                                <ScanoAssigneeChips names={task.assignees.map((assignee) => assignee.name)} compact />
                              </TableCell>
                              <TableCell sx={{ minWidth: 170 }}>
                                <Stack spacing={0.5}>
                                  <Typography variant="body2" sx={{ fontWeight: 700 }}>
                                    Started {task.progress.startedCount}/{task.progress.totalCount}
                                  </Typography>
                                  <Typography variant="body2" sx={{ color: "text.secondary" }}>
                                    Ended {task.progress.endedCount}/{task.progress.totalCount}
                                  </Typography>
                                  <Typography variant="caption" sx={{ color: "text.secondary" }}>
                                    Products {counters.scannedProductsCount}
                                  </Typography>
                                </Stack>
                              </TableCell>
                              <TableCell>{formatCairoDateTime(task.scheduledAt)}</TableCell>
                              <TableCell align="right" sx={{ minWidth: 240 }}>
                                <Stack direction="row" spacing={1} justifyContent="flex-end">
                                  <Button
                                    size="small"
                                    variant="outlined"
                                    startIcon={<OpenInNewRoundedIcon />}
                                    onClick={() => navigate(`/scano/tasks/${task.id}`)}
                                  >
                                    Open
                                  </Button>
                                  {task.permissions.canEdit ? (
                                    <Button size="small" startIcon={<EditRoundedIcon />} onClick={() => void openEditWizard(task)}>
                                      Edit
                                    </Button>
                                  ) : null}
                                  {canManageScanoTasks ? (
                                    <Button size="small" color="error" startIcon={<DeleteOutlineRoundedIcon />} onClick={() => setTaskPendingDelete(task)}>
                                      Delete
                                    </Button>
                                  ) : null}
                                  {task.permissions.canComplete ? (
                                    <Button
                                      size="small"
                                      variant="contained"
                                      color="success"
                                      startIcon={<TaskAltRoundedIcon />}
                                      onClick={() => navigate(`/scano/tasks/${task.id}`)}
                                    >
                                      Review
                                    </Button>
                                  ) : null}
                                  {(task.permissions.canDownloadReviewPackage || task.latestExport?.canDownload) ? (
                                    <Button size="small" startIcon={<DownloadRoundedIcon />} onClick={() => void handleDownloadReviewPackage(task)}>
                                      Export
                                    </Button>
                                  ) : null}
                                </Stack>
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </TableContainer>
                </>
              ) : (
                <Stack spacing={1} alignItems="center" justifyContent="center" sx={{ minHeight: 220, px: 2.5, textAlign: "center" }}>
                  <Typography variant="h6" sx={{ fontWeight: 900 }}>
                    No tasks found
                  </Typography>
                  <Typography variant="body2" sx={{ color: "text.secondary", maxWidth: 460 }}>
                    Adjust the date range, filters, or create the first Scano task to start the workflow.
                  </Typography>
                </Stack>
              )}
            </CardContent>
          </Card>
        </Stack>
      </Container>

      <Dialog
        open={wizardOpen}
        onClose={() => {
          if (!savingTask) closeWizard();
        }}
        fullWidth
        maxWidth="md"
      >
        <DialogTitle>{wizardMode === "edit" ? "Edit Task" : "Add New Task"}</DialogTitle>
        <DialogContent dividers>
          <Stack spacing={2.2}>
            <Stepper activeStep={activeStep} alternativeLabel sx={{ pt: 0.6 }}>
              {WIZARD_STEPS.map((label) => (
                <Step key={label}>
                  <StepLabel>{label}</StepLabel>
                </Step>
              ))}
            </Stepper>

            {activeStep === 0 ? (
              <Stack spacing={1.5}>
                <TextField
                  label="Search Chains"
                  value={chainSearch}
                  onChange={(event) => setChainSearch(event.target.value)}
                  placeholder="Type a chain name"
                  InputProps={{
                    endAdornment: chainLoading ? <CircularProgress size={18} /> : <SearchRoundedIcon fontSize="small" />,
                  }}
                  fullWidth
                />

                {selectedChain ? (
                  <Chip
                    label={`Selected chain: ${selectedChain.name}`}
                    sx={{ alignSelf: "flex-start", fontWeight: 800, bgcolor: "rgba(37,99,235,0.10)", color: "#1d4ed8" }}
                  />
                ) : null}

                {chainError ? <Alert severity="error" variant="outlined">{chainError}</Alert> : null}

                <Stack spacing={1}>
                  {chainSearch.trim() ? (
                    chainOptions.length ? (
                      chainOptions.map((chain) => {
                        const isSelected = selectedChain?.id === chain.id;
                        return (
                          <Button
                            key={chain.id}
                            fullWidth
                            variant={isSelected ? "contained" : "outlined"}
                            color={isSelected ? "primary" : "inherit"}
                            onClick={() => {
                              setSelectedChain(chain);
                              setSelectedBranch(null);
                              setBranchOptions([]);
                              setBranchSearch("");
                              setBranchError("");
                            }}
                            sx={{ justifyContent: "space-between", py: 1.2, px: 1.5 }}
                          >
                            <Stack alignItems="flex-start" spacing={0.2}>
                              <Typography sx={{ fontWeight: 800 }}>{chain.name}</Typography>
                              <Typography variant="caption" sx={{ color: "inherit", opacity: 0.82 }}>
                                {chain.type || "Chain"}
                              </Typography>
                            </Stack>
                            <Chip
                              size="small"
                              label={chain.active ? "Active" : "Inactive"}
                              sx={{
                                fontWeight: 800,
                                bgcolor: isSelected ? "rgba(255,255,255,0.24)" : chain.active ? "rgba(236,253,245,0.92)" : "rgba(241,245,249,0.96)",
                                color: isSelected ? "#fff" : chain.active ? "#166534" : "#475569",
                              }}
                            />
                          </Button>
                        );
                      })
                    ) : (
                      <Alert severity="info" variant="outlined">
                        No chains matched this search.
                      </Alert>
                    )
                  ) : (
                    <Alert severity="info" variant="outlined">
                      Type a chain name to search the Scano catalog.
                    </Alert>
                  )}
                </Stack>
              </Stack>
            ) : null}

            {activeStep === 1 ? (
              <Stack spacing={1.5}>
                {selectedChain ? (
                  <Chip
                    label={`Chain: ${selectedChain.name}`}
                    sx={{ alignSelf: "flex-start", fontWeight: 800, bgcolor: "rgba(37,99,235,0.10)", color: "#1d4ed8" }}
                  />
                ) : (
                  <Alert severity="warning" variant="outlined">
                    Select a chain first.
                  </Alert>
                )}

                <TextField
                  label="Search Branches"
                  value={branchSearch}
                  onChange={(event) => setBranchSearch(event.target.value)}
                  placeholder="Optional branch search"
                  disabled={!selectedChain}
                  InputProps={{
                    endAdornment: branchLoading ? <CircularProgress size={18} /> : <SearchRoundedIcon fontSize="small" />,
                  }}
                  fullWidth
                />

                {selectedBranch ? (
                  <Chip
                    label={`Selected branch: ${selectedBranch.name}`}
                    sx={{ alignSelf: "flex-start", fontWeight: 800, bgcolor: "rgba(14,165,233,0.10)", color: "#0369a1" }}
                  />
                ) : null}

                {branchError ? <Alert severity="error" variant="outlined">{branchError}</Alert> : null}

                <Stack spacing={1}>
                  {selectedChain ? (
                    branchOptions.length ? (
                      branchOptions.map((branch) => {
                        const isSelected = selectedBranch?.id === branch.id;
                        return (
                          <Button
                            key={branch.id}
                            fullWidth
                            variant={isSelected ? "contained" : "outlined"}
                            color={isSelected ? "primary" : "inherit"}
                            onClick={() => setSelectedBranch(branch)}
                            sx={{ justifyContent: "flex-start", py: 1.2, px: 1.5, textAlign: "left" }}
                          >
                            <Stack alignItems="flex-start" spacing={0.2}>
                              <Typography sx={{ fontWeight: 800 }}>{branch.name}</Typography>
                              <Typography variant="caption" sx={{ color: "inherit", opacity: 0.82 }}>
                                {branch.chainName}
                              </Typography>
                            </Stack>
                          </Button>
                        );
                      })
                    ) : (
                      <Alert severity="info" variant="outlined">
                        No branches matched this chain search.
                      </Alert>
                    )
                  ) : null}
                </Stack>
              </Stack>
            ) : null}

            {activeStep === 2 ? (
              <Stack spacing={1.8}>
                <TextField
                  label="Scheduled At"
                  type="datetime-local"
                  value={scheduledAtInput}
                  onChange={(event) => setScheduledAtInput(event.target.value)}
                  InputLabelProps={{ shrink: true }}
                  helperText="Stored as Cairo time and saved as ISO."
                  fullWidth
                />

                {scheduledAtInput && !scheduledAtIso ? (
                  <Alert severity="error" variant="outlined">
                    Enter a valid Cairo date and time.
                  </Alert>
                ) : null}

                <Divider />

                <Box>
                  <Typography variant="subtitle1" sx={{ fontWeight: 900, mb: 1 }}>
                    Assign Scanners
                  </Typography>
                  {teamLoading ? (
                    <Stack direction="row" spacing={1} alignItems="center">
                      <CircularProgress size={18} />
                      <Typography variant="body2" sx={{ color: "text.secondary" }}>
                        Loading Scano team...
                      </Typography>
                    </Stack>
                  ) : assignableTeamMembers.length ? (
                    <Stack spacing={0.8}>
                      {assignableTeamMembers.map((member) => (
                        <FormControlLabel
                          key={member.id}
                          control={(
                            <Checkbox
                              checked={selectedAssigneeIds.includes(member.id)}
                              onChange={() => toggleAssigneeSelection(member.id)}
                            />
                          )}
                          label={`${member.name} (${member.linkedUserEmail})`}
                        />
                      ))}
                    </Stack>
                  ) : (
                    <Alert severity="warning" variant="outlined">
                      Grant at least one active scanner access before creating tasks.
                    </Alert>
                  )}
                </Box>
              </Stack>
            ) : null}

            {activeStep === 3 ? (
              <Stack spacing={1.5}>
                <Card variant="outlined">
                  <CardContent sx={{ display: "flex", flexDirection: "column", gap: 1.2 }}>
                    <Typography variant="subtitle1" sx={{ fontWeight: 900 }}>
                      Review Task
                    </Typography>
                    <Typography><strong>Chain:</strong> {selectedChain?.name ?? "--"}</Typography>
                    <Typography><strong>Branch:</strong> {selectedBranch?.name ?? "--"}</Typography>
                    <Typography><strong>Assigned To:</strong> {selectedAssignees.map((member) => member.name).join(", ") || "--"}</Typography>
                    <Typography><strong>Scheduled At:</strong> {scheduledAtIso ? formatCairoDateTime(scheduledAtIso) : "--"}</Typography>
                  </CardContent>
                </Card>
              </Stack>
            ) : null}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={closeWizard} disabled={savingTask}>Cancel</Button>
          <Button onClick={() => setActiveStep((current) => Math.max(0, current - 1))} disabled={activeStep === 0 || savingTask}>
            Back
          </Button>
          {activeStep < WIZARD_STEPS.length - 1 ? (
            <Button variant="contained" onClick={() => setActiveStep((current) => current + 1)} disabled={!canMoveNext || savingTask}>
              Next
            </Button>
          ) : (
            <Button
              variant="contained"
              onClick={() => void handleSaveTask()}
              disabled={savingTask || !selectedChain || !selectedBranch || !scheduledAtIso || !selectedAssigneeIds.length}
              startIcon={savingTask ? <CircularProgress size={16} color="inherit" /> : undefined}
            >
              {wizardMode === "edit" ? "Update Task" : "Create Task"}
            </Button>
          )}
        </DialogActions>
      </Dialog>

      <Dialog open={!!taskPendingDelete} onClose={() => (savingTask ? undefined : setTaskPendingDelete(null))} fullWidth maxWidth="xs">
        <DialogTitle>Delete Task</DialogTitle>
        <DialogContent dividers>
          <Stack spacing={1}>
            <Typography sx={{ color: "#0f172a", fontWeight: 700 }}>
              {taskPendingDelete?.chainName} · {taskPendingDelete?.branchName}
            </Typography>
            <Typography variant="body2" sx={{ color: "text.secondary", lineHeight: 1.8 }}>
              This will permanently delete the task, confirmed products, scans, review exports, and local scanner images.
            </Typography>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setTaskPendingDelete(null)} disabled={savingTask}>Cancel</Button>
          <Button
            variant="contained"
            color="error"
            startIcon={savingTask ? <CircularProgress size={16} color="inherit" /> : <DeleteOutlineRoundedIcon />}
            onClick={() => void handleDeleteTask()}
            disabled={savingTask}
          >
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
            boxShadow: "0 18px 40px rgba(15,23,42,0.16)",
          }}
        >
          {toast.msg}
        </Alert>
      ) : null}
    </Box>
  );
}
