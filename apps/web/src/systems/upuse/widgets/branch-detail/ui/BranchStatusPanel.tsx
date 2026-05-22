import AccessTimeFilledRoundedIcon from "@mui/icons-material/AccessTimeFilledRounded";
import BoltRoundedIcon from "@mui/icons-material/BoltRounded";
import GroupsRoundedIcon from "@mui/icons-material/GroupsRounded";
import PersonOffRoundedIcon from "@mui/icons-material/PersonOffRounded";
import ScheduleRoundedIcon from "@mui/icons-material/ScheduleRounded";
import SettingsSuggestRoundedIcon from "@mui/icons-material/SettingsSuggestRounded";
import StorefrontRoundedIcon from "@mui/icons-material/StorefrontRounded";
import { Box, Chip, Divider, LinearProgress, Stack, Typography } from "@mui/material";
import type { BranchSnapshot } from "../../../api/types";
import {
  availabilitySubtypeChip,
  hasTimerBackedAvailability,
  resolveAvailabilityKind,
  resolveSourceClosedReason,
} from "../../../shared/lib/branch/availabilityMeta";
import { closureProgress, hasDeadlinePassed } from "../../../shared/lib/progress/closureProgress";
import { fmtCountdown, fmtTimeCairo } from "../../../utils/format";
import { closeReasonMeta, statusChip, statusPanelMeta } from "../lib/statusMeta";

function sourceWindowMeta(branch: BranchSnapshot, sourceLabel: string | null) {
  if (!sourceLabel) return null;

  if (branch.highDemandSource === "UPUSE" && (sourceLabel === "highDemand" || branch.vssGroup === "highDemand")) {
    return {
      label: "UPuse High Demand",
      title: "State",
      tone: "#1d4ed8",
      background: "rgba(219,234,254,0.96)",
      border: "rgba(96,165,250,0.26)",
      icon: <BoltRoundedIcon sx={{ fontSize: 18 }} />,
    };
  }

  if (sourceLabel === "UPuse" || branch.closureSource === "UPUSE" || branch.closedByUpuse) {
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
    title: "State",
    tone: "#334155",
    background: "rgba(248,250,252,0.98)",
    border: "rgba(148,163,184,0.16)",
    icon: <StorefrontRoundedIcon sx={{ fontSize: 18 }} />,
  };
}

function fallbackStateMeta(branch: BranchSnapshot, kind: ReturnType<typeof resolveAvailabilityKind>) {
  if (kind === "highDemand" && branch.highDemandSource === "UPUSE") {
    return {
      label: "UPuse High Demand",
      title: "State",
      tone: "#1d4ed8",
      background: "rgba(219,234,254,0.96)",
      border: "rgba(96,165,250,0.26)",
      icon: <BoltRoundedIcon sx={{ fontSize: 18 }} />,
    };
  }

  if (kind === "open" || branch.status === "OPEN") {
    return {
      label: "Open",
      title: "State",
      tone: "#166534",
      background: "rgba(220,252,231,0.96)",
      border: "rgba(34,197,94,0.18)",
      icon: <StorefrontRoundedIcon sx={{ fontSize: 18 }} />,
    };
  }

  return null;
}

function triggerIcon(reason?: BranchSnapshot["closeReason"]) {
  if (reason === "LATE") return <AccessTimeFilledRoundedIcon sx={{ fontSize: 18 }} />;
  if (reason === "UNASSIGNED") return <PersonOffRoundedIcon sx={{ fontSize: 18 }} />;
  if (reason === "CAPACITY") return <GroupsRoundedIcon sx={{ fontSize: 18 }} />;
  if (reason === "CAPACITY_HOUR") return <ScheduleRoundedIcon sx={{ fontSize: 18 }} />;
  return null;
}

