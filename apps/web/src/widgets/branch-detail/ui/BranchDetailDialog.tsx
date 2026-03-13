import { Alert, Box, Dialog, DialogContent, DialogTitle, LinearProgress, Skeleton, Stack, Typography, useMediaQuery, useTheme } from "@mui/material";
import { useEffect, useState } from "react";
import type { BranchDetailResult, BranchPickersSummary, BranchSnapshot } from "../../../api/types";
import { useAuth } from "../../../app/providers/AuthProvider";
import { useBranchDetailState } from "../../../features/branches/useBranchDetailState";
import { BranchDetailHeader } from "./BranchDetailHeader";
import { BranchDetailOverview } from "./BranchDetailOverview";
import { BranchDetailSegmentedNav } from "./BranchDetailSegmentedNav";
import { BranchLogPanel } from "./BranchLogPanel";
import { BranchOrdersSection } from "./BranchOrdersSection";
import { BranchPickersPanel } from "./BranchPickersPanel";
import { resolveDisplayedBranch } from "../lib/resolveDisplayedBranch";

type DetailSection = "queue" | "pickers" | "log";

function nonFatalDetailNotice(detail: BranchDetailResult | null) {
  if (!detail || detail.kind === "branch_not_found") return null;
  if (detail.kind === "ok") {
    if (detail.cacheState === "stale") {
      return {
        severity: "warning",
        message: "Local orders cache is stale. Queue detail may be behind the latest monitor snapshot.",
      } as const;
    }
    if (detail.cacheState === "warming") {
      return {
        severity: "info",
        message: "Local orders cache is still warming up. Queue detail may lag behind the latest snapshot for a short time.",
      } as const;
    }
    return null;
  }
  return {
    severity: detail.kind === "detail_fetch_failed" ? "warning" : "info",
    message: detail.message,
  } as const;
}

function emptyPickers(): BranchPickersSummary {
  return {
    todayCount: 0,
    activePreparingCount: 0,
    lastHourCount: 0,
    items: [],
  };
}

function formatPickerCount(count: number) {
  return `${count} picker${count === 1 ? "" : "s"}`;
}

function LoadingLayout() {
  return (
    <Stack spacing={1.05} sx={{ minHeight: 0 }}>
      <Box
        sx={{
          display: "grid",
          gap: 1,
          gridTemplateColumns: { xs: "1fr", lg: "minmax(300px, 0.95fr) minmax(0, 1.25fr)" },
        }}
      >
        <Skeleton variant="rounded" animation="wave" height={224} />
        <Skeleton variant="rounded" animation="wave" height={224} />
      </Box>
      <Skeleton variant="rounded" animation="wave" height={50} />
      <Skeleton variant="rounded" animation="wave" height={252} />
    </Stack>
  );
}

function QueueLoadingLayout() {
  return (
    <Box
      sx={{
        display: "grid",
        gap: 1.2,
        gridTemplateColumns: { xs: "1fr", md: "repeat(2, minmax(0, 1fr))" },
      }}
    >
      <Skeleton variant="rounded" animation="wave" height={260} />
      <Skeleton variant="rounded" animation="wave" height={260} />
    </Box>
  );
}

function renderPickerBadge(pickerCount: number) {
  return (
    <Box
      sx={{
        px: 1,
        py: 0.55,
        borderRadius: 999,
        bgcolor: "rgba(15,23,42,0.06)",
        color: "#0f172a",
        fontSize: 12,
        fontWeight: 900,
        lineHeight: 1,
        border: "1px solid rgba(148,163,184,0.12)",
      }}
    >
      {formatPickerCount(pickerCount)}
    </Box>
  );
}

