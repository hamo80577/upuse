import { Box, Stack, Typography } from "@mui/material";
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
  };
  preparingNow: number;
  pickerCount: number;
  fetchedAt?: string | null;
}) {
  return (
    <Stack spacing={1.2}>
      <Box
        sx={{
          display: "grid",
          gap: 1.2,
          gridTemplateColumns: { xs: "1fr", lg: "minmax(300px, 0.95fr) minmax(0, 1.25fr)" },
        }}
      >
        <BranchStatusPanel branch={props.branch} nowMs={props.nowMs} />

        <Box
          sx={{
            borderRadius: 3.2,
            border: "1px solid rgba(148,163,184,0.14)",
            bgcolor: "rgba(255,255,255,0.94)",
            boxShadow: "0 14px 34px rgba(15,23,42,0.05)",
            px: { xs: 1.2, sm: 1.45 },
            py: { xs: 1.2, sm: 1.35 },
          }}
        >
          <Typography variant="caption" sx={{ color: "text.secondary", fontWeight: 800 }}>
            Live Operations
          </Typography>
          <Typography sx={{ mt: 0.25, fontWeight: 900, color: "#0f172a", lineHeight: 1.15 }}>
            Current queue pressure and today&apos;s branch flow
          </Typography>
          <Typography variant="caption" sx={{ mt: 0.45, display: "block", color: "#64748b", lineHeight: 1.45 }}>
            {props.fetchedAt
              ? "Live detail is reading from the latest local orders cache sync."
              : "Live detail is using the latest monitor snapshot right now."}
          </Typography>

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
