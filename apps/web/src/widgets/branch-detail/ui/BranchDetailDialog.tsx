import CloseIcon from "@mui/icons-material/Close";
import RefreshRoundedIcon from "@mui/icons-material/RefreshRounded";
import { Alert, Box, CircularProgress, Dialog, DialogContent, DialogTitle, Grid, IconButton, LinearProgress, Skeleton, Stack, Switch, Tooltip, Typography } from "@mui/material";
import { useEffect, useState } from "react";
import type { BranchDetailResult, BranchSnapshot } from "../../../api/types";
import { api, describeApiError } from "../../../api/client";
import { useAuth } from "../../../app/providers/AuthProvider";
import { useBranchDetailState } from "../../../features/branches/useBranchDetailState";
import { BranchLogPanel } from "./BranchLogPanel";
import { BranchOrdersSection } from "./BranchOrdersSection";
import { BranchStatusPanel } from "./BranchStatusPanel";
import { BranchSummaryStats } from "./BranchSummaryStats";
import { fmtPlacedAt } from "../lib/time";
import { resolveDisplayedBranch } from "../lib/resolveDisplayedBranch";

function nonFatalDetailNotice(detail: BranchDetailResult | null) {
  if (!detail || detail.kind === "ok" || detail.kind === "branch_not_found") return null;
  return {
    severity: detail.kind === "detail_fetch_failed" ? "warning" : "info",
    message: detail.message,
  } as const;
}

