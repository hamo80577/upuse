import AssessmentRoundedIcon from "@mui/icons-material/AssessmentRounded";
import { Alert, AlertTitle, Box, Button, IconButton, Stack, Tooltip, Typography } from "@mui/material";
import type { DashboardLiveConnectionState, DashboardSnapshot } from "../../../api/types";
import { SummaryStat } from "./SummaryStat";

function fmtSyncAge(ms: number) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  if (totalSeconds < 60) return `${totalSeconds}s`;

  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes < 60) return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;

  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
}

export function OperationsSummaryCard(props: {
  totals: DashboardSnapshot["totals"];
  updatedAt?: string;
  connectionState: DashboardLiveConnectionState;
  canRefreshNow?: boolean;
  syncGuard: {
    stale: boolean;
    recovering: boolean;
    ageMs: number;
    thresholdMs: number;
  };
  onRefreshNow: () => void;
  onOpenReport: () => void;
}) {
  const canRefreshNow = props.canRefreshNow ?? true;
  const metrics: Array<{
    label: string;
    value: number;
    color: string;
    bg: string;
  }> = [
    {
      label: "Orders",
      value: props.totals.ordersToday,
      color: "#0f172a",
      bg: "rgba(15,23,42,0.05)",
    },
    {
      label: "Cancelled",
      value: props.totals.cancelledToday,
      color: "#b45309",
      bg: "rgba(245,158,11,0.10)",
    },
    {
      label: "Active Orders",
      value: props.totals.activeNow,
      color: "#2563eb",
      bg: "rgba(37,99,235,0.10)",
    },
    {
      label: "Late",
      value: props.totals.lateNow,
      color: props.totals.lateNow === 0 ? "#16a34a" : "#9a3412",
      bg: props.totals.lateNow === 0 ? "rgba(34,197,94,0.10)" : "rgba(251,146,60,0.12)",
    },
    {
      label: "Unassigned",
      value: props.totals.unassignedNow,
      color: props.totals.unassignedNow === 0 ? "#16a34a" : "#b91c1c",
      bg: props.totals.unassignedNow === 0 ? "rgba(34,197,94,0.10)" : "rgba(239,68,68,0.10)",
    },
  ];

  return (
    <Box
      sx={{
        mb: 2,
        p: { xs: 1.2, md: 1.85 },
        borderRadius: { xs: 3, md: 4 },
        border: "1px solid rgba(148,163,184,0.14)",
        background: "linear-gradient(135deg, rgba(255,255,255,0.98) 0%, rgba(248,250,252,0.98) 100%)",
        boxShadow: "0 18px 40px rgba(15,23,42,0.06)",
      }}
    >
      <Stack
        direction={{ xs: "column", md: "row" }}
        spacing={1}
        alignItems={{ xs: "flex-start", md: "center" }}
        justifyContent="space-between"
      >
        <Box>
          <Typography
            sx={{
              fontWeight: 900,
              fontSize: { xs: 18, md: 20 },
              lineHeight: 1.1,
              color: "#0f172a",
            }}
          >
            Live Operations
          </Typography>
          <Typography variant="caption" sx={{ color: "text.secondary", display: { xs: "none", sm: "block" } }}>
            Real-time view across all chains
          </Typography>
        </Box>

        <Stack
          direction="row"
          spacing={1}
          alignItems="center"
          sx={{ width: "auto", alignSelf: { xs: "flex-end", md: "auto" } }}
        >
          <Tooltip title="Download report">
            <IconButton
              onClick={props.onOpenReport}
              aria-label="Download report"
              sx={{
                width: 40,
                height: 40,
                border: "1px solid rgba(37,99,235,0.22)",
                color: "#1d4ed8",
                bgcolor: "rgba(37,99,235,0.04)",
                boxShadow: "0 8px 18px rgba(15,23,42,0.05)",
                "&:hover": {
                  borderColor: "rgba(37,99,235,0.32)",
                  bgcolor: "rgba(37,99,235,0.08)",
                  boxShadow: "0 10px 20px rgba(15,23,42,0.08)",
                },
              }}
            >
              <AssessmentRoundedIcon />
            </IconButton>
          </Tooltip>
        </Stack>
      </Stack>

      {props.connectionState === "connecting" && !props.updatedAt ? (
        <Alert severity="info" variant="outlined" sx={{ mt: 1.5, borderRadius: 3 }}>
          <AlertTitle sx={{ mb: 0.4, fontWeight: 900 }}>Connecting Live Sync</AlertTitle>
          <Typography variant="body2" sx={{ display: { xs: "none", sm: "block" } }}>
            Opening the dashboard stream and waiting for the first snapshot.
          </Typography>
          <Typography variant="body2" sx={{ display: { xs: "block", sm: "none" } }}>
            Waiting for the first live snapshot.
          </Typography>
        </Alert>
      ) : null}

      {props.connectionState === "fallback" ? (
        <Alert severity="warning" variant="outlined" sx={{ mt: 1.5, borderRadius: 3 }}>
          <AlertTitle sx={{ mb: 0.4, fontWeight: 900 }}>Fallback Polling Active</AlertTitle>
          <Typography variant="body2" sx={{ display: { xs: "none", sm: "block" } }}>
            The live stream disconnected. The dashboard is polling every 15 seconds until streaming reconnects.
          </Typography>
          <Typography variant="body2" sx={{ display: { xs: "block", sm: "none" } }}>
            Live stream dropped. Polling every 15s.
          </Typography>
        </Alert>
      ) : null}

      {props.connectionState === "disconnected" ? (
        <Alert
          severity="error"
          variant="outlined"
          sx={{ mt: 1.5, borderRadius: 3 }}
          action={(
            <Button
              size="small"
              variant="contained"
              color="error"
              disabled={!canRefreshNow || props.syncGuard.recovering}
              onClick={props.onRefreshNow}
              sx={{ fontWeight: 800, minWidth: 126 }}
            >
              {!canRefreshNow ? "No Access" : props.syncGuard.recovering ? "Recovering..." : "Refresh Now"}
            </Button>
          )}
        >
          <AlertTitle sx={{ mb: 0.4, fontWeight: 900 }}>Live Sync Disconnected</AlertTitle>
          <Typography variant="body2" sx={{ display: { xs: "none", sm: "block" } }}>
            The dashboard could not keep a live connection or fallback refresh healthy. Use a manual refresh while it retries.
          </Typography>
          <Typography variant="body2" sx={{ display: { xs: "block", sm: "none" } }}>
            Live sync is down. Use manual refresh.
          </Typography>
        </Alert>
      ) : null}

      {props.syncGuard.stale && props.connectionState === "live" ? (
        <Alert
          severity="warning"
          variant="outlined"
          sx={{
            mt: 1.5,
            borderRadius: 3,
            borderColor: "rgba(217,119,6,0.18)",
            bgcolor: "rgba(255,251,235,0.96)",
            alignItems: "center",
          }}
          action={
            <Button
              size="small"
              variant="contained"
              color="warning"
              disabled={!canRefreshNow || props.syncGuard.recovering}
              onClick={props.onRefreshNow}
              sx={{ fontWeight: 800, minWidth: 126 }}
            >
              {!canRefreshNow ? "No Access" : props.syncGuard.recovering ? "Recovering..." : "Refresh Now"}
            </Button>
          }
        >
          <AlertTitle sx={{ mb: 0.4, fontWeight: 900 }}>Live Sync Delayed</AlertTitle>
          <Typography variant="body2" sx={{ fontWeight: 700, color: "#78350f" }}>
            No fresh monitor update for {fmtSyncAge(props.syncGuard.ageMs)}.
          </Typography>
          <Typography variant="caption" sx={{ display: { xs: "none", sm: "block" }, mt: 0.45, color: "#92400e" }}>
            Expected a refresh within {fmtSyncAge(props.syncGuard.thresholdMs)}. The dashboard is trying to restart live sync first, then you can force a refresh.
          </Typography>
          <Typography variant="caption" sx={{ display: { xs: "block", sm: "none" }, mt: 0.45, color: "#92400e" }}>
            Expected within {fmtSyncAge(props.syncGuard.thresholdMs)}.
          </Typography>
        </Alert>
      ) : null}

      <Box
        sx={{
          mt: 1.6,
          display: "grid",
          gap: 1,
          gridTemplateColumns: {
            xs: "repeat(2, minmax(0, 1fr))",
            md: "repeat(3, minmax(0, 1fr))",
            xl: "repeat(5, minmax(0, 1fr))",
          },
        }}
      >
        {metrics.map((metric) => (
          <SummaryStat
            key={metric.label}
            label={metric.label}
            value={metric.value}
            color={metric.color}
            bg={metric.bg}
          />
        ))}
      </Box>
    </Box>
  );
}
