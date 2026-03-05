import { Box, Divider, Stack, Typography } from "@mui/material";
import type { BranchLiveOrder } from "../../../api/types";
import { fmtSignedPickupDiff, fmtPlacedAt } from "../lib/time";

function OrderRow(props: { item: BranchLiveOrder; nowMs: number }) {
  const pickupDiff = fmtSignedPickupDiff(props.item.pickupAt, props.nowMs);

  return (
    <Box sx={{ px: 1.5, py: 1.2, borderBottom: "1px solid rgba(148,163,184,0.12)" }}>
      <Stack direction={{ xs: "column", sm: "row" }} spacing={1.25} justifyContent="space-between" alignItems={{ xs: "flex-start", sm: "center" }}>
        <Box sx={{ minWidth: 0 }}>
          <Typography sx={{ fontWeight: 900, lineHeight: 1.1 }}>#{props.item.externalId}</Typography>
          <Typography variant="caption" sx={{ display: "block", color: "text.secondary", mt: 0.25 }}>
            Placed at {fmtPlacedAt(props.item.placedAt)}
          </Typography>
          <Typography variant="caption" sx={{ display: "block", color: "text.secondary", mt: 0.15 }}>
            Customer: {props.item.customerFirstName || "--"}
          </Typography>
          {props.item.shopperFirstName ? (
            <Typography variant="caption" sx={{ display: "block", color: "text.secondary", mt: 0.15 }}>
              Shopper: {props.item.shopperFirstName}
            </Typography>
          ) : null}
        </Box>

        <Box sx={{ textAlign: { xs: "left", sm: "right" } }}>
          <Typography
            sx={{
              fontWeight: 900,
              fontVariantNumeric: "tabular-nums",
              color: pickupDiff.positive ? "#15803d" : "#b91c1c",
            }}
          >
            {pickupDiff.text}
          </Typography>
          <Typography variant="caption" sx={{ color: "text.secondary" }}>
            Pickup {fmtPlacedAt(props.item.pickupAt)}
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
}) {
  return (
    <Box sx={{ borderRadius: 3, border: "1px solid rgba(148,163,184,0.14)", overflow: "hidden" }}>
      <Box sx={{ px: 1.5, py: 1.2, bgcolor: "rgba(248,250,252,0.8)" }}>
        <Typography sx={{ fontWeight: 900 }}>{props.title}</Typography>
        <Typography variant="caption" sx={{ color: "text.secondary" }}>
          {props.subtitle}
        </Typography>
      </Box>
      <Divider />
      <Stack spacing={0} sx={{ maxHeight: 360, overflowY: "auto" }}>
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
