import { Box, Chip, Stack, Typography } from "@mui/material";
import type { BranchSnapshot } from "../../../api/types";
import { BranchStatusPanel } from "./BranchStatusPanel";
import { BranchSummaryStats } from "./BranchSummaryStats";

export function BranchDetailOverview(props: {
  branch: BranchSnapshot;
  nowMs: number;
  totals: {
    totalToday: number;
    cancelledToday: number;
    doneToday: number;
    activeNow: number;
    lateNow: number;
    unassignedNow: number;
    onHoldNow: number;
  };
  preparingNow: number;
  pickerCount: number;
  fetchedAt?: string | null;
}) {
  return (
    <Stack spacing={1}>
      <Box
        sx={{
          display: "grid",
          gap: 1.1,
          gridTemplateColumns: { xs: "1fr", lg: "minmax(330px, 0.86fr) minmax(0, 1.34fr)" },
          alignItems: "stretch",
        }}
      >
        <BranchStatusPanel branch={props.branch} nowMs={props.nowMs} />

        <Box
          sx={{
            borderRadius: 2.5,
            border: "1px solid rgba(148,163,184,0.16)",
            bgcolor: "rgba(255,255,255,0.96)",
            background: "linear-gradient(180deg, rgba(255,255,255,0.98) 0%, rgba(248,250,252,0.92) 100%)",
            boxShadow: "0 16px 34px rgba(15,23,42,0.07)",
            px: { xs: 1.15, sm: 1.45 },
            py: { xs: 1.15, sm: 1.35 },
          }}
        >
          <Stack direction={{ xs: "column", sm: "row" }} spacing={1} alignItems={{ xs: "flex-start", sm: "center" }} justifyContent="space-between">
            <Box sx={{ minWidth: 0 }}>
              <Typography variant="caption" sx={{ color: "text.secondary", fontWeight: 800 }}>
                Live Operations
              </Typography>
              <Typography sx={{ mt: 0.2, fontWeight: 900, color: "#0f172a", lineHeight: 1.12, fontSize: { xs: 20, sm: 23 } }}>
                Current queue pressure and today&apos;s branch flow
              </Typography>
              <Typography variant="caption" sx={{ mt: 0.38, display: "block", color: "#64748b", lineHeight: 1.45 }}>
                {props.fetchedAt
                  ? "Latest local orders cache sync is powering this branch workspace."
                  : "Using the latest monitor snapshot while detailed queue data catches up."}
              </Typography>
            </Box>
            <Chip
              size="small"
              label={props.fetchedAt ? "Detail synced" : "Snapshot mode"}
              sx={{
                fontWeight: 900,
                bgcolor: props.fetchedAt ? "rgba(220,252,231,0.92)" : "rgba(239,246,255,0.94)",
                color: props.fetchedAt ? "#166534" : "#1d4ed8",
                border: "1px solid rgba(148,163,184,0.12)",
              }}
            />
          </Stack>

          <Box sx={{ mt: 1.1 }}>
            <BranchSummaryStats
              totals={props.totals}
              preparingNow={props.preparingNow}
              pickerCount={props.pickerCount}
            />
          </Box>
        </Box>
      </Box>
    </Stack>
  );
}
