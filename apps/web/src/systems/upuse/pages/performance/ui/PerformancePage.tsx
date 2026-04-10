import CheckRoundedIcon from "@mui/icons-material/CheckRounded";
import CloseRoundedIcon from "@mui/icons-material/CloseRounded";
import DeleteOutlineRoundedIcon from "@mui/icons-material/DeleteOutlineRounded";
import EditRoundedIcon from "@mui/icons-material/EditRounded";
import FilterAltRoundedIcon from "@mui/icons-material/FilterAltRounded";
import FilterAltOffRoundedIcon from "@mui/icons-material/FilterAltOffRounded";
import ExpandMoreRoundedIcon from "@mui/icons-material/ExpandMoreRounded";
import InsightsRoundedIcon from "@mui/icons-material/InsightsRounded";
import LocalShippingRoundedIcon from "@mui/icons-material/LocalShippingRounded";
import RefreshRoundedIcon from "@mui/icons-material/RefreshRounded";
import SearchRoundedIcon from "@mui/icons-material/SearchRounded";
import SortRoundedIcon from "@mui/icons-material/SortRounded";
import SpaceDashboardRoundedIcon from "@mui/icons-material/SpaceDashboardRounded";
import StorefrontRoundedIcon from "@mui/icons-material/StorefrontRounded";
import VisibilityRoundedIcon from "@mui/icons-material/VisibilityRounded";
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Collapse,
  CircularProgress,
  Container,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  IconButton,
  InputBase,
  Menu,
  MenuItem,
  Pagination,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { type MouseEventHandler, type ReactNode, Suspense, lazy, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { api, describeApiError } from "../../../api/client";
import type {
  LocalVendorCatalogItem,
  PerformanceBranchFilter,
  PerformanceDeliveryTypeFilter,
  PerformanceEntityBranchCard,
  PerformanceNumericSortKey,
  PerformancePreferencesState,
  PerformanceSavedGroup,
  PerformanceSummaryResponse,
  PerformanceTrendResolutionMinutes,
  PerformanceTrendResponse,
  PerformanceVendorDetailResponse,
} from "../../../api/types";
import { useMonitorStatus } from "../../../app/providers/MonitorStatusProvider";
import { TopBar } from "../../../widgets/top-bar/ui/TopBar";
import { PerformanceBranchDialog } from "./PerformanceBranchDialog";
import { MetricTile } from "./components/MetricTile";

const PAGE_SIZE = 10;
const FULL_DAY_END_MINUTE = 1_440;
const LIVE_RECONNECT_DELAYS_MS = [1_000, 3_000, 5_000, 10_000] as const;

type NumericSortKey = PerformanceNumericSortKey;
type BranchFilterKey = PerformanceBranchFilter;
type DeliveryTypeFilterKey = PerformanceDeliveryTypeFilter;
type BranchActivityFilter = "all" | "active" | "inactive";
type HeroPanel = "summary" | "trend";
type BulkAddMode = "orders" | "availability";
type BulkAddStep = "input" | "loading" | "review" | "name";

const LazyPerformanceTrendPanel = lazy(async () => {
  const module = await import("./PerformanceTrendPanel");
  return { default: module.PerformanceTrendPanel };
});

interface DisplayPerformanceBranchCard extends PerformanceEntityBranchCard {
  availabilityVendorId?: string | null;
  isPlaceholder?: boolean;
  isUnmappedVendor?: boolean;
}

interface BulkAddResolvedVendor {
  ordersVendorId: number;
  availabilityVendorId: string | null;
  name: string;
  isNoOrdersYet: boolean;
}

interface BulkAddResolutionSummary {
  enteredCount: number;
  resolvedCount: number;
  noOrdersCount: number;
  notFoundCount: number;
  mode: BulkAddMode;
}

const DEFAULT_PREFERENCES_STATE: PerformancePreferencesState = {
  searchQuery: "",
  selectedVendorIds: [],
  selectedDeliveryTypes: [],
  selectedBranchFilters: [],
  selectedSortKeys: ["orders"],
  nameSortEnabled: false,
  activeGroupId: null,
  activeViewId: null,
};

const DELIVERY_TYPE_OPTIONS: Array<{ value: DeliveryTypeFilterKey; label: string }> = [
  { value: "logistics", label: "Logistics Delivery" },
  { value: "vendor_delivery", label: "Vendor Delivery" },
];

const BRANCH_FILTER_OPTIONS: Array<{ value: BranchFilterKey; label: string }> = [
  { value: "vendor", label: "Has Vendor Cancels" },
  { value: "transport", label: "Has Transport Cancels" },
  { value: "late", label: "Has Late" },
  { value: "on_hold", label: "Has On Hold" },
  { value: "unassigned", label: "Has Unassigned" },
  { value: "in_prep", label: "Has In Prep" },
  { value: "ready", label: "Has Ready to Pickup" },
];

const BRANCH_ACTIVITY_FILTER_OPTIONS: Array<{ value: BranchActivityFilter; label: string }> = [
  { value: "all", label: "All" },
  { value: "active", label: "Active" },
  { value: "inactive", label: "Inactive" },
];

const NUMERIC_SORT_OPTIONS: Array<{ value: NumericSortKey; label: string }> = [
  { value: "orders", label: "Most Orders" },
  { value: "vfr", label: "Highest VFR" },
  { value: "lfr", label: "Highest LFR" },
  { value: "vlfr", label: "Highest V+L FR" },
  { value: "active", label: "Most Active" },
  { value: "late", label: "Most Late" },
  { value: "on_hold", label: "Most On Hold" },
  { value: "unassigned", label: "Most Unassigned" },
  { value: "in_prep", label: "Most In Prep" },
  { value: "ready", label: "Most Ready to Pickup" },
];

const NAME_SORT_LABEL = "Branch Name";
const NO_ORDERS_YET_LABEL = "No Orders Yet";

const metric = (value: number) => value.toLocaleString("en-US");
const percent = (value: number) => `${value.toFixed(value >= 10 ? 1 : 2)}%`;
const cairoTimeFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Africa/Cairo",
  hour: "2-digit",
  minute: "2-digit",
});

