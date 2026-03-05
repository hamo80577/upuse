import CloseIcon from "@mui/icons-material/Close";
import { Alert, Box, CircularProgress, Dialog, DialogContent, DialogTitle, Grid, IconButton, LinearProgress, Skeleton, Stack, Typography } from "@mui/material";
import type { BranchDetailSnapshot } from "../../../api/types";
import { useBranchDetailState } from "../../../features/branches/useBranchDetailState";
import { BranchLogPanel } from "./BranchLogPanel";
import { BranchOrdersSection } from "./BranchOrdersSection";
import { BranchStatusPanel } from "./BranchStatusPanel";
import { BranchSummaryStats } from "./BranchSummaryStats";
import { fmtPlacedAt } from "../lib/time";

export function BranchDetailDialog(props: {
  branchId: number | null;
  branchSnapshot?: BranchDetailSnapshot["branch"] | null;
  open: boolean;
  refreshToken?: string;
  onClose: () => void;
}) {
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
    loadMoreLogs,
    clearLog,
  } = useBranchDetailState({
    branchId: props.branchId,
    branchSnapshot: props.branchSnapshot,
    open: props.open,
    refreshToken: props.refreshToken,
  });

  const branch = detail?.branch
    ? {
        ...detail.branch,
        ...(props.branchSnapshot ?? {}),
        metrics: props.branchSnapshot?.metrics ?? detail.branch.metrics,
        lastUpdatedAt: props.branchSnapshot?.lastUpdatedAt ?? detail.branch.lastUpdatedAt,
      }
    : props.branchSnapshot;
  const queueTotals = detail
    ? {
        activeNow: detail.unassignedOrders.length + detail.preparingOrders.length,
        lateNow: [...detail.unassignedOrders, ...detail.preparingOrders].reduce(
          (sum, item) => sum + (item.isLate ? 1 : 0),
          0,
        ),
        unassignedNow: detail.unassignedOrders.length,
      }
    : null;
  const liveTotals = {
    totalToday: branch?.metrics.totalToday ?? detail?.totals.totalToday ?? 0,
    cancelledToday: branch?.metrics.cancelledToday ?? detail?.totals.cancelledToday ?? 0,
    doneToday: branch?.metrics.doneToday ?? detail?.totals.doneToday ?? 0,
    activeNow: queueTotals?.activeNow ?? branch?.metrics.activeNow ?? detail?.totals.activeNow ?? 0,
    lateNow: queueTotals?.lateNow ?? branch?.metrics.lateNow ?? detail?.totals.lateNow ?? 0,
    unassignedNow: queueTotals?.unassignedNow ?? branch?.metrics.unassignedNow ?? detail?.totals.unassignedNow ?? 0,
  };

  return (
    <Dialog open={props.open} onClose={props.onClose} fullWidth maxWidth="lg">
      <DialogTitle sx={{ pb: 1.5 }}>
        <Stack direction="row" alignItems="flex-start" justifyContent="space-between" gap={2}>
          <Box sx={{ minWidth: 0 }}>
            <Typography sx={{ fontWeight: 900, lineHeight: 1.2 }}>{branch?.name ?? "Branch detail"}</Typography>
            <Typography variant="caption" sx={{ color: "text.secondary" }}>
              Orders since start of day and live active queues{refreshing ? " • refreshing..." : ""}
            </Typography>
          </Box>
          <IconButton onClick={props.onClose}>
            <CloseIcon />
          </IconButton>
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
        ) : detail && branch ? (
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
            {error ? <Alert severity="warning" variant="outlined">{error}</Alert> : null}
            <Grid container spacing={2}>
              <Grid item xs={12} md={8}>
                <Stack spacing={2}>
                  <BranchSummaryStats totals={liveTotals} />

                  <Stack spacing={1.5}>
                    <BranchOrdersSection
                      title="Unassigned Orders"
                      subtitle="Current unassigned orders in this branch"
                      items={detail.unassignedOrders}
                      emptyText="No unassigned orders right now."
                      nowMs={nowMs}
                    />
                    <BranchOrdersSection
                      title="In Preparation"
                      subtitle="Assigned and in-progress orders, including late ones"
                      items={detail.preparingOrders}
                      emptyText="No active preparation orders right now."
                      nowMs={nowMs}
                    />
                  </Stack>
                </Stack>
              </Grid>

              <Grid item xs={12} md={4}>
                <Stack spacing={2}>
                  <BranchStatusPanel branch={branch} nowMs={nowMs} />

                  <BranchLogPanel
                    logDays={logDays}
                    logLoading={logLoading}
                    logLoadingMore={logLoadingMore}
                    hasMoreLogs={hasMoreLogs}
                    logError={logError}
                    clearingLog={clearingLog}
                    onLoadMore={loadMoreLogs}
                    onClear={clearLog}
                  />

                  <Typography variant="caption" sx={{ color: "text.secondary" }}>
                    Last refresh: {fmtPlacedAt(detail.fetchedAt)}
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
