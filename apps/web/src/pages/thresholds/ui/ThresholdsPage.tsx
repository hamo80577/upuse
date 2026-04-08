import AccountTreeRoundedIcon from "@mui/icons-material/AccountTreeRounded";
import AutoAwesomeRoundedIcon from "@mui/icons-material/AutoAwesomeRounded";
import LayersRoundedIcon from "@mui/icons-material/LayersRounded";
import StorefrontRoundedIcon from "@mui/icons-material/StorefrontRounded";
import TuneRoundedIcon from "@mui/icons-material/TuneRounded";
import {
  Alert,
  Box,
  ButtonBase,
  Chip,
  Snackbar,
  Stack,
  Typography,
} from "@mui/material";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { startTransition, useEffect, useState } from "react";
import { describeApiError } from "../../../api/client";
import type { BranchMappingItem, ChainThreshold } from "../../../api/types";
import { useAuth } from "../../../app/providers/AuthProvider";
import { useMonitorStatus } from "../../../app/providers/MonitorStatusProvider";
import {
  emptyBranchThresholdEditor,
  emptyChainEditor,
  normalizeChains,
  resolveEffectiveThresholds,
} from "../../../features/branch-mapping/lib/branchMapping";
import { useBranchMappingState } from "../../../features/branch-mapping/model/useBranchMappingState";
import {
  BranchThresholdOverrideManager,
  type BranchThresholdEditorDraft,
} from "../../../features/settings/BranchThresholdOverrideManager";
import {
  ChainThresholdManager,
  type ChainEditorDraft,
  type DefaultThresholdEditorDraft,
} from "../../../features/settings/ChainThresholdManager";
import {
  branchHasCustomOverride,
  countActiveRules,
  type ThresholdWorkspaceMode,
} from "../../../features/settings/lib/ruleCatalog";
import { TopBar } from "../../../widgets/top-bar/ui/TopBar";

function emptyDefaultThresholdEditor(): DefaultThresholdEditorDraft {
  return {
    lateThreshold: "5",
    lateReopenThreshold: "0",
    unassignedThreshold: "5",
    unassignedReopenThreshold: "0",
    readyThreshold: "0",
    readyReopenThreshold: "0",
  };
}

function metricCardSx(accent: { soft: string; solid: string }) {
  return {
    p: 1.35,
    borderRadius: 3.2,
    border: "1px solid rgba(148,163,184,0.16)",
    bgcolor: "rgba(255,255,255,0.92)",
    boxShadow: "0 18px 38px rgba(15,23,42,0.06)",
    display: "grid",
    gap: 0.7,
    minWidth: 0,
    "& .metric-icon": {
      width: 42,
      height: 42,
      borderRadius: 2.4,
      display: "grid",
      placeItems: "center",
      bgcolor: accent.soft,
      color: accent.solid,
      border: `1px solid ${accent.soft}`,
    },
  };
}

