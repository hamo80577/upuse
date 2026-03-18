import AccessTimeFilledRoundedIcon from "@mui/icons-material/AccessTimeFilledRounded";
import GroupsRoundedIcon from "@mui/icons-material/GroupsRounded";
import PersonOffRoundedIcon from "@mui/icons-material/PersonOffRounded";
import SettingsSuggestRoundedIcon from "@mui/icons-material/SettingsSuggestRounded";
import StorefrontRoundedIcon from "@mui/icons-material/StorefrontRounded";
import { Box, Chip, Divider, LinearProgress, Stack, Tooltip, Typography } from "@mui/material";
import type { BranchSnapshot } from "../../../api/types";
import { closureProgress, hasDeadlinePassed } from "../../../shared/lib/progress/closureProgress";
import { fmtCountdown, fmtTimeCairo } from "../../../utils/format";
import { closeReasonMeta, statusChip, statusPanelMeta } from "../lib/statusMeta";

function sourceWindowMeta(branch: BranchSnapshot, sourceLabel: string | null) {
  if (!sourceLabel) return null;

  if (branch.closureSource === "UPUSE" || branch.closedByUpuse) {
    return {
      label: sourceLabel,
      title: "Control Source",
      tone: "#155e75",
      background: "rgba(236,254,255,0.96)",
      border: "rgba(34,211,238,0.18)",
      icon: <SettingsSuggestRoundedIcon sx={{ fontSize: 18 }} />,
    };
  }

  return {
    label: sourceLabel,
    title: branch.status === "CLOSED" ? "Current State" : "Source State",
    tone: "#334155",
    background: "rgba(248,250,252,0.98)",
    border: "rgba(148,163,184,0.16)",
    icon: <StorefrontRoundedIcon sx={{ fontSize: 18 }} />,
  };
}

function triggerIcon(reason?: BranchSnapshot["closeReason"]) {
  if (reason === "LATE") return <AccessTimeFilledRoundedIcon sx={{ fontSize: 18 }} />;
  if (reason === "UNASSIGNED") return <PersonOffRoundedIcon sx={{ fontSize: 18 }} />;
  if (reason === "CAPACITY") return <GroupsRoundedIcon sx={{ fontSize: 18 }} />;
  return null;
}

