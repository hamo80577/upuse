import { Box, CircularProgress, Divider, Stack, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Typography } from "@mui/material";
import type { BranchPickersSummary } from "../../../api/types";
import { fmtInt } from "../../../utils/format";
import { fmtPlacedAt } from "../lib/time";

function PickerMetricTile(props: { label: string; value: number | string; tone?: "neutral" | "accent" }) {
  const displayValue = typeof props.value === "number" ? fmtInt(props.value) : props.value;

  return (
    <Box
      sx={{
        borderRadius: 1.75,
        p: 1,
        bgcolor: props.tone === "accent" ? "rgba(236,253,245,0.95)" : "rgba(248,250,252,0.92)",
        border: props.tone === "accent" ? "1px solid rgba(16,185,129,0.14)" : "1px solid rgba(148,163,184,0.12)",
      }}
    >
      <Typography variant="caption" sx={{ color: "text.secondary", display: "block" }}>
        {props.label}
      </Typography>
      <Typography sx={{ mt: 0.3, fontWeight: 900, color: props.tone === "accent" ? "#047857" : "#0f172a" }}>
        {displayValue}
      </Typography>
    </Box>
  );
}

function ordersLabel(count: number) {
  return `${fmtInt(count)} order${count === 1 ? "" : "s"}`;
}

export function BranchPickersPanel(props: {
  pickers: BranchPickersSummary;
  recentActiveAvailable?: boolean;
  loading?: boolean;
  emptyText?: string;
}) {
  const recentActiveAvailable = props.recentActiveAvailable === true;

  return (
    <Stack spacing={1.2}>
      <Box
        sx={{
          display: "grid",
          gap: 0.9,
          gridTemplateColumns: { xs: "repeat(3, minmax(0, 1fr))", md: "repeat(3, minmax(0, 1fr))" },
        }}
      >
        <PickerMetricTile label="Today" value={props.pickers.todayCount} />
        <PickerMetricTile label="On Prep" value={props.pickers.activePreparingCount} tone="accent" />
        <PickerMetricTile label="Recent Active" value={recentActiveAvailable ? props.pickers.recentActiveCount : "--"} />
      </Box>

      <Box
        sx={{
          borderRadius: 2.5,
          border: "1px solid rgba(148,163,184,0.14)",
          overflow: "hidden",
          bgcolor: "rgba(255,255,255,0.94)",
          boxShadow: "0 12px 28px rgba(15,23,42,0.04)",
        }}
      >
        <Box sx={{ px: 1.5, py: 1.12, bgcolor: "rgba(248,250,252,0.86)" }}>
          <Typography sx={{ fontWeight: 900 }}>Picker Activity</Typography>
          <Typography variant="caption" sx={{ color: "text.secondary" }}>
            Today&apos;s prepared orders with first and last order timing.
          </Typography>
        </Box>
        <Divider />

        {props.loading && !props.pickers.items.length ? (
          <Stack spacing={0.8} sx={{ px: 1.5, py: 2 }}>
            <Typography variant="body2" sx={{ color: "text.secondary" }}>
              Loading picker activity...
            </Typography>
            <Stack direction="row" justifyContent="center">
              <CircularProgress size={18} />
            </Stack>
          </Stack>
        ) : props.pickers.items.length ? (
          <TableContainer sx={{ maxHeight: { xs: "none", sm: 420 } }}>
            <Table stickyHeader size="small">
              <TableHead>
                <TableRow>
                  <TableCell sx={{ fontWeight: 900, bgcolor: "rgba(248,250,252,0.96)", py: 1 }}>Picker</TableCell>
                  <TableCell align="center" sx={{ fontWeight: 900, bgcolor: "rgba(248,250,252,0.96)", py: 1 }}>Orders</TableCell>
                  <TableCell align="center" sx={{ fontWeight: 900, bgcolor: "rgba(248,250,252,0.96)", py: 1 }}>Frist order</TableCell>
                  <TableCell align="center" sx={{ fontWeight: 900, bgcolor: "rgba(248,250,252,0.96)", py: 1 }}>Last order</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {props.pickers.items.map((picker) => {
                  const recentlyActive = recentActiveAvailable && picker.recentlyActive;

                  return (
                    <TableRow
                      key={picker.shopperId}
                      hover
                      sx={recentlyActive
                        ? {
                            bgcolor: "rgba(240,253,244,0.86)",
                            boxShadow: "inset 3px 0 0 #22c55e",
                            "&:hover": {
                              bgcolor: "rgba(220,252,231,0.96)",
                            },
                          }
                        : undefined}
                    >
                      <TableCell>
                        <Stack spacing={0.45} alignItems="flex-start">
                          <Stack direction="row" spacing={0.75} alignItems="center" sx={{ flexWrap: "wrap" }}>
                            {recentlyActive ? (
                              <Box
                                sx={{
                                  width: 10,
                                  height: 10,
                                  borderRadius: "50%",
                                  bgcolor: "#22c55e",
                                  boxShadow: "0 0 0 4px rgba(34,197,94,0.14)",
                                  flexShrink: 0,
                                }}
                              />
                            ) : null}
                            <Typography sx={{ fontWeight: 900, lineHeight: 1.15, color: recentlyActive ? "#166534" : "#0f172a" }}>
                              {picker.shopperFirstName}
                            </Typography>
                            {recentlyActive ? (
                              <Box
                                sx={{
                                  px: 0.75,
                                  py: 0.28,
                                  borderRadius: 999,
                                  bgcolor: "rgba(34,197,94,0.14)",
                                  color: "#166534",
                                  fontSize: 10.5,
                                  fontWeight: 900,
                                  lineHeight: 1,
                                  border: "1px solid rgba(34,197,94,0.18)",
                                }}
                              >
                                Recent Active
                              </Box>
                            ) : null}
                          </Stack>
                          <Typography variant="caption" sx={{ color: "text.secondary", display: "block", mt: 0.2 }}>
                            Picker ID {picker.shopperId}
                          </Typography>
                        </Stack>
                      </TableCell>
                      <TableCell align="center" sx={{ fontWeight: 800 }}>
                        {ordersLabel(picker.ordersToday)}
                      </TableCell>
                      <TableCell align="center" sx={{ fontWeight: 800 }}>
                        {fmtPlacedAt(picker.firstPickupAt ?? undefined)}
                      </TableCell>
                      <TableCell align="center" sx={{ fontWeight: 800, color: recentlyActive ? "#15803d" : "inherit" }}>
                        {fmtPlacedAt(picker.lastPickupAt ?? undefined)}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </TableContainer>
        ) : (
          <Box sx={{ px: 1.5, py: 2 }}>
            <Typography variant="body2" sx={{ color: "text.secondary" }}>
              {props.emptyText ?? "No pickers found for this branch today."}
            </Typography>
          </Box>
        )}
      </Box>
    </Stack>
  );
}
