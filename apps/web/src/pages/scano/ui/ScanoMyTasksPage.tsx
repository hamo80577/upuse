import PlayArrowRoundedIcon from "@mui/icons-material/PlayArrowRounded";
import RestartAltRoundedIcon from "@mui/icons-material/RestartAltRounded";
import SearchRoundedIcon from "@mui/icons-material/SearchRounded";
import VisibilityRoundedIcon from "@mui/icons-material/VisibilityRounded";
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Container,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, describeApiError } from "../../../api/client";
import type { ScanoTaskId, ScanoTaskListItem, ScanoTaskStatus } from "../../../api/types";
import { TopBar } from "../../../widgets/top-bar/ui/TopBar";
import { ScanoAssigneeChips } from "./ScanoAssigneeChips";
import { ScanoDateRangeField } from "./ScanoDateRangeField";
import {
  formatCairoDateTime,
  getScanoTaskStatusMeta,
  sortTaskItems,
  toCairoRangeEndIso,
  toCairoRangeStartIso,
  upsertTaskItem,
  withScanoCounters,
} from "./scanoShared";

type ToastState = { type: "success" | "error"; msg: string } | null;
type StatusFilter = "all" | ScanoTaskStatus;

export function ScanoMyTasksPage() {
  const navigate = useNavigate();
  const [tasks, setTasks] = useState<ScanoTaskListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [pageError, setPageError] = useState("");
  const [toast, setToast] = useState<ToastState>(null);
  const [fromFilter, setFromFilter] = useState("");
  const [toFilter, setToFilter] = useState("");
  const [searchFilter, setSearchFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [actionTaskId, setActionTaskId] = useState<ScanoTaskId | null>(null);

  const visibleTasks = useMemo(() => {
    const normalizedSearch = searchFilter.trim().toLowerCase();
    return tasks.filter((task) => {
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
  }, [searchFilter, statusFilter, tasks]);

  const loadTasks = useCallback(async (signal?: AbortSignal) => {
    const fromIso = fromFilter ? (toCairoRangeStartIso(fromFilter) ?? undefined) : undefined;
    const toIso = toFilter ? (toCairoRangeEndIso(toFilter) ?? undefined) : undefined;

    try {
      setLoading(true);
      setPageError("");
      const response = await api.listScanoTasks({ from: fromIso, to: toIso, signal });
      if (signal?.aborted) return;
      setTasks(sortTaskItems(response.items));
    } catch (error) {
      if (signal?.aborted) return;
      setPageError(describeApiError(error, "Failed to load your Scano tasks"));
    } finally {
      if (!signal?.aborted) {
        setLoading(false);
      }
    }
  }, [fromFilter, toFilter]);

  useEffect(() => {
    const controller = new AbortController();
    void loadTasks(controller.signal);
    return () => controller.abort();
  }, [loadTasks]);

  async function handleStart(task: ScanoTaskListItem) {
    try {
      setActionTaskId(task.id);
      const response = await api.startScanoTask(task.id);
      setTasks((current) => upsertTaskItem(current, response.item));
      navigate(`/scano/tasks/${task.id}/run`);
    } catch (error) {
      setToast({ type: "error", msg: describeApiError(error, "Failed to start task") });
    } finally {
      setActionTaskId(null);
    }
  }

  async function handleResume(task: ScanoTaskListItem) {
    try {
      setActionTaskId(task.id);
      const response = await api.resumeScanoTask(task.id);
      setTasks((current) => upsertTaskItem(current, response.item));
      navigate(`/scano/tasks/${task.id}/run`);
    } catch (error) {
      setToast({ type: "error", msg: describeApiError(error, "Failed to resume task") });
    } finally {
      setActionTaskId(null);
    }
  }

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

      <Container maxWidth="sm" sx={{ py: { xs: 2, md: 3 } }}>
        <Stack spacing={2}>
          <Card
            sx={{
              borderRadius: 4,
              bgcolor: "rgba(255,255,255,0.82)",
              border: "1px solid rgba(148,163,184,0.16)",
              boxShadow: "0 20px 56px rgba(15,23,42,0.08)",
            }}
          >
            <CardContent sx={{ p: 2 }}>
              <Stack spacing={1.5}>
                <Box>
                  <Typography variant="h4" sx={{ fontWeight: 950, letterSpacing: "-0.04em" }}>
                    My Tasks
                  </Typography>
                  <Typography variant="body2" sx={{ color: "#64748b", mt: 0.5 }}>
                    Start, continue, or review the tasks assigned to you without leaving the mobile workflow.
                  </Typography>
                </Box>

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
                  placeholder="Chain or branch"
                  InputProps={{ endAdornment: <SearchRoundedIcon fontSize="small" /> }}
                  fullWidth
                />

                <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                  {(["all", "pending", "in_progress", "awaiting_review", "completed"] as const).map((value) => (
                    <Chip
                      key={value}
                      label={value === "all" ? "All" : value.replace("_", " ")}
                      clickable
                      color={statusFilter === value ? "primary" : "default"}
                      onClick={() => setStatusFilter(value)}
                    />
                  ))}
                </Stack>
              </Stack>
            </CardContent>
          </Card>

          {pageError ? (
            <Alert severity="error" variant="outlined">
              {pageError}
            </Alert>
          ) : null}

          {loading ? (
            <Card sx={{ borderRadius: 4 }}>
              <CardContent sx={{ minHeight: 200, display: "grid", placeItems: "center" }}>
                <Stack spacing={1} alignItems="center">
                  <CircularProgress size={28} />
                  <Typography variant="body2" sx={{ color: "text.secondary" }}>
                    Loading your tasks...
                  </Typography>
                </Stack>
              </CardContent>
            </Card>
          ) : visibleTasks.length ? (
            <Stack spacing={1.2}>
              {visibleTasks.map((task) => {
                const statusMeta = getScanoTaskStatusMeta(task.status);
                const busy = actionTaskId === task.id;
                const counters = withScanoCounters(task.counters);

                return (
                  <Card
                    key={task.id}
                    sx={{
                      borderRadius: 4,
                      border: "1px solid rgba(148,163,184,0.16)",
                      bgcolor: "rgba(255,255,255,0.9)",
                    }}
                  >
                    <CardContent sx={{ p: 1.8 }}>
                      <Stack spacing={1.35}>
                        <Stack direction="row" justifyContent="space-between" alignItems="flex-start" spacing={1}>
                          <Box>
                            <Typography sx={{ fontWeight: 900 }}>{task.chainName}</Typography>
                            <Typography variant="body2" sx={{ color: "text.secondary" }}>
                              {task.branchName}
                            </Typography>
                          </Box>
                          <Chip size="small" label={statusMeta.label} sx={{ fontWeight: 800, ...statusMeta.sx }} />
                        </Stack>

                        <ScanoAssigneeChips names={task.assignees.map((assignee) => assignee.name)} compact />

                        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                          <Chip size="small" label={`Started ${task.progress.startedCount}/${task.progress.totalCount}`} />
                          <Chip size="small" label={`Ended ${task.progress.endedCount}/${task.progress.totalCount}`} />
                          <Chip size="small" label={`Products ${counters.scannedProductsCount}`} />
                        </Stack>

                        <Typography variant="body2" sx={{ color: "text.secondary" }}>
                          {formatCairoDateTime(task.scheduledAt)}
                        </Typography>

                        <Stack spacing={1}>
                          {task.permissions.canStart ? (
                            <Button
                              variant="contained"
                              color="success"
                              startIcon={busy ? <CircularProgress size={16} color="inherit" /> : <PlayArrowRoundedIcon />}
                              onClick={() => void handleStart(task)}
                              disabled={busy}
                              fullWidth
                            >
                              Start
                            </Button>
                          ) : null}

                          {task.viewerState.canEnter && task.viewerState.hasStarted && !task.viewerState.hasEnded ? (
                            <Button
                              variant="contained"
                              onClick={() => navigate(`/scano/tasks/${task.id}/run`)}
                              fullWidth
                            >
                              Continue
                            </Button>
                          ) : null}

                          {task.viewerState.canResume ? (
                            <Button
                              variant="outlined"
                              startIcon={busy ? <CircularProgress size={16} color="inherit" /> : <RestartAltRoundedIcon />}
                              onClick={() => void handleResume(task)}
                              disabled={busy}
                              fullWidth
                            >
                              Resume
                            </Button>
                          ) : null}

                          {!task.permissions.canStart && !task.viewerState.canEnter && !task.viewerState.canResume ? (
                            <Button variant="outlined" disabled fullWidth>
                              {task.status === "completed" ? "Completed" : "Waiting For Review"}
                            </Button>
                          ) : null}

                          <Button
                            variant="text"
                            startIcon={<VisibilityRoundedIcon />}
                            onClick={() => navigate(`/scano/tasks/${task.id}`)}
                            fullWidth
                          >
                            View Details
                          </Button>
                        </Stack>
                      </Stack>
                    </CardContent>
                  </Card>
                );
              })}
            </Stack>
          ) : (
            <Card sx={{ borderRadius: 4 }}>
              <CardContent sx={{ minHeight: 180, display: "grid", placeItems: "center", textAlign: "center" }}>
                <Stack spacing={1}>
                  <Typography variant="h6" sx={{ fontWeight: 900 }}>
                    No assigned tasks
                  </Typography>
                  <Typography variant="body2" sx={{ color: "text.secondary" }}>
                    Try a different date range or wait until new work is assigned.
                  </Typography>
                </Stack>
              </CardContent>
            </Card>
          )}
        </Stack>
      </Container>

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
