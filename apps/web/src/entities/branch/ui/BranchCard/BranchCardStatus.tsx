import { Box, Chip, LinearProgress, Stack, Typography } from "@mui/material";
import { memo } from "react";
import type { BranchSnapshot } from "../../../../api/types";
import { fmtCountdown, fmtTimeCairo } from "../../../../utils/format";
import { statusMeta } from "./branchCardViewModel";

function BranchCardStatusBase(props: {
  branch: BranchSnapshot;
  nowMs: number;
  progressValue: number;
  canTrackProgress: boolean;
  timerReached: boolean;
}) {
  const meta = statusMeta(props.branch.status);

  return (
    <Box
      sx={{
        minWidth: 0,
        p: 0.25,
        pl: { lg: 0.5 },
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        textAlign: "center",
      }}
    >
      <Stack direction="column" alignItems="center" gap={0.6} sx={{ mb: 0.8 }}>
        <Typography variant="caption" sx={{ fontWeight: 800, color: meta.titleColor, textAlign: "center" }}>
          Branch Status
        </Typography>
        <Chip
          label={meta.label}
          size="small"
          sx={{
            border: "1px solid",
            fontWeight: 900,
            ...meta.chipSx,
          }}
        />
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
              textAlign: "center",
            }}
          >
            {fmtCountdown(props.branch.closedUntil, props.nowMs)}
          </Typography>
          <Typography variant="caption" sx={{ color: "#166534", fontWeight: 700, textAlign: "center" }}>
            {props.timerReached ? "Window reached at" : "Reopens at"} {fmtTimeCairo(props.branch.closedUntil)}
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
          {!props.timerReached && props.canTrackProgress ? (
            <Typography variant="caption" sx={{ color: "text.secondary", textAlign: "center", lineHeight: 1.35 }}>
              Duration progress {Math.round(props.progressValue)}%
            </Typography>
          ) : null}
          {props.timerReached ? (
            <Typography variant="caption" sx={{ color: "text.secondary", textAlign: "center", lineHeight: 1.35 }}>
              Waiting for the next availability update.
            </Typography>
          ) : null}
        </Stack>
      ) : meta.note ? (
        <Typography variant="body2" sx={{ color: "text.secondary", lineHeight: 1.55, textAlign: "center" }}>
          {meta.note}
        </Typography>
      ) : null}
    </Box>
  );
}

export const BranchCardStatus = memo(BranchCardStatusBase);
