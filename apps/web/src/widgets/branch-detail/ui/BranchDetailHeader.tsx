import CloseIcon from "@mui/icons-material/Close";
import RefreshRoundedIcon from "@mui/icons-material/RefreshRounded";
import { Box, Chip, IconButton, Stack, Tooltip, Typography } from "@mui/material";
import type { BranchSnapshot } from "../../../api/types";
import { closeReasonChip, statusChip, statusPanelMeta } from "../lib/statusMeta";

export function BranchDetailHeader(props: {
  branch: BranchSnapshot | null;
  detailNotFound: boolean;
  refreshing: boolean;
  onRefresh: () => void;
  onClose: () => void;
}) {
  const chip = props.branch ? statusChip(props.branch) : null;
  const reason = props.branch ? closeReasonChip(props.branch.closeReason) : null;
  const panel = props.branch ? statusPanelMeta(props.branch) : null;

  return (
    <Box
      sx={{
        borderRadius: 3.5,
        border: "1px solid rgba(148,163,184,0.14)",
        bgcolor: "rgba(255,255,255,0.96)",
        boxShadow: "0 14px 34px rgba(15,23,42,0.06)",
        px: { xs: 1.2, sm: 1.55 },
        py: { xs: 1, sm: 1.08 },
      }}
    >
      <Stack direction={{ xs: "column", md: "row" }} justifyContent="space-between" alignItems={{ xs: "stretch", md: "center" }} gap={{ xs: 0.95, md: 1.25 }}>
        <Box sx={{ minWidth: 0, flex: 1, pr: { md: 1 } }}>
          <Typography
            sx={{
              fontWeight: 900,
              lineHeight: 1.15,
              fontSize: { xs: 21, sm: 25 },
              color: "#0f172a",
              letterSpacing: -0.35,
            }}
          >
            {props.detailNotFound ? "Branch detail unavailable" : props.branch?.name ?? "Branch detail"}
          </Typography>
          <Typography variant="body2" sx={{ mt: 0.3, color: "#475569", fontWeight: 700 }}>
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
            alignItems="flex-start"
            justifyContent={{ xs: "space-between", md: "flex-end" }}
            sx={{ flexWrap: "wrap", rowGap: 0.65, columnGap: 0.65, maxWidth: { md: 500 } }}
          >
            {!props.detailNotFound ? (
              <Stack
                direction="row"
                spacing={0.6}
                justifyContent={{ xs: "flex-start", md: "flex-end" }}
                sx={{ flexWrap: "wrap", rowGap: 0.6, maxWidth: { md: 380 } }}
              >
                {chip ? (
                  <Chip
                    size="small"
                    label={chip.label}
                    sx={{
                      fontWeight: 900,
                      border: "1px solid rgba(15,23,42,0.08)",
                      ...chip.sx,
                    }}
                  />
                ) : null}
                {panel?.sourceLabel ? (
                  <Chip
                    size="small"
                    label={panel.sourceLabel}
                    sx={{
                      fontWeight: 900,
                      bgcolor: "rgba(241,245,249,0.92)",
                      color: "#334155",
                    }}
                  />
                ) : null}
                {reason ? (
                  <Chip
                    size="small"
                    label={reason.label}
                    sx={{
                      fontWeight: 900,
                      ...reason.sx,
                    }}
                  />
                ) : null}
              </Stack>
            ) : null}

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
                      width: { xs: 34, sm: 36 },
                      height: { xs: 34, sm: 36 },
                      border: "1px solid rgba(148,163,184,0.14)",
                      bgcolor: "rgba(248,250,252,0.88)",
                    }}
                  >
                    <RefreshRoundedIcon sx={{ fontSize: 20 }} />
                  </IconButton>
                </span>
              </Tooltip>
              <IconButton
                onClick={props.onClose}
                aria-label="Close detail"
                sx={{
                  width: { xs: 34, sm: 36 },
                  height: { xs: 34, sm: 36 },
                  border: "1px solid rgba(148,163,184,0.14)",
                  bgcolor: "rgba(248,250,252,0.88)",
                }}
              >
                <CloseIcon sx={{ fontSize: 20 }} />
              </IconButton>
            </Stack>
          </Stack>

        </Stack>
      </Stack>
    </Box>
  );
}
