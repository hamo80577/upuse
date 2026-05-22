import { Box, Chip, Divider, Stack, Typography } from "@mui/material";
import type { ReactNode } from "react";
import type { BranchLiveOrder } from "../../../api/types";
import { fmtElapsedDuration, fmtSignedPickupDiff, fmtPlacedAt } from "../lib/time";

type TimeDisplayMode = "pickup_delta" | "duration" | "ready_age" | "none";

const timeMetricPanelSx = {
  minWidth: { xs: "auto", sm: 124 },
  textAlign: { xs: "left", sm: "right" },
  borderRadius: 1.75,
  px: { xs: 0, sm: 0.85 },
  py: { xs: 0, sm: 0.7 },
  bgcolor: { xs: "transparent", sm: "rgba(248,250,252,0.92)" },
  border: { xs: "none", sm: "1px solid rgba(148,163,184,0.10)" },
} as const;

function OrderRow(props: { item: BranchLiveOrder; nowMs: number; timeDisplayMode: TimeDisplayMode; durationWarningMs?: number }) {
  const pickupDiff = fmtSignedPickupDiff(props.item.pickupAt, props.nowMs);
  const duration = fmtElapsedDuration(props.item.placedAt, props.nowMs);
  const readyAge = props.item.readyAgeMinutes == null
    ? fmtElapsedDuration(props.item.readySinceAt, props.nowMs)
    : `${Math.max(0, Math.floor(props.item.readyAgeMinutes))}m`;
  const placedAtMs = props.item.placedAt ? new Date(props.item.placedAt).getTime() : Number.NaN;
  const durationElapsedMs = Number.isFinite(placedAtMs) ? Math.max(0, props.nowMs - placedAtMs) : null;
  const durationIsWarning =
    props.durationWarningMs != null &&
    durationElapsedMs != null &&
    durationElapsedMs > props.durationWarningMs;
  const durationLabel =
    props.durationWarningMs == null
      ? "Duration"
      : durationElapsedMs == null
        ? "Unknown"
        : durationIsWarning
          ? "Over 2m"
          : "Within 2m";

  return (
    <Box
      sx={{
        px: 1.15,
        py: 1.05,
        borderBottom: "1px solid rgba(148,163,184,0.10)",
        bgcolor: props.item.isLate ? "rgba(255,247,237,0.70)" : "rgba(255,255,255,0.72)",
      }}
    >
      <Stack direction={{ xs: "column", sm: "row", lg: "column", xl: "row" }} spacing={1} justifyContent="space-between" alignItems={{ xs: "flex-start", xl: "flex-start" }}>
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
            <Box sx={{ px: 0.75, py: 0.45, borderRadius: 1.5, bgcolor: "rgba(248,250,252,0.95)", border: "1px solid rgba(148,163,184,0.10)" }}>
              <Typography variant="caption" sx={{ color: "text.secondary", display: "block", lineHeight: 1 }}>
                Placed
              </Typography>
              <Typography variant="caption" sx={{ color: "#0f172a", fontWeight: 800 }}>
                {fmtPlacedAt(props.item.placedAt)}
              </Typography>
            </Box>
            <Box sx={{ px: 0.75, py: 0.45, borderRadius: 1.5, bgcolor: "rgba(248,250,252,0.95)", border: "1px solid rgba(148,163,184,0.10)" }}>
              <Typography variant="caption" sx={{ color: "text.secondary", display: "block", lineHeight: 1 }}>
                Picker
              </Typography>
              <Typography variant="caption" sx={{ color: "#0f172a", fontWeight: 800 }}>
                {props.item.shopperFirstName || "--"}
              </Typography>
            </Box>
          </Stack>
        </Box>

        {props.timeDisplayMode === "pickup_delta" ? (
          <Box
            sx={timeMetricPanelSx}
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
        ) : null}

        {props.timeDisplayMode === "duration" ? (
          <Box
            sx={{
              ...timeMetricPanelSx,
              bgcolor: durationIsWarning
                ? { xs: "transparent", sm: "rgba(254,242,242,0.92)" }
                : { xs: "transparent", sm: "rgba(240,253,244,0.92)" },
              borderColor: durationIsWarning ? "rgba(248,113,113,0.18)" : "rgba(34,197,94,0.18)",
            }}
          >
            <Typography
              variant="caption"
              sx={{
                color: durationIsWarning ? "#b91c1c" : "#15803d",
                display: "block",
                fontWeight: 900,
              }}
            >
              {durationLabel}
            </Typography>
            <Typography
              sx={{
                mt: 0.15,
                fontWeight: 900,
                fontVariantNumeric: "tabular-nums",
                color: durationIsWarning ? "#b91c1c" : "#15803d",
              }}
            >
              {duration}
            </Typography>
          </Box>
        ) : null}

        {props.timeDisplayMode === "ready_age" ? (
          <Box
            sx={{
              ...timeMetricPanelSx,
              bgcolor: props.item.readyEligible === false
                ? { xs: "transparent", sm: "rgba(239,246,255,0.92)" }
                : { xs: "transparent", sm: "rgba(240,253,244,0.92)" },
              borderColor: props.item.readyEligible === false ? "rgba(96,165,250,0.18)" : "rgba(34,197,94,0.18)",
            }}
          >
            <Typography
              variant="caption"
              sx={{
                color: props.item.readyEligible === false ? "#1d4ed8" : "#15803d",
                display: "block",
                fontWeight: 900,
              }}
            >
              Ready age
            </Typography>
            <Typography
              sx={{
                mt: 0.15,
                fontWeight: 900,
                fontVariantNumeric: "tabular-nums",
                color: props.item.readyEligible === false ? "#1d4ed8" : "#15803d",
              }}
            >
              {readyAge}
            </Typography>
          </Box>
        ) : null}
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
  hideHeader?: boolean;
  timeDisplayMode?: TimeDisplayMode;
  durationWarningMs?: number;
}) {
  return (
    <Box
      sx={{
        borderRadius: 2.4,
        border: "1px solid rgba(148,163,184,0.16)",
        overflow: "hidden",
        bgcolor: "rgba(255,255,255,0.96)",
        boxShadow: "0 14px 30px rgba(15,23,42,0.055)",
      }}
    >
      {props.hideHeader ? null : (
        <>
          <Box
            sx={{
              px: 1.2,
              py: 1.05,
              bgcolor: "rgba(248,250,252,0.94)",
              display: "flex",
              alignItems: "flex-start",
              justifyContent: "space-between",
              gap: 1,
            }}
          >
            <Box sx={{ minWidth: 0 }}>
              <Typography sx={{ fontWeight: 900, color: "#0f172a", lineHeight: 1.1 }}>{props.title}</Typography>
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
        </>
      )}
      <Stack spacing={0} sx={{ maxHeight: { xs: "none", sm: 420 }, overflowY: { xs: "visible", sm: "auto" } }}>
        {props.items.length ? (
          props.items.map((item) => (
            <OrderRow
              key={item.id}
              item={item}
              nowMs={props.nowMs}
              timeDisplayMode={props.timeDisplayMode ?? "pickup_delta"}
              durationWarningMs={props.durationWarningMs}
            />
          ))
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
