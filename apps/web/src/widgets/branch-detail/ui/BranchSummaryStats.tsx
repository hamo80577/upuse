import { Box, Typography } from "@mui/material";
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
}) {
  return (
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
  );
}
