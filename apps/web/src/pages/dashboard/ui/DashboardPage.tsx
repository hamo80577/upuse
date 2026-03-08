import { Alert, AlertTitle, Backdrop, Box, Button, Chip, CircularProgress, Container, Snackbar, Stack, Typography } from "@mui/material";
import { lazy, Suspense, useDeferredValue, useMemo, useState } from "react";
import { useAuth } from "../../../app/providers/AuthProvider";
import { ChainGroupsSection } from "../../../features/dashboard/ChainGroupsSection";
import { DashboardToolbarControls } from "../../../features/dashboard/DashboardToolbarControls";
import { OperationsSummaryCard } from "../../../widgets/operations-summary/ui/OperationsSummaryCard";
import { TopBar } from "../../../widgets/top-bar/ui/TopBar";
import { buildGroupedBranches, compareBranches, matchesSearchQuery, matchesStatusFilter, type GroupMode, type SortMode, type StatusFilter } from "../lib/dashboardGrouping";
import { useDashboardPageState } from "../lib/useDashboardPageState";

const BranchDetailDialog = lazy(() =>
  import("../../../widgets/branch-detail/ui/BranchDetailDialog").then((module) => ({ default: module.BranchDetailDialog })),
);

const ReportDownloadDialog = lazy(() =>
  import("../../../components/ReportDownloadDialog").then((module) => ({ default: module.ReportDownloadDialog })),
);

