import { Box, Chip, Divider, LinearProgress, Stack, Typography } from "@mui/material";
import type { BranchSnapshot } from "../../../api/types";
import { closureProgress, hasDeadlinePassed } from "../../../shared/lib/progress/closureProgress";
import { fmtCountdown, fmtTimeCairo } from "../../../utils/format";
import { closeReasonChip, statusChip, statusPanelMeta } from "../lib/statusMeta";

export function BranchStatusPanel(props: { branch: BranchSnapshot; nowMs: number }) {
  const chip = statusChip(props.branch);
  const reason = closeReasonChip(props.branch.closeReason);
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
        border: props.branch.status === "TEMP_CLOSE" ? "1px solid rgba(220,38,38,0.18)" : "1px solid rgba(148,163,184,0.14)",
        p: 1.5,
        bgcolor: "rgba(248,250,252,0.7)",
      }}
    >
      <Stack direction="row" justifyContent="space-between" alignItems="center" gap={1}>
        <Typography variant="caption" sx={{ color: "text.secondary", fontWeight: 800 }}>
          Branch Status
        </Typography>
        <Stack direction="row" spacing={0.7} sx={{ flexWrap: "wrap", justifyContent: "flex-end" }}>
          {panel?.sourceLabel ? (
            <Chip
              size="small"
              label={panel.sourceLabel}
              sx={{
                fontWeight: 900,
                bgcolor: "rgba(241,245,249,0.92)",
                color: "#334155",
              }}
            />
          ) : null}
          {reason ? (
            <Chip
              size="small"
              label={reason.label}
              sx={{
                fontWeight: 900,
                ...reason.sx,
              }}
            />
          ) : null}
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
      </Stack>

      <Divider sx={{ my: 1.2 }} />

      <Stack spacing={1}>
        <Typography sx={{ fontWeight: 900, color: panel.tone, lineHeight: 1.15 }}>
          {panel.title}
        </Typography>
        <Typography variant="caption" sx={{ color: "text.secondary", lineHeight: 1.5 }}>
          {panel.caption}
        </Typography>
      </Stack>

      {panel.showTimer && props.branch.status === "TEMP_CLOSE" && props.branch.closedUntil ? (
        <Stack spacing={0.9} sx={{ mt: 1.2 }}>
          <Typography variant="h5" sx={{ fontWeight: 900, color: "#166534", fontVariantNumeric: "tabular-nums", lineHeight: 1 }}>
            {fmtCountdown(props.branch.closedUntil, props.nowMs)}
          </Typography>
          <Typography variant="caption" sx={{ color: "#166534", fontWeight: 700 }}>
            {timerReached ? "Window reached at" : "Reopens at"} {fmtTimeCairo(props.branch.closedUntil)}
          </Typography>
          <LinearProgress
            variant={canTrackProgress ? "determinate" : "indeterminate"}
            value={canTrackProgress ? progressValue : undefined}
            sx={{
              height: 10,
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
          <Typography variant="caption" sx={{ color: "text.secondary" }}>
            {timerReached
              ? "The timer reached its end. Waiting for the next availability update to confirm the final state."
              : canTrackProgress
                ? props.branch.closureSource === "EXTERNAL"
                  ? `Observed progress ${Math.round(progressValue)}% from first detected close until reopen time.`
                  : `Duration progress ${Math.round(progressValue)}% from close start until reopen time.`
                : "Waiting for the close start timestamp to render duration progress."}
          </Typography>
        </Stack>
      ) : null}
    </Box>
  );
}