export function BranchDetailDialog(props: {
  branchId: number | null;
  branchSnapshot?: BranchSnapshot | null;
  open: boolean;
  onClose: () => void;
}) {
  const { canManage, canManageBranches } = useAuth();
  const {
    detail,
    loading,
    refreshing,
    error,
    logDays,
    logLoading,
    logLoadingMore,
    hasMoreLogs,
    logError,
    clearingLog,
    nowMs,
    refreshDetail,
    loadMoreLogs,
    clearLog,
  } = useBranchDetailState({
    branchId: props.branchId,
    branchSnapshot: props.branchSnapshot,
    open: props.open,
  });
  const [togglingMonitoring, setTogglingMonitoring] = useState(false);
  const [monitorToggleError, setMonitorToggleError] = useState<string | null>(null);

  const branch = resolveDisplayedBranch(detail, props.branchSnapshot);
  const monitorEnabled = branch?.monitorEnabled ?? false;
  const detailNotFound = detail?.kind === "branch_not_found";
  const detailWithBranch = detail && detail.kind !== "branch_not_found" ? detail : null;
  const queueTotals = detailWithBranch
    ? {
        activeNow: detailWithBranch.unassignedOrders.length + detailWithBranch.preparingOrders.length,
        lateNow: [...detailWithBranch.unassignedOrders, ...detailWithBranch.preparingOrders].reduce(
          (sum, item) => sum + (item.isLate ? 1 : 0),
          0,
        ),
        unassignedNow: detailWithBranch.unassignedOrders.length,
      }
    : null;
  const liveTotals = {
    totalToday: branch?.metrics.totalToday ?? detailWithBranch?.totals.totalToday ?? 0,
    cancelledToday: branch?.metrics.cancelledToday ?? detailWithBranch?.totals.cancelledToday ?? 0,
    doneToday: branch?.metrics.doneToday ?? detailWithBranch?.totals.doneToday ?? 0,
    activeNow: queueTotals?.activeNow ?? branch?.metrics.activeNow ?? detailWithBranch?.totals.activeNow ?? 0,
    lateNow: queueTotals?.lateNow ?? branch?.metrics.lateNow ?? detailWithBranch?.totals.lateNow ?? 0,
    unassignedNow: queueTotals?.unassignedNow ?? branch?.metrics.unassignedNow ?? detailWithBranch?.totals.unassignedNow ?? 0,
  };
  const detailNotice = nonFatalDetailNotice(detail);
  const unavailableOrdersText = detail?.kind === "snapshot_unavailable"
    ? detail.fetchedAt
      ? "No orders in this queue from the latest Orders API response."
      : "Orders detail is unavailable while the live snapshot is missing."
    : detail?.kind === "detail_fetch_failed"
      ? "Orders detail is temporarily unavailable. Showing the latest monitor snapshot."
      : "No active orders right now.";

  useEffect(() => {
    if (!props.open) {
      setMonitorToggleError(null);
      setTogglingMonitoring(false);
    }
  }, [props.open]);

  useEffect(() => {
    setMonitorToggleError(null);
  }, [branch?.branchId, branch?.monitorEnabled]);

  const toggleMonitoring = async (nextEnabled: boolean) => {
    if (!branch || !canManageBranches || togglingMonitoring) return;

    try {
      setTogglingMonitoring(true);
      setMonitorToggleError(null);
      await api.setBranchMonitoring(branch.branchId, nextEnabled);
      refreshDetail();
    } catch (toggleError) {
      setMonitorToggleError(describeApiError(toggleError, "Failed to update monitor state"));
    } finally {
      setTogglingMonitoring(false);
    }
  };

  return (
    <Dialog open={props.open} onClose={props.onClose} fullWidth maxWidth="lg">
      <DialogTitle sx={{ pb: 1.5 }}>
        <Stack direction="row" alignItems="flex-start" justifyContent="space-between" gap={2}>
          <Box sx={{ minWidth: 0 }}>
            <Typography sx={{ fontWeight: 900, lineHeight: 1.2 }}>
              {detailNotFound ? "Branch detail unavailable" : branch?.name ?? "Branch detail"}
            </Typography>
            <Typography variant="caption" sx={{ color: "text.secondary" }}>
              {detailNotFound ? "This branch mapping no longer exists." : `Orders since start of day and live active queues${refreshing ? " • refreshing..." : ""}`}
            </Typography>
          </Box>
          <Stack direction="row" spacing={0.5}>
            <Tooltip title="Refresh detail">
              <span>
                <IconButton
                  onClick={refreshDetail}
                  disabled={!props.branchId || loading || refreshing}
                  aria-label="Refresh detail"
                >
                  <RefreshRoundedIcon />
                </IconButton>
              </span>
            </Tooltip>
            <IconButton onClick={props.onClose} aria-label="Close detail">
              <CloseIcon />
            </IconButton>
          </Stack>
        </Stack>
      </DialogTitle>

      <DialogContent dividers sx={{ p: { xs: 1.5, md: 2 } }}>
        {loading ? (
          <Stack spacing={1.5} sx={{ minHeight: 280 }}>
            <Box
              sx={{
                display: "grid",
                gap: 1,
                gridTemplateColumns: { xs: "repeat(2, minmax(0, 1fr))", md: "repeat(6, minmax(0, 1fr))" },
              }}
            >
              {Array.from({ length: 6 }).map((_, index) => (
                <Skeleton key={index} variant="rounded" animation="wave" height={70} />
              ))}
            </Box>
            <Skeleton variant="rounded" animation="wave" height={180} />
            <Skeleton variant="rounded" animation="wave" height={180} />
            <Stack alignItems="center" justifyContent="center" sx={{ py: 1 }}>
              <CircularProgress size={24} />
            </Stack>
          </Stack>
        ) : detailNotFound ? (
          <Alert severity="error" variant="outlined">
            {detail?.message ?? "Branch not found"}
          </Alert>
        ) : detailWithBranch && branch ? (
          <Stack spacing={1.5}>
            <Box sx={{ minHeight: 6, borderRadius: 999, overflow: "hidden" }}>
              {refreshing ? (
                <LinearProgress
                  sx={{
                    height: 5,
                    borderRadius: 999,
                    bgcolor: "rgba(148,163,184,0.16)",
                    "& .MuiLinearProgress-bar": {
                      borderRadius: 999,
                      background: "linear-gradient(90deg, #2563eb 0%, #22c55e 100%)",
                    },
                  }}
                />
              ) : (
                <Box sx={{ height: 5, borderRadius: 999, bgcolor: "rgba(148,163,184,0.08)" }} />
              )}
            </Box>
            {detailNotice ? (
              <Alert severity={detailNotice.severity} variant="outlined">
                {detailNotice.message}
              </Alert>
            ) : null}
            {error ? <Alert severity="warning" variant="outlined">{error}</Alert> : null}
            {monitorToggleError ? <Alert severity="error" variant="outlined">{monitorToggleError}</Alert> : null}
            <Grid container spacing={2}>
              <Grid item xs={12} md={8}>
                <Stack spacing={2}>
                  <BranchSummaryStats totals={liveTotals} thresholds={branch.thresholds} />

                  <Stack spacing={1.5}>
                    <BranchOrdersSection
                      title="Unassigned Orders"
                      subtitle="Current unassigned orders in this branch"
                      items={detailWithBranch.unassignedOrders}
                      emptyText={detailWithBranch.unassignedOrders.length ? "No unassigned orders right now." : unavailableOrdersText}
                      nowMs={nowMs}
                    />
                    <BranchOrdersSection
                      title="In Preparation"
                      subtitle="Assigned and in-progress orders, including late ones"
                      items={detailWithBranch.preparingOrders}
                      emptyText={detailWithBranch.preparingOrders.length ? "No active preparation orders right now." : unavailableOrdersText}
                      nowMs={nowMs}
                    />
                  </Stack>
                </Stack>
              </Grid>

              <Grid item xs={12} md={4}>
                <Stack spacing={2}>
                  <Box
                    sx={{
                      p: 1.35,
                      borderRadius: 3,
                      border: "1px solid rgba(99,102,241,0.14)",
                      bgcolor: monitorEnabled ? "rgba(248,250,252,0.78)" : "rgba(238,242,255,0.82)",
                    }}
                  >
                    <Stack direction="row" justifyContent="space-between" alignItems="center" gap={1.5}>
                      <Box>
                        <Typography variant="caption" sx={{ color: "text.secondary", fontWeight: 800 }}>
                          In Monitor
                        </Typography>
                        <Typography sx={{ fontWeight: 900, color: "#0f172a", lineHeight: 1.15 }}>
                          {monitorEnabled ? "Running" : "Paused"}
                        </Typography>
                        <Typography variant="caption" sx={{ color: "#64748b" }}>
                          {monitorEnabled ? "Included in live cycles" : "Skipped from live cycles"}
                        </Typography>
                      </Box>
                      <Switch
                        checked={monitorEnabled}
                        onChange={(_event, checked) => void toggleMonitoring(checked)}
                        disabled={!branch || !canManageBranches || togglingMonitoring}
                        inputProps={{ "aria-label": "Toggle branch monitoring" }}
                      />
                    </Stack>
                  </Box>

                  <BranchStatusPanel branch={branch} nowMs={nowMs} />

                  <BranchLogPanel
                    logDays={logDays}
                    logLoading={logLoading}
                    logLoadingMore={logLoadingMore}
                    hasMoreLogs={hasMoreLogs}
                    logError={logError}
                    clearingLog={clearingLog}
                    canClear={canManage}
                    onLoadMore={loadMoreLogs}
                    onClear={clearLog}
                  />

                  <Typography variant="caption" sx={{ color: "text.secondary" }}>
                    Last refresh: {detailWithBranch.fetchedAt ? fmtPlacedAt(detailWithBranch.fetchedAt) : "unavailable"}
                  </Typography>
                </Stack>
              </Grid>
            </Grid>
          </Stack>
        ) : error ? (
          <Alert severity="error">{error}</Alert>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
