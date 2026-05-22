import CloseIcon from "@mui/icons-material/Close";
import ApartmentRoundedIcon from "@mui/icons-material/ApartmentRounded";
import RefreshRoundedIcon from "@mui/icons-material/RefreshRounded";
import StorefrontRoundedIcon from "@mui/icons-material/StorefrontRounded";
import { Box, Chip, IconButton, Stack, Tooltip, Typography } from "@mui/material";
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
        borderRadius: 3,
        border: "1px solid rgba(148,163,184,0.18)",
        bgcolor: "rgba(255,255,255,0.98)",
        background: "linear-gradient(135deg, rgba(255,255,255,0.99) 0%, rgba(248,250,252,0.96) 100%)",
        boxShadow: "0 18px 40px rgba(15,23,42,0.08)",
        px: { xs: 1.15, sm: 1.55 },
        py: { xs: 1, sm: 1.2 },
      }}
    >
      <Stack direction={{ xs: "column", md: "row" }} justifyContent="space-between" alignItems={{ xs: "stretch", md: "center" }} gap={{ xs: 1, md: 1.3 }}>
        <Box sx={{ minWidth: 0, flex: 1, pr: { md: 1 } }}>
          <Stack direction="row" spacing={0.75} alignItems="center" sx={{ mb: 0.55 }}>
            <Box
              sx={{
                width: 34,
                height: 34,
                borderRadius: 2,
                display: "grid",
                placeItems: "center",
                color: "#1d4ed8",
                bgcolor: "rgba(219,234,254,0.95)",
                border: "1px solid rgba(96,165,250,0.24)",
                flexShrink: 0,
              }}
            >
              <StorefrontRoundedIcon sx={{ fontSize: 19 }} />
            </Box>
            <Box sx={{ minWidth: 0 }}>
              <Typography variant="caption" sx={{ color: "#1d4ed8", fontWeight: 900, lineHeight: 1 }}>
                Branch Command Center
              </Typography>
              <Typography variant="caption" sx={{ display: "block", color: "#64748b", fontWeight: 700, lineHeight: 1.25 }}>
                Control, queue pressure, picker activity, and branch history in one live workspace.
              </Typography>
            </Box>
          </Stack>
          <Typography
            sx={{
              fontWeight: 900,
              lineHeight: 1.15,
              fontSize: { xs: 20, sm: 24 },
              color: "#0f172a",
            }}
          >
            {props.detailNotFound ? "Branch detail unavailable" : props.branch?.name ?? "Branch detail"}
          </Typography>
          <Stack direction="row" spacing={0.65} flexWrap="wrap" sx={{ mt: 0.7 }}>
            <Chip
              icon={<ApartmentRoundedIcon sx={{ fontSize: "16px !important" }} />}
              size="small"
              label={
                props.detailNotFound
                  ? "Missing mapping"
                  : props.branch?.chainName?.trim()
                    ? props.branch.chainName.trim()
                    : "No Chain"
              }
              sx={{ fontWeight: 900, bgcolor: "rgba(15,23,42,0.06)", color: "#334155" }}
            />
            {props.branch ? (
              <Chip
                size="small"
                label={`VSS ${props.branch.availabilityVendorId}`}
                sx={{ fontWeight: 900, bgcolor: "rgba(15,23,42,0.06)", color: "#334155" }}
              />
            ) : null}
            {props.branch?.ordersVendorId ? (
              <Chip
                size="small"
                label={`Orders ${props.branch.ordersVendorId}`}
                sx={{ fontWeight: 900, bgcolor: "rgba(15,23,42,0.06)", color: "#334155" }}
              />
            ) : null}
          </Stack>
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
                      width: { xs: 40, sm: 42 },
                      height: { xs: 40, sm: 42 },
                      borderRadius: 2,
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
                  width: { xs: 40, sm: 42 },
                  height: { xs: 40, sm: 42 },
                  borderRadius: 2,
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