function fmtIssueAt(iso?: string) {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleString("en-GB", {
      timeZone: "Africa/Cairo",
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return iso;
  }
}

export function DashboardPage() {
  const { canManageMonitor, canRefreshOrdersNow } = useAuth();
  const {
    snap,
    connectionState,
    latestMonitoringUpdateAt,
    syncAgeMs,
    staleThresholdMs,
    isSyncStale,
    syncRecovering,
    syncError,
    toast,
    setToast,
    detailBranchId,
    selectedBranch,
    detailRefreshToken,
    reportDialogOpen,
    setReportDialogOpen,
    expandedGroups,
    screenLoading,
    onStart,
    onStop,
    onRefreshNowWithLoading,
    openBranchDetail,
    closeBranchDetail,
    toggleGroup,
  } = useDashboardPageState();

  const [sortBy, setSortBy] = useState<SortMode>("total");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [groupBy, setGroupBy] = useState<GroupMode>("chain");
  const [searchQuery, setSearchQuery] = useState("");
  const deferredSearchQuery = useDeferredValue(searchQuery);

  const visibleBranchPool = useMemo(
    () =>
      [...snap.branches]
        .filter((branch) => matchesStatusFilter(branch, statusFilter))
        .filter((branch) => matchesSearchQuery(branch, deferredSearchQuery))
        .sort((a, b) => compareBranches(a, b, sortBy)),
    [deferredSearchQuery, snap.branches, sortBy, statusFilter],
  );

  const groupedBranches = useMemo(
    () => buildGroupedBranches({ branches: visibleBranchPool, groupBy }),
    [groupBy, visibleBranchPool],
  );

  const ordersError = snap.monitoring.errors?.orders;

  return (
    <Box sx={{ minHeight: "100vh", bgcolor: "background.default" }}>
      <TopBar
        running={snap.monitoring.running}
        degraded={snap.monitoring.degraded}
        degradedLabel={ordersError ? "Orders API Error" : undefined}
        degradedColor={ordersError ? "error" : "warning"}
        branchSummary={snap.branches}
        onStart={onStart}
        onStop={onStop}
        canControlMonitor={canManageMonitor}
      />

      <Container maxWidth="xl" sx={{ py: 3 }}>
        {syncError ? (
          <Alert severity="error" variant="outlined" sx={{ mb: 2, borderRadius: 3, borderColor: "rgba(220,38,38,0.22)" }}>
            {syncError}
          </Alert>
        ) : null}
        {snap.monitoring.running && ordersError ? (
          <Alert
            severity="error"
            variant="outlined"
            sx={{
              mb: 2,
              borderRadius: 3,
              borderColor: "rgba(185, 28, 28, 0.18)",
              bgcolor: "#fff7f7",
              boxShadow: "0 16px 36px rgba(185, 28, 28, 0.08)",
            }}
          >
            <Stack
              direction={{ xs: "column", md: "row" }}
              spacing={2}
              alignItems={{ xs: "stretch", md: "center" }}
              justifyContent="space-between"
            >
              <Box sx={{ minWidth: 0, flex: 1 }}>
                <AlertTitle sx={{ mb: 0.75, fontWeight: 900 }}>Orders API Error</AlertTitle>
                <Typography variant="body2" sx={{ color: "text.primary", fontWeight: 700 }}>
                  {ordersError.message}
                </Typography>

                <Stack direction={{ xs: "column", sm: "row" }} spacing={1} sx={{ mt: 1.25 }}>
                  {ordersError.statusCode ? <Chip size="small" variant="outlined" color="error" label={`HTTP ${ordersError.statusCode}`} /> : null}
                  <Chip
                    size="small"
                    variant="outlined"
                    label={`Detected ${fmtIssueAt(ordersError.at)}`}
                    sx={{ borderColor: "rgba(17,24,39,0.12)", bgcolor: "white" }}
                  />
                </Stack>

                <Typography variant="caption" sx={{ display: "block", mt: 1.25, color: "text.secondary" }}>
                  Monitoring is still running, but live orders metrics may be stale. Review the error, then stop monitoring until the Orders API recovers or the token is fixed.
                </Typography>
              </Box>

              <Button
                variant="contained"
                color="error"
                onClick={onStop}
                disabled={!canManageMonitor}
                sx={{ minWidth: 150, alignSelf: { xs: "stretch", md: "center" } }}
              >
                {canManageMonitor ? "Stop Monitor" : "No Access"}
              </Button>
            </Stack>
          </Alert>
        ) : null}
        <OperationsSummaryCard
          totals={snap.totals}
          updatedAt={latestMonitoringUpdateAt}
          connectionState={connectionState}
          canRefreshNow={canRefreshOrdersNow}
          syncGuard={{
            stale: isSyncStale,
            recovering: syncRecovering,
            ageMs: syncAgeMs,
            thresholdMs: staleThresholdMs,
          }}
          onRefreshNow={onRefreshNowWithLoading}
          onOpenReport={() => setReportDialogOpen(true)}
        />
        <DashboardToolbarControls
          sortBy={sortBy}
          statusFilter={statusFilter}
          groupBy={groupBy}
          searchQuery={searchQuery}
          onChangeSortBy={setSortBy}
          onChangeStatusFilter={setStatusFilter}
          onChangeGroupBy={setGroupBy}
          onChangeSearchQuery={setSearchQuery}
        />

        <ChainGroupsSection
          groups={groupedBranches}
          expandedGroups={expandedGroups}
          onToggleGroup={toggleGroup}
          onOpenBranchDetail={openBranchDetail}
        />
      </Container>

      <Suspense fallback={null}>
        <BranchDetailDialog
          open={!!detailBranchId}
          branchId={detailBranchId}
          branchSnapshot={selectedBranch}
          refreshToken={detailRefreshToken}
          onClose={closeBranchDetail}
        />
      </Suspense>

      <Suspense fallback={null}>
        <ReportDownloadDialog
          open={reportDialogOpen}
          onClose={() => setReportDialogOpen(false)}
        />
      </Suspense>

      <Snackbar open={!!toast} autoHideDuration={2500} onClose={() => setToast(null)} anchorOrigin={{ vertical: "bottom", horizontal: "center" }}>
        {toast ? <Alert severity={toast.type}>{toast.msg}</Alert> : undefined}
      </Snackbar>

      <Backdrop
        open={!!screenLoading}
        sx={{
          zIndex: (theme) => theme.zIndex.modal + 10,
          bgcolor: "rgba(2,6,23,0.52)",
          backdropFilter: "blur(2px)",
        }}
      >
        <Box
          sx={{
            width: { xs: "88%", sm: 420 },
            maxWidth: 520,
            borderRadius: 3,
            border: "1px solid rgba(148,163,184,0.24)",
            bgcolor: "rgba(255,255,255,0.96)",
            px: 2.2,
            py: 2,
            boxShadow: "0 24px 48px rgba(15,23,42,0.2)",
          }}
        >
          <Stack direction="row" spacing={1.5} alignItems="center">
            <CircularProgress size={24} />
            <Box sx={{ minWidth: 0 }}>
              <Typography sx={{ fontWeight: 900, color: "#0f172a", lineHeight: 1.2 }}>
                {screenLoading?.title}
              </Typography>
              <Typography variant="body2" sx={{ color: "text.secondary" }}>
                {screenLoading?.note}
              </Typography>
            </Box>
          </Stack>
        </Box>
      </Backdrop>
    </Box>
  );
}
