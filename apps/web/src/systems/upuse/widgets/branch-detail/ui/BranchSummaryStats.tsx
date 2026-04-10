import { Box, Typography } from "@mui/material";
import { fmtInt } from "../../../utils/format";

function formatPickerCount(count: number) {
  return `${fmtInt(count)} picker${count === 1 ? "" : "s"}`;
}

function PrepAndPickersStat(props: { preparingNow: number; pickerCount: number }) {
  return (
    <Box
      sx={{
        borderRadius: 1.8,
        p: 0.95,
        minHeight: { xs: 96, sm: 102 },
        bgcolor: "rgba(248,250,252,0.98)",
        border: "1px solid rgba(148,163,184,0.12)",
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        alignItems: "center",
        textAlign: "center",
      }}
    >
      <Typography variant="caption" sx={{ color: "text.secondary", fontWeight: 800 }}>
        In Prep
      </Typography>
      <Typography
        sx={{
          mt: 0.32,
          fontWeight: 900,
          color: "#0f172a",
          lineHeight: 1.02,
          fontSize: { xs: 24, sm: 26 },
        }}
      >
        {fmtInt(props.preparingNow)}
      </Typography>
      <Box
        sx={{
          mt: 0.6,
          px: 0.78,
          py: 0.28,
          borderRadius: 999,
          bgcolor: "rgba(14,165,233,0.08)",
          color: "#0f766e",
          fontSize: 10.5,
          fontWeight: 900,
          lineHeight: 1,
          border: "1px solid rgba(14,165,233,0.14)",
          display: "inline-flex",
          alignItems: "center",
          gap: 0.55,
          boxShadow: "inset 0 1px 0 rgba(255,255,255,0.6)",
        }}
      >
        <Box
          sx={{
            width: 6.5,
            height: 6.5,
            borderRadius: "50%",
            bgcolor: "#14b8a6",
            flexShrink: 0,
          }}
        />
        <Box component="span">{formatPickerCount(props.pickerCount)}</Box>
      </Box>
    </Box>
  );
}

function SummaryStat(props: {
  label: string;
  value: number;
  prominence?: "primary" | "secondary";
  emphasize?: "success" | "danger";
}) {
  const accent =
    props.emphasize === "danger"
      ? { color: "#b91c1c", bg: "rgba(254,242,242,0.9)" }
      : props.emphasize === "success"
        ? { color: "#15803d", bg: "rgba(240,253,244,0.9)" }
        : { color: "#0f172a", bg: "rgba(248,250,252,0.9)" };

  return (
    <Box
      sx={{
        borderRadius: props.prominence === "primary" ? 1.8 : 1.65,
        p: props.prominence === "primary" ? 0.95 : 0.85,
        bgcolor: accent.bg,
        border: "1px solid rgba(148,163,184,0.12)",
        textAlign: "left",
      }}
    >
      <Typography variant="caption" sx={{ color: "text.secondary", fontWeight: 800 }}>
        {props.label}
      </Typography>
      <Typography
        sx={{
          mt: 0.22,
          fontWeight: 900,
          color: accent.color,
          lineHeight: 1.05,
          fontSize: props.prominence === "primary" ? { xs: 20, sm: 22 } : { xs: 16.5, sm: 18 },
        }}
      >
        {fmtInt(props.value)}
      </Typography>
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
  preparingNow?: number;
  pickerCount: number;
}) {
  return (
    <Box sx={{ display: "grid", gap: 0.8 }}>
      <Box
        sx={{
          display: "grid",
          gap: 0.8,
          gridTemplateColumns: { xs: "repeat(2, minmax(0, 1fr))", md: "repeat(3, minmax(0, 1fr))" },
        }}
      >
        <Box sx={{ gridColumn: { xs: "1 / -1", md: "auto" } }}>
          <PrepAndPickersStat preparingNow={props.preparingNow ?? 0} pickerCount={props.pickerCount} />
        </Box>
        <SummaryStat
          label="Unassigned"
          value={props.totals.unassignedNow}
          prominence="primary"
          emphasize={props.totals.unassignedNow > 0 ? "danger" : "success"}
        />
        <SummaryStat
          label="Late"
          value={props.totals.lateNow}
          prominence="primary"
          emphasize={props.totals.lateNow > 0 ? "danger" : "success"}
        />
      </Box>

      <Box
        sx={{
          display: "grid",
          gap: 0.8,
          gridTemplateColumns: { xs: "repeat(2, minmax(0, 1fr))", md: "repeat(3, minmax(0, 1fr))" },
        }}
      >
        <SummaryStat label="Total" value={props.totals.totalToday} prominence="secondary" />
        <SummaryStat label="Active" value={props.totals.activeNow} prominence="secondary" />
        <SummaryStat label="Cancelled" value={props.totals.cancelledToday} prominence="secondary" />
      </Box>
    </Box>
  );
}
