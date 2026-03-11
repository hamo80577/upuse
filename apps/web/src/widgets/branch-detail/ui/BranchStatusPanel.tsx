import { Box, Chip, Divider, LinearProgress, Stack, Typography } from "@mui/material";
import type { BranchSnapshot } from "../../../api/types";
import { closureProgress, hasDeadlinePassed } from "../../../shared/lib/progress/closureProgress";
import { fmtCountdown, fmtTimeCairo } from "../../../utils/format";
import { statusChip, statusPanelMeta } from "../lib/statusMeta";

export function BranchStatusPanel(props: { branch: BranchSnapshot; nowMs: number }) {
  const chip = statusChip(props.branch);
  const panel = statusPanelMeta(props.branch);
  const progressValue = closureProgress(props.branch.closeStartedAt, props.branch.closedUntil, props.nowMs);
  const canTrackProgress = Boolean(
    props.branch.status === "TEMP_CLOSE" &&
      props.branch.closedUntil &&
      props.branch.closeStartedAt,
  );
  const timerReached = hasDeadlinePassed(props.branch.closedUntil, props.nowMs);

  return (
    <Box
      sx={{
        borderRadius: 3,
        border: props.branch.status === "TEMP_CLOSE" ? "1px solid rgba(220,38,38,0.16)" : "1px solid rgba(148,163,184,0.14)",
        p: { xs: 1.3, sm: 1.45 },
        background:
          props.branch.status === "TEMP_CLOSE"
            ? "linear-gradient(180deg, rgba(255,255,255,0.98) 0%, rgba(255,247,247,0.92) 100%)"
            : "linear-gradient(180deg, rgba(255,255,255,0.98) 0%, rgba(248,250,252,0.92) 100%)",
        boxShadow: "0 14px 30px rgba(15,23,42,0.05)",
      }}
    >
      <Stack direction="row" justifyContent="space-between" alignItems="flex-start" gap={1}>
        <Box>
          <Typography variant="caption" sx={{ color: "text.secondary", fontWeight: 800 }}>
            Status Window
          </Typography>
          <Typography sx={{ mt: 0.35, fontWeight: 900, color: panel.tone, lineHeight: 1.15 }}>
            {panel.title}
          </Typography>
        </Box>
        <Chip
          size="small"
          label={chip.label}
          sx={{
            fontWeight: 900,
            border: "1px solid rgba(15,23,42,0.08)",
            ...chip.sx,
          }}
        />
      </Stack>

      <Typography variant="body2" sx={{ mt: 0.9, color: "text.secondary", lineHeight: 1.55 }}>
        {panel.caption}
      </Typography>

      <Divider sx={{ my: 1.15 }} />

      {panel.showTimer && props.branch.status === "TEMP_CLOSE" && props.branch.closedUntil ? (
        <Stack spacing={0.9} sx={{ mt: 1.2 }}>
          <Stack direction={{ xs: "column", sm: "row" }} justifyContent="space-between" gap={1.1} alignItems={{ xs: "flex-start", sm: "flex-end" }}>
            <Box>
              <Typography variant="caption" sx={{ color: "text.secondary", fontWeight: 800 }}>
                Countdown
              </Typography>
              <Typography variant="h4" sx={{ mt: 0.2, fontWeight: 900, color: "#166534", fontVariantNumeric: "tabular-nums", lineHeight: 1 }}>
                {fmtCountdown(props.branch.closedUntil, props.nowMs)}
              </Typography>
            </Box>
            <Box sx={{ textAlign: { xs: "left", sm: "right" } }}>
              <Typography variant="caption" sx={{ color: "#166534", fontWeight: 800, display: "block" }}>
                {timerReached ? "Window reached at" : "Reopens at"}
              </Typography>
              <Typography sx={{ fontWeight: 900, color: "#0f172a", lineHeight: 1.1 }}>
                {fmtTimeCairo(props.branch.closedUntil)}
              </Typography>
            </Box>
          </Stack>
          <LinearProgress
            variant={canTrackProgress ? "determinate" : "indeterminate"}
            value={canTrackProgress ? progressValue : undefined}
            sx={{
              height: 12,
              borderRadius: 999,
              bgcolor: "rgba(15,23,42,0.08)",
              boxShadow: "inset 0 1px 3px rgba(15,23,42,0.12)",
              "& .MuiLinearProgress-bar": {
                borderRadius: 999,
                background: "linear-gradient(90deg, #16a34a 0%, #22c55e 45%, #86efac 100%)",
                transition: "transform 900ms linear !important",
              },
            }}
          />
          <Typography variant="caption" sx={{ color: "text.secondary", display: "block", lineHeight: 1.45 }}>
            {timerReached
              ? "The timer reached its end. Waiting for the next availability update to confirm the final state."
              : canTrackProgress
                ? props.branch.closureSource === "EXTERNAL"
                  ? `Observed progress ${Math.round(progressValue)}% from first detected close until reopen time.`
                  : `Duration progress ${Math.round(progressValue)}% from close start until reopen time.`
                : "Waiting for the close start timestamp to render duration progress."}
          </Typography>
        </Stack>
      ) : (
        <Box
          sx={{
            borderRadius: 2.6,
            px: 1.05,
            py: 0.95,
            bgcolor: "rgba(248,250,252,0.92)",
            border: "1px solid rgba(148,163,184,0.10)",
          }}
        >
          <Typography variant="caption" sx={{ color: "text.secondary", lineHeight: 1.5 }}>
            {props.branch.status === "OPEN"
              ? "No closure timer is active right now."
              : props.branch.status === "CLOSED"
                ? "The branch is closed from source with no reopen timer."
                : !props.branch.monitorEnabled
                  ? "This branch is paused from monitor cycles."
                  : "Waiting for the next live availability update."}
          </Typography>
        </Box>
      )}
    </Box>
  );
}