function toUnixMillis(value: string | null | undefined) {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function shouldReplaceSummarySnapshot(
  current: PerformanceSummaryResponse | null,
  next: PerformanceSummaryResponse,
) {
  if (!current) return true;

  const currentFetchedAt = toUnixMillis(current.fetchedAt);
  const nextFetchedAt = toUnixMillis(next.fetchedAt);

  if (currentFetchedAt == null) return true;
  if (nextFetchedAt == null) return false;
  if (nextFetchedAt !== currentFetchedAt) {
    return nextFetchedAt > currentFetchedAt;
  }

  return next.scope.dayKey !== current.scope.dayKey || next.cacheState !== current.cacheState;
}

function buildTrendRequestKey(
  dayKey: string,
  resolutionMinutes: PerformanceTrendResolutionMinutes,
  startMinute: number,
  endMinute: number,
  scopeKey: string,
) {
  return [dayKey, resolutionMinutes, startMinute, endMinute, scopeKey].join("|");
}

function isAbortError(error: unknown) {
  return error instanceof Error && error.name === "AbortError";
}

function buildEmptyTrendResponse(
  scope: PerformanceSummaryResponse["scope"],
  resolutionMinutes: PerformanceTrendResolutionMinutes,
  startMinute: number,
  endMinute: number,
  fetchedAt: string | null,
  cacheState: PerformanceTrendResponse["cacheState"],
): PerformanceTrendResponse {
  const startUtcMs = new Date(scope.startUtcIso).getTime();
  const buckets = [];
  for (let minute = startMinute; minute < endMinute; minute += resolutionMinutes) {
    const bucketStartMs = startUtcMs + (minute * 60_000);
    const bucketEndMs = startUtcMs + (Math.min(minute + resolutionMinutes, endMinute) * 60_000);
    buckets.push({
      bucketStartUtcIso: new Date(bucketStartMs).toISOString(),
      bucketEndUtcIso: new Date(bucketEndMs).toISOString(),
      label: cairoTimeFormatter.format(new Date(bucketStartMs)),
      ordersCount: 0,
      vendorCancelledCount: 0,
      transportCancelledCount: 0,
      vfr: 0,
      lfr: 0,
      vlfr: 0,
    });
  }

  return {
    scope,
    fetchedAt,
    cacheState,
    resolutionMinutes,
    startMinute,
    endMinute,
    buckets,
  };
}

function clampTrendMinute(value: number) {
  const rounded = Math.round(value / 15) * 15;
  return Math.max(0, Math.min(FULL_DAY_END_MINUTE, rounded));
}

const accent = (statusColor: PerformanceEntityBranchCard["statusColor"]) =>
  statusColor === "red"
    ? { line: "#ef4444", glow: "rgba(239,68,68,0.16)", border: "rgba(239,68,68,0.14)" }
    : statusColor === "green"
      ? { line: "#22c55e", glow: "rgba(34,197,94,0.16)", border: "rgba(34,197,94,0.14)" }
      : statusColor === "orange"
        ? { line: "#f97316", glow: "rgba(249,115,22,0.16)", border: "rgba(249,115,22,0.14)" }
        : { line: "#94a3b8", glow: "rgba(148,163,184,0.16)", border: "rgba(148,163,184,0.14)" };

function branchMatches(branch: PerformanceEntityBranchCard, query: string) {
  if (!query) return true;
  return `${branch.name} ${branch.vendorId}`.toLowerCase().includes(query);
}

function dedupeSelections<T extends string | number>(values: T[]) {
  return Array.from(new Set(values));
}

function parseBulkInputTokens(raw: string) {
  return dedupeSelections(
    raw
      .split(/[\s,]+/)
      .map((item) => item.trim())
      .filter((item) => item.length > 0),
  );
}

function parseOrdersBulkInput(raw: string) {
  return dedupeSelections(
    parseBulkInputTokens(raw)
      .map((item) => Number(item))
      .filter((item): item is number => Number.isInteger(item) && item > 0),
  );
}

function parseAvailabilityBulkInput(raw: string) {
  return parseBulkInputTokens(raw);
}

function normalizeVendorSelections(values: number[]) {
  return dedupeSelections(values).sort((left, right) => left - right);
}

function resolveExplicitVendorSelections(groupVendorIds: number[], selectedVendorIds: number[]) {
  const normalizedGroupVendorIds = normalizeVendorSelections(groupVendorIds);
  const normalizedSelectedVendorIds = normalizeVendorSelections(selectedVendorIds);

  if (normalizedGroupVendorIds.length && normalizedSelectedVendorIds.length) {
    const selectedVendorIdSet = new Set(normalizedSelectedVendorIds);
    return normalizedGroupVendorIds.filter((vendorId) => selectedVendorIdSet.has(vendorId));
  }

  return normalizedGroupVendorIds.length ? normalizedGroupVendorIds : normalizedSelectedVendorIds;
}

function normalizePreferencesState(input: Partial<PerformancePreferencesState> | PerformancePreferencesState | null | undefined): PerformancePreferencesState {
  const nextState = {
    ...DEFAULT_PREFERENCES_STATE,
    ...(input ?? {}),
  };

  const selectedSortKeys = nextState.nameSortEnabled
    ? []
    : dedupeSelections((nextState.selectedSortKeys ?? []).filter((value): value is NumericSortKey =>
      NUMERIC_SORT_OPTIONS.some((option) => option.value === value),
    ));

  return {
    searchQuery: typeof nextState.searchQuery === "string" ? nextState.searchQuery : "",
    selectedVendorIds: dedupeSelections((nextState.selectedVendorIds ?? []).filter((value): value is number => Number.isInteger(value) && value > 0)),
    selectedDeliveryTypes: dedupeSelections((nextState.selectedDeliveryTypes ?? []).filter((value): value is DeliveryTypeFilterKey =>
      DELIVERY_TYPE_OPTIONS.some((option) => option.value === value),
    )),
    selectedBranchFilters: dedupeSelections((nextState.selectedBranchFilters ?? []).filter((value): value is BranchFilterKey =>
      BRANCH_FILTER_OPTIONS.some((option) => option.value === value),
    )),
    selectedSortKeys: selectedSortKeys.length ? selectedSortKeys : (nextState.nameSortEnabled ? [] : ["orders"]),
    nameSortEnabled: Boolean(nextState.nameSortEnabled),
    activeGroupId:
      typeof nextState.activeGroupId === "number" && Number.isInteger(nextState.activeGroupId) && nextState.activeGroupId > 0
        ? nextState.activeGroupId
        : null,
    activeViewId:
      typeof nextState.activeViewId === "number" && Number.isInteger(nextState.activeViewId) && nextState.activeViewId > 0
        ? nextState.activeViewId
        : null,
  };
}

function deliveryTypeMatches(branch: PerformanceEntityBranchCard, selectedDeliveryTypes: DeliveryTypeFilterKey[]) {
  if (!selectedDeliveryTypes.length || selectedDeliveryTypes.length === DELIVERY_TYPE_OPTIONS.length) {
    return true;
  }

  return selectedDeliveryTypes.some((filter) => {
    if (filter === "logistics") {
      return branch.deliveryMode === "logistics" || branch.deliveryMode === "mixed";
    }

    return branch.deliveryMode === "self";
  });
}

function branchPassesAllFilters(branch: PerformanceEntityBranchCard, selectedFilters: BranchFilterKey[]) {
  if (!selectedFilters.length) return true;

  return selectedFilters.every((filter) => {
    switch (filter) {
      case "vendor":
        return branch.vendorOwnerCancelledCount > 0;
      case "transport":
        return branch.transportOwnerCancelledCount > 0 && branch.lfrApplicable;
      case "late":
        return branch.lateNow > 0;
      case "on_hold":
        return branch.onHoldOrders > 0;
      case "unassigned":
        return branch.unassignedOrders > 0;
      case "in_prep":
        return branch.preparingNow > 0;
      case "ready":
        return branch.readyToPickupOrders > 0;
      default:
        return true;
    }
  });
}

function numericSortScore(branch: PerformanceEntityBranchCard, key: NumericSortKey) {
  switch (key) {
    case "orders":
      return branch.totalOrders;
    case "vfr":
      return branch.vendorOwnerCancelledCount;
    case "lfr":
      return branch.lfrApplicable ? branch.transportOwnerCancelledCount : 0;
    case "vlfr":
      return branch.vendorOwnerCancelledCount + branch.transportOwnerCancelledCount;
    case "active":
      return branch.activeOrders;
    case "late":
      return branch.lateNow;
    case "on_hold":
      return branch.onHoldOrders;
    case "unassigned":
      return branch.unassignedOrders;
    case "in_prep":
      return branch.preparingNow;
    case "ready":
      return branch.readyToPickupOrders;
    default:
      return 0;
  }
}

function compareBranches(
  a: PerformanceEntityBranchCard,
  b: PerformanceEntityBranchCard,
  options: { selectedSortKeys: NumericSortKey[]; nameSortEnabled: boolean },
) {
  if (options.nameSortEnabled) {
    return a.name.localeCompare(b.name) || b.totalOrders - a.totalOrders;
  }

  const selectedSortKeys: NumericSortKey[] = options.selectedSortKeys.length ? options.selectedSortKeys : ["orders"];
  const aScore = selectedSortKeys.reduce((total, key) => total + numericSortScore(a, key), 0);
  const bScore = selectedSortKeys.reduce((total, key) => total + numericSortScore(b, key), 0);

  return (
    bScore - aScore ||
    b.totalOrders - a.totalOrders ||
    b.vlfr - a.vlfr ||
    a.name.localeCompare(b.name)
  );
}

function optionLabel<T extends string>(options: ReadonlyArray<{ value: T; label: string }>, value: T) {
  return options.find((option) => option.value === value)?.label ?? value;
}

function summarizeSelection<T extends string>(
  options: ReadonlyArray<{ value: T; label: string }>,
  selectedValues: T[],
  fallback: string,
  pluralSuffix: string,
) {
  if (!selectedValues.length) return fallback;
  if (selectedValues.length === 1) {
    return optionLabel(options, selectedValues[0]!);
  }
  return `${selectedValues.length} ${pluralSuffix}`;
}

function summarizeBranchSelection(branches: PerformanceEntityBranchCard[], selectedVendorIds: number[]) {
  if (!selectedVendorIds.length) return "Branches";
  if (selectedVendorIds.length === 1) {
    return branches.find((branch) => branch.vendorId === selectedVendorIds[0])?.name ?? "1 branch";
  }
  return `${selectedVendorIds.length} branches`;
}

function sortSavedGroups(groups: PerformanceSavedGroup[]) {
  return [...groups].sort((left, right) =>
    right.updatedAt.localeCompare(left.updatedAt) || right.id - left.id,
  );
}

function buildPlaceholderBranchCard(
  vendorId: number,
  name: string,
  availabilityVendorId: string | null,
): DisplayPerformanceBranchCard {
  return {
    vendorId,
    name: name.trim() || NO_ORDERS_YET_LABEL,
    availabilityVendorId,
    isPlaceholder: true,
    statusColor: "grey",
    totalOrders: 0,
    activeOrders: 0,
    lateNow: 0,
    onHoldOrders: 0,
    unassignedOrders: 0,
    preparingNow: 0,
    readyToPickupOrders: 0,
    deliveryMode: "unknown",
    lfrApplicable: false,
    vendorOwnerCancelledCount: 0,
    transportOwnerCancelledCount: 0,
    vfr: 0,
    lfr: 0,
    vlfr: 0,
    statusCounts: [],
    ownerCoverage: {
      totalCancelledOrders: 0,
      resolvedOwnerCount: 0,
      unresolvedOwnerCount: 0,
      vendorOwnerCancelledCount: 0,
      transportOwnerCancelledCount: 0,
      lookupErrorCount: 0,
      coverageRatio: 1,
      warning: null,
    },
  };
}

type SummaryTileBadgeTone = "default" | "info" | "danger";

function SummaryTileBadge(props: { label: string; value: string; tone?: SummaryTileBadgeTone }) {
  const palette =
    props.tone === "danger"
      ? { bg: "rgba(254,242,242,0.96)", text: "#b91c1c", border: "rgba(239,68,68,0.12)" }
      : props.tone === "info"
        ? { bg: "rgba(239,246,255,0.96)", text: "#0369a1", border: "rgba(14,165,233,0.12)" }
        : { bg: "rgba(248,250,252,0.98)", text: "#475569", border: "rgba(148,163,184,0.12)" };

  return (
    <Box
      sx={{
        display: "inline-flex",
        alignItems: "center",
        gap: 0.45,
        px: 0.75,
        py: 0.45,
        borderRadius: 999,
        border: `1px solid ${palette.border}`,
        bgcolor: palette.bg,
      }}
    >
      <Typography sx={{ fontSize: 10.5, fontWeight: 900, color: palette.text, letterSpacing: 0.14 }}>
        {props.label}
      </Typography>
      <Typography sx={{ fontSize: 10.5, fontWeight: 900, color: palette.text }}>
        {props.value}
      </Typography>
    </Box>
  );
}

function CompactSummaryTile(props: {
  label: string;
  value: string;
  secondaryValue?: string;
  tone?: "default" | "danger" | "warning" | "info";
  featured?: boolean;
  badges?: Array<{ label: string; value: string; tone?: SummaryTileBadgeTone }>;
}) {
  const palette =
    props.tone === "danger"
      ? { bg: "rgba(254,242,242,0.98)", text: "#b91c1c", border: "rgba(239,68,68,0.12)" }
      : props.tone === "warning"
        ? { bg: "rgba(255,247,237,0.98)", text: "#c2410c", border: "rgba(249,115,22,0.12)" }
        : props.tone === "info"
          ? { bg: "rgba(239,246,255,0.98)", text: "#075985", border: "rgba(14,165,233,0.12)" }
          : { bg: "rgba(248,250,252,0.98)", text: "#0f172a", border: "rgba(148,163,184,0.12)" };

  return (
    <Box
      sx={{
        p: props.featured ? { xs: 1.05, md: 1.15 } : 0.9,
        borderRadius: props.featured ? 2.8 : 2.4,
        border: `1px solid ${palette.border}`,
        bgcolor: palette.bg,
        minHeight: props.featured ? 84 : 68,
        gridColumn: props.featured ? { xs: "span 2", md: "span 2" } : undefined,
      }}
    >
      <Typography sx={{ color: "#64748b", fontSize: props.featured ? 11.5 : 10.5, fontWeight: 800, letterSpacing: 0.16 }}>
        {props.label}
      </Typography>
      <Box sx={{ mt: 0.35, display: "inline-flex", alignItems: "baseline", gap: 0.45, flexWrap: "wrap" }}>
        <Typography
          sx={{
            fontSize: props.featured ? { xs: 28, md: 32 } : { xs: 19, md: 21 },
            lineHeight: 1.02,
            fontWeight: 900,
            color: palette.text,
          }}
        >
          {props.value}
        </Typography>
        {props.secondaryValue ? (
          <Typography
            sx={{
              fontSize: props.featured ? { xs: 11, md: 12 } : { xs: 10, md: 10.5 },
              lineHeight: 1,
              fontWeight: 800,
              color: palette.text,
              opacity: 0.8,
            }}
          >
            {props.secondaryValue}
          </Typography>
        ) : null}
      </Box>
      {props.badges?.length ? (
        <Stack direction="row" spacing={0.55} sx={{ mt: 0.85, flexWrap: "wrap" }}>
          {props.badges.map((badge) => (
            <SummaryTileBadge
              key={`${props.label}-${badge.label}`}
              label={badge.label}
              value={badge.value}
              tone={badge.tone}
            />
          ))}
        </Stack>
      ) : null}
    </Box>
  );
}

function SummarySection(props: {
  title: string;
  accentColor: string;
  background: string;
  gridTemplateColumns: Partial<Record<"xs" | "sm" | "md" | "lg" | "xl", string>>;
  tiles: Array<{
    label: string;
    value: string;
    secondaryValue?: string;
    tone?: "default" | "danger" | "warning" | "info";
    featured?: boolean;
    badges?: Array<{ label: string; value: string; tone?: SummaryTileBadgeTone }>;
  }>;
}) {
  return (
    <Box
      sx={{
        p: { xs: 0.95, md: 1.05 },
        borderRadius: 3,
        border: "1px solid rgba(148,163,184,0.12)",
        bgcolor: props.background,
        boxShadow: "inset 0 1px 0 rgba(255,255,255,0.55)",
        minHeight: "100%",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <Stack direction="row" spacing={0.8} alignItems="center" sx={{ mb: 0.75 }}>
        <Typography
          sx={{
            fontSize: 11.5,
            fontWeight: 900,
            letterSpacing: 0.24,
            textTransform: "uppercase",
            color: props.accentColor,
            whiteSpace: "nowrap",
          }}
        >
          {props.title}
        </Typography>
      </Stack>

      <Box
        sx={{
          display: "grid",
          gap: 0.7,
          gridTemplateColumns: props.gridTemplateColumns,
          flex: 1,
          alignItems: "stretch",
        }}
      >
        {props.tiles.map((tile) => (
          <CompactSummaryTile
            key={`${props.title}-${tile.label}`}
            label={tile.label}
            value={tile.value}
            secondaryValue={tile.secondaryValue}
            tone={tile.tone}
            featured={tile.featured}
            badges={tile.badges}
          />
        ))}
      </Box>
    </Box>
  );
}

function buildVisibleSummary(branches: DisplayPerformanceBranchCard[]) {
  const totals = branches.reduce(
    (current, branch) => {
      current.branchCount += 1;
      if (branch.isPlaceholder) {
        current.inactiveBranchCount += 1;
      } else {
        current.activeBranchCount += 1;
      }
      current.totalOrders += branch.totalOrders;
      current.totalCancelledOrders += branch.ownerCoverage.totalCancelledOrders;
      current.activeOrders += branch.activeOrders;
      current.lateNow += branch.lateNow;
      current.onHoldOrders += branch.onHoldOrders;
      current.unassignedOrders += branch.unassignedOrders;
      current.preparingNow += branch.preparingNow;
      current.readyToPickupOrders += branch.readyToPickupOrders;
      current.vendorOwnerCancelledCount += branch.vendorOwnerCancelledCount;
      current.transportOwnerCancelledCount += branch.transportOwnerCancelledCount;
      return current;
    },
    {
      branchCount: 0,
      activeBranchCount: 0,
      inactiveBranchCount: 0,
      totalOrders: 0,
      totalCancelledOrders: 0,
      activeOrders: 0,
      lateNow: 0,
      onHoldOrders: 0,
      unassignedOrders: 0,
      preparingNow: 0,
      readyToPickupOrders: 0,
      vendorOwnerCancelledCount: 0,
      transportOwnerCancelledCount: 0,
    },
  );

  return {
    ...totals,
    vfr: totals.totalOrders ? (totals.vendorOwnerCancelledCount / totals.totalOrders) * 100 : 0,
    lfr: totals.totalOrders ? (totals.transportOwnerCancelledCount / totals.totalOrders) * 100 : 0,
    vlfr: totals.totalOrders ? ((totals.vendorOwnerCancelledCount + totals.transportOwnerCancelledCount) / totals.totalOrders) * 100 : 0,
  };
}

function formatPerformanceSnapshotTime(value: string | null | undefined) {
  if (!value) return null;
  try {
    return new Date(value).toLocaleString("en-GB", {
      timeZone: "Africa/Cairo",
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return value;
  }
}

function branchMatchesActivityFilter(branch: DisplayPerformanceBranchCard, activityFilter: BranchActivityFilter) {
  if (activityFilter === "all") {
    return true;
  }

  return activityFilter === "inactive" ? Boolean(branch.isPlaceholder) : !branch.isPlaceholder;
}

function ToolbarChipButton(props: {
  icon: ReactNode;
  ariaLabel: string;
  title: string;
  active: boolean;
  activeText: string;
  activeBg: string;
  activeColor: string;
  onClick: MouseEventHandler<HTMLButtonElement>;
  disabled?: boolean;
}) {
  return (
    <Box
      component="button"
      type="button"
      aria-label={props.ariaLabel}
      title={props.title}
      onClick={props.onClick}
      disabled={props.disabled}
      sx={{
        appearance: "none",
        display: "inline-flex",
        alignItems: "center",
        gap: props.active ? 0.7 : 0,
        minWidth: 40,
        height: 40,
        px: props.active ? 1.15 : 0.95,
        borderRadius: 999,
        border: "1px solid rgba(148,163,184,0.14)",
        bgcolor: props.active ? props.activeBg : "rgba(255,255,255,0.92)",
        color: props.active ? props.activeColor : "#334155",
        boxShadow: "0 8px 18px rgba(15,23,42,0.05)",
        cursor: props.disabled ? "default" : "pointer",
        overflow: "hidden",
        transition: "all 180ms ease",
        "&:hover": props.disabled
          ? undefined
          : {
            bgcolor: props.active ? props.activeBg : "white",
            boxShadow: "0 10px 20px rgba(15,23,42,0.08)",
          },
        "&:disabled": {
          opacity: 0.55,
          boxShadow: "none",
        },
      }}
    >
      <Box sx={{ display: "grid", placeItems: "center", flexShrink: 0 }}>{props.icon}</Box>
      <Box
        sx={{
          maxWidth: props.active ? 180 : 0,
          opacity: props.active ? 1 : 0,
          transform: props.active ? "translateX(0)" : "translateX(-6px)",
          transition: "max-width 180ms ease, opacity 160ms ease, transform 180ms ease",
          overflow: "hidden",
          whiteSpace: "nowrap",
        }}
      >
        <Typography sx={{ fontSize: 13, fontWeight: 700, color: "inherit", whiteSpace: "nowrap" }}>{props.activeText}</Typography>
      </Box>
    </Box>
  );
}

function resolvePeakFlowMetric(branch: PerformanceEntityBranchCard) {
  const candidates = [
    { label: "On Hold", value: branch.onHoldOrders, tone: "warning" as const },
    { label: "Unassigned", value: branch.unassignedOrders, tone: "warning" as const },
    { label: "In Prep", value: branch.preparingNow, tone: "info" as const },
    { label: "Ready", value: branch.readyToPickupOrders, tone: "info" as const },
  ];

  const topMetric = candidates.reduce((best, current) => (current.value > best.value ? current : best), candidates[0]!);
  if (topMetric.value > 0) {
    return topMetric;
  }

  return {
    label: "Queue",
    value: 0,
    tone: "default" as const,
  };
}

function InlineMetricPill(props: {
  label: string;
  value: string;
  secondaryValue?: string;
  tone?: "default" | "danger" | "warning" | "info";
}) {
  const palette =
    props.tone === "danger"
      ? { bg: "rgba(254,242,242,0.98)", text: "#b91c1c", border: "rgba(239,68,68,0.12)" }
      : props.tone === "warning"
        ? { bg: "rgba(255,247,237,0.98)", text: "#c2410c", border: "rgba(249,115,22,0.12)" }
        : props.tone === "info"
          ? { bg: "rgba(239,246,255,0.98)", text: "#075985", border: "rgba(14,165,233,0.12)" }
          : { bg: "rgba(248,250,252,0.98)", text: "#0f172a", border: "rgba(148,163,184,0.12)" };

  return (
    <Box
      sx={{
        display: "inline-flex",
        alignItems: "center",
        gap: 0.7,
        px: 1.1,
        py: 0.8,
        borderRadius: 999,
        border: `1px solid ${palette.border}`,
        bgcolor: palette.bg,
        whiteSpace: "nowrap",
      }}
    >
      <Typography sx={{ fontSize: 11, fontWeight: 800, color: "#64748b", letterSpacing: 0.18 }}>
        {props.label}
      </Typography>
      <Box sx={{ display: "inline-flex", alignItems: "baseline", gap: 0.4 }}>
        <Typography sx={{ fontSize: 15, fontWeight: 900, color: palette.text, lineHeight: 1 }}>
          {props.value}
        </Typography>
        {props.secondaryValue ? (
          <Typography sx={{ fontSize: 10.5, fontWeight: 800, color: palette.text, lineHeight: 1, opacity: 0.8 }}>
            {props.secondaryValue}
          </Typography>
        ) : null}
      </Box>
    </Box>
  );
}

function BranchCard(props: {
  branch: DisplayPerformanceBranchCard;
  expanded: boolean;
  onToggle: () => void;
  onOpenDetail: () => void;
}) {
  const look = accent(props.branch.statusColor);
  const peakMetric = resolvePeakFlowMetric(props.branch);
  const vfrTone =
    props.branch.vfr >= 4 ? "danger" : props.branch.vfr >= 1.5 ? "warning" : "info";

  return (
    <Box
      sx={{
        position: "relative",
        overflow: "hidden",
        p: { xs: 1.1, md: 1.25 },
        borderRadius: 4,
        border: `1px solid ${look.border}`,
        bgcolor: "rgba(255,255,255,0.97)",
        boxShadow: props.expanded ? "0 22px 44px rgba(15,23,42,0.07)" : "0 14px 30px rgba(15,23,42,0.045)",
        transition: "box-shadow 220ms ease, transform 220ms ease, border-color 220ms ease",
      }}
    >
      <Box
        sx={{
          position: "absolute",
          left: -28,
          top: "18%",
          width: 140,
          height: 140,
          borderRadius: "50%",
          bgcolor: look.glow,
          filter: "blur(28px)",
          opacity: props.expanded ? 1 : 0.72,
          transition: "opacity 220ms ease",
        }}
      />
      <Box
        sx={{
          position: "absolute",
          insetInlineStart: 0,
          top: 0,
          bottom: 0,
          width: 5,
          bgcolor: look.line,
        }}
      />

      <Stack
        direction="row"
        spacing={1}
        alignItems="center"
        sx={{ position: "relative", zIndex: 1 }}
      >
        <Box
          role="button"
          tabIndex={0}
          aria-label={`Toggle branch ${props.branch.name}`}
          aria-expanded={props.expanded}
          onClick={props.onToggle}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              props.onToggle();
            }
          }}
          sx={{
            flex: 1,
            minWidth: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 1.4,
            p: { xs: 0.45, md: 0.65 },
            textAlign: "left",
            border: 0,
            background: "transparent",
            cursor: "pointer",
            borderRadius: 3.2,
            transition: "background-color 180ms ease",
            "&:hover": {
              bgcolor: "rgba(248,250,252,0.72)",
            },
            "&:focus-visible": {
              outline: "2px solid rgba(37,99,235,0.28)",
              outlineOffset: 2,
            },
          }}
        >
          <Stack direction="row" spacing={1.1} alignItems="center" sx={{ minWidth: 0, flex: 1 }}>
            <Box
              sx={{
                width: 48,
                height: 48,
                display: "grid",
                placeItems: "center",
                borderRadius: 2.6,
                bgcolor: "rgba(248,250,252,0.98)",
                border: "1px solid rgba(148,163,184,0.12)",
                color: "#0f172a",
              }}
            >
              <StorefrontRoundedIcon fontSize="small" />
            </Box>
            <Box sx={{ minWidth: 0, flex: 1 }}>
              <Typography component="h2" sx={{ fontSize: { xs: 21, md: 23 }, lineHeight: 1.1, fontWeight: 900, color: "#0f172a", minWidth: 0 }}>
                {props.branch.name}
              </Typography>
              <Stack
                direction="row"
                spacing={0.8}
                alignItems="center"
                sx={{
                  mt: 0.3,
                  pointerEvents: "none",
                }}
              >
                <Typography sx={{ color: "#64748b", fontSize: 13, fontWeight: 700, whiteSpace: "nowrap" }}>
                  Vendor ID {props.branch.vendorId}
                </Typography>
                <Box
                  sx={{
                    width: 4,
                    height: 4,
                    borderRadius: "50%",
                    bgcolor: "rgba(148,163,184,0.8)",
                    flexShrink: 0,
                  }}
                />
                <Typography sx={{ color: "#64748b", fontSize: 13, fontWeight: 700, whiteSpace: "nowrap" }}>
                  {metric(props.branch.totalOrders)} orders
                </Typography>
                {props.branch.isUnmappedVendor ? (
                  <>
                    <Box
                      sx={{
                        width: 4,
                        height: 4,
                        borderRadius: "50%",
                        bgcolor: "rgba(148,163,184,0.8)",
                        flexShrink: 0,
                      }}
                    />
                    <Typography sx={{ color: "#854d0e", fontSize: 12.5, fontWeight: 800, whiteSpace: "nowrap" }}>
                      Unmapped vendor
                    </Typography>
                  </>
                ) : null}
                {props.branch.isPlaceholder ? (
                  <>
                    <Box
                      sx={{
                        width: 4,
                        height: 4,
                        borderRadius: "50%",
                        bgcolor: "rgba(148,163,184,0.8)",
                        flexShrink: 0,
                      }}
                    />
                    <Typography sx={{ color: "#64748b", fontSize: 13, fontWeight: 800, whiteSpace: "nowrap" }}>
                      {NO_ORDERS_YET_LABEL}
                    </Typography>
                  </>
                ) : null}
              </Stack>
            </Box>
          </Stack>

          <Stack
            direction={{ xs: "column", sm: "row" }}
            spacing={0.9}
            alignItems={{ xs: "flex-end", sm: "center" }}
            sx={{ flexShrink: 0 }}
          >
            <InlineMetricPill
              label="VFR"
              value={percent(props.branch.vfr)}
              tone={vfrTone}
            />
            <Box
              sx={{
                display: "inline-flex",
                alignItems: "center",
                gap: 0.75,
                pointerEvents: "auto",
              }}
            >
              <InlineMetricPill label={peakMetric.label} value={metric(peakMetric.value)} tone={peakMetric.tone} />
              <IconButton
                size="small"
                disabled={props.branch.isPlaceholder}
                onClick={(event) => {
                  event.stopPropagation();
                  if (props.branch.isPlaceholder) return;
                  props.onOpenDetail();
                }}
                aria-label={props.branch.isPlaceholder ? `Details unavailable for ${props.branch.name}` : `Open details for ${props.branch.name}`}
                sx={{
                  width: 34,
                  height: 34,
                  flexShrink: 0,
                  border: "1px solid rgba(37,99,235,0.14)",
                  bgcolor: "rgba(239,246,255,0.92)",
                  color: "#1d4ed8",
                  boxShadow: "0 8px 16px rgba(15,23,42,0.05)",
                  transition: "transform 180ms ease, background-color 180ms ease, box-shadow 180ms ease",
                  "&:hover": {
                    bgcolor: "rgba(219,234,254,0.98)",
                    boxShadow: "0 10px 18px rgba(15,23,42,0.08)",
                    transform: "translateY(-1px)",
                  },
                }}
              >
                <VisibilityRoundedIcon sx={{ fontSize: 18 }} />
              </IconButton>
              <Box
                sx={{
                  width: 38,
                  height: 38,
                  display: "grid",
                  placeItems: "center",
                  borderRadius: "50%",
                  border: "1px solid rgba(148,163,184,0.12)",
                  bgcolor: "rgba(248,250,252,0.98)",
                  color: "#64748b",
                  transform: props.expanded ? "rotate(180deg)" : "rotate(0deg)",
                  transition: "transform 220ms ease, background-color 180ms ease, color 180ms ease",
                }}
              >
                <ExpandMoreRoundedIcon fontSize="small" />
              </Box>
            </Box>
          </Stack>
        </Box>
      </Stack>

      <Collapse in={props.expanded} timeout={280} collapsedSize={0} unmountOnExit>
        <Box
          sx={{
            position: "relative",
            zIndex: 1,
            mt: 1.15,
            pt: 1.15,
            borderTop: "1px solid rgba(148,163,184,0.12)",
            display: "grid",
            gap: 1,
            gridTemplateColumns: {
              xs: "repeat(2, minmax(0, 1fr))",
              md: "repeat(3, minmax(0, 1fr))",
              lg: "repeat(5, minmax(0, 1fr))",
              xl: "repeat(10, minmax(0, 1fr))",
            },
            opacity: props.expanded ? 1 : 0,
            transform: props.expanded ? "translateY(0)" : "translateY(-8px)",
            transition: "opacity 220ms ease, transform 220ms ease",
          }}
        >
          <MetricTile label="Total Orders" value={metric(props.branch.totalOrders)} />
          <MetricTile label="Active" value={metric(props.branch.activeOrders)} tone="info" />
          <MetricTile label="Late" value={metric(props.branch.lateNow)} tone="warning" />
          <MetricTile
            label="VFR"
            value={metric(props.branch.vendorOwnerCancelledCount)}
            secondaryValue={percent(props.branch.vfr)}
            tone="danger"
          />
          <MetricTile
            label="LFR"
            value={props.branch.lfrApplicable ? metric(props.branch.transportOwnerCancelledCount) : "TMP"}
            secondaryValue={props.branch.lfrApplicable ? percent(props.branch.lfr) : undefined}
            tone={props.branch.lfrApplicable ? "danger" : "default"}
          />
          <MetricTile
            label="V+L FR"
            value={metric(props.branch.vendorOwnerCancelledCount + props.branch.transportOwnerCancelledCount)}
            secondaryValue={percent(props.branch.vlfr)}
            tone="danger"
          />
          <MetricTile label="On Hold" value={metric(props.branch.onHoldOrders)} tone="warning" />
          <MetricTile label="Unassigned" value={metric(props.branch.unassignedOrders)} tone="warning" />
          <MetricTile label="In Prep" value={metric(props.branch.preparingNow)} tone="info" />
          <MetricTile label="Ready to Pickup" value={metric(props.branch.readyToPickupOrders)} tone="info" />
        </Box>
      </Collapse>
    </Box>
  );
}

export function PerformancePage() {
  const { monitoring } = useMonitorStatus();
  const [heroPanel, setHeroPanel] = useState<HeroPanel>("summary");
  const [summary, setSummary] = useState<PerformanceSummaryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [trend, setTrend] = useState<PerformanceTrendResponse | null>(null);
  const [trendLoading, setTrendLoading] = useState(false);
  const [trendRefreshing, setTrendRefreshing] = useState(false);
  const [trendError, setTrendError] = useState<string | null>(null);
  const [trendResolutionMinutes, setTrendResolutionMinutes] = useState<PerformanceTrendResolutionMinutes>(60);
  const [trendStartMinute, setTrendStartMinute] = useState(0);
  const [trendEndMinute, setTrendEndMinute] = useState(FULL_DAY_END_MINUTE);
  const [currentState, setCurrentState] = useState<PerformancePreferencesState>(DEFAULT_PREFERENCES_STATE);
  const [savedGroups, setSavedGroups] = useState<PerformanceSavedGroup[]>([]);
  const [preferencesLoaded, setPreferencesLoaded] = useState(false);
  const [page, setPage] = useState(1);
  const [expandedBranchIds, setExpandedBranchIds] = useState<number[]>([]);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailSubject, setDetailSubject] = useState<DisplayPerformanceBranchCard | null>(null);
  const [detail, setDetail] = useState<PerformanceVendorDetailResponse | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailRefreshing, setDetailRefreshing] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [transportAnchorEl, setTransportAnchorEl] = useState<HTMLElement | null>(null);
  const [activityAnchorEl, setActivityAnchorEl] = useState<HTMLElement | null>(null);
  const [filterAnchorEl, setFilterAnchorEl] = useState<HTMLElement | null>(null);
  const [sortAnchorEl, setSortAnchorEl] = useState<HTMLElement | null>(null);
  const [groupQuickAnchorEl, setGroupQuickAnchorEl] = useState<HTMLElement | null>(null);
  const [branchesDialogOpen, setBranchesDialogOpen] = useState(false);
  const [branchesDialogQuery, setBranchesDialogQuery] = useState("");
  const [branchDraftVendorIds, setBranchDraftVendorIds] = useState<number[]>([]);
  const [groupEditorOpen, setGroupEditorOpen] = useState(false);
  const [groupDraftId, setGroupDraftId] = useState<number | null>(null);
  const [groupDraftName, setGroupDraftName] = useState("");
  const [groupDraftVendorIds, setGroupDraftVendorIds] = useState<number[]>([]);
  const [groupMutationError, setGroupMutationError] = useState<string | null>(null);
  const [sourceItems, setSourceItems] = useState<LocalVendorCatalogItem[]>([]);
  const [sourceLoaded, setSourceLoaded] = useState(false);
  const [sourceLoading, setSourceLoading] = useState(false);
  const [sourceError, setSourceError] = useState<string | null>(null);
  const [bulkAddOpen, setBulkAddOpen] = useState(false);
  const [bulkAddMode, setBulkAddMode] = useState<BulkAddMode>("orders");
  const [bulkAddStep, setBulkAddStep] = useState<BulkAddStep>("input");
  const [bulkAddInput, setBulkAddInput] = useState("");
  const [bulkAddGroupName, setBulkAddGroupName] = useState("");
  const [bulkAddResolvedItems, setBulkAddResolvedItems] = useState<BulkAddResolvedVendor[]>([]);
  const [bulkAddSelectedVendorIds, setBulkAddSelectedVendorIds] = useState<number[]>([]);
  const [bulkAddError, setBulkAddError] = useState<string | null>(null);
  const [bulkAddSummary, setBulkAddSummary] = useState<BulkAddResolutionSummary | null>(null);
  const [bulkAddLoadingText, setBulkAddLoadingText] = useState("");
  const [branchActivityFilter, setBranchActivityFilter] = useState<BranchActivityFilter>("all");
  const deferredSearchQuery = useDeferredValue(currentState.searchQuery.trim().toLowerCase());
  const summaryRequestIdRef = useRef(0);
  const summaryAbortRef = useRef<AbortController | null>(null);
  const summaryStateRef = useRef<PerformanceSummaryResponse | null>(null);
  const trendRequestIdRef = useRef(0);
  const trendAbortRef = useRef<AbortController | null>(null);
  const liveAbortRef = useRef<AbortController | null>(null);
  const liveReconnectTimerRef = useRef<number | null>(null);
  const liveReconnectAttemptRef = useRef(0);
  const liveSessionRef = useRef(0);
  const preferencesLoadAbortRef = useRef<AbortController | null>(null);
  const preferencesAbortRef = useRef<AbortController | null>(null);
  const preferencesSaveTimerRef = useRef<number | null>(null);
  const skipNextPreferencesAutosaveRef = useRef(false);
  const detailRequestIdRef = useRef(0);
  const detailAbortRef = useRef<AbortController | null>(null);
  const sourceLoadPromiseRef = useRef<Promise<LocalVendorCatalogItem[]> | null>(null);
  const [trendFreshKey, setTrendFreshKey] = useState<string | null>(null);
  const controlsDisabled = (loading && !summary) || !preferencesLoaded;
  const trendPanelOpen = heroPanel === "trend";
  const activeGroup = useMemo(
    () => savedGroups.find((group) => group.id === currentState.activeGroupId) ?? null,
    [currentState.activeGroupId, savedGroups],
  );
  const sourceItemByOrdersVendorId = useMemo(
    () => new Map(sourceItems.map((item) => [item.ordersVendorId, item])),
    [sourceItems],
  );
  const unmappedVendorIdSet = useMemo(
    () => new Set((summary?.unmappedVendors ?? []).map((vendor) => vendor.vendorId)),
    [summary],
  );
  const summaryBranchByVendorId = useMemo(
    () => new Map((summary?.branches ?? []).map((branch) => [branch.vendorId, branch])),
    [summary],
  );
  const scopedPlaceholderVendorIds = useMemo(
    () => dedupeSelections([
      ...(activeGroup?.vendorIds ?? []),
      ...currentState.selectedVendorIds,
    ]),
    [activeGroup?.vendorIds, currentState.selectedVendorIds],
  );

  const allBranches = useMemo(
    () => {
      const summaryBranches = (summary?.branches ?? []).map((branch) => ({
        ...branch,
        isUnmappedVendor: unmappedVendorIdSet.has(branch.vendorId),
      })) as DisplayPerformanceBranchCard[];
      if (!scopedPlaceholderVendorIds.length) {
        return summaryBranches;
      }

      const merged = [...summaryBranches];
      const existingVendorIds = new Set(summaryBranches.map((branch) => branch.vendorId));
      for (const vendorId of scopedPlaceholderVendorIds) {
        if (existingVendorIds.has(vendorId)) continue;
        const sourceItem = sourceItemByOrdersVendorId.get(vendorId);
        merged.push(buildPlaceholderBranchCard(
          vendorId,
          sourceItem?.name ?? NO_ORDERS_YET_LABEL,
          sourceItem?.availabilityVendorId ?? null,
        ));
      }
      return merged;
    },
    [scopedPlaceholderVendorIds, sourceItemByOrdersVendorId, summary, unmappedVendorIdSet],
  );

  const activeDetailSubject = useMemo(() => {
    if (!detailSubject) return null;
    return allBranches.find((branch) => branch.vendorId === detailSubject.vendorId) ?? detailSubject;
  }, [allBranches, detailSubject]);

  const scopedBranches = useMemo(
    () =>
      allBranches
        .filter((branch) => !activeGroup || activeGroup.vendorIds.includes(branch.vendorId))
        .filter((branch) => !currentState.selectedVendorIds.length || currentState.selectedVendorIds.includes(branch.vendorId))
        .filter((branch) => branchMatches(branch, deferredSearchQuery))
        .filter((branch) => deliveryTypeMatches(branch, currentState.selectedDeliveryTypes))
        .filter((branch) => branchPassesAllFilters(branch, currentState.selectedBranchFilters)),
    [activeGroup, allBranches, currentState.selectedBranchFilters, currentState.selectedDeliveryTypes, currentState.selectedVendorIds, deferredSearchQuery],
  );
  const visibleBranches = useMemo(
    () =>
      scopedBranches
        .filter((branch) => branchMatchesActivityFilter(branch, branchActivityFilter))
        .sort((a, b) => compareBranches(a, b, {
          selectedSortKeys: currentState.selectedSortKeys,
          nameSortEnabled: currentState.nameSortEnabled,
        })),
    [branchActivityFilter, currentState.nameSortEnabled, currentState.selectedSortKeys, scopedBranches],
  );
  const scopedSummary = useMemo(
    () => buildVisibleSummary(scopedBranches),
    [scopedBranches],
  );
  const visibleSummary = useMemo(
    () => buildVisibleSummary(visibleBranches),
    [visibleBranches],
  );

  const summarySections = useMemo(
    () =>
      summary
        ? [
          {
            title: "Scope",
            accentColor: "#0369a1",
            background: "linear-gradient(180deg, rgba(239,246,255,0.88) 0%, rgba(255,255,255,0.96) 100%)",
            gridTemplateColumns: {
              xs: "repeat(2, minmax(0, 1fr))",
              md: "repeat(2, minmax(0, 1fr))",
            },
            tiles: [
              {
                label: "Branches",
                value: metric(scopedSummary.branchCount),
                tone: "info" as const,
                featured: true,
                badges: [
                  { label: "Active", value: metric(scopedSummary.activeBranchCount), tone: "info" as const },
                  { label: "Inactive", value: metric(scopedSummary.inactiveBranchCount) },
                ],
              },
              { label: "Total Orders", value: metric(visibleSummary.totalOrders), featured: true },
            ],
          },
          {
            title: "Cancellation",
            accentColor: "#b91c1c",
            background: "linear-gradient(180deg, rgba(254,242,242,0.85) 0%, rgba(255,255,255,0.96) 100%)",
            gridTemplateColumns: {
              xs: "repeat(2, minmax(0, 1fr))",
              sm: "repeat(3, minmax(0, 1fr))",
              xl: "repeat(3, minmax(0, 1fr))",
            },
            tiles: [
              { label: "Total Cancels", value: metric(visibleSummary.totalCancelledOrders), tone: "warning" as const },
              { label: "Vendor Cancels", value: metric(visibleSummary.vendorOwnerCancelledCount), tone: "warning" as const },
              { label: "Transport Cancels", value: metric(visibleSummary.transportOwnerCancelledCount), tone: "warning" as const },
              { label: "VFR", value: metric(visibleSummary.vendorOwnerCancelledCount), secondaryValue: percent(visibleSummary.vfr), tone: "danger" as const },
              { label: "LFR", value: metric(visibleSummary.transportOwnerCancelledCount), secondaryValue: percent(visibleSummary.lfr), tone: "danger" as const },
              {
                label: "V+L FR",
                value: metric(visibleSummary.vendorOwnerCancelledCount + visibleSummary.transportOwnerCancelledCount),
                secondaryValue: percent(visibleSummary.vlfr),
                tone: "danger" as const,
              },
            ],
          },
          {
            title: "Flow",
            accentColor: "#075985",
            background: "linear-gradient(180deg, rgba(239,246,255,0.72) 0%, rgba(255,255,255,0.96) 100%)",
            gridTemplateColumns: {
              xs: "repeat(2, minmax(0, 1fr))",
              sm: "repeat(3, minmax(0, 1fr))",
              xl: "repeat(3, minmax(0, 1fr))",
            },
            tiles: [
              { label: "Active", value: metric(visibleSummary.activeOrders), tone: "info" as const },
              { label: "Late", value: metric(visibleSummary.lateNow), tone: "warning" as const },
              { label: "On Hold", value: metric(visibleSummary.onHoldOrders), tone: "warning" as const },
              { label: "Unassigned", value: metric(visibleSummary.unassignedOrders), tone: "warning" as const },
              { label: "In Prep", value: metric(visibleSummary.preparingNow), tone: "info" as const },
              { label: "Ready to Pickup", value: metric(visibleSummary.readyToPickupOrders), tone: "info" as const },
            ],
          },
        ]
        : [],
    [scopedSummary, summary, visibleSummary],
  );

  const pageCount = Math.max(1, Math.ceil(visibleBranches.length / PAGE_SIZE));
  const pagedBranches = useMemo(
    () => visibleBranches.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    [page, visibleBranches],
  );
  const explicitTrendVendorIds = useMemo(
    () => resolveExplicitVendorSelections(activeGroup?.vendorIds ?? [], currentState.selectedVendorIds),
    [activeGroup?.vendorIds, currentState.selectedVendorIds],
  );
  const hasExplicitTrendVendorScope = Boolean((activeGroup?.vendorIds.length ?? 0) || currentState.selectedVendorIds.length);
  const trendDeliveryTypes = useMemo(
    () =>
      currentState.selectedDeliveryTypes.length >= DELIVERY_TYPE_OPTIONS.length
        ? []
        : dedupeSelections(currentState.selectedDeliveryTypes).sort(),
    [currentState.selectedDeliveryTypes],
  );
  const trendBranchFilters = useMemo(
    () => dedupeSelections(currentState.selectedBranchFilters).sort(),
    [currentState.selectedBranchFilters],
  );
  const trendScopeKey = useMemo(
    () => [
      hasExplicitTrendVendorScope ? "scoped" : "all",
      explicitTrendVendorIds.join(","),
      deferredSearchQuery,
      trendDeliveryTypes.join(","),
      trendBranchFilters.join(","),
    ].join("|"),
    [deferredSearchQuery, explicitTrendVendorIds, hasExplicitTrendVendorScope, trendBranchFilters, trendDeliveryTypes],
  );
  const currentTrendRequestKey = useMemo(
    () =>
      summary
        ? buildTrendRequestKey(summary.scope.dayKey, trendResolutionMinutes, trendStartMinute, trendEndMinute, trendScopeKey)
        : null,
    [summary, trendEndMinute, trendResolutionMinutes, trendScopeKey, trendStartMinute],
  );
  const trendStale = useMemo(() => {
    if (!summary || !trend || !trendFreshKey || !currentTrendRequestKey) {
      return false;
    }

    if (trendFreshKey !== currentTrendRequestKey) {
      return true;
    }

    if (summary.scope.dayKey !== trend.scope.dayKey) {
      return true;
    }

    const summaryFetchedAt = toUnixMillis(summary.fetchedAt);
    const trendFetchedAt = toUnixMillis(trend.fetchedAt);
    if (summaryFetchedAt == null || trendFetchedAt == null) {
      return false;
    }

    return summaryFetchedAt > trendFetchedAt;
  }, [currentTrendRequestKey, summary, trend, trendFreshKey]);

  useEffect(() => {
    summaryStateRef.current = summary;
  }, [summary]);

  useEffect(() => {
    void loadSourceItems().catch(() => { });
  }, []);

  useEffect(() => {
    setPage(1);
  }, [activeGroup, branchActivityFilter, currentState.nameSortEnabled, currentState.searchQuery, currentState.selectedBranchFilters, currentState.selectedDeliveryTypes, currentState.selectedSortKeys, currentState.selectedVendorIds]);

  useEffect(() => {
    if (page > pageCount) {
      setPage(pageCount);
    }
  }, [page, pageCount]);

  useEffect(() => {
    if (!preferencesLoaded) return;
    if (skipNextPreferencesAutosaveRef.current) {
      skipNextPreferencesAutosaveRef.current = false;
      return;
    }
    if (preferencesSaveTimerRef.current != null) {
      window.clearTimeout(preferencesSaveTimerRef.current);
    }
    preferencesSaveTimerRef.current = window.setTimeout(() => {
      preferencesSaveTimerRef.current = null;
      const controller = new AbortController();
      preferencesAbortRef.current?.abort();
      preferencesAbortRef.current = controller;
      void api.savePerformanceCurrentPreferences(currentState, { signal: controller.signal }).catch(() => { });
    }, 350);

    return () => {
      if (preferencesSaveTimerRef.current != null) {
        window.clearTimeout(preferencesSaveTimerRef.current);
        preferencesSaveTimerRef.current = null;
      }
    };
  }, [currentState, preferencesLoaded]);

  const expandedBranchIdSet = useMemo(
    () => new Set(expandedBranchIds),
    [expandedBranchIds],
  );

  function toggleBranch(vendorId: number) {
    setExpandedBranchIds((current) =>
      current.includes(vendorId)
        ? current.filter((item) => item !== vendorId)
        : [...current, vendorId],
    );
  }

  async function loadDetail(vendorId: number, options?: { background?: boolean }) {
    const requestId = detailRequestIdRef.current + 1;
    detailRequestIdRef.current = requestId;
    detailAbortRef.current?.abort();
    const abortController = new AbortController();
    detailAbortRef.current = abortController;
    options?.background ? setDetailRefreshing(true) : setDetailLoading(true);

    try {
      const nextDetail = await api.performanceVendorDetail(vendorId, { signal: abortController.signal });
      if (requestId !== detailRequestIdRef.current) return null;
      setDetail(nextDetail);
      setDetailError(null);
      return nextDetail;
    } catch (nextError) {
      if (abortController.signal.aborted) {
        return null;
      }
      if (requestId !== detailRequestIdRef.current) return null;
      setDetailError(describeApiError(nextError, "Failed to load branch detail."));
      return null;
    } finally {
      if (detailAbortRef.current === abortController) {
        detailAbortRef.current = null;
      }
      if (requestId === detailRequestIdRef.current) {
        setDetailLoading(false);
        setDetailRefreshing(false);
      }
    }
  }

  function openDetail(branch: DisplayPerformanceBranchCard) {
    if (branch.isPlaceholder) {
      return;
    }
    setDetailSubject(branch);
    setDetailOpen(true);
    setDetail(null);
    setDetailError(null);
    void loadDetail(branch.vendorId);
  }

  function closeDetail() {
    detailAbortRef.current?.abort();
    detailAbortRef.current = null;
    setDetailOpen(false);
    setDetailSubject(null);
    setDetail(null);
    setDetailError(null);
    setDetailLoading(false);
    setDetailRefreshing(false);
  }

  async function loadPreferences(options?: { signal?: AbortSignal }) {
    try {
      const nextPreferences = await api.performancePreferences({ signal: options?.signal });
      if (options?.signal?.aborted) {
        return null;
      }
      skipNextPreferencesAutosaveRef.current = true;
      setSavedGroups(nextPreferences.groups);
      setCurrentState(normalizePreferencesState(nextPreferences.current));
      setPreferencesLoaded(true);
      return nextPreferences;
    } catch {
      if (options?.signal?.aborted) {
        return null;
      }
      skipNextPreferencesAutosaveRef.current = true;
      setSavedGroups([]);
      setCurrentState(DEFAULT_PREFERENCES_STATE);
      setPreferencesLoaded(true);
      return null;
    }
  }

  async function loadSourceItems(options?: { force?: boolean }) {
    if (sourceLoaded && !options?.force) {
      return sourceItems;
    }

    if (sourceLoadPromiseRef.current && !options?.force) {
      return sourceLoadPromiseRef.current;
    }

    setSourceLoading(true);
    if (options?.force) {
      setSourceError(null);
    }

    const request = api
      .listBranchSource()
      .then((response) => {
        setSourceItems(response.items);
        setSourceLoaded(true);
        setSourceError(null);
        return response.items;
      })
      .catch((nextError) => {
        setSourceError(describeApiError(nextError, "Failed to load branch source data."));
        throw nextError;
      })
      .finally(() => {
        setSourceLoading(false);
        sourceLoadPromiseRef.current = null;
      });

    sourceLoadPromiseRef.current = request;
    return request;
  }

  async function loadSummary(options?: { background?: boolean }) {
    const requestId = summaryRequestIdRef.current + 1;
    summaryRequestIdRef.current = requestId;
    summaryAbortRef.current?.abort();
    const abortController = new AbortController();
    summaryAbortRef.current = abortController;
    options?.background ? setRefreshing(true) : setLoading(true);

    try {
      const nextSummary = await api.performanceSummary({ signal: abortController.signal });
      if (requestId !== summaryRequestIdRef.current) return summaryStateRef.current;
      const committedSummary = shouldReplaceSummarySnapshot(summaryStateRef.current, nextSummary)
        ? nextSummary
        : summaryStateRef.current;
      if (committedSummary !== summaryStateRef.current) {
        summaryStateRef.current = committedSummary;
        setSummary(committedSummary);
      }
      setError(null);
      return committedSummary;
    } catch (nextError) {
      if (abortController.signal.aborted) {
        return null;
      }
      if (requestId !== summaryRequestIdRef.current) return null;
      setError(describeApiError(nextError, "Failed to load performance branches."));
      return null;
    } finally {
      if (summaryAbortRef.current === abortController) {
        summaryAbortRef.current = null;
      }
      if (requestId === summaryRequestIdRef.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }

  async function loadTrend(options?: { background?: boolean; summaryOverride?: PerformanceSummaryResponse | null }) {
    const trendSummary = options?.summaryOverride ?? summary;
    if (!trendSummary) return null;
    const requestKey = buildTrendRequestKey(
      trendSummary.scope.dayKey,
      trendResolutionMinutes,
      trendStartMinute,
      trendEndMinute,
      trendScopeKey,
    );

    const requestId = trendRequestIdRef.current + 1;
    trendRequestIdRef.current = requestId;
    trendAbortRef.current?.abort();
    const abortController = new AbortController();
    trendAbortRef.current = abortController;
    options?.background ? setTrendRefreshing(true) : setTrendLoading(true);

    try {
      if (!scopedBranches.length) {
        const emptyTrend = buildEmptyTrendResponse(
          trendSummary.scope,
          trendResolutionMinutes,
          trendStartMinute,
          trendEndMinute,
          trendSummary.fetchedAt,
          trendSummary.cacheState,
        );
        if (requestId !== trendRequestIdRef.current) return null;
        setTrend(emptyTrend);
        setTrendFreshKey(requestKey);
        setTrendError(null);
        return emptyTrend;
      }

      const nextTrend = await api.performanceTrend({
        resolutionMinutes: trendResolutionMinutes,
        startMinute: trendStartMinute,
        endMinute: trendEndMinute,
        vendorIds: hasExplicitTrendVendorScope ? explicitTrendVendorIds : undefined,
        searchQuery: deferredSearchQuery || undefined,
        selectedDeliveryTypes: trendDeliveryTypes.length ? trendDeliveryTypes : undefined,
        selectedBranchFilters: trendBranchFilters.length ? trendBranchFilters : undefined,
      }, {
        signal: abortController.signal,
      });
      if (requestId !== trendRequestIdRef.current) return null;
      setTrend(nextTrend);
      setTrendFreshKey(requestKey);
      setTrendError(null);
      return nextTrend;
    } catch (nextError) {
      if (abortController.signal.aborted) {
        return null;
      }
      if (requestId !== trendRequestIdRef.current) return null;
      setTrendError(describeApiError(nextError, "Failed to load performance trend."));
      return null;
    } finally {
      if (trendAbortRef.current === abortController) {
        trendAbortRef.current = null;
      }
      if (requestId === trendRequestIdRef.current) {
        setTrendLoading(false);
        setTrendRefreshing(false);
      }
    }
  }

  useEffect(() => {
    let active = true;

    const stopReconnectTimer = () => {
      if (liveReconnectTimerRef.current == null) return;
      window.clearTimeout(liveReconnectTimerRef.current);
      liveReconnectTimerRef.current = null;
    };

    const stopStream = () => {
      stopReconnectTimer();
      liveAbortRef.current?.abort();
      liveAbortRef.current = null;
    };

    const scheduleReconnect = (connectStream: () => void) => {
      stopReconnectTimer();
      const delay = LIVE_RECONNECT_DELAYS_MS[Math.min(liveReconnectAttemptRef.current, LIVE_RECONNECT_DELAYS_MS.length - 1)];
      liveReconnectAttemptRef.current = Math.min(
        liveReconnectAttemptRef.current + 1,
        LIVE_RECONNECT_DELAYS_MS.length - 1,
      );
      liveReconnectTimerRef.current = window.setTimeout(() => {
        liveReconnectTimerRef.current = null;
        connectStream();
      }, delay);
    };

    const connectStream = () => {
      if (!active) return;
      stopStream();

      const sessionId = liveSessionRef.current + 1;
      liveSessionRef.current = sessionId;
      const controller = new AbortController();
      liveAbortRef.current = controller;

      void api
        .streamPerformance({
          signal: controller.signal,
          onOpen: () => {
            if (!active || liveSessionRef.current !== sessionId) return;
            liveReconnectAttemptRef.current = 0;
          },
          onSummary: (nextSummary) => {
            if (!active || liveSessionRef.current !== sessionId) return;
            if (!shouldReplaceSummarySnapshot(summaryStateRef.current, nextSummary)) {
              return;
            }
            summaryStateRef.current = nextSummary;
            setSummary(nextSummary);
            setError(null);
          },
        })
        .then(() => {
          if (!active || liveSessionRef.current !== sessionId || controller.signal.aborted) return;
          scheduleReconnect(connectStream);
        })
        .catch((nextError) => {
          if (!active || liveSessionRef.current !== sessionId || controller.signal.aborted || isAbortError(nextError)) {
            return;
          }
          scheduleReconnect(connectStream);
        });
    };

    connectStream();

    return () => {
      active = false;
      stopStream();
    };
  }, []);

  useEffect(() => {
    if (!summary || !trendPanelOpen) return;
    void loadTrend({ background: Boolean(trend) });
  }, [Boolean(summary), trendEndMinute, trendPanelOpen, trendResolutionMinutes, trendScopeKey, trendStartMinute]);

  useEffect(() => {
    if (trendPanelOpen) return;
    trendAbortRef.current?.abort();
    trendAbortRef.current = null;
    setTrendLoading(false);
    setTrendRefreshing(false);
  }, [trendPanelOpen]);

  useEffect(() => {
    const preferencesAbortController = new AbortController();
    preferencesLoadAbortRef.current?.abort();
    preferencesLoadAbortRef.current = preferencesAbortController;

    void Promise.allSettled([
      loadSummary(),
      loadPreferences({ signal: preferencesAbortController.signal }),
    ]);
    return () => {
      summaryAbortRef.current?.abort();
      summaryAbortRef.current = null;
      trendAbortRef.current?.abort();
      trendAbortRef.current = null;
      preferencesLoadAbortRef.current?.abort();
      preferencesLoadAbortRef.current = null;
      preferencesAbortRef.current?.abort();
      preferencesAbortRef.current = null;
      detailAbortRef.current?.abort();
      detailAbortRef.current = null;
      liveAbortRef.current?.abort();
      liveAbortRef.current = null;
      if (liveReconnectTimerRef.current != null) {
        window.clearTimeout(liveReconnectTimerRef.current);
        liveReconnectTimerRef.current = null;
      }
    };
  }, []);

  const branchSelectionOptions = useMemo(
    () =>
      [...allBranches]
        .sort((left, right) => left.name.localeCompare(right.name) || left.vendorId - right.vendorId)
        .filter((branch) => branchMatches(branch, branchesDialogQuery.trim().toLowerCase())),
    [allBranches, branchesDialogQuery],
  );
  const visibleBranchDraftIds = useMemo(
    () => branchSelectionOptions.map((branch) => branch.vendorId),
    [branchSelectionOptions],
  );
  const allVisibleBranchesSelected = visibleBranchDraftIds.length > 0
    && visibleBranchDraftIds.every((vendorId) => branchDraftVendorIds.includes(vendorId));
  const bulkAddEnteredCount = useMemo(
    () => (
      bulkAddMode === "orders"
        ? parseOrdersBulkInput(bulkAddInput).length
        : parseAvailabilityBulkInput(bulkAddInput).length
    ),
    [bulkAddInput, bulkAddMode],
  );

  const transportButtonActive = currentState.selectedDeliveryTypes.length > 0
    && currentState.selectedDeliveryTypes.length < DELIVERY_TYPE_OPTIONS.length;
  const activityButtonActive = branchActivityFilter !== "all";
  const filterButtonActive = currentState.selectedBranchFilters.length > 0;
  const sortButtonActive = currentState.nameSortEnabled
    || currentState.selectedSortKeys.join(",") !== DEFAULT_PREFERENCES_STATE.selectedSortKeys.join(",");

  const transportButtonText = summarizeSelection(DELIVERY_TYPE_OPTIONS, currentState.selectedDeliveryTypes, "Transport", "transport");
  const activityButtonText = optionLabel(BRANCH_ACTIVITY_FILTER_OPTIONS, branchActivityFilter);
  const filterButtonText = summarizeSelection(BRANCH_FILTER_OPTIONS, currentState.selectedBranchFilters, "Filters", "filters");
  const sortButtonText = currentState.nameSortEnabled
    ? NAME_SORT_LABEL
    : optionLabel(NUMERIC_SORT_OPTIONS, currentState.selectedSortKeys[0] ?? "orders");
  const branchButtonActive = Boolean(activeGroup) || currentState.selectedVendorIds.length > 0;
  const branchButtonText = activeGroup?.name ?? summarizeBranchSelection(allBranches, currentState.selectedVendorIds);
  const hasCustomSort = currentState.nameSortEnabled
    || currentState.selectedSortKeys.join(",") !== DEFAULT_PREFERENCES_STATE.selectedSortKeys.join(",");
  const hasClearableFilters = Boolean(
    currentState.searchQuery.trim()
    || currentState.selectedVendorIds.length
    || currentState.selectedDeliveryTypes.length
    || branchActivityFilter !== "all"
    || currentState.selectedBranchFilters.length
    || currentState.activeGroupId
    || currentState.activeViewId
    || hasCustomSort,
  );

  function openHeroPanel(panel: HeroPanel) {
    setHeroPanel(panel);
  }

  function updateTrendWindow(next: {
    resolutionMinutes?: PerformanceTrendResolutionMinutes;
    startMinute?: number;
    endMinute?: number;
  }) {
    let nextStartMinute = next.startMinute == null ? trendStartMinute : clampTrendMinute(next.startMinute);
    let nextEndMinute = next.endMinute == null ? trendEndMinute : clampTrendMinute(next.endMinute);

    nextStartMinute = Math.min(nextStartMinute, FULL_DAY_END_MINUTE - 15);
    nextEndMinute = Math.max(15, nextEndMinute);

    if (nextStartMinute >= nextEndMinute) {
      if (next.startMinute != null && next.endMinute == null) {
        nextEndMinute = Math.min(FULL_DAY_END_MINUTE, nextStartMinute + 15);
      } else if (next.endMinute != null && next.startMinute == null) {
        nextStartMinute = Math.max(0, nextEndMinute - 15);
      } else {
        nextEndMinute = Math.min(FULL_DAY_END_MINUTE, nextStartMinute + 15);
        if (nextStartMinute >= nextEndMinute) {
          nextStartMinute = Math.max(0, nextEndMinute - 15);
        }
      }
    }

    if (next.resolutionMinutes != null) {
      setTrendResolutionMinutes(next.resolutionMinutes);
    }
    setTrendStartMinute(nextStartMinute);
    setTrendEndMinute(nextEndMinute);
  }

  function clearAllFilters() {
    setCurrentState(DEFAULT_PREFERENCES_STATE);
    setGroupQuickAnchorEl(null);
    setTransportAnchorEl(null);
    setActivityAnchorEl(null);
    setFilterAnchorEl(null);
    setSortAnchorEl(null);
    setBranchesDialogQuery("");
    setBranchDraftVendorIds([]);
    setBranchActivityFilter("all");
  }

  function setSearchQuery(nextQuery: string) {
    setCurrentState((current) => normalizePreferencesState({
      ...current,
      searchQuery: nextQuery,
      activeViewId: null,
    }));
  }

  function toggleDeliveryTypeFilter(value: DeliveryTypeFilterKey) {
    setCurrentState((current) => {
      const selected = current.selectedDeliveryTypes.includes(value)
        ? current.selectedDeliveryTypes.filter((item) => item !== value)
        : [...current.selectedDeliveryTypes, value];
      return normalizePreferencesState({
        ...current,
        selectedDeliveryTypes: selected,
        activeViewId: null,
      });
    });
  }

  function toggleBranchFilter(value: BranchFilterKey) {
    setCurrentState((current) => {
      const selected = current.selectedBranchFilters.includes(value)
        ? current.selectedBranchFilters.filter((item) => item !== value)
        : [...current.selectedBranchFilters, value];
      return normalizePreferencesState({
        ...current,
        selectedBranchFilters: selected,
        activeViewId: null,
      });
    });
  }

  function toggleNumericSort(value: NumericSortKey) {
    setCurrentState((current) => normalizePreferencesState({
      ...current,
      selectedSortKeys: [value],
      nameSortEnabled: false,
      activeViewId: null,
    }));
    setSortAnchorEl(null);
  }

  function toggleNameSort() {
    setCurrentState((current) => normalizePreferencesState({
      ...current,
      nameSortEnabled: !current.nameSortEnabled,
      selectedSortKeys: !current.nameSortEnabled ? [] : DEFAULT_PREFERENCES_STATE.selectedSortKeys,
      activeViewId: null,
    }));
    setSortAnchorEl(null);
  }

  function openBranchesDialog() {
    setGroupQuickAnchorEl(null);
    setBranchDraftVendorIds(activeGroup?.vendorIds ?? currentState.selectedVendorIds);
    setBranchesDialogQuery("");
    setGroupMutationError(null);
    closeBulkAddDialog();
    setBranchesDialogOpen(true);
  }

  function toggleBranchDraftVendor(vendorId: number) {
    setBranchDraftVendorIds((current) =>
      current.includes(vendorId)
        ? current.filter((item) => item !== vendorId)
        : [...current, vendorId].sort((left, right) => left - right),
    );
  }

  function selectVisibleBranches() {
    setBranchDraftVendorIds((current) =>
      dedupeSelections([...current, ...visibleBranchDraftIds]).sort((left, right) => left - right),
    );
  }

  function applyBranchSelection() {
    setCurrentState((current) => normalizePreferencesState({
      ...current,
      selectedVendorIds: branchDraftVendorIds,
      activeGroupId: null,
      activeViewId: null,
    }));
    setBranchesDialogOpen(false);
  }

  function clearBranchSelection() {
    setCurrentState((current) => normalizePreferencesState({
      ...current,
      selectedVendorIds: [],
      activeGroupId: null,
      activeViewId: null,
    }));
    setBranchDraftVendorIds([]);
  }

  function resetBulkAddState() {
    setBulkAddMode("orders");
    setBulkAddStep("input");
    setBulkAddInput("");
    setBulkAddGroupName("");
    setBulkAddResolvedItems([]);
    setBulkAddSelectedVendorIds([]);
    setBulkAddError(null);
    setBulkAddSummary(null);
    setBulkAddLoadingText("");
  }

  function openBulkAddDialog() {
    resetBulkAddState();
    setBulkAddOpen(true);
  }

  function closeBulkAddDialog() {
    setBulkAddOpen(false);
    resetBulkAddState();
  }

  function toggleBulkAddVendor(vendorId: number) {
    setBulkAddSelectedVendorIds((current) =>
      current.includes(vendorId)
        ? current.filter((item) => item !== vendorId)
        : [...current, vendorId].sort((left, right) => left - right),
    );
  }

  async function resolveBulkAdd() {
    const parsedOrders = parseOrdersBulkInput(bulkAddInput);
    const parsedAvailabilityIds = parseAvailabilityBulkInput(bulkAddInput);
    const enteredCount = bulkAddMode === "orders" ? parsedOrders.length : parsedAvailabilityIds.length;

    if (!enteredCount) {
      setBulkAddError(`Enter at least one ${bulkAddMode === "orders" ? "Orders ID" : "Availability ID"}.`);
      return;
    }

    setBulkAddError(null);
    setBulkAddStep("loading");
    setBulkAddLoadingText(`Resolving ${metric(enteredCount)} vendor${enteredCount === 1 ? "" : "s"}...`);

    try {
      let nextSourceItems = sourceItems;
      if (bulkAddMode === "availability" || !sourceLoaded) {
        try {
          nextSourceItems = await loadSourceItems();
        } catch (nextError) {
          if (bulkAddMode === "availability") {
            throw nextError;
          }
          nextSourceItems = [];
        }
      }

      const nextSourceByOrdersVendorId = new Map(nextSourceItems.map((item) => [item.ordersVendorId, item]));
      const nextSourceByAvailabilityVendorId = new Map(nextSourceItems.map((item) => [item.availabilityVendorId, item]));
      const resolvedItems: BulkAddResolvedVendor[] = [];
      let notFoundCount = 0;

      if (bulkAddMode === "orders") {
        for (const ordersVendorId of parsedOrders) {
          const summaryBranch = summaryBranchByVendorId.get(ordersVendorId);
          const sourceItem = nextSourceByOrdersVendorId.get(ordersVendorId);
          resolvedItems.push({
            ordersVendorId,
            availabilityVendorId: sourceItem?.availabilityVendorId ?? null,
            name: summaryBranch?.name ?? sourceItem?.name ?? NO_ORDERS_YET_LABEL,
            isNoOrdersYet: !summaryBranch,
          });
        }
      } else {
        for (const availabilityVendorId of parsedAvailabilityIds) {
          const sourceItem = nextSourceByAvailabilityVendorId.get(availabilityVendorId);
          if (!sourceItem) {
            notFoundCount += 1;
            continue;
          }

          const summaryBranch = summaryBranchByVendorId.get(sourceItem.ordersVendorId);
          resolvedItems.push({
            ordersVendorId: sourceItem.ordersVendorId,
            availabilityVendorId: sourceItem.availabilityVendorId,
            name: summaryBranch?.name ?? sourceItem.name ?? NO_ORDERS_YET_LABEL,
            isNoOrdersYet: !summaryBranch,
          });
        }
      }

      const nextSelectedVendorIds = resolvedItems.map((item) => item.ordersVendorId);
      setBulkAddResolvedItems(resolvedItems);
      setBulkAddSelectedVendorIds(nextSelectedVendorIds);
      setBulkAddSummary({
        enteredCount,
        resolvedCount: resolvedItems.filter((item) => !item.isNoOrdersYet).length,
        noOrdersCount: resolvedItems.filter((item) => item.isNoOrdersYet).length,
        notFoundCount,
        mode: bulkAddMode,
      });
      setBulkAddStep("review");
    } catch (nextError) {
      setBulkAddError(describeApiError(nextError, "Failed to resolve vendor IDs."));
      setBulkAddStep("input");
    }
  }

  async function saveBulkAddGroup() {
    try {
      const response = await api.createPerformanceGroup({
        name: bulkAddGroupName,
        vendorIds: bulkAddSelectedVendorIds,
      });
      setSavedGroups((current) => sortSavedGroups([
        response.group,
        ...current.filter((item) => item.id !== response.group.id),
      ]));
      closeBulkAddDialog();
    } catch (nextError) {
      setBulkAddError(describeApiError(nextError, "Failed to save group."));
    }
  }

  function openNewGroupEditor() {
    setGroupDraftId(null);
    setGroupDraftName("");
    setGroupDraftVendorIds(branchDraftVendorIds.length ? branchDraftVendorIds : (activeGroup?.vendorIds ?? currentState.selectedVendorIds));
    setGroupMutationError(null);
    setGroupEditorOpen(true);
  }

  function openEditGroupEditor(group: PerformanceSavedGroup) {
    setGroupDraftId(group.id);
    setGroupDraftName(group.name);
    setGroupDraftVendorIds(group.vendorIds);
    setGroupMutationError(null);
    setGroupEditorOpen(true);
  }

  async function saveGroup() {
    try {
      const response = groupDraftId == null
        ? await api.createPerformanceGroup({
          name: groupDraftName,
          vendorIds: groupDraftVendorIds,
        })
        : await api.updatePerformanceGroup(groupDraftId, {
          name: groupDraftName,
          vendorIds: groupDraftVendorIds,
        });
      setSavedGroups((current) => sortSavedGroups([
        response.group,
        ...current.filter((item) => item.id !== response.group.id),
      ]));
      setGroupEditorOpen(false);
      setGroupDraftId(null);
      setGroupDraftName("");
      setGroupDraftVendorIds([]);
      setGroupMutationError(null);
    } catch (nextError) {
      setGroupMutationError(describeApiError(nextError, "Failed to save group."));
    }
  }

  async function deleteGroup(group: PerformanceSavedGroup) {
    try {
      await api.deletePerformanceGroup(group.id);
      setSavedGroups((current) => current.filter((item) => item.id !== group.id));
      if (currentState.activeGroupId === group.id) {
        setCurrentState((current) => normalizePreferencesState({
          ...current,
          activeGroupId: null,
        }));
      }
    } catch (nextError) {
      setGroupMutationError(describeApiError(nextError, "Failed to delete group."));
    }
  }

  function applyGroup(group: PerformanceSavedGroup) {
    setCurrentState((current) => normalizePreferencesState({
      ...current,
      selectedVendorIds: [],
      activeGroupId: group.id,
      activeViewId: null,
    }));
    setGroupQuickAnchorEl(null);
    setBranchDraftVendorIds(group.vendorIds);
    setBranchesDialogOpen(false);
  }

  function clearActiveGroup() {
    setCurrentState((current) => normalizePreferencesState({
      ...current,
      activeGroupId: null,
    }));
    setGroupQuickAnchorEl(null);
  }

  return (
    <Box
      sx={{
        minHeight: "100vh",
        bgcolor: "#f6f8fc",
        backgroundImage:
          "radial-gradient(circle at 12% 16%, rgba(14,165,233,0.07), transparent 30%), radial-gradient(circle at 82% 18%, rgba(249,115,22,0.06), transparent 24%), linear-gradient(180deg, #f8fbff 0%, #f6f8fc 100%)",
      }}
    >
      <TopBar
        running={monitoring.running}
        degraded={monitoring.degraded}
      />

      <Container maxWidth="xl" sx={{ py: { xs: 2, md: 3 } }}>
        <Stack spacing={1.5}>
          <Box
            sx={{
              p: { xs: 1.5, md: 1.7 },
              borderRadius: 4,
              border: "1px solid rgba(148,163,184,0.14)",
              bgcolor: "rgba(255,255,255,0.96)",
              boxShadow: "0 20px 44px rgba(15,23,42,0.045)",
            }}
          >
            <Stack
              direction={{ xs: "column", lg: "row" }}
              spacing={1.2}
              justifyContent="space-between"
              alignItems={{ xs: "flex-start", lg: "center" }}
            >
              <Box>
                <Typography component="h1" sx={{ fontSize: { xs: 28, md: 34 }, lineHeight: 1.05, fontWeight: 900, color: "#0f172a" }}>
                  Performance
                </Typography>
              </Box>

              <Button
                variant="outlined"
                startIcon={<RefreshRoundedIcon />}
                onClick={() => {
                  void (async () => {
                    const nextSummary = await loadSummary({ background: Boolean(summary) });
                    if (trendPanelOpen) {
                      await loadTrend({
                        background: Boolean(trend),
                        summaryOverride: nextSummary ?? summaryStateRef.current,
                      });
                    }
                    if (detailOpen && detailSubject) {
                      await loadDetail(detailSubject.vendorId, { background: Boolean(detail) });
                    }
                  })();
                }}
                disabled={loading || refreshing}
                sx={{
                  borderRadius: 999,
                  px: 1.8,
                  borderColor: "rgba(14,165,233,0.28)",
                  bgcolor: "rgba(255,255,255,0.96)",
                  boxShadow: "0 12px 24px rgba(14,165,233,0.08)",
                  "&:hover": {
                    borderColor: "rgba(14,165,233,0.4)",
                    bgcolor: "white",
                  },
                }}
              >
                Refresh
              </Button>
            </Stack>

            {summary?.cacheState && summary.cacheState !== "fresh" ? (
              <Alert severity={summary.cacheState === "stale" ? "warning" : "info"} variant="outlined" sx={{ mt: 1.2 }}>
                {summary.cacheState === "stale"
                  ? "Performance snapshot is stale. The page is showing the latest current-day snapshot until the next successful refresh finishes."
                  : "Performance snapshot is warming up. Current-day totals may still be filling in."}
                {summary.fetchedAt ? ` Last snapshot ${formatPerformanceSnapshotTime(summary.fetchedAt)} Cairo time.` : ""}
              </Alert>
            ) : null}

            {summary?.ownerCoverage.warning ? (
              <Alert severity="warning" variant="outlined" sx={{ mt: 1.2 }}>
                {summary.ownerCoverage.warning}
              </Alert>
            ) : null}

            <div id="performance-hero-tabs">
              <Stack
                direction="row"
                spacing={0.6}
                sx={{
                  mt: 1.25,
                  width: "fit-content",
                  p: 0.45,
                  borderRadius: 999,
                  border: "1px solid rgba(148,163,184,0.12)",
                  bgcolor: "rgba(241,245,249,0.82)",
                  boxShadow: "inset 0 1px 0 rgba(255,255,255,0.72), 0 10px 24px rgba(15,23,42,0.04)",
                }}
                role="tablist"
                aria-label="Performance hero panels"
              >
                {[
                  {
                    value: "summary" as const,
                    label: "Summary",
                    icon: <SpaceDashboardRoundedIcon sx={{ fontSize: 17 }} />,
                  },
                  {
                    value: "trend" as const,
                    label: "Trend",
                    icon: <InsightsRoundedIcon sx={{ fontSize: 17 }} />,
                  },
                ].map((tab) => {
                  const active = heroPanel === tab.value;
                  return (
                    <Box
                      key={tab.value}
                      component="button"
                      type="button"
                      onClick={() => openHeroPanel(tab.value)}
                      role="tab"
                      aria-selected={active}
                      aria-label={`Show ${tab.label} panel`}
                      sx={{
                        position: "relative",
                        appearance: "none",
                        px: 1.5,
                        py: 0.78,
                        borderRadius: 999,
                        border: "1px solid transparent",
                        bgcolor: "transparent",
                        color: active ? "#0f172a" : "#475569",
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 0.65,
                        fontSize: 12.5,
                        fontWeight: 900,
                        cursor: "pointer",
                        overflow: "hidden",
                        transition: "color 180ms ease, transform 180ms ease",
                        "&:hover": {
                          color: "#0f172a",
                          transform: "translateY(-1px)",
                        },
                      }}
                    >
                      {active ? (
                        <span
                        style={{
                          position: "absolute",
                          inset: 0,
                          borderRadius: 999,
                          background: "linear-gradient(135deg, rgba(14,165,233,0.18), rgba(255,255,255,0.98) 46%, rgba(226,232,240,0.95) 100%)",
                          boxShadow: "0 10px 24px rgba(14,165,233,0.12)",
                          border: "1px solid rgba(14,165,233,0.14)",
                        }}
                        />
                      ) : null}
                      <Box sx={{ position: "relative", zIndex: 1, display: "inline-flex", alignItems: "center", gap: 0.65 }}>
                        {tab.icon}
                        {tab.label}
                        {tab.value === "trend" && trendStale ? (
                          <Box
                            component="span"
                            data-testid="performance-trend-stale-indicator"
                            sx={{
                              display: "inline-flex",
                              alignItems: "center",
                              px: 0.7,
                              py: 0.15,
                              borderRadius: 999,
                              bgcolor: "rgba(245,158,11,0.14)",
                              color: "#b45309",
                              fontSize: 10.5,
                              fontWeight: 900,
                              letterSpacing: 0.1,
                            }}
                          >
                            Update
                          </Box>
                        ) : null}
                      </Box>
                    </Box>
                  );
                })}
              </Stack>

              <Box
                sx={{
                  mt: 1.15,
                  minHeight: { xs: 336, md: 352 },
                  p: { xs: 0.9, md: 1.05 },
                  borderRadius: 3.4,
                  border: "1px solid rgba(148,163,184,0.12)",
                  bgcolor: "rgba(248,250,252,0.72)",
                  boxShadow: "inset 0 1px 0 rgba(255,255,255,0.7)",
                }}
              >
                <div >
                  {heroPanel === "summary" ? (
                    <div
                      key="summary-panel"
                    >
                      {summarySections.length ? (
                        <Box
                          sx={{
                            display: "grid",
                            gap: 0.8,
                            gridTemplateColumns: {
                              xs: "1fr",
                              md: "minmax(220px, 0.9fr) minmax(320px, 1.2fr) minmax(320px, 1.2fr)",
                            },
                            alignItems: "stretch",
                          }}
                        >
                          {summarySections.map((section) => (
                            <SummarySection
                              key={section.title}
                              title={section.title}
                              accentColor={section.accentColor}
                              background={section.background}
                              gridTemplateColumns={section.gridTemplateColumns}
                              tiles={section.tiles}
                            />
                          ))}
                        </Box>
                      ) : null}
                    </div>
                  ) : (
                    <div
                      key="trend-panel"
                    >
                      {summary?.ownerCoverage.warning ? (
                        <Alert severity="warning" variant="outlined" sx={{ mb: 1 }}>
                          {summary.ownerCoverage.warning}
                        </Alert>
                      ) : null}
                      <Suspense
                        fallback={(
                          <Stack
                            alignItems="center"
                            justifyContent="center"
                            spacing={1}
                            sx={{ minHeight: { xs: 300, md: 316 } }}
                          >
                            <CircularProgress size={24} sx={{ color: "#0284c7" }} />
                            <Typography sx={{ color: "#64748b", fontSize: 13, fontWeight: 700 }}>
                              Loading trend panel
                            </Typography>
                          </Stack>
                        )}
                      >
                        <LazyPerformanceTrendPanel
                          trend={trend}
                          loading={trendLoading}
                          refreshing={trendRefreshing}
                          error={trendError}
                          resolutionMinutes={trendResolutionMinutes}
                          startMinute={trendStartMinute}
                          endMinute={trendEndMinute}
                          onResolutionChange={(value) => updateTrendWindow({ resolutionMinutes: value })}
                          onRangeChange={(startMinute, endMinute) => updateTrendWindow({ startMinute, endMinute })}
                          onInteract={() => { }}
                        />
                      </Suspense>
                    </div>
                  )}
                </div>
              </Box>
            </div>
          </Box>

          <Box
            sx={{
              mt: 0.2,
              mb: 0.3,
              display: "flex",
              justifyContent: "flex-end",
            }}
          >
            <Stack
              direction={{ xs: "column", md: "row" }}
              spacing={1}
              alignItems={{ xs: "stretch", md: "center" }}
              sx={{ width: { xs: "100%", md: "auto" } }}
            >
              <Stack direction="row" spacing={1} alignItems="center">
                <Stack direction="row" spacing={0.6} alignItems="center">
                  <ToolbarChipButton
                    ariaLabel="Pick branches"
                    title={`Branches: ${branchButtonText}`}
                    active={branchButtonActive}
                    activeText={branchButtonText}
                    activeBg="rgba(14,165,233,0.08)"
                    activeColor="#0369a1"
                    onClick={openBranchesDialog}
                    disabled={controlsDisabled}
                    icon={<StorefrontRoundedIcon />}
                  />
                  {savedGroups.length ? (
                    <IconButton
                      aria-label="Open saved branch groups"
                      title={activeGroup ? `Saved group: ${activeGroup.name}` : "Saved groups"}
                      onClick={(event) => setGroupQuickAnchorEl(event.currentTarget)}
                      disabled={controlsDisabled}
                      sx={{
                        width: 40,
                        height: 40,
                        border: "1px solid rgba(148,163,184,0.14)",
                        bgcolor: activeGroup ? "rgba(14,165,233,0.08)" : "rgba(255,255,255,0.92)",
                        color: activeGroup ? "#0369a1" : "#334155",
                        boxShadow: "0 8px 18px rgba(15,23,42,0.05)",
                        transition: "all 180ms ease",
                        "&:hover": {
                          bgcolor: activeGroup ? "rgba(14,165,233,0.12)" : "white",
                          boxShadow: "0 10px 20px rgba(15,23,42,0.08)",
                        },
                        "&:disabled": {
                          opacity: 0.55,
                          boxShadow: "none",
                        },
                      }}
                    >
                      <ExpandMoreRoundedIcon
                        sx={{
                          transform: groupQuickAnchorEl ? "rotate(180deg)" : "rotate(0deg)",
                          transition: "transform 180ms ease",
                        }}
                      />
                    </IconButton>
                  ) : null}
                </Stack>

                <ToolbarChipButton
                  ariaLabel="Transport type"
                  title={`Transport type: ${transportButtonText}`}
                  active={transportButtonActive}
                  activeText={transportButtonText}
                  activeBg="rgba(37,99,235,0.08)"
                  activeColor="#1d4ed8"
                  onClick={(event) => setTransportAnchorEl(event.currentTarget)}
                  disabled={controlsDisabled}
                  icon={<LocalShippingRoundedIcon />}
                />

                <ToolbarChipButton
                  ariaLabel="Branch activity"
                  title={`Branch activity: ${activityButtonText}`}
                  active={activityButtonActive}
                  activeText={activityButtonText}
                  activeBg="rgba(14,116,144,0.08)"
                  activeColor="#0f766e"
                  onClick={(event) => setActivityAnchorEl(event.currentTarget)}
                  disabled={controlsDisabled}
                  icon={<CheckRoundedIcon />}
                />

                <ToolbarChipButton
                  ariaLabel="Filter branches"
                  title={`Filters: ${filterButtonText}`}
                  active={filterButtonActive}
                  activeText={filterButtonText}
                  activeBg="rgba(22,163,74,0.08)"
                  activeColor="#15803d"
                  onClick={(event) => setFilterAnchorEl(event.currentTarget)}
                  disabled={controlsDisabled}
                  icon={<FilterAltRoundedIcon />}
                />

                <ToolbarChipButton
                  ariaLabel="Sort branches"
                  title={`Sort: ${sortButtonText}`}
                  active={sortButtonActive}
                  activeText={sortButtonText}
                  activeBg="rgba(249,115,22,0.10)"
                  activeColor="#c2410c"
                  onClick={(event) => setSortAnchorEl(event.currentTarget)}
                  disabled={controlsDisabled}
                  icon={<SortRoundedIcon />}
                />

                {hasClearableFilters ? (
                  <Button
                    aria-label="Clear all filters"
                    title="Clear all filters"
                    onClick={clearAllFilters}
                    disabled={controlsDisabled}
                    startIcon={<FilterAltOffRoundedIcon />}
                    sx={{
                      minWidth: 0,
                      height: 40,
                      px: 1.2,
                      borderRadius: 999,
                      color: "#b91c1c",
                      bgcolor: "rgba(254,242,242,0.96)",
                      border: "1px solid rgba(239,68,68,0.16)",
                      boxShadow: "0 10px 22px rgba(239,68,68,0.10)",
                      fontSize: 12.5,
                      fontWeight: 900,
                      transform: "translateY(0)",
                      transition: "transform 160ms ease, box-shadow 160ms ease, background-color 160ms ease, border-color 160ms ease",
                      "&:hover": {
                        bgcolor: "rgba(254,226,226,0.98)",
                        borderColor: "rgba(239,68,68,0.24)",
                        boxShadow: "0 14px 28px rgba(239,68,68,0.12)",
                        transform: "translateY(-1px)",
                      },
                      "&:active": {
                        transform: "scale(0.98)",
                      },
                    }}
                  >
                    Clear
                  </Button>
                ) : null}

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
                <SearchRoundedIcon sx={{ fontSize: 19, color: currentState.searchQuery ? "#2563eb" : "#64748b" }} />
                <InputBase
                  value={currentState.searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  placeholder="Search branches"
                  inputProps={{ "aria-label": "Search branches" }}
                  disabled={controlsDisabled}
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
          </Box>

          <Menu
            anchorEl={groupQuickAnchorEl}
            open={Boolean(groupQuickAnchorEl)}
            onClose={() => setGroupQuickAnchorEl(null)}
            anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
            transformOrigin={{ vertical: "top", horizontal: "right" }}
            PaperProps={{
              sx: {
                mt: 0.8,
                borderRadius: 2.5,
                border: "1px solid rgba(148,163,184,0.12)",
                boxShadow: "0 18px 34px rgba(15,23,42,0.10)",
                minWidth: 220,
              },
            }}
          >
            {activeGroup ? (
              <>
                <MenuItem onClick={clearActiveGroup}>Clear active group</MenuItem>
                <Divider />
              </>
            ) : null}
            {savedGroups.map((group) => (
              <MenuItem
                key={group.id}
                selected={activeGroup?.id === group.id}
                onClick={() => applyGroup(group)}
              >
                {group.name}
              </MenuItem>
            ))}
            <Divider />
            <MenuItem onClick={openBranchesDialog}>Manage branches</MenuItem>
          </Menu>

          <Menu
            anchorEl={transportAnchorEl}
            open={Boolean(transportAnchorEl)}
            onClose={() => setTransportAnchorEl(null)}
            anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
            transformOrigin={{ vertical: "top", horizontal: "right" }}
            PaperProps={{
              sx: {
                mt: 0.8,
                borderRadius: 2.5,
                border: "1px solid rgba(148,163,184,0.12)",
                boxShadow: "0 18px 34px rgba(15,23,42,0.10)",
                minWidth: 190,
              },
            }}
          >
            {DELIVERY_TYPE_OPTIONS.map((option) => (
              <MenuItem
                key={option.value}
                selected={currentState.selectedDeliveryTypes.includes(option.value)}
                onClick={() => toggleDeliveryTypeFilter(option.value)}
              >
                <Checkbox
                  size="small"
                  checked={currentState.selectedDeliveryTypes.includes(option.value)}
                  sx={{ mr: 0.8, py: 0.2 }}
                />
                {option.label}
              </MenuItem>
            ))}
            <Divider />
            <MenuItem
              onClick={() => {
                setCurrentState((current) => normalizePreferencesState({
                  ...current,
                  selectedDeliveryTypes: [],
                  activeViewId: null,
                }));
              }}
            >
              Clear transport
            </MenuItem>
          </Menu>

          <Menu
            anchorEl={activityAnchorEl}
            open={Boolean(activityAnchorEl)}
            onClose={() => setActivityAnchorEl(null)}
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
            {BRANCH_ACTIVITY_FILTER_OPTIONS.map((option) => (
              <MenuItem
                key={option.value}
                selected={branchActivityFilter === option.value}
                onClick={() => {
                  setBranchActivityFilter(option.value);
                  setActivityAnchorEl(null);
                }}
              >
                <Checkbox
                  size="small"
                  checked={branchActivityFilter === option.value}
                  sx={{ mr: 0.8, py: 0.2 }}
                />
                {option.label}
              </MenuItem>
            ))}
          </Menu>

          <Menu
            anchorEl={filterAnchorEl}
            open={Boolean(filterAnchorEl)}
            onClose={() => setFilterAnchorEl(null)}
            anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
            transformOrigin={{ vertical: "top", horizontal: "right" }}
            PaperProps={{
              sx: {
                mt: 0.8,
                borderRadius: 2.5,
                border: "1px solid rgba(148,163,184,0.12)",
                boxShadow: "0 18px 34px rgba(15,23,42,0.10)",
                minWidth: 200,
              },
            }}
          >
            {BRANCH_FILTER_OPTIONS.map((option) => (
              <MenuItem
                key={option.value}
                selected={currentState.selectedBranchFilters.includes(option.value)}
                onClick={() => toggleBranchFilter(option.value)}
              >
                <Checkbox
                  size="small"
                  checked={currentState.selectedBranchFilters.includes(option.value)}
                  sx={{ mr: 0.8, py: 0.2 }}
                />
                {option.label}
              </MenuItem>
            ))}
            <Divider />
            <MenuItem
              onClick={() => {
                setCurrentState((current) => normalizePreferencesState({
                  ...current,
                  selectedBranchFilters: [],
                  activeViewId: null,
                }));
              }}
            >
              Clear filters
            </MenuItem>
          </Menu>

          <Menu
            anchorEl={sortAnchorEl}
            open={Boolean(sortAnchorEl)}
            onClose={() => setSortAnchorEl(null)}
            anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
            transformOrigin={{ vertical: "top", horizontal: "right" }}
            PaperProps={{
              sx: {
                mt: 0.8,
                borderRadius: 2.5,
                border: "1px solid rgba(148,163,184,0.12)",
                boxShadow: "0 18px 34px rgba(15,23,42,0.10)",
                minWidth: 190,
              },
            }}
          >
            {NUMERIC_SORT_OPTIONS.map((option) => (
              <MenuItem
                key={option.value}
                selected={currentState.selectedSortKeys.includes(option.value)}
                onClick={() => toggleNumericSort(option.value)}
              >
                <Checkbox
                  size="small"
                  checked={currentState.selectedSortKeys.includes(option.value)}
                  sx={{ mr: 0.8, py: 0.2 }}
                />
                {option.label}
              </MenuItem>
            ))}
            <Divider />
            <MenuItem selected={currentState.nameSortEnabled} onClick={toggleNameSort}>
              <Checkbox size="small" checked={currentState.nameSortEnabled} sx={{ mr: 0.8, py: 0.2 }} />
              {NAME_SORT_LABEL}
            </MenuItem>
            <Divider />
            <MenuItem
              onClick={() => {
                setCurrentState((current) => normalizePreferencesState({
                  ...current,
                  selectedSortKeys: DEFAULT_PREFERENCES_STATE.selectedSortKeys,
                  nameSortEnabled: false,
                  activeViewId: null,
                }));
                setSortAnchorEl(null);
              }}
            >
              Reset sort
            </MenuItem>
          </Menu>

          <Dialog
            open={branchesDialogOpen}
            onClose={() => {
              setBranchesDialogOpen(false);
              closeBulkAddDialog();
            }}
            fullWidth
            maxWidth="sm"
          >
            <DialogTitle>Branches</DialogTitle>
            <DialogContent dividers>
              <Stack spacing={1.35}>
                {groupMutationError ? <Alert severity="error">{groupMutationError}</Alert> : null}
                <Stack
                  direction={{ xs: "column", sm: "row" }}
                  spacing={1}
                  justifyContent="space-between"
                  alignItems={{ xs: "flex-start", sm: "center" }}
                >
                  <Box>
                    <Typography sx={{ color: "#0f172a", fontSize: 13, fontWeight: 900 }}>
                      Saved groups
                    </Typography>
                    <Typography sx={{ color: "#64748b", fontSize: 12.5, fontWeight: 700 }}>
                      {savedGroups.length ? `${metric(savedGroups.length)} saved groups` : "No saved groups yet"}
                    </Typography>
                  </Box>
                  <Stack direction="row" spacing={0.8}>
                    <Button variant="outlined" onClick={openBulkAddDialog}>
                      Bulk Add
                    </Button>
                    <Button
                      variant="contained"
                      onClick={openNewGroupEditor}
                      disabled={!(branchDraftVendorIds.length || activeGroup?.vendorIds.length || currentState.selectedVendorIds.length)}
                    >
                      Save as Group
                    </Button>
                  </Stack>
                </Stack>
                {activeGroup ? (
                  <Alert
                    severity="info"
                    action={<Button color="inherit" size="small" onClick={clearActiveGroup}>Clear</Button>}
                  >
                    Active group: {activeGroup.name}
                  </Alert>
                ) : null}
                {savedGroups.length ? (
                  <Stack spacing={0.7}>
                    {savedGroups.map((group) => (
                      <Box
                        key={group.id}
                        sx={{
                          p: 1,
                          borderRadius: 2.2,
                          border: "1px solid rgba(148,163,184,0.12)",
                          bgcolor: "rgba(255,255,255,0.96)",
                        }}
                      >
                        <Stack direction="row" spacing={1} justifyContent="space-between" alignItems="center">
                          <Box sx={{ minWidth: 0, flex: 1 }}>
                            <Typography sx={{ fontWeight: 900, color: "#0f172a" }}>{group.name}</Typography>
                            <Typography sx={{ color: "#64748b", fontSize: 12.5, fontWeight: 700 }}>
                              {metric(group.vendorIds.length)} branches
                            </Typography>
                          </Box>
                          <Stack direction="row" spacing={0.4}>
                            <IconButton size="small" aria-label={`Apply group ${group.name}`} onClick={() => applyGroup(group)}>
                              <CheckRoundedIcon fontSize="small" />
                            </IconButton>
                            <IconButton size="small" aria-label={`Edit group ${group.name}`} onClick={() => openEditGroupEditor(group)}>
                              <EditRoundedIcon fontSize="small" />
                            </IconButton>
                            <IconButton size="small" aria-label={`Delete group ${group.name}`} onClick={() => void deleteGroup(group)}>
                              <DeleteOutlineRoundedIcon fontSize="small" />
                            </IconButton>
                          </Stack>
                        </Stack>
                      </Box>
                    ))}
                  </Stack>
                ) : null}
                <Divider />
                <TextField
                  value={branchesDialogQuery}
                  onChange={(event) => setBranchesDialogQuery(event.target.value)}
                  label="Search branches"
                  fullWidth
                  size="small"
                />
                <Stack direction="row" justifyContent="space-between" alignItems="center">
                  <Typography sx={{ color: "#64748b", fontSize: 13, fontWeight: 700 }}>
                    {metric(branchDraftVendorIds.length)} selected
                  </Typography>
                  <Stack direction="row" spacing={0.7}>
                    <Button
                      size="small"
                      onClick={selectVisibleBranches}
                      disabled={!visibleBranchDraftIds.length || allVisibleBranchesSelected}
                    >
                      Select all results
                    </Button>
                    <Button size="small" onClick={() => setBranchDraftVendorIds([])}>
                      Clear
                    </Button>
                  </Stack>
                </Stack>
                <Stack
                  spacing={0.65}
                  sx={{
                    maxHeight: 420,
                    overflowY: "auto",
                  }}
                >
                  {branchSelectionOptions.map((branch) => (
                    <Box
                      key={branch.vendorId}
                      role="button"
                      tabIndex={0}
                      onClick={() => toggleBranchDraftVendor(branch.vendorId)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          toggleBranchDraftVendor(branch.vendorId);
                        }
                      }}
                      sx={{
                        px: 1,
                        py: 0.85,
                        display: "flex",
                        alignItems: "center",
                        gap: 0.85,
                        borderRadius: 2,
                        border: "1px solid rgba(148,163,184,0.12)",
                        bgcolor: branchDraftVendorIds.includes(branch.vendorId) ? "rgba(239,246,255,0.92)" : "rgba(255,255,255,0.96)",
                        cursor: "pointer",
                      }}
                    >
                      <Checkbox checked={branchDraftVendorIds.includes(branch.vendorId)} tabIndex={-1} />
                      <Box sx={{ minWidth: 0, flex: 1 }}>
                        <Typography sx={{ fontWeight: 800, color: "#0f172a" }}>{branch.name}</Typography>
                        <Stack direction="row" spacing={0.8} alignItems="center" sx={{ flexWrap: "wrap" }}>
                          <Typography sx={{ fontSize: 12.5, color: "#64748b", fontWeight: 700 }}>
                            Vendor ID {branch.vendorId}
                          </Typography>
                          {branch.isPlaceholder ? (
                            <Typography sx={{ fontSize: 12, color: "#64748b", fontWeight: 800 }}>
                              {NO_ORDERS_YET_LABEL}
                            </Typography>
                          ) : null}
                        </Stack>
                      </Box>
                    </Box>
                  ))}
                  {!branchSelectionOptions.length ? (
                    <Typography sx={{ color: "#64748b", textAlign: "center", py: 2 }}>No branches match the current search.</Typography>
                  ) : null}
                </Stack>
              </Stack>
            </DialogContent>
            <DialogActions>
              <Button
                onClick={() => {
                  setBranchesDialogOpen(false);
                  closeBulkAddDialog();
                }}
              >
                Cancel
              </Button>
              <Button onClick={clearBranchSelection}>Clear selection</Button>
              <Button variant="contained" onClick={applyBranchSelection}>Apply</Button>
            </DialogActions>
          </Dialog>

          <Dialog
            open={bulkAddOpen}
            onClose={() => {
              if (bulkAddStep !== "loading") {
                closeBulkAddDialog();
              }
            }}
            fullWidth
            maxWidth="sm"
          >
            <DialogTitle>
              {bulkAddStep === "name" ? "Name Group" : bulkAddStep === "review" ? "Review Vendors" : "Bulk Add Group"}
            </DialogTitle>
            <DialogContent dividers>
              <Stack spacing={1.35}>
                {bulkAddError ? <Alert severity="error">{bulkAddError}</Alert> : null}

                {bulkAddStep === "input" ? (
                  <>
                    <Stack direction="row" spacing={0.8}>
                      <Button
                        variant={bulkAddMode === "orders" ? "contained" : "outlined"}
                        onClick={() => {
                          setBulkAddMode("orders");
                          setBulkAddError(null);
                        }}
                      >
                        Orders ID
                      </Button>
                      <Button
                        variant={bulkAddMode === "availability" ? "contained" : "outlined"}
                        onClick={() => {
                          setBulkAddMode("availability");
                          setBulkAddError(null);
                        }}
                      >
                        Availability ID
                      </Button>
                    </Stack>

                    {bulkAddMode === "availability" && sourceError ? (
                      <Alert
                        severity="warning"
                        action={(
                          <Button color="inherit" size="small" onClick={() => void loadSourceItems({ force: true }).catch(() => { })}>
                            Retry
                          </Button>
                        )}
                      >
                        {sourceError}
                      </Alert>
                    ) : null}

                    <TextField
                      value={bulkAddInput}
                      onChange={(event) => setBulkAddInput(event.target.value)}
                      label={bulkAddMode === "orders" ? "Paste Orders IDs" : "Paste Availability IDs"}
                      placeholder={bulkAddMode === "orders" ? "111\n112\n113" : "AV-111\nAV-112\nAV-113"}
                      multiline
                      minRows={8}
                      fullWidth
                    />
                    <Typography sx={{ color: "#64748b", fontSize: 13, fontWeight: 700 }}>
                      {metric(bulkAddEnteredCount)} vendors entered
                    </Typography>
                    <Typography sx={{ color: "#64748b", fontSize: 12.5 }}>
                      Paste IDs from sheets or lists. Line breaks, tabs, commas, and spaces are all supported.
                    </Typography>
                  </>
                ) : null}

                {bulkAddStep === "loading" ? (
                  <Stack spacing={1.2} alignItems="center" sx={{ py: 3 }}>
                    <CircularProgress size={34} />
                    <Typography sx={{ fontWeight: 800, color: "#0f172a" }}>{bulkAddLoadingText}</Typography>
                    <Typography sx={{ color: "#64748b", textAlign: "center" }}>
                      Checking current performance data and branch source details.
                    </Typography>
                  </Stack>
                ) : null}

                {bulkAddStep === "review" && bulkAddSummary ? (
                  <>
                    <Alert severity="info">
                      {bulkAddSummary.mode === "orders"
                        ? `${metric(bulkAddSummary.resolvedCount)} branches have current orders and ${metric(bulkAddSummary.noOrdersCount)} will be added as ${NO_ORDERS_YET_LABEL}.`
                        : `${metric(bulkAddSummary.resolvedCount)} mapped from availability IDs, ${metric(bulkAddSummary.noOrdersCount)} will be added as ${NO_ORDERS_YET_LABEL}, and ${metric(bulkAddSummary.notFoundCount)} were not found.`}
                    </Alert>
                    <Stack direction="row" justifyContent="space-between" alignItems="center">
                      <Typography sx={{ color: "#64748b", fontSize: 13, fontWeight: 700 }}>
                        {metric(bulkAddSelectedVendorIds.length)} selected
                      </Typography>
                      <Stack direction="row" spacing={0.7}>
                        <Button
                          size="small"
                          onClick={() => setBulkAddSelectedVendorIds(bulkAddResolvedItems.map((item) => item.ordersVendorId))}
                          disabled={!bulkAddResolvedItems.length}
                        >
                          Select all
                        </Button>
                        <Button size="small" onClick={() => setBulkAddSelectedVendorIds([])}>
                          Clear
                        </Button>
                      </Stack>
                    </Stack>
                    <Stack
                      spacing={0.65}
                      sx={{
                        maxHeight: 360,
                        overflowY: "auto",
                      }}
                    >
                      {bulkAddResolvedItems.map((item) => (
                        <Box
                          key={`${item.ordersVendorId}-${item.availabilityVendorId ?? "orders"}`}
                          role="button"
                          tabIndex={0}
                          onClick={() => toggleBulkAddVendor(item.ordersVendorId)}
                          onKeyDown={(event) => {
                            if (event.key === "Enter" || event.key === " ") {
                              event.preventDefault();
                              toggleBulkAddVendor(item.ordersVendorId);
                            }
                          }}
                          sx={{
                            px: 1,
                            py: 0.9,
                            display: "flex",
                            alignItems: "center",
                            gap: 0.85,
                            borderRadius: 2,
                            border: "1px solid rgba(148,163,184,0.12)",
                            bgcolor: bulkAddSelectedVendorIds.includes(item.ordersVendorId) ? "rgba(239,246,255,0.92)" : "rgba(255,255,255,0.96)",
                            cursor: "pointer",
                          }}
                        >
                          <Checkbox checked={bulkAddSelectedVendorIds.includes(item.ordersVendorId)} tabIndex={-1} />
                          <Box sx={{ minWidth: 0, flex: 1 }}>
                            <Typography sx={{ fontWeight: 800, color: "#0f172a" }}>{item.name}</Typography>
                            <Stack direction="row" spacing={0.8} alignItems="center" sx={{ flexWrap: "wrap" }}>
                              <Typography sx={{ fontSize: 12.5, color: "#64748b", fontWeight: 700 }}>
                                Orders ID {item.ordersVendorId}
                              </Typography>
                              {item.availabilityVendorId ? (
                                <Typography sx={{ fontSize: 12.5, color: "#64748b", fontWeight: 700 }}>
                                  Availability ID {item.availabilityVendorId}
                                </Typography>
                              ) : null}
                              {item.isNoOrdersYet ? (
                                <Typography sx={{ fontSize: 12, color: "#64748b", fontWeight: 800 }}>
                                  {NO_ORDERS_YET_LABEL}
                                </Typography>
                              ) : null}
                            </Stack>
                          </Box>
                        </Box>
                      ))}
                      {!bulkAddResolvedItems.length ? (
                        <Typography sx={{ color: "#64748b", textAlign: "center", py: 2 }}>
                          No vendors are ready to add yet.
                        </Typography>
                      ) : null}
                    </Stack>
                  </>
                ) : null}

                {bulkAddStep === "name" ? (
                  <>
                    <Alert severity="info">
                      Adding {metric(bulkAddSelectedVendorIds.length)} branches to this saved group.
                    </Alert>
                    <TextField
                      value={bulkAddGroupName}
                      onChange={(event) => setBulkAddGroupName(event.target.value)}
                      label="Group name"
                      fullWidth
                      size="small"
                    />
                  </>
                ) : null}
              </Stack>
            </DialogContent>
            <DialogActions>
              {bulkAddStep === "input" ? (
                <>
                  <Button onClick={closeBulkAddDialog}>Cancel</Button>
                  <Button variant="contained" onClick={() => void resolveBulkAdd()} disabled={!bulkAddEnteredCount || (bulkAddMode === "availability" && sourceLoading)}>
                    Review
                  </Button>
                </>
              ) : null}
              {bulkAddStep === "review" ? (
                <>
                  <Button
                    onClick={() => {
                      setBulkAddStep("input");
                      setBulkAddError(null);
                    }}
                  >
                    Back
                  </Button>
                  <Button
                    variant="contained"
                    onClick={() => {
                      setBulkAddStep("name");
                      setBulkAddError(null);
                    }}
                    disabled={!bulkAddSelectedVendorIds.length}
                  >
                    Add
                  </Button>
                </>
              ) : null}
              {bulkAddStep === "name" ? (
                <>
                  <Button
                    onClick={() => {
                      setBulkAddStep("review");
                      setBulkAddError(null);
                    }}
                  >
                    Back
                  </Button>
                  <Button
                    variant="contained"
                    onClick={() => void saveBulkAddGroup()}
                    disabled={!bulkAddSelectedVendorIds.length || !bulkAddGroupName.trim()}
                  >
                    Save Group
                  </Button>
                </>
              ) : null}
            </DialogActions>
          </Dialog>

          <Dialog open={groupEditorOpen} onClose={() => setGroupEditorOpen(false)} fullWidth maxWidth="xs">
            <DialogTitle>{groupDraftId == null ? "Save group" : "Edit group"}</DialogTitle>
            <DialogContent dividers>
              <Stack spacing={1.2}>
                {groupMutationError ? <Alert severity="error">{groupMutationError}</Alert> : null}
                <TextField
                  value={groupDraftName}
                  onChange={(event) => setGroupDraftName(event.target.value)}
                  label="Group name"
                  fullWidth
                  size="small"
                />
                <Alert
                  severity="info"
                  action={
                    <Button
                      color="inherit"
                      size="small"
                      onClick={() => setGroupDraftVendorIds(currentState.selectedVendorIds)}
                      disabled={!currentState.selectedVendorIds.length}
                    >
                      Use current
                    </Button>
                  }
                >
                  {metric(groupDraftVendorIds.length)} branches in this group
                </Alert>
              </Stack>
            </DialogContent>
            <DialogActions>
              <Button onClick={() => setGroupEditorOpen(false)}>Cancel</Button>
              <Button
                variant="contained"
                onClick={() => void saveGroup()}
                disabled={!groupDraftName.trim() || !groupDraftVendorIds.length}
              >
                {groupDraftId == null ? "Save" : "Update"}
              </Button>
            </DialogActions>
          </Dialog>

          {error ? (
            <Alert
              severity="error"
              variant="outlined"
              action={
                <Button color="inherit" size="small" onClick={() => void loadSummary({ background: Boolean(summary) })}>
                  Retry
                </Button>
              }
            >
              {error}
            </Alert>
          ) : null}

          {loading && !summary ? (
            <Box
              sx={{
                minHeight: 280,
                display: "grid",
                placeItems: "center",
                borderRadius: 3.2,
                border: "1px solid rgba(148,163,184,0.14)",
                bgcolor: "rgba(255,255,255,0.92)",
              }}
            >
              <Stack spacing={1} alignItems="center">
                <CircularProgress size={28} />
                <Typography sx={{ color: "#64748b" }}>Loading performance...</Typography>
              </Stack>
            </Box>
          ) : visibleBranches.length ? (
            <Stack spacing={1.2}>
              <Stack direction={{ xs: "column", md: "row" }} justifyContent="space-between" alignItems={{ xs: "flex-start", md: "center" }}>
                <Typography sx={{ color: "#64748b", fontWeight: 700 }}>
                  Showing {metric(pagedBranches.length)} of {metric(visibleBranches.length)} branches
                </Typography>
                {pageCount > 1 ? (
                  <Pagination
                    page={page}
                    count={pageCount}
                    onChange={(_event, value) => setPage(value)}
                    color="primary"
                    shape="rounded"
                    size="small"
                  />
                ) : null}
              </Stack>

              {pagedBranches.map((branch) => (
                <BranchCard
                  key={branch.vendorId}
                  branch={branch}
                  expanded={expandedBranchIdSet.has(branch.vendorId)}
                  onToggle={() => toggleBranch(branch.vendorId)}
                  onOpenDetail={() => openDetail(branch)}
                />
              ))}

              {pageCount > 1 ? (
                <Box sx={{ display: "flex", justifyContent: "center", pt: 0.4 }}>
                  <Pagination
                    page={page}
                    count={pageCount}
                    onChange={(_event, value) => setPage(value)}
                    color="primary"
                    shape="rounded"
                  />
                </Box>
              ) : null}
            </Stack>
          ) : (
            <Box
              sx={{
                p: 2.2,
                borderRadius: 3.2,
                border: "1px solid rgba(148,163,184,0.14)",
                bgcolor: "rgba(255,255,255,0.96)",
                boxShadow: "0 18px 36px rgba(15,23,42,0.045)",
              }}
            >
              <Typography sx={{ fontSize: 20, fontWeight: 900, color: "#0f172a" }}>No branches match the current filters</Typography>
            </Box>
          )}
        </Stack>
      </Container>

      <PerformanceBranchDialog
        open={detailOpen}
        subject={activeDetailSubject}
        detail={detail}
        loading={detailLoading}
        refreshing={detailRefreshing}
        error={detailError}
        onClose={closeDetail}
        onRefresh={() => {
          if (detailSubject) {
            void loadDetail(detailSubject.vendorId, { background: Boolean(detail) });
          }
        }}
      />
    </Box>
  );
}
