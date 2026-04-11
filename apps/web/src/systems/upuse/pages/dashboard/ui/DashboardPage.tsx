import { Alert, Backdrop, Box, Button, CircularProgress, Container, Snackbar, Stack, Typography } from "@mui/material";
import { lazy, Suspense, useDeferredValue, useEffect, useMemo, useState } from "react";
import { useAuth } from "../../../app/providers/AuthProvider";
import {
  UPUSE_MONITOR_MANAGE_CAPABILITY,
  UPUSE_MONITOR_ORDERS_REFRESH_CAPABILITY,
} from "../../../routes/capabilities";
import { ChainGroupsSection } from "../../../features/dashboard/ChainGroupsSection";
import { DashboardToolbarControls } from "../../../features/dashboard/DashboardToolbarControls";
import { OperationsSummaryCard } from "../../../widgets/operations-summary/ui/OperationsSummaryCard";
import { TopBar } from "../../../widgets/top-bar/ui/TopBar";
import { buildGroupedBranches, compareBranches, matchesSearchQuery, matchesStatusFilter, type GroupMode, type SortMode, type StatusFilter } from "../lib/dashboardGrouping";
import { DashboardIssueBanner } from "./DashboardIssueBanner";
import { useDashboardPageState } from "../lib/useDashboardPageState";

const loadBranchDetailDialog = () =>
  import("../../../widgets/branch-detail/ui/BranchDetailDialog").then((module) => ({ default: module.BranchDetailDialog }));

const BranchDetailDialog = lazy(loadBranchDetailDialog);

