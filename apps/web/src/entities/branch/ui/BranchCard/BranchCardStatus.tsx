import AccessTimeFilledRoundedIcon from "@mui/icons-material/AccessTimeFilledRounded";
import GroupsRoundedIcon from "@mui/icons-material/GroupsRounded";
import PersonOffRoundedIcon from "@mui/icons-material/PersonOffRounded";
import ScheduleRoundedIcon from "@mui/icons-material/ScheduleRounded";
import { Box, Chip, LinearProgress, Stack, Typography } from "@mui/material";
import { memo } from "react";
import type { BranchSnapshot } from "../../../../api/types";
import { fmtCountdown, fmtTimeCairo } from "../../../../utils/format";
import { statusMeta } from "./branchCardViewModel";

function triggerMeta(reason?: BranchSnapshot["closeReason"]) {
  if (reason === "LATE") {
    return {
      label: "Late Trigger",
      tone: "#9a3412",
      background: "rgba(255,237,213,0.94)",
      border: "rgba(251,146,60,0.22)",
      icon: <AccessTimeFilledRoundedIcon sx={{ fontSize: 13 }} />,
    };
  }
  if (reason === "UNASSIGNED") {
    return {
      label: "Unassigned Trigger",
      tone: "#b91c1c",
      background: "rgba(254,226,226,0.94)",
      border: "rgba(248,113,113,0.22)",
      icon: <PersonOffRoundedIcon sx={{ fontSize: 13 }} />,
    };
  }
  if (reason === "CAPACITY") {
    return {
      label: "Capacity Trigger",
      tone: "#155e75",
      background: "rgba(236,254,255,0.96)",
      border: "rgba(34,211,238,0.22)",
      icon: <GroupsRoundedIcon sx={{ fontSize: 13 }} />,
    };
  }
  if (reason === "CAPACITY_HOUR") {
    return {
      label: "Capacity / Hour Trigger",
      tone: "#1d4ed8",
      background: "rgba(239,246,255,0.96)",
      border: "rgba(96,165,250,0.24)",
      icon: <ScheduleRoundedIcon sx={{ fontSize: 13 }} />,
    };
  }
  return null;
}

