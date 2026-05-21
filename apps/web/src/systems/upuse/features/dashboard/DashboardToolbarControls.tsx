import CategoryRoundedIcon from "@mui/icons-material/CategoryRounded";
import CheckRoundedIcon from "@mui/icons-material/CheckRounded";
import CloseRoundedIcon from "@mui/icons-material/CloseRounded";
import FilterAltRoundedIcon from "@mui/icons-material/FilterAltRounded";
import SearchRoundedIcon from "@mui/icons-material/SearchRounded";
import SortRoundedIcon from "@mui/icons-material/SortRounded";
import { Badge, Box, Chip, Divider, IconButton, InputBase, Menu, MenuItem, Stack, Tooltip, Typography } from "@mui/material";
import { useState } from "react";
import type { GroupMode, PressureFilter, SortMode, StatusFilter } from "../../pages/dashboard/lib/dashboardGrouping";

export type { GroupMode, PressureFilter, SortMode, StatusFilter };

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
  if (sortBy === "onHold") return "On Hold";
  if (sortBy === "late") return "Late";
  if (sortBy === "unassigned") return "Unassigned";
  if (sortBy === "ready") return "Ready";
  if (sortBy === "inPrep") return "In Prep";
  return "Total";
}

function pressureFilterLabel(filter: PressureFilter) {
  if (filter === "onHold") return "On Hold";
  if (filter === "late") return "Late";
  if (filter === "unassigned") return "Unassigned";
  if (filter === "ready") return "Ready";
  return "In Prep";
}

const statusFilters: Array<{ value: StatusFilter; label: string }> = [
  { value: "all", label: "All Statuses" },
  { value: "open", label: "Open" },
  { value: "tempClose", label: "Temporary Close" },
  { value: "closed", label: "Closed" },
  { value: "unknown", label: "Unknown" },
];

const pressureFilters: PressureFilter[] = ["onHold", "late", "unassigned", "ready", "inPrep"];
const sortModes: SortMode[] = ["total", "onHold", "late", "unassigned", "ready", "inPrep"];

