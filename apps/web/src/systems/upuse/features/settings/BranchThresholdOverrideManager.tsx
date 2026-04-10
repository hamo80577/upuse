import ApartmentRoundedIcon from "@mui/icons-material/ApartmentRounded";
import CloseRoundedIcon from "@mui/icons-material/CloseRounded";
import FilterAltRoundedIcon from "@mui/icons-material/FilterAltRounded";
import RestartAltRoundedIcon from "@mui/icons-material/RestartAltRounded";
import SaveRoundedIcon from "@mui/icons-material/SaveRounded";
import SearchRoundedIcon from "@mui/icons-material/SearchRounded";
import TuneRoundedIcon from "@mui/icons-material/TuneRounded";
import {
  Alert,
  Box,
  Button,
  ButtonBase,
  Chip,
  Dialog,
  DialogContent,
  Divider,
  Drawer,
  InputAdornment,
  MenuItem,
  Select,
  Stack,
  Switch,
  TextField,
  Typography,
  useMediaQuery,
} from "@mui/material";
import { useTheme } from "@mui/material/styles";
import { useDeferredValue, useEffect, useState } from "react";
import type { BranchMappingItem, ChainThreshold, ThresholdProfile } from "../../api/types";
import {
  branchHasCustomOverride,
  getRuleCatalogEntry,
  thresholdRuleCatalog,
  thresholdSourceLabel,
  type RuleCatalogEntry,
  type RuleEditorDraft,
} from "./lib/ruleCatalog";

export interface BranchThresholdEditorDraft {
  lateThreshold: string;
  lateReopenThreshold: string;
  unassignedThreshold: string;
  unassignedReopenThreshold: string;
  readyThreshold: string;
  readyReopenThreshold: string;
  capacityRuleEnabled: boolean;
  capacityPerHourEnabled: boolean;
  capacityPerHourLimit: string;
}

type OverrideLens = "all" | "custom" | "inherited";

function safeText(value: unknown) {
  return typeof value === "string" ? value : "";
}

function normalizeChainName(value: unknown) {
  return safeText(value).trim().toLowerCase();
}

function branchLabel(branch: Pick<BranchMappingItem, "name" | "availabilityVendorId">) {
  return safeText(branch.name).trim() || `Availability ${branch.availabilityVendorId}`;
}

function clampReopenThreshold(closeThreshold: number, reopenThreshold: number | undefined) {
  const normalizedClose = Math.max(0, Math.round(closeThreshold));
  const normalizedReopen =
    typeof reopenThreshold === "number"
      ? Math.max(0, Math.round(reopenThreshold))
      : 0;
  return Math.min(normalizedClose, normalizedReopen);
}

function buildBranchRuleEditorDraft(branchEditor: BranchThresholdEditorDraft): RuleEditorDraft {
  return {
    late: {
      close: branchEditor.lateThreshold,
      reopen: branchEditor.lateReopenThreshold,
    },
    unassigned: {
      close: branchEditor.unassignedThreshold,
      reopen: branchEditor.unassignedReopenThreshold,
    },
    ready: {
      close: branchEditor.readyThreshold,
      reopen: branchEditor.readyReopenThreshold,
    },
    capacity: {
      enabled: branchEditor.capacityRuleEnabled,
    },
    capacityHour: {
      enabled: branchEditor.capacityPerHourEnabled,
      limit: branchEditor.capacityPerHourLimit,
    },
  };
}

function resolveEffectiveThresholdProfile(
  branch: Pick<
    BranchMappingItem,
    | "chainName"
    | "lateThresholdOverride"
    | "lateReopenThresholdOverride"
    | "unassignedThresholdOverride"
    | "unassignedReopenThresholdOverride"
    | "readyThresholdOverride"
    | "readyReopenThresholdOverride"
    | "capacityRuleEnabledOverride"
    | "capacityPerHourEnabledOverride"
    | "capacityPerHourLimitOverride"
  >,
  chains: ChainThreshold[],
  globalThresholds: Pick<
    ThresholdProfile,
    | "lateThreshold"
    | "lateReopenThreshold"
    | "unassignedThreshold"
    | "unassignedReopenThreshold"
    | "readyThreshold"
    | "readyReopenThreshold"
    | "capacityRuleEnabled"
    | "capacityPerHourEnabled"
    | "capacityPerHourLimit"
  >,
): ThresholdProfile {
  const chainKey = normalizeChainName(branch.chainName);
  const chain = chainKey
    ? chains.find((item) => normalizeChainName(item.name) === chainKey)
    : undefined;
  const inherited = chain
    ? {
        lateThreshold: chain.lateThreshold,
        lateReopenThreshold: chain.lateReopenThreshold ?? 0,
        unassignedThreshold: chain.unassignedThreshold,
        unassignedReopenThreshold: chain.unassignedReopenThreshold ?? 0,
        readyThreshold: chain.readyThreshold ?? 0,
        readyReopenThreshold: chain.readyReopenThreshold ?? 0,
        capacityRuleEnabled: chain.capacityRuleEnabled !== false,
        capacityPerHourEnabled: chain.capacityPerHourEnabled === true,
        capacityPerHourLimit: chain.capacityPerHourLimit ?? null,
        source: "chain" as const,
      }
    : {
        lateThreshold: globalThresholds.lateThreshold,
        lateReopenThreshold: globalThresholds.lateReopenThreshold ?? 0,
        unassignedThreshold: globalThresholds.unassignedThreshold,
        unassignedReopenThreshold: globalThresholds.unassignedReopenThreshold ?? 0,
        readyThreshold: globalThresholds.readyThreshold ?? 0,
        readyReopenThreshold: globalThresholds.readyReopenThreshold ?? 0,
        capacityRuleEnabled: globalThresholds.capacityRuleEnabled !== false,
        capacityPerHourEnabled: globalThresholds.capacityPerHourEnabled === true,
        capacityPerHourLimit: globalThresholds.capacityPerHourLimit ?? null,
        source: "global" as const,
      };

  const hasThresholdOverride =
    typeof branch.lateThresholdOverride === "number" &&
    typeof branch.unassignedThresholdOverride === "number";
  const hasLateReopenThresholdOverride = typeof branch.lateReopenThresholdOverride === "number";
  const hasUnassignedReopenThresholdOverride = typeof branch.unassignedReopenThresholdOverride === "number";
  const hasReadyThresholdOverride = typeof branch.readyThresholdOverride === "number";
  const hasReadyReopenThresholdOverride = typeof branch.readyReopenThresholdOverride === "number";
  const hasCapacityOverride = typeof branch.capacityRuleEnabledOverride === "boolean";
  const hasCapacityPerHourOverride =
    typeof branch.capacityPerHourEnabledOverride === "boolean" &&
    typeof branch.capacityPerHourLimitOverride === "number";

  if (
    hasThresholdOverride
    || hasLateReopenThresholdOverride
    || hasUnassignedReopenThresholdOverride
    || hasReadyThresholdOverride
    || hasReadyReopenThresholdOverride
    || hasCapacityOverride
    || hasCapacityPerHourOverride
  ) {
    return {
      lateThreshold: hasThresholdOverride ? branch.lateThresholdOverride as number : inherited.lateThreshold,
      lateReopenThreshold: clampReopenThreshold(
        hasThresholdOverride ? branch.lateThresholdOverride as number : inherited.lateThreshold,
        hasLateReopenThresholdOverride ? branch.lateReopenThresholdOverride as number : inherited.lateReopenThreshold,
      ),
      unassignedThreshold: hasThresholdOverride ? branch.unassignedThresholdOverride as number : inherited.unassignedThreshold,
      unassignedReopenThreshold: clampReopenThreshold(
        hasThresholdOverride ? branch.unassignedThresholdOverride as number : inherited.unassignedThreshold,
        hasUnassignedReopenThresholdOverride ? branch.unassignedReopenThresholdOverride as number : inherited.unassignedReopenThreshold,
      ),
      readyThreshold: hasReadyThresholdOverride ? branch.readyThresholdOverride as number : inherited.readyThreshold,
      readyReopenThreshold: clampReopenThreshold(
        hasReadyThresholdOverride ? branch.readyThresholdOverride as number : inherited.readyThreshold,
        hasReadyReopenThresholdOverride ? branch.readyReopenThresholdOverride as number : inherited.readyReopenThreshold,
      ),
      capacityRuleEnabled: hasCapacityOverride ? branch.capacityRuleEnabledOverride as boolean : inherited.capacityRuleEnabled,
      capacityPerHourEnabled:
        hasCapacityPerHourOverride ? branch.capacityPerHourEnabledOverride as boolean : inherited.capacityPerHourEnabled,
      capacityPerHourLimit:
        hasCapacityPerHourOverride ? branch.capacityPerHourLimitOverride as number : inherited.capacityPerHourLimit,
      source: "branch",
    };
  }

  return inherited;
}