function BranchCardStatusBase(props: {
  branch: BranchSnapshot;
  nowMs: number;
  progressValue: number;
  canTrackProgress: boolean;
  timerReached: boolean;
}) {
  const meta = statusMeta(props.branch);
  const trigger = props.branch.status !== "OPEN" ? triggerMeta(props.branch.closeReason) : null;
  const reopenAtLabel = `${props.timerReached ? "Window reached at" : "Reopens at"} ${fmtTimeCairo(props.branch.closedUntil)}`;
  const progressLabel = `Duration progress ${Math.round(props.progressValue)}%`;

  return (
    <Box
      sx={{
        minWidth: 0,
        p: { xs: 1, md: 0.25 },
        pl: { lg: 0.5 },
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        textAlign: { xs: "left", md: "center" },
        borderRadius: { xs: 2.8, md: 0 },
        bgcolor: {
          xs: props.branch.status === "TEMP_CLOSE" ? "rgba(255,241,242,0.48)" : "rgba(248,250,252,0.9)",
          md: "transparent",
        },
        border: { xs: "1px solid rgba(148,163,184,0.12)", md: "none" },
      }}
    >
      <Stack direction="column" alignItems={{ xs: "flex-start", md: "center" }} gap={0.6} sx={{ mb: 0.8 }}>
        <Typography variant="caption" sx={{ fontWeight: 800, color: meta.titleColor, textAlign: "center", display: { xs: "none", sm: "block" } }}>
          Branch Status
        </Typography>
        <Box
          sx={{
            display: "flex",
            flexWrap: "wrap",
            alignItems: "center",
            justifyContent: { xs: "flex-start", md: "center" },
            gap: 0.55,
          }}
        >
          <Chip
            label={meta.label}
            size="small"
            sx={{
              border: "1px solid",
              fontWeight: 900,
              ...meta.chipSx,
            }}
          />
          {trigger ? (
            <Box
              aria-label={trigger.label}
              sx={{
                display: "inline-flex",
                alignItems: "center",
                gap: 0.55,
                maxWidth: "100%",
                px: 0.7,
                py: 0.35,
                borderRadius: 999,
                bgcolor: trigger.background,
                color: trigger.tone,
                border: `1px solid ${trigger.border}`,
                boxShadow: "inset 0 1px 0 rgba(255,255,255,0.55)",
              }}
            >
              <Box
                sx={{
                  width: 18,
                  height: 18,
                  borderRadius: 999,
                  display: "grid",
                  placeItems: "center",
                  bgcolor: "rgba(255,255,255,0.74)",
                  color: "inherit",
                  flexShrink: 0,
                }}
              >
                {trigger.icon}
              </Box>
              <Typography
                component="span"
                sx={{
                  fontSize: 11.5,
                  fontWeight: 900,
                  lineHeight: 1.05,
                  color: "inherit",
                }}
              >
                {trigger.label}
              </Typography>
            </Box>
          ) : null}
        </Box>
      </Stack>

      {props.branch.status === "TEMP_CLOSE" && props.branch.closedUntil ? (
        <Stack spacing={0.7}>
          <Typography
            variant="h6"
            sx={{
              fontWeight: 900,
              color: "#166534",
              lineHeight: 1,
              fontVariantNumeric: "tabular-nums",
              textAlign: { xs: "left", md: "center" },
              fontSize: { xs: 28, md: 24 },
            }}
          >
            {fmtCountdown(props.branch.closedUntil, props.nowMs)}
          </Typography>
          <LinearProgress
            variant={props.canTrackProgress ? "determinate" : "indeterminate"}
            value={props.canTrackProgress ? props.progressValue : undefined}
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
          <Typography variant="caption" sx={{ color: "#166534", fontWeight: 700, textAlign: { xs: "left", md: "center" }, display: { xs: "block", sm: "none" } }}>
            {props.timerReached ? "Reached" : "Reopens"} {fmtTimeCairo(props.branch.closedUntil)}
          </Typography>
          {!props.timerReached && props.canTrackProgress ? (
            <Typography variant="caption" sx={{ color: "text.secondary", textAlign: "center", lineHeight: 1.35, display: { xs: "none", sm: "block" } }}>
              {reopenAtLabel} • {progressLabel}
            </Typography>
          ) : null}
          {!props.timerReached && props.canTrackProgress ? (
            <Typography variant="caption" sx={{ color: "text.secondary", textAlign: "center", lineHeight: 1.35, display: { xs: "block", sm: "none" } }}>
              {Math.round(props.progressValue)}% progress
            </Typography>
          ) : null}
          {!props.timerReached && !props.canTrackProgress ? (
            <Typography variant="caption" sx={{ color: "text.secondary", textAlign: "center", lineHeight: 1.35, display: { xs: "none", sm: "block" } }}>
              {reopenAtLabel}
            </Typography>
          ) : null}
          {props.timerReached ? (
            <Typography variant="caption" sx={{ color: "text.secondary", textAlign: "center", lineHeight: 1.35, display: { xs: "none", sm: "block" } }}>
              {reopenAtLabel} • Waiting for the next availability update.
            </Typography>
          ) : null}
          {props.timerReached ? (
            <Typography variant="caption" sx={{ color: "text.secondary", textAlign: "center", lineHeight: 1.35, display: { xs: "block", sm: "none" } }}>
              Waiting update
            </Typography>
          ) : null}
        </Stack>
      ) : meta.note ? (
        <Typography variant="body2" sx={{ color: "text.secondary", lineHeight: 1.55, textAlign: "center", display: { xs: "none", sm: "block" } }}>
          {meta.note}
        </Typography>
      ) : null}
    </Box>
  );
}

export const BranchCardStatus = memo(BranchCardStatusBase);
