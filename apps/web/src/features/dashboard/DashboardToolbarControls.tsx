import CategoryRoundedIcon from "@mui/icons-material/CategoryRounded";
import FilterAltRoundedIcon from "@mui/icons-material/FilterAltRounded";
import SearchRoundedIcon from "@mui/icons-material/SearchRounded";
import SortRoundedIcon from "@mui/icons-material/SortRounded";
import { Box, IconButton, InputBase, Menu, MenuItem, Stack } from "@mui/material";
import { useState } from "react";
import type { GroupMode, SortMode, StatusFilter } from "../../pages/dashboard/lib/dashboardGrouping";

export type { GroupMode, SortMode, StatusFilter };

function statusFilterLabel(filter: StatusFilter) {
  if (filter === "all") return "All";
  if (filter === "open") return "Open";
  if (filter === "tempClose") return "Temporary Close";
  if (filter === "closed") return "Closed";
  return "Unknown";
}

function groupModeLabel(groupBy: GroupMode) {
  if (groupBy === "status") return "By Status";
  if (groupBy === "all") return "All Together";
  return "By Chain";
}

function sortModeLabel(sortBy: SortMode) {
  if (sortBy === "late") return "Late";
  if (sortBy === "unassigned") return "Unassigned";
  return "Total";
}