function stripBranchOverrides(branch: BranchMappingItem): BranchMappingItem {
  return {
    ...branch,
    lateThresholdOverride: null,
    lateReopenThresholdOverride: null,
    unassignedThresholdOverride: null,
    unassignedReopenThresholdOverride: null,
    readyThresholdOverride: null,
    readyReopenThresholdOverride: null,
    capacityRuleEnabledOverride: null,
    capacityPerHourEnabledOverride: null,
    capacityPerHourLimitOverride: null,
  };
}

function ruleSurfaceSx(entry: RuleCatalogEntry, highlighted = false) {
  return {
    p: 1.1,
    borderRadius: 3,
    border: `1px solid ${highlighted ? "rgba(15,23,42,0.12)" : "rgba(148,163,184,0.16)"}`,
    bgcolor: "rgba(255,255,255,0.94)",
    boxShadow: highlighted ? "0 12px 28px rgba(15,23,42,0.07)" : "0 10px 24px rgba(15,23,42,0.05)",
    transition: "transform 180ms ease, box-shadow 180ms ease, border-color 180ms ease",
    "&:hover": {
      boxShadow: "0 14px 28px rgba(15,23,42,0.08)",
      borderColor: "rgba(15,23,42,0.16)",
    },
  };
}

function countBranchOverrideRules(branch: BranchMappingItem) {
  return [
    typeof branch.lateThresholdOverride === "number" || typeof branch.lateReopenThresholdOverride === "number",
    typeof branch.unassignedThresholdOverride === "number" || typeof branch.unassignedReopenThresholdOverride === "number",
    typeof branch.readyThresholdOverride === "number" || typeof branch.readyReopenThresholdOverride === "number",
    typeof branch.capacityRuleEnabledOverride === "boolean",
    typeof branch.capacityPerHourEnabledOverride === "boolean" && typeof branch.capacityPerHourLimitOverride === "number",
  ].filter(Boolean).length;
}

function hasLateOverride(branch: BranchMappingItem) {
  return typeof branch.lateThresholdOverride === "number" || typeof branch.lateReopenThresholdOverride === "number";
}

function hasUnassignedOverride(branch: BranchMappingItem) {
  return typeof branch.unassignedThresholdOverride === "number" || typeof branch.unassignedReopenThresholdOverride === "number";
}

function hasReadyOverride(branch: BranchMappingItem) {
  return typeof branch.readyThresholdOverride === "number" || typeof branch.readyReopenThresholdOverride === "number";
}

function hasCapacityOverride(branch: BranchMappingItem) {
  return typeof branch.capacityRuleEnabledOverride === "boolean";
}

function hasCapacityHourOverride(branch: BranchMappingItem) {
  return typeof branch.capacityPerHourEnabledOverride === "boolean" && typeof branch.capacityPerHourLimitOverride === "number";
}

