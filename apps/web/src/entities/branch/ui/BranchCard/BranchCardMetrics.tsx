import { Box, Typography } from "@mui/material";
import { memo, type ReactNode } from "react";
import { fmtInt } from "../../../../utils/format";
import type { BranchSnapshot } from "../../../../api/types";

function MetricTile(props: {
  label: string;
  value: number;
  tone?: "neutral" | "late" | "unassigned";
  mobileSpan?: number;
  badgeText?: ReactNode;
  badgeTone?: "default" | "syncing" | "stale";
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
      {props.badgeText ? (
        <Box
          sx={{
            mt: 0.55,
            px: { xs: 0.68, md: 0.8 },
            py: { xs: 0.22, md: 0.28 },
            borderRadius: 999,
            bgcolor: {
              xs:
                props.badgeTone === "stale"
                  ? "rgba(245,158,11,0.08)"
                  : props.badgeTone === "syncing"
                    ? "rgba(100,116,139,0.08)"
                    : "rgba(14,165,233,0.08)",
              md:
                props.badgeTone === "stale"
                  ? "rgba(245,158,11,0.12)"
                  : props.badgeTone === "syncing"
                    ? "rgba(100,116,139,0.12)"
                    : "rgba(14,165,233,0.12)",
            },
            color:
              props.badgeTone === "stale"
                ? "#9a3412"
                : props.badgeTone === "syncing"
                  ? "#475569"
                  : "#0f766e",
            fontSize: { xs: 9.5, md: 10.5 },
            fontWeight: 900,
            lineHeight: 1,
            border:
              props.badgeTone === "stale"
                ? "1px solid rgba(245,158,11,0.18)"
                : props.badgeTone === "syncing"
                  ? "1px solid rgba(148,163,184,0.18)"
                  : "1px solid rgba(14,165,233,0.14)",
            display: "inline-flex",
            alignItems: "center",
            gap: { xs: 0.42, md: 0.55 },
            boxShadow: { xs: "none", md: "inset 0 1px 0 rgba(255,255,255,0.6)" },
          }}
        >
          <Box
            sx={{
              width: { xs: 5.5, md: 6.5 },
              height: { xs: 5.5, md: 6.5 },
              borderRadius: "50%",
              bgcolor:
                props.badgeTone === "stale"
                  ? "#f59e0b"
                  : props.badgeTone === "syncing"
                    ? "#64748b"
                    : "#14b8a6",
              flexShrink: 0,
            }}
          />
          <Box component="span">{props.badgeText}</Box>
        </Box>
      ) : null}
    </Box>
  );
}

function formatPickerCount(count: number) {
  return `${fmtInt(count)} picker${count === 1 ? "" : "s"}`;
}

function formatPickerBadgeText(count: number, badgeState: "fresh" | "syncing" | "stale") {
  if (badgeState === "syncing") return "Syncing";
  if (badgeState === "stale") return `${formatPickerCount(count)} stale`;
  return formatPickerCount(count);
}

function BranchCardMetricsBase(props: {
  metrics: BranchSnapshot["metrics"];
  preparingNow: number;
  preparingPickersNow: number;
  pickerBadgeState: "fresh" | "syncing" | "stale";
}) {
  const m = props.metrics;
  const preparingPickerBadgeText = formatPickerBadgeText(props.preparingPickersNow, props.pickerBadgeState);

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
      <MetricTile
        label="In Prep"
        value={props.preparingNow}
        badgeText={preparingPickerBadgeText}
        badgeTone={props.pickerBadgeState === "fresh" ? "default" : props.pickerBadgeState}
        mobileSpan={2}
      />
      <MetricTile label="Active" value={m.activeNow} mobileSpan={2} />
      <MetricTile label="Late" value={m.lateNow} tone="late" mobileSpan={3} />
      <MetricTile label="Unassigned" value={m.unassignedNow} tone="unassigned" mobileSpan={3} />
    </Box>
  );
}

export const BranchCardMetrics = memo(BranchCardMetricsBase);
