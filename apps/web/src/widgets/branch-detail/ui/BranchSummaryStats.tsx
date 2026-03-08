import { Box, Typography } from "@mui/material";
import type { ThresholdProfile } from "../../../api/types";
import { fmtInt } from "../../../utils/format";

function SummaryStat(props: { label: string; value: number; emphasize?: "success" | "danger" }) {
  const accent =
    props.emphasize === "danger"
      ? { color: "#b91c1c", bg: "rgba(254,242,242,0.9)" }
      : props.emphasize === "success"
        ? { color: "#15803d", bg: "rgba(240,253,244,0.9)" }
        : { color: "#0f172a", bg: "rgba(248,250,252,0.9)" };

  return (
    <Box sx={{ borderRadius: 2.5, p: 1.1, bgcolor: accent.bg, textAlign: "center" }}>
      <Typography variant="caption" sx={{ color: "text.secondary" }}>
        {props.label}
      </Typography>
      <Typography sx={{ mt: 0.2, fontWeight: 900, color: accent.color }}>{fmtInt(props.value)}</Typography>
    </Box>
  );
}

export function BranchSummaryStats(props: {
  totals: {
    totalToday: number;
    cancelledToday: number;
    doneToday: number;
    activeNow: number;
    lateNow: number;
    unassignedNow: number;
  };
  thresholds?: ThresholdProfile;
}) {
  const stripBorder =
    props.thresholds?.source === "branch"
      ? "rgba(14,165,233,0.28)"
      : props.thresholds?.source === "chain"
        ? "rgba(15,23,42,0.12)"
        : "rgba(148,163,184,0.18)";

  return (
    <Box>
      {props.thresholds ? (
        <Box sx={{ display: "flex", justifyContent: "flex-end", mb: 0.9 }}>
          <Box
            sx={{
              display: "inline-flex",
              alignItems: "stretch",
              borderRadius: 999,
              overflow: "hidden",
              border: `1px solid ${stripBorder}`,
              bgcolor: "rgba(255,255,255,0.92)",
              boxShadow: "0 8px 20px rgba(15,23,42,0.05)",
            }}
          >
            <Box
              sx={{
                px: 1.15,
                py: 0.6,
                display: "flex",
                alignItems: "baseline",
                gap: 0.55,
                bgcolor: "rgba(251,146,60,0.10)",
              }}
            >
              <Typography variant="caption" sx={{ fontWeight: 900, color: "#c2410c" }}>
                L
              </Typography>
              <Typography sx={{ fontWeight: 900, color: "#9a3412", lineHeight: 1 }}>
                {fmtInt(props.thresholds.lateThreshold)}
              </Typography>
            </Box>

            <Box sx={{ width: 1, bgcolor: "rgba(148,163,184,0.18)" }} />

            <Box
              sx={{
                px: 1.15,
                py: 0.6,
                display: "flex",
                alignItems: "baseline",
                gap: 0.55,
                bgcolor: "rgba(239,68,68,0.10)",
              }}
            >
              <Typography variant="caption" sx={{ fontWeight: 900, color: "#b91c1c" }}>
                U
              </Typography>
              <Typography sx={{ fontWeight: 900, color: "#991b1b", lineHeight: 1 }}>
                {fmtInt(props.thresholds.unassignedThreshold)}
              </Typography>
            </Box>
          </Box>
        </Box>
      ) : null}

      <Box
        sx={{
          display: "grid",
          gap: 1,
          gridTemplateColumns: { xs: "repeat(2, minmax(0, 1fr))", md: "repeat(6, minmax(0, 1fr))" },
        }}
      >
        <SummaryStat label="Total" value={props.totals.totalToday} />
        <SummaryStat label="Cancelled" value={props.totals.cancelledToday} />
        <SummaryStat label="Done" value={props.totals.doneToday} />
        <SummaryStat label="Active" value={props.totals.activeNow} />
        <SummaryStat
          label="Late"
          value={props.totals.lateNow}
          emphasize={props.totals.lateNow > 0 ? "danger" : "success"}
        />
        <SummaryStat
          label="Unassigned"
          value={props.totals.unassignedNow}
          emphasize={props.totals.unassignedNow > 0 ? "danger" : "success"}
        />
      </Box>
    </Box>
  );
}
