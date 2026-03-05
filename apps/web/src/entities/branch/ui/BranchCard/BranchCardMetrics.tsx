import { Box, Typography } from "@mui/material";
import { memo } from "react";
import { fmtInt } from "../../../../utils/format";
import type { BranchSnapshot } from "../../../../api/types";

function MetricTile(props: {
  label: string;
  value: number;
  tone?: "neutral" | "late" | "unassigned";
}) {
  const tone = props.tone ?? "neutral";
  const zeroIsHealthy = (tone === "late" || tone === "unassigned") && props.value === 0;
  const toneSx =
    zeroIsHealthy
      ? {
          accent: "#16a34a",
          valueColor: "#15803d",
          labelColor: "#15803d",
        }
      : tone === "late"
        ? {
            accent: "#9a3412",
            valueColor: "#9a3412",
            labelColor: "#9a3412",
          }
        : tone === "unassigned"
          ? {
              accent: "#b91c1c",
              valueColor: "#b91c1c",
              labelColor: "#b91c1c",
            }
          : {
              accent: "rgba(148, 163, 184, 0.45)",
              valueColor: "#0f172a",
              labelColor: "#475569",
            };

  return (
    <Box
      sx={{
        minWidth: 0,
        minHeight: { xs: 58, md: 68 },
        p: 0.25,
        borderLeft: "2px solid",
        borderColor: toneSx.accent,
        pl: 1,
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        alignItems: "center",
        textAlign: "center",
      }}
    >
      <Typography
        variant="caption"
        sx={{
          color: toneSx.labelColor,
          fontWeight: tone === "neutral" ? 700 : 800,
          display: "block",
          whiteSpace: "normal",
          lineHeight: 1.2,
        }}
      >
        {props.label}
      </Typography>
      <Typography variant="h6" sx={{ mt: 0.2, fontWeight: 900, color: toneSx.valueColor, lineHeight: 1.1 }}>
        {fmtInt(props.value)}
      </Typography>
    </Box>
  );
}

function BranchCardMetricsBase(props: { metrics: BranchSnapshot["metrics"] }) {
  const m = props.metrics;
  return (
    <Box
      sx={{
        display: "grid",
        columnGap: { xs: 0.85, md: 1.15 },
        rowGap: 0.8,
        alignItems: "stretch",
        gridTemplateColumns: {
          xs: "repeat(2, minmax(0, 1fr))",
          md: "repeat(5, minmax(0, 1fr))",
        },
      }}
    >
      <MetricTile label="Total" value={m.totalToday} />
      <MetricTile label="Cancelled" value={m.cancelledToday} />
      <MetricTile label="Active" value={m.activeNow} />
      <MetricTile label="Late" value={m.lateNow} tone="late" />
      <MetricTile label="Unassigned" value={m.unassignedNow} tone="unassigned" />
    </Box>
  );
}

export const BranchCardMetrics = memo(BranchCardMetricsBase);
