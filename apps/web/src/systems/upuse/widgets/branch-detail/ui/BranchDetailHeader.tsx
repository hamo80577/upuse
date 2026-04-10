import CloseIcon from "@mui/icons-material/Close";
import RefreshRoundedIcon from "@mui/icons-material/RefreshRounded";
import { Box, IconButton, Stack, Tooltip, Typography } from "@mui/material";
import type { BranchSnapshot } from "../../../api/types";

export function BranchDetailHeader(props: {
  branch: BranchSnapshot | null;
  detailNotFound: boolean;
  refreshing: boolean;
  onRefresh: () => void;
  onClose: () => void;
}) {
  return (
    <Box
      sx={{
        borderRadius: 2.25,
        border: "1px solid rgba(148,163,184,0.14)",
        bgcolor: "rgba(255,255,255,0.96)",
        boxShadow: "0 12px 28px rgba(15,23,42,0.055)",
        px: { xs: 1.05, sm: 1.35 },
        py: { xs: 0.85, sm: 0.92 },
      }}
    >
      <Stack direction={{ xs: "column", md: "row" }} justifyContent="space-between" alignItems={{ xs: "stretch", md: "center" }} gap={{ xs: 0.8, md: 1.05 }}>
        <Box sx={{ minWidth: 0, flex: 1, pr: { md: 1 } }}>
          <Typography
            sx={{
              fontWeight: 900,
              lineHeight: 1.15,
              fontSize: { xs: 19, sm: 23 },
              color: "#0f172a",
              letterSpacing: -0.28,
            }}
          >
            {props.detailNotFound ? "Branch detail unavailable" : props.branch?.name ?? "Branch detail"}
          </Typography>
          <Typography variant="body2" sx={{ mt: 0.2, color: "#475569", fontWeight: 700, fontSize: { xs: 13, sm: 13.5 } }}>
            {props.detailNotFound
              ? "This branch mapping no longer exists."
                : props.branch?.chainName?.trim()
                  ? props.branch.chainName.trim()
                  : "Operations detail"}
          </Typography>
        </Box>

        <Stack
          spacing={0.6}
          alignItems={{ xs: "stretch", md: "flex-end" }}
          sx={{ flexShrink: 0, minWidth: { md: 0 } }}
        >
          <Stack
            direction="row"
            spacing={0.65}
            alignItems="center"
            justifyContent={{ xs: "flex-end", md: "flex-end" }}
            sx={{ flexWrap: "wrap", rowGap: 0.65, columnGap: 0.65 }}
          >
            <Stack
              direction="row"
              spacing={0.5}
              justifyContent="flex-end"
              sx={{ ml: "auto" }}
            >
              <Tooltip title="Refresh detail">
                <span>
                  <IconButton
                    onClick={props.onRefresh}
                    disabled={!props.branch || props.detailNotFound || props.refreshing}
                    aria-label="Refresh detail"
                    sx={{
                      width: { xs: 32, sm: 34 },
                      height: { xs: 32, sm: 34 },
                      border: "1px solid rgba(148,163,184,0.14)",
                      bgcolor: "rgba(248,250,252,0.88)",
                    }}
                  >
                    <RefreshRoundedIcon sx={{ fontSize: 18 }} />
                  </IconButton>
                </span>
              </Tooltip>
              <IconButton
                onClick={props.onClose}
                aria-label="Close detail"
                sx={{
                  width: { xs: 32, sm: 34 },
                  height: { xs: 32, sm: 34 },
                  border: "1px solid rgba(148,163,184,0.14)",
                  bgcolor: "rgba(248,250,252,0.88)",
                }}
              >
                <CloseIcon sx={{ fontSize: 18 }} />
              </IconButton>
            </Stack>
          </Stack>

        </Stack>
      </Stack>
    </Box>
  );
}