export function BranchStatusPanel(props: { branch: BranchSnapshot; nowMs: number }) {
  const chip = statusChip(props.branch);
  const panel = statusPanelMeta(props.branch);
  const source = sourceWindowMeta(props.branch, panel.sourceLabel);
  const reason = closeReasonMeta(props.branch.closeReason);
  const reasonIcon = triggerIcon(props.branch.closeReason);
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
        borderRadius: 2.25,
        border: props.branch.status === "TEMP_CLOSE" ? "1px solid rgba(220,38,38,0.16)" : "1px solid rgba(148,163,184,0.14)",
        p: { xs: 1.1, sm: 1.2 },
        background:
          props.branch.status === "TEMP_CLOSE"
            ? "linear-gradient(180deg, rgba(255,255,255,0.98) 0%, rgba(255,247,247,0.92) 100%)"
            : "linear-gradient(180deg, rgba(255,255,255,0.98) 0%, rgba(248,250,252,0.92) 100%)",
        boxShadow: "0 12px 26px rgba(15,23,42,0.05)",
      }}
    >
      <Stack direction="row" justifyContent="space-between" alignItems="flex-start" gap={1}>
        <Box>
          <Typography variant="caption" sx={{ color: "text.secondary", fontWeight: 800 }}>
            Status Window
          </Typography>
          <Typography sx={{ mt: 0.25, fontWeight: 900, color: panel.tone, lineHeight: 1.15, fontSize: { xs: 18, sm: 20 } }}>
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

      <Typography variant="body2" sx={{ mt: 0.75, color: "text.secondary", lineHeight: 1.5, fontSize: { xs: 13, sm: 13.5 } }}>
        {panel.caption}
      </Typography>

      {source || (reason && reasonIcon) ? (
        <Stack
          direction={{ xs: "column", sm: "row" }}
          spacing={0.8}
          sx={{ mt: 0.9, alignItems: { sm: "stretch" } }}
        >
          {source ? (
            <Box
              sx={{
                flex: 1,
                minWidth: 0,
                borderRadius: 2,
                px: 0.95,
                py: 0.8,
                bgcolor: source.background,
                border: `1px solid ${source.border}`,
              }}
            >
              <Typography variant="caption" sx={{ color: "text.secondary", fontWeight: 800 }}>
                {source.title}
              </Typography>
              <Stack direction="row" spacing={0.75} alignItems="center" sx={{ mt: 0.45 }}>
                <Box
                  sx={{
                    width: 26,
                    height: 26,
                    borderRadius: "9px",
                    display: "grid",
                    placeItems: "center",
                    bgcolor: "rgba(255,255,255,0.68)",
                    color: source.tone,
                    border: "1px solid rgba(255,255,255,0.7)",
                    flexShrink: 0,
                  }}
                >
                  {source.icon}
                </Box>
                <Typography sx={{ fontWeight: 800, color: source.tone, lineHeight: 1.2, fontSize: 13 }}>
                  {source.label}
                </Typography>
              </Stack>
            </Box>
          ) : null}

          {reason && reasonIcon ? (
            <Tooltip title={reason.label}>
              <Box
                aria-label={reason.label}
                sx={{
                  width: { xs: "100%", sm: 92 },
                  borderRadius: 2,
                  px: 0.95,
                  py: 0.8,
                  bgcolor: reason.background,
                  border: `1px solid ${reason.border}`,
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Typography variant="caption" sx={{ color: "text.secondary", fontWeight: 800 }}>
                  Trigger
                </Typography>
                <Box
                  sx={{
                    mt: 0.45,
                    width: 30,
                    height: 30,
                    borderRadius: "10px",
                    display: "grid",
                    placeItems: "center",
                    bgcolor: "rgba(255,255,255,0.66)",
                    color: reason.tone,
                    border: "1px solid rgba(255,255,255,0.72)",
                  }}
                >
                  {reasonIcon}
                </Box>
              </Box>
            </Tooltip>
          ) : null}
        </Stack>
      ) : null}

      <Divider sx={{ my: 1 }} />

      {panel.showTimer && props.branch.status === "TEMP_CLOSE" && props.branch.closedUntil ? (
        <Stack spacing={0.9} sx={{ mt: 1.2 }}>
          <Stack direction={{ xs: "column", sm: "row" }} justifyContent="space-between" gap={0.95} alignItems={{ xs: "flex-start", sm: "flex-end" }}>
            <Box>
              <Typography variant="caption" sx={{ color: "text.secondary", fontWeight: 800 }}>
                Countdown
              </Typography>
              <Typography sx={{ mt: 0.16, fontWeight: 900, color: "#166534", fontVariantNumeric: "tabular-nums", lineHeight: 1, fontSize: { xs: 34, sm: 38 } }}>
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
            borderRadius: 2,
            px: 0.95,
            py: 0.82,
            bgcolor: "rgba(248,250,252,0.92)",
            border: "1px solid rgba(148,163,184,0.10)",
          }}
        >
          <Typography variant="caption" sx={{ color: "text.secondary", lineHeight: 1.5 }}>
            {props.branch.status === "OPEN"
              ? "No closure timer is active right now."
              : props.branch.status === "CLOSED"
                ? "The branch is closed from source with no reopen timer."
                : panel.footerCaption
                  ? panel.footerCaption
                : !props.branch.monitorEnabled
                  ? "This branch is paused from monitor cycles."
                  : "Waiting for the next live availability update."}
          </Typography>
        </Box>
      )}
    </Box>
  );
}