export function BranchDetailDialog(props: {
  branchId: number | null;
  branchSnapshot?: BranchSnapshot | null;
  open: boolean;
  onClose: () => void;
}) {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("sm"));
  const { canManage } = useAuth();
  const [pickersRequested, setPickersRequested] = useState(false);
  const [logsRequested, setLogsRequested] = useState(false);
  const {
    detail,
    loading,
    refreshing,
    error,
    pickers,
    pickersLoading,
    pickersError,
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
    loadPickers: pickersRequested,
    loadLogs: logsRequested,
  });
  const [section, setSection] = useState<DetailSection>("queue");

  const branch = resolveDisplayedBranch(detail, props.branchSnapshot);
  const detailNotFound = detail?.kind === "branch_not_found";
  const detailWithBranch = detail && detail.kind !== "branch_not_found" ? detail : null;
  const showSnapshotShell = Boolean(branch) && !detailNotFound;
  const showFullScreenLoading = loading && !showSnapshotShell && !detailNotFound;
  const hasLiveQueueDetail = detailWithBranch
    ? detailWithBranch.kind === "ok" || (detailWithBranch.kind === "snapshot_unavailable" && Boolean(detailWithBranch.fetchedAt))
    : false;
  const queueTotals = hasLiveQueueDetail && detailWithBranch
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
  const pickerSummary = pickers ?? detailWithBranch?.pickers ?? emptyPickers();
  const activePreparingPickerCount = hasLiveQueueDetail && detailWithBranch
    ? detailWithBranch.pickers.activePreparingCount
    : branch?.preparingPickersNow ?? 0;
  const preparingNow = hasLiveQueueDetail && detailWithBranch
    ? detailWithBranch.preparingOrders.length
    : branch?.preparingNow ?? 0;
  const detailNotice = nonFatalDetailNotice(detail);
  const queuePanelLoading = loading && !detailWithBranch && !error;
  const unavailableOrdersText = detail?.kind === "snapshot_unavailable"
    ? detail.fetchedAt
      ? "No orders in this queue from the latest local orders cache."
      : "Orders detail is unavailable while the live snapshot is missing."
    : detail?.kind === "detail_fetch_failed"
      ? "Queue detail is temporarily unavailable. Showing the latest monitor snapshot."
      : "No active orders right now.";

  useEffect(() => {
    if (!props.open) {
      setSection("queue");
      setPickersRequested(false);
      setLogsRequested(false);
    }
  }, [props.open]);

  useEffect(() => {
    setSection("queue");
    setPickersRequested(false);
    setLogsRequested(false);
  }, [props.branchId]);

  const handleSectionChange = (nextSection: DetailSection) => {
    setSection(nextSection);
    if (nextSection === "pickers") {
      setPickersRequested(true);
    }
    if (nextSection === "log") {
      setLogsRequested(true);
    }
  };

  return (
    <Dialog
      open={props.open}
      onClose={props.onClose}
      fullWidth
      fullScreen={isMobile}
      maxWidth="lg"
      PaperProps={{
        sx: {
          width: { xs: "100%", sm: "min(1040px, calc(100vw - 56px))" },
          height: { xs: "100%", sm: "min(760px, calc(100vh - 48px))" },
          maxHeight: { xs: "100%", sm: "calc(100vh - 48px)" },
          m: { xs: 0, sm: 2.5 },
          borderRadius: { xs: 0, sm: 2.4 },
          display: "flex",
          flexDirection: "column",
        },
      }}
    >
      <DialogTitle sx={{ pb: { xs: 0.9, sm: 1 }, px: { xs: 1, sm: 1.6 }, pt: { xs: 0.9, sm: 1.2 } }}>
        {showFullScreenLoading ? (
          <Skeleton variant="rounded" animation="wave" height={122} />
        ) : (
          <BranchDetailHeader
            branch={branch}
            detailNotFound={detailNotFound}
            refreshing={refreshing}
            onRefresh={refreshDetail}
            onClose={props.onClose}
          />
        )}
      </DialogTitle>

      <DialogContent
        dividers
        sx={{
          p: { xs: 1, md: 1.35 },
          flex: 1,
          minHeight: 0,
          display: "flex",
          flexDirection: "column",
          overflowX: "hidden",
          overflowY: "auto",
        }}
      >
        {showFullScreenLoading ? (
          <LoadingLayout />
        ) : detailNotFound ? (
          <Box
            sx={{
              minHeight: 320,
              display: "grid",
              placeItems: "center",
              px: 1,
            }}
          >
            <Box
              sx={{
                width: "100%",
                maxWidth: 460,
                borderRadius: 2.5,
                border: "1px solid rgba(220,38,38,0.16)",
                bgcolor: "rgba(255,255,255,0.96)",
                boxShadow: "0 18px 38px rgba(15,23,42,0.05)",
                px: 2,
                py: 2.2,
                textAlign: "center",
              }}
            >
              <Typography sx={{ fontWeight: 900, color: "#7f1d1d", lineHeight: 1.15 }}>
                Branch detail unavailable
              </Typography>
              <Typography variant="body2" sx={{ mt: 0.7, color: "text.secondary", lineHeight: 1.6 }}>
                {detail?.message ?? "Branch not found"}
              </Typography>
            </Box>
          </Box>
        ) : showSnapshotShell && branch ? (
          <Stack spacing={1.2} sx={{ minHeight: 0 }}>
            <Box sx={{ minHeight: 6, borderRadius: 999, overflow: "hidden", flexShrink: 0 }}>
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
            {(detailNotice || error) ? (
              <Stack spacing={0.85} sx={{ flexShrink: 0 }}>
                {detailNotice ? (
                  <Alert severity={detailNotice.severity} variant="outlined">
                    {detailNotice.message}
                  </Alert>
                ) : null}
                {error ? <Alert severity="warning" variant="outlined">{error}</Alert> : null}
              </Stack>
            ) : null}

            <Stack spacing={1.2} sx={{ minHeight: 0 }}>
              <BranchDetailOverview
                branch={branch}
                nowMs={nowMs}
                totals={liveTotals}
                preparingNow={preparingNow}
                pickerCount={activePreparingPickerCount}
                fetchedAt={detailWithBranch?.fetchedAt ?? null}
              />

              <Box
                sx={{
                  position: { xs: "sticky", sm: "static" },
                  top: 0,
                  zIndex: 3,
                  pt: { xs: 0.2, sm: 0 },
                  pb: { xs: 0.5, sm: 0 },
                  px: { xs: 0.25, sm: 0 },
                  mx: { xs: -0.25, sm: 0 },
                  borderRadius: { xs: 2.25, sm: 0 },
                  border: { xs: "1px solid rgba(148,163,184,0.10)", sm: "none" },
                  bgcolor: { xs: "rgba(255,255,255,0.94)", sm: "transparent" },
                  backdropFilter: { xs: "blur(14px)", sm: "none" },
                  boxShadow: { xs: "0 14px 28px rgba(15,23,42,0.08)", sm: "none" },
                }}
              >
                <BranchDetailSegmentedNav value={section} onChange={handleSectionChange} />
              </Box>

              <Box sx={{ minHeight: 0, overflow: "visible", pb: { xs: 0.4, sm: 0.1 } }}>
                {section === "queue" ? (
                  queuePanelLoading ? (
                    <QueueLoadingLayout />
                  ) : (
                    <Box
                      sx={{
                        display: "grid",
                        gap: 1.2,
                        gridTemplateColumns: { xs: "1fr", md: "repeat(2, minmax(0, 1fr))" },
                        alignItems: "start",
                      }}
                    >
                      <BranchOrdersSection
                        title="Unassigned Orders"
                        subtitle="Current unassigned queue"
                        items={detailWithBranch?.unassignedOrders ?? []}
                        emptyText={detailWithBranch?.unassignedOrders.length ? "No unassigned orders right now." : unavailableOrdersText}
                        nowMs={nowMs}
                      />
                      <BranchOrdersSection
                        title="In Preparation"
                        subtitle="Assigned preparation queue"
                        items={detailWithBranch?.preparingOrders ?? []}
                        emptyText={detailWithBranch?.preparingOrders.length ? "No active preparation orders right now." : unavailableOrdersText}
                        nowMs={nowMs}
                        headerBadge={renderPickerBadge(activePreparingPickerCount)}
                      />
                    </Box>
                  )
                ) : null}

                {section === "pickers" ? (
                  <BranchPickersPanel
                    pickers={pickerSummary}
                    loading={pickersLoading}
                    emptyText={
                      pickersError
                        ? pickersError
                        : detail?.kind === "detail_fetch_failed"
                        ? "Picker detail is temporarily unavailable. Showing the latest monitor snapshot."
                        : detail?.kind === "snapshot_unavailable" && !detail.fetchedAt
                          ? "Picker detail is unavailable while the live snapshot is missing."
                          : "No pickers found for this branch today."
                    }
                  />
                ) : null}

                {section === "log" ? (
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
                ) : null}
              </Box>
            </Stack>
          </Stack>
        ) : error ? (
          <Alert severity="error">{error}</Alert>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