export function DashboardToolbarControls(props: {
  sortBy: SortMode;
  statusFilter: StatusFilter;
  groupBy: GroupMode;
  searchQuery: string;
  onChangeSortBy: (value: SortMode) => void;
  onChangeStatusFilter: (value: StatusFilter) => void;
  onChangeGroupBy: (value: GroupMode) => void;
  onChangeSearchQuery: (value: string) => void;
}) {
  const [sortAnchorEl, setSortAnchorEl] = useState<HTMLElement | null>(null);
  const [filterAnchorEl, setFilterAnchorEl] = useState<HTMLElement | null>(null);
  const [groupAnchorEl, setGroupAnchorEl] = useState<HTMLElement | null>(null);

  return (
    <Box sx={{ mt: 2, mb: 1, display: "flex", justifyContent: "flex-end" }}>
      <Stack
        direction={{ xs: "column", md: "row" }}
        spacing={1}
        alignItems={{ xs: "stretch", md: "center" }}
        sx={{ width: { xs: "100%", md: "auto" } }}
      >
        <Stack direction="row" spacing={1} alignItems="center">
          <IconButton
            onClick={(event) => setGroupAnchorEl(event.currentTarget)}
            sx={{
              width: 40,
              height: 40,
              border: "1px solid rgba(148,163,184,0.14)",
              bgcolor: props.groupBy === "chain" ? "rgba(255,255,255,0.92)" : "rgba(37,99,235,0.08)",
              color: props.groupBy === "chain" ? "#334155" : "#1d4ed8",
              boxShadow: "0 8px 18px rgba(15,23,42,0.05)",
              "&:hover": {
                bgcolor: props.groupBy === "chain" ? "white" : "rgba(37,99,235,0.12)",
                boxShadow: "0 10px 20px rgba(15,23,42,0.08)",
              },
            }}
            title={`Group: ${groupModeLabel(props.groupBy)}`}
          >
            <CategoryRoundedIcon />
          </IconButton>

          <IconButton
            onClick={(event) => setFilterAnchorEl(event.currentTarget)}
            sx={{
              width: 40,
              height: 40,
              border: "1px solid rgba(148,163,184,0.14)",
              bgcolor: props.statusFilter === "all" ? "rgba(255,255,255,0.92)" : "rgba(22,163,74,0.08)",
              color: props.statusFilter === "all" ? "#334155" : "#15803d",
              boxShadow: "0 8px 18px rgba(15,23,42,0.05)",
              "&:hover": {
                bgcolor: props.statusFilter === "all" ? "white" : "rgba(22,163,74,0.12)",
                boxShadow: "0 10px 20px rgba(15,23,42,0.08)",
              },
            }}
            title={`Filter: ${statusFilterLabel(props.statusFilter)}`}
          >
            <FilterAltRoundedIcon />
          </IconButton>

          <IconButton
            onClick={(event) => setSortAnchorEl(event.currentTarget)}
            sx={{
              width: 40,
              height: 40,
              border: "1px solid rgba(148,163,184,0.14)",
              bgcolor: props.sortBy === "total" ? "rgba(255,255,255,0.92)" : "rgba(249,115,22,0.10)",
              color: props.sortBy === "total" ? "#334155" : "#c2410c",
              boxShadow: "0 8px 18px rgba(15,23,42,0.05)",
              "&:hover": {
                bgcolor: props.sortBy === "total" ? "white" : "rgba(249,115,22,0.14)",
                boxShadow: "0 10px 20px rgba(15,23,42,0.08)",
              },
            }}
            title={`Sort: ${sortModeLabel(props.sortBy)}`}
          >
            <SortRoundedIcon />
          </IconButton>
        </Stack>

        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            gap: 0.8,
            px: 1.15,
            height: 40,
            borderRadius: 999,
            border: "1px solid rgba(148,163,184,0.14)",
            bgcolor: "rgba(255,255,255,0.92)",
            boxShadow: "0 8px 18px rgba(15,23,42,0.05)",
            width: { xs: "100%", md: 240 },
          }}
        >
          <SearchRoundedIcon sx={{ fontSize: 19, color: props.searchQuery ? "#2563eb" : "#64748b" }} />
          <InputBase
            value={props.searchQuery}
            onChange={(event) => props.onChangeSearchQuery(event.target.value)}
            placeholder="Search branches"
            inputProps={{ "aria-label": "Search branches" }}
            sx={{
              flex: 1,
              fontSize: 14,
              fontWeight: 600,
              color: "#0f172a",
              "& input::placeholder": {
                color: "#94a3b8",
                opacity: 1,
              },
            }}
          />
        </Box>
      </Stack>

      <Menu
        anchorEl={groupAnchorEl}
        open={!!groupAnchorEl}
        onClose={() => setGroupAnchorEl(null)}
        anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
        transformOrigin={{ vertical: "top", horizontal: "right" }}
        PaperProps={{
          sx: {
            mt: 0.8,
            borderRadius: 2.5,
            border: "1px solid rgba(148,163,184,0.12)",
            boxShadow: "0 18px 34px rgba(15,23,42,0.10)",
            minWidth: 180,
          },
        }}
      >
        <MenuItem
          selected={props.groupBy === "chain"}
          onClick={() => {
            props.onChangeGroupBy("chain");
            setGroupAnchorEl(null);
          }}
        >
          By Chain
        </MenuItem>
        <MenuItem
          selected={props.groupBy === "status"}
          onClick={() => {
            props.onChangeGroupBy("status");
            setGroupAnchorEl(null);
          }}
        >
          By Status
        </MenuItem>
        <MenuItem
          selected={props.groupBy === "all"}
          onClick={() => {
            props.onChangeGroupBy("all");
            setGroupAnchorEl(null);
          }}
        >
          All Together
        </MenuItem>
      </Menu>

      <Menu
        anchorEl={filterAnchorEl}
        open={!!filterAnchorEl}
        onClose={() => setFilterAnchorEl(null)}
        anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
        transformOrigin={{ vertical: "top", horizontal: "right" }}
        PaperProps={{
          sx: {
            mt: 0.8,
            borderRadius: 2.5,
            border: "1px solid rgba(148,163,184,0.12)",
            boxShadow: "0 18px 34px rgba(15,23,42,0.10)",
            minWidth: 180,
          },
        }}
      >
        <MenuItem
          selected={props.statusFilter === "all"}
          onClick={() => {
            props.onChangeStatusFilter("all");
            setFilterAnchorEl(null);
          }}
        >
          All Statuses
        </MenuItem>
        <MenuItem
          selected={props.statusFilter === "open"}
          onClick={() => {
            props.onChangeStatusFilter("open");
            setFilterAnchorEl(null);
          }}
        >
          Open
        </MenuItem>
        <MenuItem
          selected={props.statusFilter === "tempClose"}
          onClick={() => {
            props.onChangeStatusFilter("tempClose");
            setFilterAnchorEl(null);
          }}
        >
          Temporary Close
        </MenuItem>
        <MenuItem
          selected={props.statusFilter === "closed"}
          onClick={() => {
            props.onChangeStatusFilter("closed");
            setFilterAnchorEl(null);
          }}
        >
          Closed
        </MenuItem>
        <MenuItem
          selected={props.statusFilter === "unknown"}
          onClick={() => {
            props.onChangeStatusFilter("unknown");
            setFilterAnchorEl(null);
          }}
        >
          Unknown
        </MenuItem>
      </Menu>

      <Menu
        anchorEl={sortAnchorEl}
        open={!!sortAnchorEl}
        onClose={() => setSortAnchorEl(null)}
        anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
        transformOrigin={{ vertical: "top", horizontal: "right" }}
        PaperProps={{
          sx: {
            mt: 0.8,
            borderRadius: 2.5,
            border: "1px solid rgba(148,163,184,0.12)",
            boxShadow: "0 18px 34px rgba(15,23,42,0.10)",
            minWidth: 160,
          },
        }}
      >
        <MenuItem
          selected={props.sortBy === "total"}
          onClick={() => {
            props.onChangeSortBy("total");
            setSortAnchorEl(null);
          }}
        >
          Total
        </MenuItem>
        <MenuItem
          selected={props.sortBy === "late"}
          onClick={() => {
            props.onChangeSortBy("late");
            setSortAnchorEl(null);
          }}
        >
          Late
        </MenuItem>
        <MenuItem
          selected={props.sortBy === "unassigned"}
          onClick={() => {
            props.onChangeSortBy("unassigned");
            setSortAnchorEl(null);
          }}
        >
          Unassigned
        </MenuItem>
      </Menu>
    </Box>
  );
}
