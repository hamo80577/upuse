import { Box, Typography } from "@mui/material";
import { memo } from "react";
import { fmtInt } from "../../../../utils/format";
import type { BranchSnapshot } from "../../../../api/types";

function MetricTile(props: {
  label: string;
  value: number;
  tone?: "neutral" | "late" | "unassigned";
  mobileSpan?: number;
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
        minHeight: { xs: 62, md: 68 },
        p: { xs: 0.95, md: 0.25 },
        gridColumn: { xs: `span ${props.mobileSpan ?? 2}`, md: "span 1" },
        borderLeft: { xs: "none", md: "2px solid" },
        borderTop: { xs: "2px solid", md: "none" },
        borderColor: toneSx.accent,
        pl: { xs: 1.05, md: 1 },
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        alignItems: { xs: "flex-start", md: "center" },
        textAlign: { xs: "left", md: "center" },
        borderRadius: { xs: 2.6, md: 0 },
        bgcolor: {
          xs:
            tone === "late"
              ? zeroIsHealthy
                ? "rgba(240,253,244,0.95)"
                : "rgba(255,247,237,0.95)"
              : tone === "unassigned"
                ? zeroIsHealthy
                  ? "rgba(240,253,244,0.95)"
                  : "rgba(254,242,242,0.95)"
                : "rgba(248,250,252,0.98)",
          md: "transparent",
        },
        border: { xs: "1px solid rgba(148,163,184,0.12)", md: "none" },
        boxShadow: { xs: "inset 0 1px 0 rgba(255,255,255,0.65)", md: "none" },
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
          fontSize: { xs: 10.5, md: 12 },
        }}
      >
        {props.label}
      </Typography>
      <Typography variant="h6" sx={{ mt: 0.25, fontWeight: 900, color: toneSx.valueColor, lineHeight: 1.05, fontSize: { xs: 22, md: 20 } }}>
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
        columnGap: { xs: 0.75, md: 1.15 },
        rowGap: { xs: 0.75, md: 0.8 },
        alignItems: "stretch",
        gridTemplateColumns: {
          xs: "repeat(6, minmax(0, 1fr))",
          md: "repeat(5, minmax(0, 1fr))",
        },
      }}
    >
      <MetricTile label="Total" value={m.totalToday} mobileSpan={2} />
      <MetricTile label="Cancelled" value={m.cancelledToday} mobileSpan={2} />
      <MetricTile label="Active" value={m.activeNow} mobileSpan={2} />
      <MetricTile label="Late" value={m.lateNow} tone="late" mobileSpan={3} />
      <MetricTile label="Unassigned" value={m.unassignedNow} tone="unassigned" mobileSpan={3} />
    </Box>
  );
}

export const BranchCardMetrics = memo(BranchCardMetricsBase);