export function ThresholdsPage() {
  const { canManageMonitor, canManageThresholds } = useAuth();
  const { monitoring, startMonitoring, stopMonitoring } = useMonitorStatus();
  const shouldReduceMotion = useReducedMotion();
  const {
    settings,
    branches,
    loadError,
    saveChains: persistThresholdChains,
    saveGlobalThresholds: persistGlobalThresholds,
    saveBranchThresholdOverride: persistBranchThresholdOverride,
  } = useBranchMappingState();

  const [toast, setToast] = useState<{ type: "success" | "error" | "info"; msg: string } | null>(null);
  const [rulesMode, setRulesMode] = useState<ThresholdWorkspaceMode>("chains");
  const [thresholdForm, setThresholdForm] = useState({
    chains: [] as ChainThreshold[],
    lateThreshold: 5,
    lateReopenThreshold: 0,
    unassignedThreshold: 5,
    unassignedReopenThreshold: 0,
    readyThreshold: 0,
    readyReopenThreshold: 0,
  });
  const [defaultEditor, setDefaultEditor] = useState<DefaultThresholdEditorDraft>(emptyDefaultThresholdEditor());
  const [defaultEditorOpen, setDefaultEditorOpen] = useState(false);
  const [chainEditor, setChainEditor] = useState<ChainEditorDraft>(emptyChainEditor());
  const [editingChainIndex, setEditingChainIndex] = useState<number | null>(null);
  const [chainEditorOpen, setChainEditorOpen] = useState(false);
  const [selectedChainName, setSelectedChainName] = useState<string | null>(null);
  const [overrideChainFilter, setOverrideChainFilter] = useState<string>("all");
  const [branchThresholdEditor, setBranchThresholdEditor] = useState<BranchThresholdEditorDraft>(emptyBranchThresholdEditor());
  const [editingThresholdBranchId, setEditingThresholdBranchId] = useState<number | null>(null);
  const [savingThresholdBranchId, setSavingThresholdBranchId] = useState<number | null>(null);

  useEffect(() => {
    if (!settings) return;
    const normalizedChains = normalizeChains(settings.chains);
    setThresholdForm({
      chains: normalizedChains,
      lateThreshold: settings.lateThreshold,
      lateReopenThreshold: settings.lateReopenThreshold ?? 0,
      unassignedThreshold: settings.unassignedThreshold,
      unassignedReopenThreshold: settings.unassignedReopenThreshold ?? 0,
      readyThreshold: settings.readyThreshold ?? 0,
      readyReopenThreshold: settings.readyReopenThreshold ?? 0,
    });
    setDefaultEditor({
      lateThreshold: String(settings.lateThreshold),
      lateReopenThreshold: String(settings.lateReopenThreshold ?? 0),
      unassignedThreshold: String(settings.unassignedThreshold),
      unassignedReopenThreshold: String(settings.unassignedReopenThreshold ?? 0),
      readyThreshold: String(settings.readyThreshold ?? 0),
      readyReopenThreshold: String(settings.readyReopenThreshold ?? 0),
    });
  }, [settings]);

  useEffect(() => {
    if (!thresholdForm.chains.length) {
      setSelectedChainName(null);
      return;
    }

    if (!selectedChainName || !thresholdForm.chains.some((chain) => chain.name === selectedChainName)) {
      setSelectedChainName(thresholdForm.chains[0]?.name ?? null);
    }
  }, [selectedChainName, thresholdForm.chains]);

  const globalThresholds = {
    lateThreshold: Number(thresholdForm.lateThreshold ?? settings?.lateThreshold ?? 5),
    lateReopenThreshold: Number(thresholdForm.lateReopenThreshold ?? settings?.lateReopenThreshold ?? 0),
    unassignedThreshold: Number(thresholdForm.unassignedThreshold ?? settings?.unassignedThreshold ?? 5),
    unassignedReopenThreshold: Number(thresholdForm.unassignedReopenThreshold ?? settings?.unassignedReopenThreshold ?? 0),
    readyThreshold: Number(thresholdForm.readyThreshold ?? settings?.readyThreshold ?? 0),
    readyReopenThreshold: Number(thresholdForm.readyReopenThreshold ?? settings?.readyReopenThreshold ?? 0),
    capacityRuleEnabled: true,
    capacityPerHourEnabled: false,
    capacityPerHourLimit: null,
  };

  const customOverrideCount = branches.filter((branch) => branchHasCustomOverride(branch)).length;
  const activeRuleCount = countActiveRules(thresholdForm.chains, branches, globalThresholds);

  const onStart = async () => {
    if (!canManageMonitor) {
      setToast({ type: "info", msg: "No access" });
      return;
    }

    try {
      await startMonitoring();
      setToast({ type: "success", msg: "Monitoring started" });
    } catch (error) {
      setToast({ type: "error", msg: describeApiError(error, "Failed to start") });
    }
  };

  const onStop = async () => {
    if (!canManageMonitor) {
      setToast({ type: "info", msg: "No access" });
      return;
    }

    try {
      await stopMonitoring();
      setToast({ type: "success", msg: "Monitoring stopped" });
    } catch (error) {
      setToast({ type: "error", msg: describeApiError(error, "Failed to stop") });
    }
  };

  const persistChains = async (nextChains: ChainThreshold[]) => {
    if (!canManageThresholds) {
      setToast({ type: "info", msg: "No access" });
      return;
    }

    try {
      const normalized = await persistThresholdChains(nextChains);
      setThresholdForm((current) => ({ ...current, chains: normalized }));
      setEditingChainIndex(null);
      setChainEditor(emptyChainEditor());
      setChainEditorOpen(false);
      setSelectedChainName(normalized[0]?.name ?? null);
      setToast({ type: "success", msg: "Chains saved" });
    } catch (error) {
      setToast({ type: "error", msg: describeApiError(error, "Chain save failed") });
    }
  };

  const upsertChain = async () => {
    const name = chainEditor.name.trim();
    const lateThreshold = Number(chainEditor.lateThreshold);
    const lateReopenThreshold = Number(chainEditor.lateReopenThreshold);
    const unassignedThreshold = Number(chainEditor.unassignedThreshold);
    const unassignedReopenThreshold = Number(chainEditor.unassignedReopenThreshold);
    const readyThreshold = Number(chainEditor.readyThreshold);
    const readyReopenThreshold = Number(chainEditor.readyReopenThreshold);
    const capacityPerHourLimitRaw = chainEditor.capacityPerHourLimit.trim();
    const capacityPerHourLimit = capacityPerHourLimitRaw ? Number(capacityPerHourLimitRaw) : null;

    if (!name) {
      setToast({ type: "error", msg: "Enter chain name" });
      return;
    }

    if (
      !Number.isFinite(lateThreshold) || lateThreshold < 0
      || !Number.isFinite(lateReopenThreshold) || lateReopenThreshold < 0
      || !Number.isFinite(unassignedThreshold) || unassignedThreshold < 0
      || !Number.isFinite(unassignedReopenThreshold) || unassignedReopenThreshold < 0
      || !Number.isFinite(readyThreshold) || readyThreshold < 0
      || !Number.isFinite(readyReopenThreshold) || readyReopenThreshold < 0
    ) {
      setToast({ type: "error", msg: "Enter valid thresholds" });
      return;
    }

    if (
      lateReopenThreshold > lateThreshold
      || unassignedReopenThreshold > unassignedThreshold
      || readyReopenThreshold > readyThreshold
    ) {
      setToast({ type: "error", msg: "Reopen thresholds must be less than or equal to close thresholds" });
      return;
    }

    if (
      capacityPerHourLimit != null &&
      (!Number.isFinite(capacityPerHourLimit) || capacityPerHourLimit < 1)
    ) {
      setToast({ type: "error", msg: "Enter a valid Capacity / Hour limit" });
      return;
    }

    if (chainEditor.capacityPerHourEnabled && capacityPerHourLimit == null) {
      setToast({ type: "error", msg: "Enter Capacity / Hour limit before enabling it" });
      return;
    }

    const nextChains = normalizeChains(thresholdForm.chains.filter((_item, index) => index !== editingChainIndex))
      .filter((item) => item.name.trim().toLowerCase() !== name.toLowerCase());
    nextChains.push({
      name,
      lateThreshold: Math.round(lateThreshold),
      lateReopenThreshold: Math.round(lateReopenThreshold),
      unassignedThreshold: Math.round(unassignedThreshold),
      unassignedReopenThreshold: Math.round(unassignedReopenThreshold),
      readyThreshold: Math.round(readyThreshold),
      readyReopenThreshold: Math.round(readyReopenThreshold),
      capacityRuleEnabled: chainEditor.capacityRuleEnabled,
      capacityPerHourEnabled: chainEditor.capacityPerHourEnabled,
      capacityPerHourLimit: capacityPerHourLimit == null ? null : Math.round(capacityPerHourLimit),
    });
    await persistChains(nextChains);
    setSelectedChainName(name);
  };

  const openDefaultsEditor = () => {
    setDefaultEditor({
      lateThreshold: String(thresholdForm.lateThreshold),
      lateReopenThreshold: String(thresholdForm.lateReopenThreshold),
      unassignedThreshold: String(thresholdForm.unassignedThreshold),
      unassignedReopenThreshold: String(thresholdForm.unassignedReopenThreshold),
      readyThreshold: String(thresholdForm.readyThreshold),
      readyReopenThreshold: String(thresholdForm.readyReopenThreshold),
    });
    setDefaultEditorOpen(true);
  };

  const closeDefaultsEditor = () => {
    setDefaultEditorOpen(false);
  };

  const saveGlobalThresholds = async () => {
    const lateThreshold = Number(defaultEditor.lateThreshold);
    const lateReopenThreshold = Number(defaultEditor.lateReopenThreshold);
    const unassignedThreshold = Number(defaultEditor.unassignedThreshold);
    const unassignedReopenThreshold = Number(defaultEditor.unassignedReopenThreshold);
    const readyThreshold = Number(defaultEditor.readyThreshold);
    const readyReopenThreshold = Number(defaultEditor.readyReopenThreshold);

    if (!canManageThresholds) {
      setToast({ type: "info", msg: "No access" });
      return;
    }

    if (
      !Number.isFinite(lateThreshold) || lateThreshold < 0
      || !Number.isFinite(lateReopenThreshold) || lateReopenThreshold < 0
      || !Number.isFinite(unassignedThreshold) || unassignedThreshold < 0
      || !Number.isFinite(unassignedReopenThreshold) || unassignedReopenThreshold < 0
      || !Number.isFinite(readyThreshold) || readyThreshold < 0
      || !Number.isFinite(readyReopenThreshold) || readyReopenThreshold < 0
    ) {
      setToast({ type: "error", msg: "Enter valid thresholds" });
      return;
    }

    if (
      lateReopenThreshold > lateThreshold
      || unassignedReopenThreshold > unassignedThreshold
      || readyReopenThreshold > readyThreshold
    ) {
      setToast({ type: "error", msg: "Reopen thresholds must be less than or equal to close thresholds" });
      return;
    }

    try {
      await persistGlobalThresholds(
        lateThreshold,
        lateReopenThreshold,
        unassignedThreshold,
        unassignedReopenThreshold,
        readyThreshold,
        readyReopenThreshold,
      );
      setThresholdForm((current) => ({
        ...current,
        lateThreshold,
        lateReopenThreshold,
        unassignedThreshold,
        unassignedReopenThreshold,
        readyThreshold,
        readyReopenThreshold,
      }));
      setDefaultEditorOpen(false);
      setToast({ type: "success", msg: "Defaults saved" });
    } catch (error) {
      setToast({ type: "error", msg: describeApiError(error, "Default threshold save failed") });
    }
  };

  const startChainEdit = (chain: ChainThreshold, index: number) => {
    setEditingChainIndex(index);
    setChainEditor({
      name: chain.name,
      lateThreshold: String(chain.lateThreshold),
      lateReopenThreshold: String(chain.lateReopenThreshold ?? 0),
      unassignedThreshold: String(chain.unassignedThreshold),
      unassignedReopenThreshold: String(chain.unassignedReopenThreshold ?? 0),
      readyThreshold: String(chain.readyThreshold ?? 0),
      readyReopenThreshold: String(chain.readyReopenThreshold ?? 0),
      capacityRuleEnabled: chain.capacityRuleEnabled !== false,
      capacityPerHourEnabled: chain.capacityPerHourEnabled === true,
      capacityPerHourLimit: chain.capacityPerHourLimit == null ? "" : String(chain.capacityPerHourLimit),
    });
    setChainEditorOpen(true);
  };

  const startNewChainEdit = () => {
    setEditingChainIndex(null);
    setChainEditor(emptyChainEditor());
    setChainEditorOpen(true);
  };

  const cancelChainEdit = () => {
    setEditingChainIndex(null);
    setChainEditor(emptyChainEditor());
    setChainEditorOpen(false);
  };

  const startBranchThresholdEdit = (branch: BranchMappingItem) => {
    const effective = resolveEffectiveThresholds(branch, thresholdForm.chains, globalThresholds);
    setEditingThresholdBranchId(branch.id);
    setBranchThresholdEditor({
      lateThreshold: branch.lateThresholdOverride == null ? "" : String(branch.lateThresholdOverride),
      lateReopenThreshold: branch.lateReopenThresholdOverride == null ? "" : String(branch.lateReopenThresholdOverride),
      unassignedThreshold: branch.unassignedThresholdOverride == null ? "" : String(branch.unassignedThresholdOverride),
      unassignedReopenThreshold: branch.unassignedReopenThresholdOverride == null ? "" : String(branch.unassignedReopenThresholdOverride),
      readyThreshold: branch.readyThresholdOverride == null ? "" : String(branch.readyThresholdOverride),
      readyReopenThreshold: branch.readyReopenThresholdOverride == null ? "" : String(branch.readyReopenThresholdOverride),
      capacityRuleEnabled: branch.capacityRuleEnabledOverride ?? (effective.capacityRuleEnabled !== false),
      capacityPerHourEnabled: branch.capacityPerHourEnabledOverride ?? (effective.capacityPerHourEnabled === true),
      capacityPerHourLimit:
        branch.capacityPerHourLimitOverride != null
          ? String(branch.capacityPerHourLimitOverride)
          : effective.capacityPerHourLimit != null
            ? String(effective.capacityPerHourLimit)
            : "",
    });
    startTransition(() => setRulesMode("overrides"));
  };

  const saveBranchThresholdOverride = async (branch: BranchMappingItem) => {
    if (!canManageThresholds) {
      setToast({ type: "info", msg: "No access" });
      return;
    }

    const lateThresholdRaw = branchThresholdEditor.lateThreshold.trim();
    const lateReopenThresholdRaw = branchThresholdEditor.lateReopenThreshold.trim();
    const unassignedThresholdRaw = branchThresholdEditor.unassignedThreshold.trim();
    const unassignedReopenThresholdRaw = branchThresholdEditor.unassignedReopenThreshold.trim();
    const readyThresholdRaw = branchThresholdEditor.readyThreshold.trim();
    const readyReopenThresholdRaw = branchThresholdEditor.readyReopenThreshold.trim();
    const capacityPerHourLimitRaw = branchThresholdEditor.capacityPerHourLimit.trim();
    const hasLateThreshold = lateThresholdRaw.length > 0;
    const hasLateReopenThreshold = lateReopenThresholdRaw.length > 0;
    const hasUnassignedThreshold = unassignedThresholdRaw.length > 0;
    const hasUnassignedReopenThreshold = unassignedReopenThresholdRaw.length > 0;
    const hasReadyThreshold = readyThresholdRaw.length > 0;
    const hasReadyReopenThreshold = readyReopenThresholdRaw.length > 0;
    const hasCapacityPerHourLimit = capacityPerHourLimitRaw.length > 0;

    if (hasLateThreshold !== hasUnassignedThreshold) {
      setToast({ type: "error", msg: "Enter both branch thresholds or leave both inherited" });
      return;
    }

    const lateThreshold = hasLateThreshold ? Number(lateThresholdRaw) : null;
    const lateReopenThreshold = hasLateReopenThreshold ? Number(lateReopenThresholdRaw) : null;
    const unassignedThreshold = hasUnassignedThreshold ? Number(unassignedThresholdRaw) : null;
    const unassignedReopenThreshold = hasUnassignedReopenThreshold ? Number(unassignedReopenThresholdRaw) : null;
    const readyThreshold = hasReadyThreshold ? Number(readyThresholdRaw) : null;
    const readyReopenThreshold = hasReadyReopenThreshold ? Number(readyReopenThresholdRaw) : null;
    const capacityPerHourLimit = hasCapacityPerHourLimit ? Number(capacityPerHourLimitRaw) : null;

    if (
      (lateThreshold != null && (!Number.isFinite(lateThreshold) || lateThreshold < 0))
      || (lateReopenThreshold != null && (!Number.isFinite(lateReopenThreshold) || lateReopenThreshold < 0))
      || (unassignedThreshold != null && (!Number.isFinite(unassignedThreshold) || unassignedThreshold < 0))
      || (unassignedReopenThreshold != null && (!Number.isFinite(unassignedReopenThreshold) || unassignedReopenThreshold < 0))
      || (readyThreshold != null && (!Number.isFinite(readyThreshold) || readyThreshold < 0))
      || (readyReopenThreshold != null && (!Number.isFinite(readyReopenThreshold) || readyReopenThreshold < 0))
    ) {
      setToast({ type: "error", msg: "Enter valid branch thresholds" });
      return;
    }

    if (
      capacityPerHourLimit != null &&
      (!Number.isFinite(capacityPerHourLimit) || capacityPerHourLimit < 1)
    ) {
      setToast({ type: "error", msg: "Enter a valid Capacity / Hour limit" });
      return;
    }

    const inherited = resolveEffectiveThresholds(
      {
        ...branch,
        readyThresholdOverride: null,
        readyReopenThresholdOverride: null,
        lateReopenThresholdOverride: null,
        unassignedReopenThresholdOverride: null,
        capacityRuleEnabledOverride: null,
        capacityPerHourEnabledOverride: null,
        capacityPerHourLimitOverride: null,
      },
      thresholdForm.chains,
      globalThresholds,
    );
    const nextLateThreshold = lateThreshold == null ? inherited.lateThreshold ?? 0 : Math.round(lateThreshold);
    const nextLateReopenThreshold = lateReopenThreshold == null ? inherited.lateReopenThreshold ?? 0 : Math.round(lateReopenThreshold);
    const nextUnassignedThreshold = unassignedThreshold == null ? inherited.unassignedThreshold ?? 0 : Math.round(unassignedThreshold);
    const nextUnassignedReopenThreshold =
      unassignedReopenThreshold == null
        ? inherited.unassignedReopenThreshold ?? 0
        : Math.round(unassignedReopenThreshold);
    const nextReadyThreshold = readyThreshold == null ? inherited.readyThreshold ?? 0 : Math.round(readyThreshold);
    const nextReadyReopenThreshold =
      readyReopenThreshold == null
        ? inherited.readyReopenThreshold ?? 0
        : Math.round(readyReopenThreshold);

    if (
      nextLateReopenThreshold > nextLateThreshold
      || nextUnassignedReopenThreshold > nextUnassignedThreshold
      || nextReadyReopenThreshold > nextReadyThreshold
    ) {
      setToast({ type: "error", msg: "Reopen thresholds must be less than or equal to close thresholds" });
      return;
    }

    const capacityRuleEnabledOverride =
      branchThresholdEditor.capacityRuleEnabled === (inherited.capacityRuleEnabled !== false)
        ? null
        : branchThresholdEditor.capacityRuleEnabled;
    const inheritedCapacityPerHourEnabled = inherited.capacityPerHourEnabled === true;
    const inheritedCapacityPerHourLimit = inherited.capacityPerHourLimit ?? null;
    const hourlyMatchesInherited =
      branchThresholdEditor.capacityPerHourEnabled === inheritedCapacityPerHourEnabled
      && (
        (capacityPerHourLimit == null && inheritedCapacityPerHourLimit == null)
        || (capacityPerHourLimit != null && inheritedCapacityPerHourLimit != null && Math.round(capacityPerHourLimit) === inheritedCapacityPerHourLimit)
      );
    const needsCustomHourlyOverride = !hourlyMatchesInherited;

    if (needsCustomHourlyOverride && capacityPerHourLimit == null) {
      setToast({ type: "error", msg: "Enter Capacity / Hour limit or use inherited" });
      return;
    }

    const capacityPerHourEnabledOverride = needsCustomHourlyOverride
      ? branchThresholdEditor.capacityPerHourEnabled
      : null;
    const capacityPerHourLimitOverride = needsCustomHourlyOverride && capacityPerHourLimit != null
      ? Math.round(capacityPerHourLimit)
      : null;

    try {
      setSavingThresholdBranchId(branch.id);
      await persistBranchThresholdOverride(
        branch.id,
        lateThreshold == null ? null : Math.round(lateThreshold),
        lateReopenThreshold == null ? null : Math.round(lateReopenThreshold),
        unassignedThreshold == null ? null : Math.round(unassignedThreshold),
        unassignedReopenThreshold == null ? null : Math.round(unassignedReopenThreshold),
        readyThreshold == null ? null : Math.round(readyThreshold),
        readyReopenThreshold == null ? null : Math.round(readyReopenThreshold),
        capacityRuleEnabledOverride,
        capacityPerHourEnabledOverride,
        capacityPerHourLimitOverride,
      );
      setEditingThresholdBranchId(null);
      setBranchThresholdEditor(emptyBranchThresholdEditor());
      setToast({ type: "success", msg: "Override saved" });
    } catch (error) {
      setToast({ type: "error", msg: describeApiError(error, "Branch override save failed") });
    } finally {
      setSavingThresholdBranchId(null);
    }
  };

  const clearBranchThresholdOverride = async (branch: BranchMappingItem) => {
    if (!canManageThresholds) {
      setToast({ type: "info", msg: "No access" });
      return;
    }

    try {
      setSavingThresholdBranchId(branch.id);
      await persistBranchThresholdOverride(branch.id, null, null, null, null, null, null, null, null, null);
      setEditingThresholdBranchId(null);
      setBranchThresholdEditor(emptyBranchThresholdEditor());
      setToast({ type: "success", msg: "Using inherited thresholds" });
    } catch (error) {
      setToast({ type: "error", msg: describeApiError(error, "Branch override reset failed") });
    } finally {
      setSavingThresholdBranchId(null);
    }
  };

  const modeCards: Array<{
    value: ThresholdWorkspaceMode;
    label: string;
    caption: string;
    icon: JSX.Element;
  }> = [
    {
      value: "chains",
      label: "Chains Studio",
      caption: "Design reusable rule workspaces for chain-level profiles.",
      icon: <AccountTreeRoundedIcon sx={{ fontSize: 22 }} />,
    },
    {
      value: "overrides",
      label: "Overrides Studio",
      caption: "Drill into branches, inspect effective rules, and override only what is necessary.",
      icon: <TuneRoundedIcon sx={{ fontSize: 22 }} />,
    },
  ];

  return (
    <Box
      sx={{
        minHeight: "100vh",
        background:
          "radial-gradient(circle at top left, rgba(59,130,246,0.08), transparent 24%), radial-gradient(circle at top right, rgba(99,102,241,0.08), transparent 22%), #f7f8fa",
      }}
    >
      <TopBar
        running={monitoring.running}
        degraded={monitoring.degraded}
        onStart={onStart}
        onStop={onStop}
        canControlMonitor={canManageMonitor}
      />

      <Box sx={{ p: { xs: 2, md: 3 }, display: "grid", gap: 2 }}>
        {loadError ? <Alert severity="error" variant="outlined">{loadError}</Alert> : null}
        {!canManageThresholds ? (
          <Alert severity="info" variant="outlined" sx={{ borderRadius: 3 }}>
            You can review thresholds, but editing actions are disabled for your role.
          </Alert>
        ) : null}

        <Box
          sx={{
            p: { xs: 1.7, md: 2.2 },
            borderRadius: 4,
            border: "1px solid rgba(148,163,184,0.16)",
            background:
              "linear-gradient(135deg, rgba(255,255,255,0.95), rgba(239,246,255,0.92) 45%, rgba(238,242,255,0.95) 100%)",
            boxShadow: "0 28px 54px rgba(15,23,42,0.08)",
          }}
        >
          <Stack spacing={1.55}>
            <Stack
              direction={{ xs: "column", xl: "row" }}
              spacing={1.35}
              alignItems={{ xs: "flex-start", xl: "center" }}
              justifyContent="space-between"
            >
              <Box>
                <Stack direction="row" spacing={1} alignItems="center">
                  <Box
                    sx={{
                      width: 46,
                      height: 46,
                      borderRadius: 2.8,
                      display: "grid",
                      placeItems: "center",
                      bgcolor: "rgba(99,102,241,0.14)",
                      color: "#4338ca",
                    }}
                  >
                    <AutoAwesomeRoundedIcon sx={{ fontSize: 23 }} />
                  </Box>
                  <Box>
                    <Typography variant="h5" sx={{ fontWeight: 900, color: "#0f172a" }}>
                      Rule Control Studio
                    </Typography>
                    <Typography variant="body2" sx={{ color: "#475569", maxWidth: 760 }}>
                      A redesigned threshold workspace built for larger rule sets, faster navigation, and clearer control over chain profiles and branch overrides.
                    </Typography>
                  </Box>
                </Stack>
              </Box>

              <Stack direction="row" spacing={0.8} flexWrap="wrap">
                <Chip
                  size="medium"
                  label={rulesMode === "chains" ? "Chain design mode" : "Branch override mode"}
                  sx={{ fontWeight: 900, bgcolor: "rgba(15,23,42,0.06)", color: "#0f172a" }}
                />
                {overrideChainFilter !== "all" ? (
                  <Chip
                    size="medium"
                    label={`Override filter: ${overrideChainFilter === "__no_chain__" ? "No Chain" : overrideChainFilter}`}
                    sx={{ fontWeight: 900, bgcolor: "rgba(14,165,233,0.1)", color: "#0369a1" }}
                  />
                ) : null}
              </Stack>
            </Stack>

            <Box
              sx={{
                display: "grid",
                gap: 1,
                gridTemplateColumns: { xs: "1fr", md: "repeat(3, minmax(0, 1fr))" },
              }}
            >
              <Box sx={metricCardSx({ soft: "rgba(29,78,216,0.14)", solid: "#1d4ed8" })}>
                <Box className="metric-icon">
                  <LayersRoundedIcon sx={{ fontSize: 22 }} />
                </Box>
                <Typography variant="caption" sx={{ color: "#64748b" }}>
                  Chains
                </Typography>
                <Typography sx={{ fontSize: 28, fontWeight: 900, color: "#0f172a", lineHeight: 1 }}>
                  {thresholdForm.chains.length}
                </Typography>
                <Typography variant="caption" sx={{ color: "#64748b" }}>
                  Reusable workspaces ready for branch inheritance.
                </Typography>
              </Box>

              <Box sx={metricCardSx({ soft: "rgba(14,165,233,0.14)", solid: "#0369a1" })}>
                <Box className="metric-icon">
                  <TuneRoundedIcon sx={{ fontSize: 22 }} />
                </Box>
                <Typography variant="caption" sx={{ color: "#64748b" }}>
                  Custom Overrides
                </Typography>
                <Typography sx={{ fontSize: 28, fontWeight: 900, color: "#0f172a", lineHeight: 1 }}>
                  {customOverrideCount}
                </Typography>
                <Typography variant="caption" sx={{ color: "#64748b" }}>
                  Branches already tuned away from inherited values.
                </Typography>
              </Box>

              <Box sx={metricCardSx({ soft: "rgba(16,185,129,0.14)", solid: "#047857" })}>
                <Box className="metric-icon">
                  <StorefrontRoundedIcon sx={{ fontSize: 22 }} />
                </Box>
                <Typography variant="caption" sx={{ color: "#64748b" }}>
                  Active Rules
                </Typography>
                <Typography sx={{ fontSize: 28, fontWeight: 900, color: "#0f172a", lineHeight: 1 }}>
                  {activeRuleCount}
                </Typography>
                <Typography variant="caption" sx={{ color: "#64748b" }}>
                  Rule types currently configured across this workspace.
                </Typography>
              </Box>
            </Box>

            <Box
              sx={{
                p: 0.55,
                borderRadius: 999,
                border: "1px solid rgba(148,163,184,0.16)",
                bgcolor: "rgba(248,250,252,0.84)",
                boxShadow: "inset 0 1px 0 rgba(255,255,255,0.82), 0 14px 28px rgba(15,23,42,0.05)",
              }}
            >
              <Stack direction={{ xs: "column", md: "row" }} spacing={0.8}>
                {modeCards.map((item) => {
                  const active = rulesMode === item.value;
                  return (
                    <ButtonBase
                      key={item.value}
                      onClick={() => startTransition(() => setRulesMode(item.value))}
                      aria-label={item.label}
                      sx={{
                        flex: 1,
                        borderRadius: 999,
                        textAlign: "left",
                      }}
                    >
                      <Box
                        sx={{
                          width: "100%",
                          px: 1.35,
                          py: 1.05,
                          borderRadius: 999,
                          border: active ? "1px solid rgba(79,70,229,0.18)" : "1px solid transparent",
                          background: active
                            ? "linear-gradient(135deg, rgba(79,70,229,0.18), rgba(255,255,255,0.98) 55%, rgba(224,231,255,0.9) 100%)"
                            : "transparent",
                          boxShadow: active ? "0 18px 32px rgba(79,70,229,0.14)" : "none",
                          transition: "transform 180ms ease, box-shadow 180ms ease, border-color 180ms ease",
                          "&:hover": {
                            transform: "translateY(-1px)",
                            boxShadow: active ? "0 18px 32px rgba(79,70,229,0.14)" : "0 12px 24px rgba(15,23,42,0.06)",
                          },
                        }}
                      >
                        <Stack direction="row" spacing={1} alignItems="center">
                          <Box
                            sx={{
                              width: 38,
                              height: 38,
                              borderRadius: 2.2,
                              display: "grid",
                              placeItems: "center",
                              bgcolor: active ? "rgba(79,70,229,0.16)" : "rgba(15,23,42,0.06)",
                              color: active ? "#4338ca" : "#475569",
                              flexShrink: 0,
                            }}
                          >
                            {item.icon}
                          </Box>
                          <Box sx={{ minWidth: 0 }}>
                            <Typography sx={{ fontWeight: 900, color: "#0f172a" }}>
                              {item.label}
                            </Typography>
                            <Typography variant="caption" sx={{ color: "#64748b", display: "block" }}>
                              {item.caption}
                            </Typography>
                          </Box>
                        </Stack>
                      </Box>
                    </ButtonBase>
                  );
                })}
              </Stack>
            </Box>
          </Stack>
        </Box>

        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={rulesMode}
            initial={shouldReduceMotion ? false : { opacity: 0, y: 14, scale: 0.985, filter: "blur(6px)" }}
            animate={shouldReduceMotion ? { opacity: 1 } : { opacity: 1, y: 0, scale: 1, filter: "blur(0px)" }}
            exit={shouldReduceMotion ? { opacity: 0 } : { opacity: 0, y: -10, scale: 0.985, filter: "blur(6px)" }}
            transition={{ duration: shouldReduceMotion ? 0 : 0.26, ease: [0.22, 1, 0.36, 1] }}
          >
            {rulesMode === "chains" ? (
              <ChainThresholdManager
                chains={thresholdForm.chains}
                globalThresholds={globalThresholds}
                selectedChainName={selectedChainName}
                editingChainIndex={editingChainIndex}
                chainEditor={chainEditor}
                chainEditorOpen={chainEditorOpen}
                defaultEditor={defaultEditor}
                defaultEditorOpen={defaultEditorOpen}
                readOnly={!canManageThresholds}
                onSelectChain={setSelectedChainName}
                onChangeDefaultEditor={(patch) => setDefaultEditor((current) => ({ ...current, ...patch }))}
                onOpenDefaults={openDefaultsEditor}
                onCloseDefaults={closeDefaultsEditor}
                onSaveDefaults={() => void saveGlobalThresholds()}
                onChangeEditor={(patch) => setChainEditor((current) => ({ ...current, ...patch }))}
                onOpenNewChain={startNewChainEdit}
                onEditChain={startChainEdit}
                onRemoveChain={(index) => void persistChains(thresholdForm.chains.filter((_item, itemIndex) => itemIndex !== index))}
                onSaveChain={() => void upsertChain()}
                onCancelEdit={cancelChainEdit}
                onOpenOverrides={(chainName) => {
                  startTransition(() => {
                    setOverrideChainFilter(chainName);
                    setRulesMode("overrides");
                  });
                }}
              />
            ) : (
              <BranchThresholdOverrideManager
                branches={branches}
                chains={thresholdForm.chains}
                globalThresholds={globalThresholds}
                chainFilter={overrideChainFilter}
                onChainFilterChange={setOverrideChainFilter}
                editingBranchId={editingThresholdBranchId}
                branchEditor={branchThresholdEditor}
                savingBranchId={savingThresholdBranchId}
                readOnly={!canManageThresholds}
                onEditBranch={startBranchThresholdEdit}
                onChangeEditor={(patch) => setBranchThresholdEditor((current) => ({ ...current, ...patch }))}
                onSaveBranch={(branch) => void saveBranchThresholdOverride(branch)}
                onClearBranchOverride={(branch) => void clearBranchThresholdOverride(branch)}
                onCancelEdit={() => {
                  setEditingThresholdBranchId(null);
                  setBranchThresholdEditor(emptyBranchThresholdEditor());
                }}
              />
            )}
          </motion.div>
        </AnimatePresence>
      </Box>

      <Snackbar
        open={!!toast}
        autoHideDuration={2500}
        onClose={() => setToast(null)}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
      >
        {toast ? <Alert severity={toast.type}>{toast.msg}</Alert> : undefined}
      </Snackbar>
    </Box>
  );
}