function RuleComparisonCard(props: {
  entry: RuleCatalogEntry;
  effectiveLabel: string;
  overrideLabel: string;
  statusLabel: string;
}) {
  const { entry } = props;

  return (
    <Box sx={ruleSurfaceSx(entry)}>
      <Stack spacing={0.9}>
        <Stack direction="row" spacing={1} alignItems="center">
          <Box
            sx={{
              width: 38,
              height: 38,
              borderRadius: 2,
              display: "grid",
              placeItems: "center",
              color: entry.accent.solid,
              bgcolor: entry.accent.soft,
              border: `1px solid ${entry.accent.border}`,
            }}
          >
            {entry.icon}
          </Box>
          <Typography sx={{ fontWeight: 900, color: "#0f172a" }}>
            {entry.label}
          </Typography>
        </Stack>

        <Stack direction="row" spacing={0.7} flexWrap="wrap">
          <Chip
            size="small"
            label={props.statusLabel}
            sx={{ fontWeight: 900, bgcolor: entry.accent.soft, color: entry.accent.solid }}
          />
        </Stack>

        <Stack spacing={0.4}>
          <Typography variant="caption" sx={{ color: "#64748b" }}>
            Current
          </Typography>
          <Typography sx={{ fontWeight: 900, color: "#0f172a" }}>
            {props.effectiveLabel}
          </Typography>
        </Stack>

        <Stack spacing={0.4}>
          <Typography variant="caption" sx={{ color: "#64748b" }}>
            Override
          </Typography>
          <Typography variant="body2" sx={{ fontWeight: 700, color: "#334155" }}>
            {props.overrideLabel}
          </Typography>
        </Stack>
      </Stack>
    </Box>
  );
}

function RuleEditorCard(props: {
  entry: RuleCatalogEntry;
  draft: RuleEditorDraft;
  disabled: boolean;
  closeLabelSuffix: string;
  reopenLabelSuffix: string;
  limitLabel: string;
  closePlaceholder?: string;
  reopenPlaceholder?: string;
  limitPlaceholder?: string;
  helperText: string;
  onCloseChange?: (value: string) => void;
  onReopenChange?: (value: string) => void;
  onToggleChange?: (value: boolean) => void;
  onLimitChange?: (value: string) => void;
}) {
  const { entry, draft } = props;
  const values = draft[entry.id] as {
    close?: string;
    reopen?: string;
    enabled?: boolean;
    limit?: string;
  };

  return (
    <Box sx={ruleSurfaceSx(entry, true)}>
      <Stack spacing={1}>
        <Stack direction="row" spacing={1} alignItems="center">
          <Box
            sx={{
              width: 38,
              height: 38,
              borderRadius: 2,
              display: "grid",
              placeItems: "center",
              color: entry.accent.solid,
              bgcolor: entry.accent.soft,
              border: `1px solid ${entry.accent.border}`,
            }}
          >
            {entry.icon}
          </Box>
          <Typography sx={{ fontWeight: 900, color: "#0f172a" }}>
            {entry.label}
          </Typography>
        </Stack>

        {entry.supportsClose ? (
          <Stack direction={{ xs: "column", sm: "row" }} spacing={1}>
            <TextField
              label={`${entry.shortLabel} ${props.closeLabelSuffix}`}
              type="number"
              value={values.close}
              onChange={(event) => props.onCloseChange?.(event.target.value)}
              placeholder={props.closePlaceholder}
              inputProps={{ min: 0 }}
              disabled={props.disabled}
              fullWidth
            />
            <TextField
              label={`${entry.shortLabel} ${props.reopenLabelSuffix}`}
              type="number"
              value={values.reopen}
              onChange={(event) => props.onReopenChange?.(event.target.value)}
              placeholder={props.reopenPlaceholder}
              inputProps={{ min: 0 }}
              disabled={props.disabled}
              fullWidth
            />
          </Stack>
        ) : null}

        {entry.supportsToggle ? (
          <Stack
            direction={{ xs: "column", sm: "row" }}
            spacing={1}
            alignItems={{ xs: "flex-start", sm: "center" }}
            justifyContent="space-between"
          >
            <Typography sx={{ fontWeight: 800, color: "#0f172a" }}>
              {entry.supportsLimit ? "Hourly limit" : "State"}
            </Typography>

            <Stack direction="row" spacing={0.9} alignItems="center">
              <Typography variant="caption" sx={{ color: "#64748b" }}>
                {values.enabled ? "Enabled" : "Disabled"}
              </Typography>
              <Switch
                checked={values.enabled}
                onChange={(event) => props.onToggleChange?.(event.target.checked)}
                disabled={props.disabled}
              />
            </Stack>
          </Stack>
        ) : null}

        {entry.supportsLimit ? (
          <TextField
            label={props.limitLabel}
            type="number"
            value={values.limit}
            onChange={(event) => props.onLimitChange?.(event.target.value)}
            placeholder={props.limitPlaceholder}
            inputProps={{ min: 1 }}
            disabled={props.disabled}
            fullWidth
          />
        ) : null}
      </Stack>
    </Box>
  );
}

