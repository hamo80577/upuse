import ExpandMoreRoundedIcon from "@mui/icons-material/ExpandMoreRounded";
import { Box, Chip, Collapse, Grid, Stack, Typography } from "@mui/material";
import type { KeyboardEvent } from "react";
import { BranchCard } from "../../entities/branch/ui/BranchCard/BranchCard";
import { isGroupExpanded } from "../../pages/dashboard/lib/dashboardGrouping";
import type { BranchGroup } from "../../pages/dashboard/lib/dashboardGrouping";

export function ChainGroupsSection(props: {
  groups: BranchGroup[];
  expandedGroups: Record<string, boolean>;
  onToggleGroup: (groupKey: string) => void;
  onOpenBranchDetail: (branchId: number) => void;
  ordersSyncState?: "fresh" | "syncing" | "stale";
}) {
  if (!props.groups.length) {
    return (
      <Box
        sx={{
          mt: 1.2,
          px: { xs: 1.3, md: 1.6 },
          py: { xs: 2.2, md: 2.5 },
          borderRadius: 4,
          border: "1px dashed rgba(148,163,184,0.24)",
          bgcolor: "rgba(248,250,252,0.76)",
          textAlign: "center",
        }}
      >
        <Typography sx={{ fontWeight: 900, color: "#0f172a" }}>
          No branches match this view
        </Typography>
        <Typography variant="body2" sx={{ mt: 0.4, color: "text.secondary", display: { xs: "none", sm: "block" } }}>
          Change the filter or grouping to bring branches back into the board.
        </Typography>
      </Box>
    );
  }

  return (
    <Box>
      <Stack spacing={2}>
        {props.groups.map((group) => {
          const expanded = isGroupExpanded(props.expandedGroups, group.key);

          return (
            <Box key={group.key}>
            <Box
              role="button"
              tabIndex={0}
              onClick={() => props.onToggleGroup(group.key)}
              onKeyDown={(event: KeyboardEvent<HTMLDivElement>) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  props.onToggleGroup(group.key);
                }
              }}
              sx={{
                mb: 1,
                px: { xs: 0.95, md: 1.2 },
                py: { xs: 0.9, md: 1 },
                borderRadius: 3,
                border: "1px solid rgba(148,163,184,0.12)",
                bgcolor: "rgba(255,255,255,0.9)",
                cursor: "pointer",
                transition: "border-color 160ms ease, box-shadow 160ms ease, background-color 160ms ease",
                "&:hover": {
                  borderColor: "rgba(100,116,139,0.18)",
                  boxShadow: "0 10px 24px rgba(15,23,42,0.06)",
                  bgcolor: "rgba(255,255,255,0.98)",
                },
                "&:focus-visible": {
                  outline: "2px solid rgba(37,99,235,0.24)",
                  outlineOffset: 2,
                },
              }}
            >
              <Stack
                direction={{ xs: "column", md: "row" }}
                spacing={1}
                alignItems={{ xs: "flex-start", md: "center" }}
                justifyContent="space-between"
                sx={{ gap: 1 }}
              >
                <Stack direction="row" spacing={1} alignItems="center" sx={{ minWidth: 0 }}>
                  <Box
                    sx={{
                      width: 30,
                      height: 30,
                      borderRadius: "10px",
                      display: "grid",
                      placeItems: "center",
                      bgcolor: "rgba(241,245,249,0.95)",
                      color: "#334155",
                      flexShrink: 0,
                    }}
                  >
                    <ExpandMoreRoundedIcon
                      sx={{
                        fontSize: 22,
                        transform: expanded ? "rotate(180deg)" : "rotate(90deg)",
                        transition: "transform 180ms ease",
                      }}
                    />
                  </Box>

                  <Box sx={{ minWidth: 0 }}>
                    <Typography
                      sx={{
                        fontWeight: 900,
                        fontSize: { xs: 16, md: 18 },
                        lineHeight: 1.1,
                        color: "#0f172a",
                      }}
                    >
                      {group.label}
                    </Typography>
                    <Typography variant="caption" sx={{ color: "text.secondary", display: { xs: "none", sm: "block" } }}>
                      {group.items.length} branches
                    </Typography>
                  </Box>
                </Stack>

                <Stack direction="row" spacing={0.8} sx={{ flexWrap: "wrap", rowGap: 0.8 }}>
                  <Chip
                    size="small"
                    label={`${group.items.length} br`}
                    sx={{
                      display: { xs: "inline-flex", sm: "none" },
                      fontWeight: 800,
                      bgcolor: "rgba(15,23,42,0.06)",
                      color: "#334155",
                    }}
                  />
                  {group.totals.open > 0 ? (
                    <Chip
                      size="small"
                      label={`Open ${group.totals.open}`}
                      sx={{
                        fontWeight: 800,
                        bgcolor: "rgba(231,247,237,0.95)",
                        color: "#166534",
                      }}
                    />
                  ) : null}
                  {group.totals.tempClose > 0 ? (
                    <Chip
                      size="small"
                      label={`Temp ${group.totals.tempClose}`}
                      sx={{
                        fontWeight: 800,
                        bgcolor: "rgba(255,241,242,0.95)",
                        color: "#be123c",
                      }}
                    />
                  ) : null}
                  {group.totals.closed > 0 ? (
                    <Chip
                      size="small"
                      label={`Closed ${group.totals.closed}`}
                      sx={{
                        fontWeight: 800,
                        bgcolor: "rgba(255,247,214,0.95)",
                        color: "#92400e",
                      }}
                    />
                  ) : null}
                  {group.totals.unknown > 0 ? (
                    <Chip
                      size="small"
                      label={`Unknown ${group.totals.unknown}`}
                      sx={{
                        fontWeight: 800,
                        bgcolor: "rgba(241,245,249,0.95)",
                        color: "#475569",
                      }}
                    />
                  ) : null}
                </Stack>
              </Stack>
            </Box>

            <Collapse in={expanded} timeout={220} unmountOnExit>
              <Box sx={{ pt: 0.2 }}>
                <Grid container spacing={1.75}>
                  {group.items.map(({ branch, rank }) => (
                    <Grid key={branch.branchId} item xs={12} sx={{ display: "flex" }}>
                      <Box sx={{ width: "100%" }}>
                        <BranchCard
                          b={branch}
                          rank={rank}
                          onOpenDetail={props.onOpenBranchDetail}
                          ordersSyncState={props.ordersSyncState}
                        />
                      </Box>
                    </Grid>
                  ))}
                </Grid>
              </Box>
            </Collapse>
            </Box>
          );
        })}
      </Stack>
    </Box>
  );
}