export function BranchStatusPanel(props: { branch: BranchSnapshot; nowMs: number }) {
  const chip = statusChip(props.branch);
  const panel = statusPanelMeta(props.branch);
  const availabilityChip = availabilitySubtypeChip(props.branch);
  const source = sourceWindowMeta(props.branch, panel.sourceLabel);
  const kind = resolveAvailabilityKind(props.branch);
  const stateSource = source ?? fallbackStateMeta(props.branch, kind);
  const reason = kind === "upuseTempClose" ? closeReasonMeta(props.branch.closeReason) : null;
  const reasonIcon = kind === "upuseTempClose" ? triggerIcon(props.branch.closeReason) : null;
  const sourceClosedReason = resolveSourceClosedReason(props.branch);
  const progressValue = closureProgress(props.branch.closeStartedAt, props.branch.closedUntil, props.nowMs);
  const canTrackProgress = Boolean(hasTimerBackedAvailability(props.branch) && props.branch.closeStartedAt);
  const timerReached = hasDeadlinePassed(props.branch.closedUntil, props.nowMs);
  const showTimer = panel.showTimer && hasTimerBackedAvailability(props.branch) && Boolean(props.branch.closedUntil);

  return (
    <Box
      sx={{
        borderRadius: 2.25,
        border: props.branch.status === "TEMP_CLOSE" ? "1px solid rgba(220,38,38,0.16)" : "1px solid rgba(148,163,184,0.16)",
        p: { xs: 1.15, sm: 1.35 },
        background:
          props.branch.status === "TEMP_CLOSE"
            ? "linear-gradient(180deg, rgba(255,255,255,0.98) 0%, rgba(255,247,247,0.92) 100%)"
            : props.branch.highDemandSource === "UPUSE"
              ? "linear-gradient(180deg, rgba(255,255,255,0.99) 0%, rgba(239,246,255,0.94) 100%)"
              : "linear-gradient(180deg, rgba(255,255,255,0.98) 0%, rgba(248,250,252,0.92) 100%)",
        boxShadow: "0 16px 34px rgba(15,23,42,0.07)",
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

      {availabilityChip ? (
        <Stack direction="row" spacing={0.7} sx={{ mt: 0.9, flexWrap: "wrap", rowGap: 0.7 }}>
          <Chip
            size="small"
            label={availabilityChip.label}
            sx={{
              fontWeight: 900,
              border: "1px solid",
              ...availabilityChip.sx,
            }}
          />
        </Stack>
      ) : null}

      <Typography variant="body2" sx={{ mt: 0.75, color: "text.secondary", lineHeight: 1.5, fontSize: { xs: 13, sm: 13.5 } }}>
        {panel.caption}
      </Typography>

      {stateSource || (reason && reasonIcon) ? (
        <Stack
          direction={{ xs: "column", sm: "row" }}
          spacing={0.7}
          sx={{ mt: 0.95, alignItems: { sm: "stretch" } }}
        >
          {stateSource ? (
            <Box
              sx={{
                flex: 1,
                minWidth: 0,
                borderRadius: 1.9,
                px: 0.9,
                py: 0.78,
                bgcolor: "rgba(248,250,252,0.9)",
                border: "1px solid rgba(226,232,240,0.92)",
                boxShadow: "inset 0 1px 0 rgba(255,255,255,0.55)",
              }}
            >
              <Stack direction="row" spacing={0.8} alignItems="center">
                <Box
                  sx={{
                    width: 30,
                    height: 30,
                    borderRadius: "10px",
                    display: "grid",
                    placeItems: "center",
                    bgcolor: stateSource.background,
                    color: stateSource.tone,
                    border: `1px solid ${stateSource.border}`,
                    flexShrink: 0,
                  }}
                >
                  {stateSource.icon}
                </Box>
                <Box sx={{ minWidth: 0 }}>
                  <Typography variant="caption" sx={{ color: "#64748b", fontWeight: 800, lineHeight: 1.1 }}>
                    {stateSource.title}
                  </Typography>
                  <Typography sx={{ mt: 0.16, fontWeight: 800, color: "#0f172a", lineHeight: 1.22, fontSize: 13 }}>
                    {stateSource.label}
                  </Typography>
                </Box>
              </Stack>
            </Box>
          ) : null}

          {reason && reasonIcon ? (
            <Box
              aria-label={reason.label}
              sx={{
                flex: stateSource ? { sm: "0 1 44%" } : 1,
                minWidth: 0,
                borderRadius: 1.9,
                px: 0.9,
                py: 0.78,
                bgcolor: "rgba(248,250,252,0.9)",
                border: "1px solid rgba(226,232,240,0.92)",
                boxShadow: "inset 0 1px 0 rgba(255,255,255,0.55)",
              }}
            >
              <Stack direction="row" spacing={0.8} alignItems="center">
                <Box
                  sx={{
                    width: 30,
                    height: 30,
                    borderRadius: "10px",
                    display: "grid",
                    placeItems: "center",
                    bgcolor: reason.background,
                    color: reason.tone,
                    border: `1px solid ${reason.border}`,
                    flexShrink: 0,
                  }}
                >
                  {reasonIcon}
                </Box>
                <Box sx={{ minWidth: 0 }}>
                  <Typography variant="caption" sx={{ color: "#64748b", fontWeight: 800, lineHeight: 1.1 }}>
                    Trigger
                  </Typography>
                  <Typography sx={{ mt: 0.16, fontWeight: 800, color: "#0f172a", lineHeight: 1.22, fontSize: 13 }}>
                    {reason.label}
                  </Typography>
                </Box>
              </Stack>
            </Box>
          ) : null}
        </Stack>
      ) : null}

      {kind === "sourceIssue" && sourceClosedReason ? (
        <Box
          sx={{
            mt: 0.95,
            borderRadius: 1.9,
            px: 0.9,
            py: 0.78,
            bgcolor: "rgba(254,242,242,0.8)",
            border: "1px solid rgba(248,113,113,0.18)",
          }}
        >
          <Typography variant="caption" sx={{ color: "#991b1b", fontWeight: 800, lineHeight: 1.1 }}>
            closedReason
          </Typography>
          <Typography sx={{ mt: 0.18, fontWeight: 800, color: "#7f1d1d", lineHeight: 1.3, fontSize: 13 }}>
            {sourceClosedReason}
          </Typography>
        </Box>
      ) : null}

      <Divider sx={{ my: 1 }} />

      {showTimer ? (
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
                ? kind === "sourceShortClosure"
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
              ? kind === "highDemand"
                ? props.branch.highDemandSource === "UPUSE"
                  ? "The branch stays open while UPuse scheduled highDemand is active."
                  : "The branch stays open while VSS reports highDemand."
                : "No closure timer is active right now."
              : props.branch.status === "CLOSED"
                ? panel.footerCaption
                  ? panel.footerCaption
                  : "The branch is closed from source with no reopen timer."
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