export function BranchThresholdOverrideManager(props: {
  branches: BranchMappingItem[];
  chains: ChainThreshold[];
  globalThresholds: {
    lateThreshold: number;
    lateReopenThreshold?: number;
    unassignedThreshold: number;
    unassignedReopenThreshold?: number;
    readyThreshold?: number;
    readyReopenThreshold?: number;
    capacityRuleEnabled: boolean;
    capacityPerHourEnabled: boolean;
    capacityPerHourLimit: number | null;
  };
  chainFilter: string;
  onChainFilterChange: (value: string) => void;
  editingBranchId: number | null;
  branchEditor: BranchThresholdEditorDraft;
  savingBranchId: number | null;
  readOnly?: boolean;
  onEditBranch: (branch: BranchMappingItem) => void;
  onChangeEditor: (patch: Partial<BranchThresholdEditorDraft>) => void;
  onSaveBranch: (branch: BranchMappingItem) => void;
  onClearBranchOverride: (branch: BranchMappingItem) => void;
  onCancelEdit: () => void;
}) {
  const { branches, chains, globalThresholds, chainFilter, editingBranchId, branchEditor, savingBranchId, readOnly = false } = props;
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("md"));
  const [query, setQuery] = useState("");
  const [lens, setLens] = useState<OverrideLens>("all");
  const [selectedBranchId, setSelectedBranchId] = useState<number | null>(null);
  const [branchDetailsOpen, setBranchDetailsOpen] = useState(false);
  const deferredQuery = useDeferredValue(query);
  const normalizedQuery = deferredQuery.trim().toLowerCase();
  const branchDraft = buildBranchRuleEditorDraft(branchEditor);

  const chainOptions = Array.from(new Set(branches.map((branch) => safeText(branch.chainName).trim()).filter(Boolean)))
    .sort((left, right) => left.localeCompare(right));

  const filteredBranches = branches.filter((branch) => {
    const branchChainName = safeText(branch.chainName).trim();
    const normalizedBranchChainName = normalizeChainName(branch.chainName);
    const normalizedChainFilter = normalizeChainName(chainFilter);

    if (chainFilter === "__no_chain__" && branchChainName) return false;
    if (
      chainFilter !== "all"
      && chainFilter !== "__no_chain__"
      && normalizedBranchChainName !== normalizedChainFilter
    ) {
      return false;
    }
    if (normalizedQuery) {
      const haystack = [
        branchLabel(branch).toLowerCase(),
        branchChainName.toLowerCase(),
        safeText(branch.availabilityVendorId).toLowerCase(),
        String(branch.ordersVendorId ?? ""),
      ].join(" ");
      if (!haystack.includes(normalizedQuery)) return false;
    }

    if (lens === "custom" && !branchHasCustomOverride(branch)) return false;
    if (lens === "inherited" && branchHasCustomOverride(branch)) return false;
    return true;
  });

  useEffect(() => {
    if (editingBranchId != null) {
      setSelectedBranchId(editingBranchId);
      setBranchDetailsOpen(false);
    }
  }, [editingBranchId]);

  useEffect(() => {
    if (!filteredBranches.length) {
      setSelectedBranchId(null);
      setBranchDetailsOpen(false);
      return;
    }

    if (!filteredBranches.some((branch) => branch.id === selectedBranchId)) {
      setSelectedBranchId(filteredBranches[0].id);
      setBranchDetailsOpen(false);
    }
  }, [filteredBranches, selectedBranchId]);

  const selectedBranch =
    filteredBranches.find((branch) => branch.id === selectedBranchId)
    ?? filteredBranches[0]
    ?? null;

  const effective = selectedBranch
    ? resolveEffectiveThresholdProfile(selectedBranch, chains, globalThresholds)
    : null;
  const inherited = selectedBranch
    ? resolveEffectiveThresholdProfile(stripBranchOverrides(selectedBranch), chains, globalThresholds)
    : null;

  function handleOpenBranchDetails(branchId: number) {
    setSelectedBranchId(branchId);
    setBranchDetailsOpen(true);
  }

  function handleCloseBranchDetails() {
    setBranchDetailsOpen(false);
  }

  return (
    <Stack spacing={2}>
      <Box
        sx={{
          p: { xs: 1.1, md: 1.35 },
          borderRadius: 3.5,
          border: "1px solid rgba(148,163,184,0.16)",
          bgcolor: "rgba(255,255,255,0.96)",
          boxShadow: "0 16px 36px rgba(15,23,42,0.06)",
        }}
      >
        <Stack spacing={1.1}>
          <Stack
            direction={{ xs: "column", xl: "row" }}
            spacing={1}
            alignItems={{ xs: "stretch", xl: "center" }}
            justifyContent="space-between"
          >
            <Stack direction="row" spacing={1} alignItems="center">
              <Box
                sx={{
                  width: 36,
                  height: 36,
                  borderRadius: 2,
                  display: "grid",
                  placeItems: "center",
                  bgcolor: "rgba(15,23,42,0.06)",
                  color: "#334155",
                }}
              >
                <FilterAltRoundedIcon sx={{ fontSize: 18 }} />
              </Box>
              <Typography sx={{ fontWeight: 900, color: "#0f172a" }}>
                Overrides
              </Typography>
            </Stack>

            <Stack direction={{ xs: "column", md: "row" }} spacing={1} sx={{ width: { xs: "100%", xl: "auto" } }}>
              <TextField
                placeholder="Search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                size="small"
                sx={{ minWidth: { xs: "100%", md: 240 } }}
                InputProps={{
                  startAdornment: (
                    <InputAdornment position="start">
                      <SearchRoundedIcon sx={{ fontSize: 18, color: "#64748b" }} />
                    </InputAdornment>
                  ),
                }}
              />

              <Select
                size="small"
                value={chainFilter}
                onChange={(event) => props.onChainFilterChange(event.target.value)}
                sx={{ minWidth: { xs: "100%", md: 220 }, borderRadius: 999 }}
              >
                <MenuItem value="all">All Chains</MenuItem>
                <MenuItem value="__no_chain__">No Chain</MenuItem>
                {chainOptions.map((item) => (
                  <MenuItem key={item} value={item}>
                    {item}
                  </MenuItem>
                ))}
              </Select>
            </Stack>
          </Stack>

          <Stack direction={{ xs: "column", md: "row" }} spacing={1} justifyContent="space-between">
            <Stack direction="row" spacing={0.8} flexWrap="wrap">
              {[
                { key: "all" as const, label: `All ${branches.length}` },
                { key: "custom" as const, label: `Custom ${branches.filter((branch) => branchHasCustomOverride(branch)).length}` },
                { key: "inherited" as const, label: `Inherited ${branches.filter((branch) => !branchHasCustomOverride(branch)).length}` },
              ].map((item) => {
                const active = lens === item.key;
                return (
                  <Button
                    key={item.key}
                    variant={active ? "contained" : "outlined"}
                    onClick={() => setLens(item.key)}
                    sx={{
                      borderRadius: 999,
                      fontWeight: 900,
                      color: active ? "#ffffff" : "#334155",
                      borderColor: "rgba(148,163,184,0.2)",
                      backgroundColor: active ? "#0f172a" : "transparent",
                      boxShadow: "none",
                      "&:hover": {
                        backgroundColor: active ? "#0f172a" : "rgba(15,23,42,0.04)",
                        borderColor: "rgba(15,23,42,0.16)",
                      },
                    }}
                  >
                    {item.label}
                  </Button>
                );
              })}
            </Stack>

            <Chip
              size="small"
              label={`${filteredBranches.length} shown`}
              sx={{ fontWeight: 900, bgcolor: "rgba(15,23,42,0.06)", color: "#334155" }}
            />
          </Stack>

          <Stack direction={{ xs: "column", xl: "row" }} spacing={1.2} sx={{ alignItems: { xs: "stretch", xl: "flex-start" } }}>
            <Box
              sx={{
                width: { xs: "100%", xl: 360 },
                flexShrink: 0,
                p: 1.05,
                borderRadius: 3,
                border: "1px solid rgba(148,163,184,0.16)",
                bgcolor: "rgba(248,250,252,0.72)",
              }}
            >
              <Stack spacing={0.75}>
                {filteredBranches.length ? (
                  filteredBranches.map((branch) => {
                    const active = selectedBranch?.id === branch.id;
                    const branchEffective = resolveEffectiveThresholdProfile(branch, chains, globalThresholds);
                    const customCount = countBranchOverrideRules(branch);
                    return (
                      <ButtonBase
                        key={branch.id}
                        onClick={() => handleOpenBranchDetails(branch.id)}
                        sx={{ width: "100%", borderRadius: 3, textAlign: "left" }}
                      >
                        <Box
                          sx={{
                            width: "100%",
                            p: 1,
                            borderRadius: 3,
                            border: active ? "1px solid rgba(15,23,42,0.18)" : "1px solid rgba(148,163,184,0.16)",
                            bgcolor: "rgba(255,255,255,0.94)",
                            boxShadow: active ? "0 12px 24px rgba(15,23,42,0.08)" : "0 8px 18px rgba(15,23,42,0.04)",
                            transition: "box-shadow 180ms ease, border-color 180ms ease",
                            "&:hover": {
                              boxShadow: "0 12px 24px rgba(15,23,42,0.08)",
                            },
                          }}
                        >
                          <Stack spacing={0.35}>
                            <Typography sx={{ fontWeight: 900, color: "#0f172a" }} noWrap>
                              {branchLabel(branch)}
                            </Typography>
                            <Typography variant="caption" sx={{ color: "#64748b", display: "block" }} noWrap>
                              {safeText(branch.chainName).trim() || "No Chain"}
                            </Typography>
                            <Typography variant="caption" sx={{ color: "#64748b", display: "block" }} noWrap>
                              Late {branchEffective.lateThreshold} {"->"} {branchEffective.lateReopenThreshold ?? 0}
                            </Typography>
                            <Typography variant="caption" sx={{ color: "#64748b", display: "block" }} noWrap>
                              {customCount ? `${customCount} custom` : thresholdSourceLabel(branchEffective.source)}
                            </Typography>
                          </Stack>
                        </Box>
                      </ButtonBase>
                    );
                  })
                ) : (
                  <Alert severity="info" variant="outlined" sx={{ borderRadius: 2.8 }}>
                    No branches match the current filters.
                  </Alert>
                )}
              </Stack>
            </Box>

            <Box sx={{ flex: 1, minWidth: 0 }}>
              {selectedBranch && effective && inherited ? (
                <Box
                  sx={{
                    p: { xs: 1.1, md: 1.25 },
                    borderRadius: 3,
                    border: "1px solid rgba(148,163,184,0.16)",
                    bgcolor: "rgba(255,255,255,0.96)",
                    boxShadow: "0 12px 28px rgba(15,23,42,0.06)",
                  }}
                >
                  <Stack spacing={1.1}>
                    <Stack
                      direction={{ xs: "column", lg: "row" }}
                      spacing={1}
                      justifyContent="space-between"
                      alignItems={{ xs: "flex-start", lg: "center" }}
                    >
                      <Box>
                        <Typography sx={{ fontWeight: 900, color: "#0f172a" }}>
                          {branchLabel(selectedBranch)}
                        </Typography>
                        <Typography variant="caption" sx={{ color: "#64748b", display: "block" }}>
                          {safeText(selectedBranch.chainName).trim() || "No Chain"} • {thresholdSourceLabel(effective.source)}
                        </Typography>
                      </Box>

                      <Stack direction={{ xs: "column", sm: "row" }} spacing={1}>
                        <Button
                          variant="outlined"
                          startIcon={<RestartAltRoundedIcon />}
                          onClick={() => props.onClearBranchOverride(selectedBranch)}
                          disabled={readOnly || savingBranchId === selectedBranch.id || !branchHasCustomOverride(selectedBranch)}
                          sx={{ borderRadius: 999, fontWeight: 900 }}
                        >
                          Inherited
                        </Button>
                        <Button
                          variant="outlined"
                          startIcon={<ApartmentRoundedIcon />}
                          onClick={() => handleOpenBranchDetails(selectedBranch.id)}
                          sx={{ borderRadius: 999, fontWeight: 900 }}
                        >
                          Open
                        </Button>
                        <Button
                          variant="contained"
                          startIcon={<TuneRoundedIcon />}
                          onClick={() => props.onEditBranch(selectedBranch)}
                          disabled={readOnly || savingBranchId === selectedBranch.id}
                          sx={{ borderRadius: 999, background: "#0f172a", boxShadow: "none" }}
                        >
                          Edit
                        </Button>
                      </Stack>
                    </Stack>

                    <Stack direction="row" spacing={0.75} flexWrap="wrap">
                      <Chip
                        size="small"
                        label={`${countBranchOverrideRules(selectedBranch)} override rules`}
                        sx={{ fontWeight: 900, bgcolor: "rgba(15,23,42,0.06)", color: "#334155" }}
                      />
                      <Chip
                        size="small"
                        label={`Orders ${selectedBranch.ordersVendorId ?? "N/A"}`}
                        sx={{ fontWeight: 900, bgcolor: "rgba(15,23,42,0.06)", color: "#334155" }}
                      />
                      <Chip
                        size="small"
                        label={`Availability ${selectedBranch.availabilityVendorId}`}
                        sx={{ fontWeight: 900, bgcolor: "rgba(15,23,42,0.06)", color: "#334155" }}
                      />
                    </Stack>

                    <Box
                      sx={{
                        display: "grid",
                        gap: 1,
                        gridTemplateColumns: { xs: "1fr", md: "repeat(2, minmax(0, 1fr))", xl: "repeat(3, minmax(0, 1fr))" },
                      }}
                    >
                      {thresholdRuleCatalog.map((entry) => {
                        if (entry.id === "late") {
                          return (
                            <RuleComparisonCard
                              key={entry.id}
                              entry={entry}
                              effectiveLabel={`${effective.lateThreshold} -> ${effective.lateReopenThreshold ?? 0}`}
                              overrideLabel={
                                hasLateOverride(selectedBranch)
                                  ? `${selectedBranch.lateThresholdOverride ?? inherited.lateThreshold} -> ${selectedBranch.lateReopenThresholdOverride ?? inherited.lateReopenThreshold ?? 0}`
                                  : "Inherited"
                              }
                              statusLabel={hasLateOverride(selectedBranch) ? "Custom" : thresholdSourceLabel(inherited.source)}
                            />
                          );
                        }

                        if (entry.id === "unassigned") {
                          return (
                            <RuleComparisonCard
                              key={entry.id}
                              entry={entry}
                              effectiveLabel={`${effective.unassignedThreshold} -> ${effective.unassignedReopenThreshold ?? 0}`}
                              overrideLabel={
                                hasUnassignedOverride(selectedBranch)
                                  ? `${selectedBranch.unassignedThresholdOverride ?? inherited.unassignedThreshold} -> ${selectedBranch.unassignedReopenThresholdOverride ?? inherited.unassignedReopenThreshold ?? 0}`
                                  : "Inherited"
                              }
                              statusLabel={hasUnassignedOverride(selectedBranch) ? "Custom" : thresholdSourceLabel(inherited.source)}
                            />
                          );
                        }

                        if (entry.id === "ready") {
                          return (
                            <RuleComparisonCard
                              key={entry.id}
                              entry={entry}
                              effectiveLabel={`${effective.readyThreshold ?? 0} -> ${effective.readyReopenThreshold ?? 0}`}
                              overrideLabel={
                                hasReadyOverride(selectedBranch)
                                  ? `${selectedBranch.readyThresholdOverride ?? inherited.readyThreshold ?? 0} -> ${selectedBranch.readyReopenThresholdOverride ?? inherited.readyReopenThreshold ?? 0}`
                                  : "Inherited"
                              }
                              statusLabel={hasReadyOverride(selectedBranch) ? "Custom" : thresholdSourceLabel(inherited.source)}
                            />
                          );
                        }

                        if (entry.id === "capacity") {
                          return (
                            <RuleComparisonCard
                              key={entry.id}
                              entry={entry}
                              effectiveLabel={effective.capacityRuleEnabled === false ? "Disabled" : "Enabled"}
                              overrideLabel={
                                hasCapacityOverride(selectedBranch)
                                  ? (selectedBranch.capacityRuleEnabledOverride ? "Enabled" : "Disabled")
                                  : "Inherited"
                              }
                              statusLabel={hasCapacityOverride(selectedBranch) ? "Custom" : thresholdSourceLabel(inherited.source)}
                            />
                          );
                        }

                        return (
                          <RuleComparisonCard
                            key={entry.id}
                            entry={entry}
                            effectiveLabel={
                              effective.capacityPerHourEnabled === true && typeof effective.capacityPerHourLimit === "number"
                                ? `${effective.capacityPerHourLimit}/h`
                                : "Disabled"
                            }
                            overrideLabel={
                              hasCapacityHourOverride(selectedBranch)
                                ? (
                                  selectedBranch.capacityPerHourEnabledOverride && typeof selectedBranch.capacityPerHourLimitOverride === "number"
                                    ? `${selectedBranch.capacityPerHourLimitOverride}/h`
                                    : "Disabled"
                                )
                                : "Inherited"
                            }
                            statusLabel={hasCapacityHourOverride(selectedBranch) ? "Custom" : thresholdSourceLabel(inherited.source)}
                          />
                        );
                      })}
                    </Box>
                  </Stack>
                </Box>
              ) : (
                <Alert severity="info" variant="outlined" sx={{ borderRadius: 3 }}>
                  No branches
                </Alert>
              )}
            </Box>
          </Stack>
        </Stack>
      </Box>

      <Dialog
        open={branchDetailsOpen && selectedBranch != null && effective != null && inherited != null}
        onClose={handleCloseBranchDetails}
        fullWidth
        fullScreen={isMobile}
        maxWidth="lg"
        PaperProps={{
          "data-testid": "branch-details-dialog",
          sx: {
            width: { xs: "100%", sm: "min(1120px, calc(100vw - 56px))" },
            height: { xs: "100%", sm: "min(780px, calc(100vh - 48px))" },
            maxHeight: { xs: "100%", sm: "calc(100vh - 48px)" },
            m: { xs: 0, sm: 2.5 },
            borderRadius: { xs: 0, sm: 3.2 },
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
          },
        }}
      >
        {selectedBranch && effective && inherited ? (
          <DialogContent
            dividers
            sx={{
              p: { xs: 1, md: 1.35 },
              flex: 1,
              minHeight: 0,
              display: "flex",
              flexDirection: "column",
              gap: 1.5,
              overflowX: "hidden",
              overflowY: "auto",
            }}
          >
            <Stack spacing={1.2}>
              <Stack
                direction={{ xs: "column", lg: "row" }}
                spacing={1.1}
                justifyContent="space-between"
                alignItems={{ xs: "flex-start", lg: "center" }}
              >
                <Stack direction="row" spacing={1} alignItems="center">
                  <Box
                    sx={{
                      width: 48,
                      height: 48,
                      borderRadius: 2.8,
                      display: "grid",
                      placeItems: "center",
                      bgcolor: "rgba(99,102,241,0.12)",
                      color: "#4338ca",
                    }}
                  >
                    <ApartmentRoundedIcon sx={{ fontSize: 22 }} />
                  </Box>
                  <Box>
                    <Typography sx={{ fontWeight: 900, fontSize: { xs: "1.1rem", md: "1.25rem" }, color: "#0f172a" }}>
                      {branchLabel(selectedBranch)}
                    </Typography>
                    <Typography variant="caption" sx={{ color: "#64748b", display: "block" }}>
                      {safeText(selectedBranch.chainName).trim() || "No Chain"} • {thresholdSourceLabel(effective.source)}
                    </Typography>
                  </Box>
                </Stack>

                <Stack direction={{ xs: "column-reverse", sm: "row" }} spacing={1}>
                  <Button
                    variant="text"
                    color="inherit"
                    onClick={handleCloseBranchDetails}
                    startIcon={<CloseRoundedIcon />}
                  >
                    Close
                  </Button>
                  <Button
                    variant="outlined"
                    startIcon={<RestartAltRoundedIcon />}
                    onClick={() => props.onClearBranchOverride(selectedBranch)}
                    disabled={readOnly || savingBranchId === selectedBranch.id || !branchHasCustomOverride(selectedBranch)}
                    sx={{ borderRadius: 999, fontWeight: 900 }}
                  >
                    Use Inherited
                  </Button>
                  <Button
                    variant="contained"
                    startIcon={<TuneRoundedIcon />}
                    onClick={() => {
                      handleCloseBranchDetails();
                      props.onEditBranch(selectedBranch);
                    }}
                    disabled={readOnly || savingBranchId === selectedBranch.id}
                    sx={{
                      borderRadius: 999,
                      background: "linear-gradient(135deg, #312e81, #4f46e5)",
                      boxShadow: "0 18px 30px rgba(79,70,229,0.18)",
                    }}
                  >
                    Edit Override
                  </Button>
                </Stack>
              </Stack>

              <Stack direction="row" spacing={0.75} flexWrap="wrap">
                <Chip
                  size="small"
                  label={`${countBranchOverrideRules(selectedBranch)} override rules`}
                  sx={{ fontWeight: 900, bgcolor: "rgba(14,165,233,0.1)", color: "#0369a1" }}
                />
                <Chip
                  size="small"
                  label={inherited.source === "chain" ? safeText(selectedBranch.chainName).trim() || "No Chain" : "Global"}
                  sx={{ fontWeight: 900, bgcolor: "rgba(15,23,42,0.06)", color: "#334155" }}
                />
                <Chip
                  size="small"
                  label={`Orders ${selectedBranch.ordersVendorId ?? "N/A"} • Availability ${selectedBranch.availabilityVendorId}`}
                  sx={{ fontWeight: 900, bgcolor: "rgba(99,102,241,0.08)", color: "#4338ca" }}
                />
              </Stack>

              <Box
                sx={{
                  display: "grid",
                  gap: 1,
                  gridTemplateColumns: { xs: "1fr", md: "repeat(2, minmax(0, 1fr))", xl: "repeat(3, minmax(0, 1fr))" },
                }}
              >
                {thresholdRuleCatalog.map((entry) => {
                  if (entry.id === "late") {
                    return (
                      <RuleComparisonCard
                        key={entry.id}
                        entry={entry}
                        effectiveLabel={`${effective.lateThreshold} -> ${effective.lateReopenThreshold ?? 0}`}
                        overrideLabel={
                          hasLateOverride(selectedBranch)
                            ? `${selectedBranch.lateThresholdOverride ?? inherited.lateThreshold} -> ${selectedBranch.lateReopenThresholdOverride ?? inherited.lateReopenThreshold ?? 0}`
                            : "Inherited"
                        }
                        statusLabel={hasLateOverride(selectedBranch) ? "Custom override" : thresholdSourceLabel(inherited.source)}
                      />
                    );
                  }

                  if (entry.id === "unassigned") {
                    return (
                      <RuleComparisonCard
                        key={entry.id}
                        entry={entry}
                        effectiveLabel={`${effective.unassignedThreshold} -> ${effective.unassignedReopenThreshold ?? 0}`}
                        overrideLabel={
                          hasUnassignedOverride(selectedBranch)
                            ? `${selectedBranch.unassignedThresholdOverride ?? inherited.unassignedThreshold} -> ${selectedBranch.unassignedReopenThresholdOverride ?? inherited.unassignedReopenThreshold ?? 0}`
                            : "Inherited"
                        }
                        statusLabel={hasUnassignedOverride(selectedBranch) ? "Custom override" : thresholdSourceLabel(inherited.source)}
                      />
                    );
                  }

                  if (entry.id === "ready") {
                    return (
                      <RuleComparisonCard
                        key={entry.id}
                        entry={entry}
                        effectiveLabel={`${effective.readyThreshold ?? 0} -> ${effective.readyReopenThreshold ?? 0}`}
                        overrideLabel={
                          hasReadyOverride(selectedBranch)
                            ? `${selectedBranch.readyThresholdOverride ?? inherited.readyThreshold ?? 0} -> ${selectedBranch.readyReopenThresholdOverride ?? inherited.readyReopenThreshold ?? 0}`
                            : "Inherited"
                        }
                        statusLabel={hasReadyOverride(selectedBranch) ? "Custom override" : thresholdSourceLabel(inherited.source)}
                      />
                    );
                  }

                  if (entry.id === "capacity") {
                    return (
                      <RuleComparisonCard
                        key={entry.id}
                        entry={entry}
                        effectiveLabel={effective.capacityRuleEnabled === false ? "Disabled" : "Enabled"}
                        overrideLabel={
                          hasCapacityOverride(selectedBranch)
                            ? (selectedBranch.capacityRuleEnabledOverride ? "Enabled" : "Disabled")
                            : "Inherited"
                        }
                        statusLabel={hasCapacityOverride(selectedBranch) ? "Custom override" : thresholdSourceLabel(inherited.source)}
                      />
                    );
                  }

                  return (
                    <RuleComparisonCard
                      key={entry.id}
                      entry={entry}
                      effectiveLabel={
                        effective.capacityPerHourEnabled === true && typeof effective.capacityPerHourLimit === "number"
                          ? `${effective.capacityPerHourLimit}/h`
                          : "Disabled"
                      }
                      overrideLabel={
                        hasCapacityHourOverride(selectedBranch)
                          ? (
                            selectedBranch.capacityPerHourEnabledOverride && typeof selectedBranch.capacityPerHourLimitOverride === "number"
                              ? `${selectedBranch.capacityPerHourLimitOverride}/h`
                              : "Disabled"
                          )
                          : "Inherited"
                      }
                      statusLabel={hasCapacityHourOverride(selectedBranch) ? "Custom override" : thresholdSourceLabel(inherited.source)}
                    />
                  );
                })}
              </Box>
            </Stack>
          </DialogContent>
        ) : null}
      </Dialog>

      <Drawer
        open={editingBranchId != null}
        anchor={isMobile ? "bottom" : "right"}
        onClose={props.onCancelEdit}
        PaperProps={{
          "data-testid": "branch-override-sheet",
          "data-anchor": isMobile ? "bottom" : "right",
          sx: {
            width: { xs: "100%", md: 540 },
            maxWidth: "100%",
            borderTopLeftRadius: isMobile ? 24 : 28,
            borderTopRightRadius: isMobile ? 24 : 0,
            borderBottomLeftRadius: isMobile ? 0 : 28,
            p: 2,
            border: "1px solid rgba(148,163,184,0.16)",
            boxShadow: "0 28px 54px rgba(15,23,42,0.16)",
          },
        }}
      >
        {selectedBranch && effective ? (
          <Stack spacing={1.5}>
            <Stack direction="row" spacing={1} alignItems="center" justifyContent="space-between">
              <Box>
                <Typography sx={{ fontWeight: 900, color: "#0f172a" }}>
                  Edit Override
                </Typography>
                <Typography variant="caption" sx={{ color: "#64748b", display: "block" }}>
                  {branchLabel(selectedBranch)}
                </Typography>
              </Box>

              <Button
                variant="text"
                color="inherit"
                onClick={props.onCancelEdit}
                startIcon={<CloseRoundedIcon />}
              >
                Close
              </Button>
            </Stack>

            <Stack spacing={1.1}>
              {thresholdRuleCatalog.map((entry) => {
                if (entry.id === "late") {
                  return (
                    <RuleEditorCard
                      key={entry.id}
                      entry={entry}
                      draft={branchDraft}
                      disabled={readOnly || savingBranchId === selectedBranch.id}
                      closeLabelSuffix="Threshold Override"
                      reopenLabelSuffix="Reopen Threshold Override"
                      limitLabel=""
                      closePlaceholder={String(effective.lateThreshold)}
                      reopenPlaceholder={String(effective.lateReopenThreshold ?? 0)}
                      helperText=""
                      onCloseChange={(value) => props.onChangeEditor({ lateThreshold: value })}
                      onReopenChange={(value) => props.onChangeEditor({ lateReopenThreshold: value })}
                    />
                  );
                }

                if (entry.id === "unassigned") {
                  return (
                    <RuleEditorCard
                      key={entry.id}
                      entry={entry}
                      draft={branchDraft}
                      disabled={readOnly || savingBranchId === selectedBranch.id}
                      closeLabelSuffix="Threshold Override"
                      reopenLabelSuffix="Reopen Threshold Override"
                      limitLabel=""
                      closePlaceholder={String(effective.unassignedThreshold)}
                      reopenPlaceholder={String(effective.unassignedReopenThreshold ?? 0)}
                      helperText=""
                      onCloseChange={(value) => props.onChangeEditor({ unassignedThreshold: value })}
                      onReopenChange={(value) => props.onChangeEditor({ unassignedReopenThreshold: value })}
                    />
                  );
                }

                if (entry.id === "ready") {
                  return (
                    <RuleEditorCard
                      key={entry.id}
                      entry={entry}
                      draft={branchDraft}
                      disabled={readOnly || savingBranchId === selectedBranch.id}
                      closeLabelSuffix="Threshold Override"
                      reopenLabelSuffix="Reopen Threshold Override"
                      limitLabel=""
                      closePlaceholder={String(effective.readyThreshold ?? 0)}
                      reopenPlaceholder={String(effective.readyReopenThreshold ?? 0)}
                      helperText=""
                      onCloseChange={(value) => props.onChangeEditor({ readyThreshold: value })}
                      onReopenChange={(value) => props.onChangeEditor({ readyReopenThreshold: value })}
                    />
                  );
                }

                if (entry.id === "capacity") {
                  return (
                    <RuleEditorCard
                      key={entry.id}
                      entry={entry}
                      draft={branchDraft}
                      disabled={readOnly || savingBranchId === selectedBranch.id}
                      closeLabelSuffix=""
                      reopenLabelSuffix=""
                      limitLabel=""
                      helperText=""
                      onToggleChange={(value) => props.onChangeEditor({ capacityRuleEnabled: value })}
                    />
                  );
                }

                return (
                  <RuleEditorCard
                    key={entry.id}
                    entry={entry}
                    draft={branchDraft}
                    disabled={readOnly || savingBranchId === selectedBranch.id}
                    closeLabelSuffix=""
                    reopenLabelSuffix=""
                    limitLabel="Capacity / Hour Limit Override"
                    limitPlaceholder={effective.capacityPerHourLimit == null ? "" : String(effective.capacityPerHourLimit)}
                    helperText=""
                    onToggleChange={(value) => props.onChangeEditor({ capacityPerHourEnabled: value })}
                    onLimitChange={(value) => props.onChangeEditor({ capacityPerHourLimit: value })}
                  />
                );
              })}
            </Stack>

            <Stack direction={{ xs: "column-reverse", sm: "row" }} spacing={1}>
              <Button
                variant="text"
                color="inherit"
                onClick={props.onCancelEdit}
                sx={{ width: { xs: "100%", sm: "auto" } }}
              >
                Cancel
              </Button>
              <Button
                variant="outlined"
                startIcon={<RestartAltRoundedIcon />}
                onClick={() => props.onClearBranchOverride(selectedBranch)}
                disabled={readOnly || savingBranchId === selectedBranch.id}
                sx={{ width: { xs: "100%", sm: "auto" }, borderRadius: 999, fontWeight: 900 }}
              >
                Use Inherited
              </Button>
              <Button
                variant="contained"
                startIcon={<SaveRoundedIcon />}
                onClick={() => props.onSaveBranch(selectedBranch)}
                disabled={readOnly || savingBranchId === selectedBranch.id}
                sx={{
                  width: { xs: "100%", sm: "auto" },
                  borderRadius: 999,
                  background: "linear-gradient(135deg, #312e81, #4f46e5)",
                }}
              >
                Save Override
              </Button>
            </Stack>
          </Stack>
        ) : null}
      </Drawer>
    </Stack>
  );
}
