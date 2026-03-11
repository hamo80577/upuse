import { Box, Chip, Divider, Stack, Typography } from "@mui/material";
import type { ReactNode } from "react";
import type { BranchLiveOrder } from "../../../api/types";
import { fmtSignedPickupDiff, fmtPlacedAt } from "../lib/time";

function OrderRow(props: { item: BranchLiveOrder; nowMs: number }) {
  const pickupDiff = fmtSignedPickupDiff(props.item.pickupAt, props.nowMs);

  return (
    <Box
      sx={{
        px: 1.35,
        py: 1.15,
        borderBottom: "1px solid rgba(148,163,184,0.10)",
        bgcolor: props.item.isLate ? "rgba(255,247,237,0.62)" : "transparent",
      }}
    >
      <Stack direction={{ xs: "column", sm: "row" }} spacing={1.2} justifyContent="space-between" alignItems={{ xs: "flex-start", sm: "flex-start" }}>
        <Box sx={{ minWidth: 0, flex: 1 }}>
          <Stack direction="row" spacing={0.7} alignItems="center" sx={{ flexWrap: "wrap", rowGap: 0.7 }}>
            <Typography sx={{ fontWeight: 900, lineHeight: 1.1, fontSize: 15 }}>#{props.item.externalId}</Typography>
            {props.item.isLate ? (
              <Chip
                size="small"
                label="Late"
                sx={{
                  height: 22,
                  fontWeight: 900,
                  bgcolor: "rgba(251,146,60,0.16)",
                  color: "#9a3412",
                }}
              />
            ) : null}
            {props.item.isUnassigned ? (
              <Chip
                size="small"
                label="Needs picker"
                sx={{
                  height: 22,
                  fontWeight: 900,
                  bgcolor: "rgba(254,242,242,0.92)",
                  color: "#b91c1c",
                }}
              />
            ) : null}
          </Stack>

          <Stack direction="row" spacing={0.7} sx={{ mt: 0.75, flexWrap: "wrap", rowGap: 0.7 }}>
            <Box sx={{ px: 0.75, py: 0.45, borderRadius: 2, bgcolor: "rgba(248,250,252,0.95)", border: "1px solid rgba(148,163,184,0.10)" }}>
              <Typography variant="caption" sx={{ color: "text.secondary", display: "block", lineHeight: 1 }}>
                Placed
              </Typography>
              <Typography variant="caption" sx={{ color: "#0f172a", fontWeight: 800 }}>
                {fmtPlacedAt(props.item.placedAt)}
              </Typography>
            </Box>
            <Box sx={{ px: 0.75, py: 0.45, borderRadius: 2, bgcolor: "rgba(248,250,252,0.95)", border: "1px solid rgba(148,163,184,0.10)" }}>
              <Typography variant="caption" sx={{ color: "text.secondary", display: "block", lineHeight: 1 }}>
                Picker
              </Typography>
              <Typography variant="caption" sx={{ color: "#0f172a", fontWeight: 800 }}>
                {props.item.shopperFirstName || "--"}
              </Typography>
            </Box>
          </Stack>
        </Box>

        <Box
          sx={{
            minWidth: { xs: "auto", sm: 124 },
            textAlign: { xs: "left", sm: "right" },
            borderRadius: 2.3,
            px: { xs: 0, sm: 0.85 },
            py: { xs: 0, sm: 0.7 },
            bgcolor: { xs: "transparent", sm: "rgba(248,250,252,0.92)" },
            border: { xs: "none", sm: "1px solid rgba(148,163,184,0.10)" },
          }}
        >
          <Typography variant="caption" sx={{ color: "text.secondary", display: "block", fontWeight: 800 }}>
            Pickup delta
          </Typography>
          <Typography
            sx={{
              mt: 0.15,
              fontWeight: 900,
              fontVariantNumeric: "tabular-nums",
              color: pickupDiff.positive ? "#15803d" : "#b91c1c",
            }}
          >
            {pickupDiff.text}
          </Typography>
        </Box>
      </Stack>
    </Box>
  );
}

export function BranchOrdersSection(props: {
  title: string;
  subtitle: string;
  items: BranchLiveOrder[];
  emptyText: string;
  nowMs: number;
  headerBadge?: ReactNode;
}) {
  return (
    <Box
      sx={{
        borderRadius: 3.2,
        border: "1px solid rgba(148,163,184,0.14)",
        overflow: "hidden",
        bgcolor: "rgba(255,255,255,0.94)",
        boxShadow: "0 12px 28px rgba(15,23,42,0.04)",
      }}
    >
      <Box
        sx={{
          px: 1.5,
          py: 1.15,
          bgcolor: "rgba(248,250,252,0.86)",
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: 1,
        }}
      >
        <Box sx={{ minWidth: 0 }}>
          <Typography sx={{ fontWeight: 900 }}>{props.title}</Typography>
          <Typography variant="caption" sx={{ color: "text.secondary", display: "block", lineHeight: 1.45 }}>
            {props.items.length ? `${props.items.length} live orders` : props.subtitle}
          </Typography>
        </Box>
        {props.headerBadge ? (
          <Box sx={{ flexShrink: 0 }}>
            {props.headerBadge}
          </Box>
        ) : null}
      </Box>
      <Divider />
      <Stack spacing={0} sx={{ maxHeight: { xs: "none", sm: 360 }, overflowY: { xs: "visible", sm: "auto" } }}>
        {props.items.length ? (
          props.items.map((item) => <OrderRow key={item.id} item={item} nowMs={props.nowMs} />)
        ) : (
          <Box sx={{ px: 1.5, py: 2 }}>
            <Typography variant="body2" sx={{ color: "text.secondary" }}>
              {props.emptyText}
            </Typography>
          </Box>
        )}
      </Stack>
    </Box>
  );
}