const ReportDownloadDialog = lazy(() =>
  import("../../../features/reports/ui/ReportDownloadDialog").then((module) => ({ default: module.ReportDownloadDialog })),
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

function extractIssueDetail(message: string, baseContext: string) {
  const escapedContext = baseContext.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = message.trim().match(new RegExp(`^${escapedContext}(?: \\(HTTP \\d+\\))?(?::\\s*(.*))?$`, "i"));
  return match?.[1]?.trim() ?? "";
}

function isTunnelIssue(message: string) {
  return /cloudflare tunnel/i.test(message) || /tunnel is temporarily unavailable/i.test(message);
}

function getSyncIssueCopy(message: string) {
  if (isTunnelIssue(message)) {
    return {
      title: "Dashboard tunnel unavailable",
      hint: "Live updates are paused until the current tunnel endpoint responds again.",
    };
  }

  if (/html error page/i.test(message)) {
    return {
      title: "Unexpected dashboard response",
      hint: "The dashboard expected API data, but the server responded with a web page instead.",
    };
  }

  return {
    title: "Live sync needs attention",
    hint: "The board may stop updating until the next successful dashboard sync.",
  };
}

function getOrdersIssueCopy(message: string) {
  const detail = extractIssueDetail(message, "Orders API request failed");
  const tunnelIssue = isTunnelIssue(message);

  if (tunnelIssue) {
    return {
      title: "Orders feed unavailable",
      message: "Cloudflare tunnel is temporarily unavailable.",
      hint: "Monitoring is still running, but live orders counts may lag until the tunnel recovers.",
    };
  }

  return {
    title: "Orders API error",
    message: detail || "The orders feed returned an unexpected response.",
    hint: "Monitoring is still running, but live orders metrics may be stale until the next healthy sync.",
  };
}

function getOrdersStaleSummary(staleBranchCount: number) {
  return {
    title: "Orders data is catching up",
    message:
      staleBranchCount === 1
        ? "1 branch is serving the latest cached orders snapshot."
        : `${staleBranchCount} branches are serving the latest cached orders snapshot.`,
    hint: "Live cards stay available while background sync retries the affected branches.",
  };
}

export function DashboardPage() {
  const { hasSystemCapability } = useAuth();
  const canManageMonitor = hasSystemCapability("upuse", UPUSE_MONITOR_MANAGE_CAPABILITY);
  const canRefreshOrdersNow = hasSystemCapability("upuse", UPUSE_MONITOR_ORDERS_REFRESH_CAPABILITY);
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

  const ordersSync = snap.monitoring.ordersSync;
  const ordersError = ordersSync?.state === "degraded" ? snap.monitoring.errors?.orders : undefined;
  const ordersSyncState =
    ordersSync?.state === "warming"
      ? "syncing"
      : ordersSync?.state === "degraded" || (ordersSync?.staleBranchCount ?? 0) > 0
        ? "stale"
        : "fresh";
  const syncIssue = syncError ? getSyncIssueCopy(syncError) : null;
  const ordersIssue = ordersError ? getOrdersIssueCopy(ordersError.message) : null;
  const partialOrdersIssue =
    snap.monitoring.running &&
    ordersSync &&
    ordersSync.state !== "degraded" &&
    ordersSync.staleBranchCount > 0
      ? getOrdersStaleSummary(ordersSync.staleBranchCount)
      : null;

  useEffect(() => {
    if (!detailBranchId) return;
    void loadBranchDetailDialog();
  }, [detailBranchId]);

  return (
    <Box sx={{ minHeight: "100vh", bgcolor: "background.default" }}>
      <TopBar
        running={snap.monitoring.running}
        degraded={snap.monitoring.degraded}
        degradedLabel={ordersError ? "Orders Sync Degraded" : undefined}
        degradedColor={ordersError ? "error" : "warning"}
        branchSummary={snap.branches}
        onStart={onStart}
        onStop={onStop}
        canControlMonitor={canManageMonitor}
      />

      <Container maxWidth="xl" sx={{ py: { xs: 2, md: 3 } }}>
        {syncError ? (
          <DashboardIssueBanner
            kind="sync"
            title={syncIssue?.title ?? "Live sync needs attention"}
            message={syncError}
            hint={syncIssue?.hint}
          />
        ) : null}
        {snap.monitoring.running && ordersError && ordersIssue ? (
          <DashboardIssueBanner
            kind="orders"
            title={ordersIssue.title}
            message={ordersIssue.message}
            hint={ordersIssue.hint}
            statusCode={ordersError.statusCode}
            detectedLabel={fmtIssueAt(ordersError.at) ? `Detected ${fmtIssueAt(ordersError.at)}` : undefined}
            action={(
              <Button
                variant="contained"
                color="error"
                onClick={onStop}
                disabled={!canManageMonitor}
                sx={{ minWidth: { xs: "100%", md: 158 }, alignSelf: { xs: "stretch", md: "center" } }}
              >
                {canManageMonitor ? (
                  <>
                    <Box component="span" sx={{ display: { xs: "inline", sm: "none" } }}>
                      Stop
                    </Box>
                    <Box component="span" sx={{ display: { xs: "none", sm: "inline" } }}>
                      Stop Monitor
                    </Box>
                  </>
                ) : "No Access"}
              </Button>
            )}
          />
        ) : null}
        {partialOrdersIssue ? (
          <DashboardIssueBanner
            kind="sync"
            title={partialOrdersIssue.title}
            message={partialOrdersIssue.message}
            hint={partialOrdersIssue.hint}
            detectedLabel={ordersSync?.lastSuccessfulSyncAt ? `Last healthy sync ${fmtIssueAt(ordersSync.lastSuccessfulSyncAt)}` : undefined}
          />
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
          ordersSyncState={ordersSyncState}
        />
      </Container>

      <Suspense
        fallback={detailBranchId ? (
          <Backdrop
            open
            sx={{
              zIndex: (theme) => theme.zIndex.modal + 5,
              bgcolor: "rgba(2,6,23,0.42)",
              backdropFilter: "blur(2px)",
            }}
          >
            <Box
              sx={{
                width: { xs: "88%", sm: 360 },
                borderRadius: 3,
                border: "1px solid rgba(148,163,184,0.22)",
                bgcolor: "rgba(255,255,255,0.96)",
                px: 2,
                py: 1.8,
                boxShadow: "0 20px 40px rgba(15,23,42,0.18)",
              }}
            >
              <Stack direction="row" spacing={1.3} alignItems="center">
                <CircularProgress size={22} />
                <Box sx={{ minWidth: 0 }}>
                  <Typography sx={{ fontWeight: 900, color: "#0f172a", lineHeight: 1.2 }}>
                    Loading branch detail
                  </Typography>
                  <Typography variant="body2" sx={{ color: "text.secondary" }}>
                    Opening the branch operations sheet...
                  </Typography>
                </Box>
              </Stack>
            </Box>
          </Backdrop>
        ) : null}
      >
        <BranchDetailDialog
          open={!!detailBranchId}
          branchId={detailBranchId}
          branchSnapshot={selectedBranch}
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