export function DashboardToolbarControls(props: {
  sortBy: SortMode;
  statusFilter: StatusFilter;
  pressureFilters: PressureFilter[];
  groupBy: GroupMode;
  searchQuery: string;
  onChangeSortBy: (value: SortMode) => void;
  onChangeStatusFilter: (value: StatusFilter) => void;
  onChangePressureFilters: (value: PressureFilter[]) => void;
  onChangeGroupBy: (value: GroupMode) => void;
  onChangeSearchQuery: (value: string) => void;
}) {
  const [sortAnchorEl, setSortAnchorEl] = useState<HTMLElement | null>(null);
  const [filterAnchorEl, setFilterAnchorEl] = useState<HTMLElement | null>(null);
  const [groupAnchorEl, setGroupAnchorEl] = useState<HTMLElement | null>(null);
  const activeFilterCount = (props.statusFilter === "all" ? 0 : 1) + props.pressureFilters.length;
  const hasActiveFilters = activeFilterCount > 0 || props.searchQuery.trim().length > 0;

  const togglePressureFilter = (filter: PressureFilter) => {
    props.onChangePressureFilters(
      props.pressureFilters.includes(filter)
        ? props.pressureFilters.filter((item) => item !== filter)
        : [...props.pressureFilters, filter],
    );
  };

  const clearFilters = () => {
    props.onChangeStatusFilter("all");
    props.onChangePressureFilters([]);
    props.onChangeSearchQuery("");
  };

  return (
    <Box sx={{ mt: 2, mb: 1, display: "flex", justifyContent: "flex-end" }}>
      <Stack
        direction={{ xs: "column", md: "row" }}
        spacing={1}
        alignItems={{ xs: "stretch", md: "center" }}
        sx={{ width: { xs: "100%", md: "auto" } }}
      >
        <Stack direction="row" spacing={1} alignItems="center">
          <Tooltip title={`Group: ${groupModeLabel(props.groupBy)}`}>
            <IconButton
              aria-label={`Group: ${groupModeLabel(props.groupBy)}`}
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
            >
              <CategoryRoundedIcon />
            </IconButton>
          </Tooltip>

          <Tooltip title={`Filters: ${activeFilterCount} active`}>
            <IconButton
              aria-label={`Filters: ${activeFilterCount} active`}
              onClick={(event) => setFilterAnchorEl(event.currentTarget)}
              sx={{
                width: 40,
                height: 40,
                border: "1px solid rgba(148,163,184,0.14)",
                bgcolor: activeFilterCount === 0 ? "rgba(255,255,255,0.92)" : "rgba(22,163,74,0.08)",
                color: activeFilterCount === 0 ? "#334155" : "#15803d",
                boxShadow: "0 8px 18px rgba(15,23,42,0.05)",
                "&:hover": {
                  bgcolor: activeFilterCount === 0 ? "white" : "rgba(22,163,74,0.12)",
                  boxShadow: "0 10px 20px rgba(15,23,42,0.08)",
                },
              }}
            >
              <Badge badgeContent={activeFilterCount} color="success" invisible={activeFilterCount === 0}>
                <FilterAltRoundedIcon />
              </Badge>
            </IconButton>
          </Tooltip>

          <Tooltip title={`Sort: ${sortModeLabel(props.sortBy)}`}>
            <IconButton
              aria-label={`Sort: ${sortModeLabel(props.sortBy)}`}
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
            >
              <SortRoundedIcon />
            </IconButton>
          </Tooltip>
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

        {hasActiveFilters ? (
          <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap sx={{ maxWidth: { xs: "100%", md: 520 } }}>
            {props.statusFilter !== "all" ? (
              <Chip size="small" label={statusFilterLabel(props.statusFilter)} sx={{ fontWeight: 900 }} />
            ) : null}
            {props.pressureFilters.map((filter) => (
              <Chip key={filter} size="small" label={pressureFilterLabel(filter)} sx={{ fontWeight: 900 }} />
            ))}
            {props.searchQuery.trim() ? (
              <Chip size="small" label={`Search: ${props.searchQuery.trim()}`} sx={{ fontWeight: 900 }} />
            ) : null}
            <Chip
              size="small"
              label="Clear"
              icon={<CloseRoundedIcon />}
              onClick={clearFilters}
              sx={{ fontWeight: 900, bgcolor: "rgba(15,23,42,0.06)" }}
            />
          </Stack>
        ) : null}
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
        <Box sx={{ px: 1.6, py: 0.8 }}>
          <Typography variant="caption" sx={{ color: "#64748b", fontWeight: 900 }}>
            Status
          </Typography>
        </Box>
        {statusFilters.map((filter) => (
          <MenuItem
            key={filter.value}
            selected={props.statusFilter === filter.value}
            onClick={() => {
              props.onChangeStatusFilter(filter.value);
              setFilterAnchorEl(null);
            }}
          >
            <Box sx={{ width: 24 }}>{props.statusFilter === filter.value ? <CheckRoundedIcon fontSize="small" /> : null}</Box>
            {filter.label}
          </MenuItem>
        ))}
        <Divider />
        <Box sx={{ px: 1.6, py: 0.8 }}>
          <Typography variant="caption" sx={{ color: "#64748b", fontWeight: 900 }}>
            Pressure
          </Typography>
        </Box>
        {pressureFilters.map((filter) => {
          const selected = props.pressureFilters.includes(filter);
          return (
            <MenuItem
              key={filter}
              selected={selected}
              onClick={() => togglePressureFilter(filter)}
            >
              <Box sx={{ width: 24 }}>{selected ? <CheckRoundedIcon fontSize="small" /> : null}</Box>
              {pressureFilterLabel(filter)}
            </MenuItem>
          );
        })}
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
        {sortModes.map((mode) => (
          <MenuItem
            key={mode}
            selected={props.sortBy === mode}
            onClick={() => {
              props.onChangeSortBy(mode);
              setSortAnchorEl(null);
            }}
          >
            {sortModeLabel(mode)}
          </MenuItem>
        ))}
      </Menu>
    </Box>
  );
}
