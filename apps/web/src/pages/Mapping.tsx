import AddRoundedIcon from "@mui/icons-material/AddRounded";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import ExpandMoreRoundedIcon from "@mui/icons-material/ExpandMoreRounded";
import RefreshRoundedIcon from "@mui/icons-material/RefreshRounded";
import SearchRoundedIcon from "@mui/icons-material/SearchRounded";
import WarningAmberRoundedIcon from "@mui/icons-material/WarningAmberRounded";
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Collapse,
  CircularProgress,
  Container,
  IconButton,
  InputAdornment,
  MenuItem,
  Snackbar,
  Stack,
  Switch,
  Tab,
  Tabs,
  TextField,
  Typography,
  useMediaQuery,
  useTheme,
} from "@mui/material";
import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { api, describeApiError } from "../api/client";
import type {
  BranchCatalogItem,
  BranchCatalogResponse,
  BranchMappingItem,
  ChainThreshold,
  SettingsMasked,
  ThresholdProfile,
} from "../api/types";
import { useAuth } from "../app/providers/AuthProvider";
import { useMonitorStatus } from "../app/providers/MonitorStatusProvider";
import { TopBar } from "../components/TopBar";
import { BranchThresholdOverrideManager, type BranchThresholdEditorDraft } from "../features/settings/BranchThresholdOverrideManager";
import { ChainThresholdManager, type ChainEditorDraft } from "../features/settings/ChainThresholdManager";

function normalizeChains(chains: ChainThreshold[]) {
  const seen = new Set<string>();
  const out: ChainThreshold[] = [];

  for (const chain of chains) {
    const name = chain.name.trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      name,
      lateThreshold: Math.max(0, Math.round(chain.lateThreshold)),
      unassignedThreshold: Math.max(0, Math.round(chain.unassignedThreshold)),
    });
  }

  return out.sort((a, b) => a.name.localeCompare(b.name));
}

function emptyChainEditor() {
  return { name: "", lateThreshold: "5", unassignedThreshold: "5" };
}

function emptyBranchThresholdEditor() {
  return { lateThreshold: "", unassignedThreshold: "" };
}

function emptyCatalogResponse(): BranchCatalogResponse {
  return {
    items: [],
    syncState: "stale",
    lastSyncedAt: null,
    lastError: null,
  };
}

function resolveEffectiveThresholds(
  branch: BranchMappingItem,
  chains: ChainThreshold[],
  globalThresholds: Pick<ThresholdProfile, "lateThreshold" | "unassignedThreshold">,
) {
  if (typeof branch.lateThresholdOverride === "number" && typeof branch.unassignedThresholdOverride === "number") {
    return {
      lateThreshold: branch.lateThresholdOverride,
      unassignedThreshold: branch.unassignedThresholdOverride,
      source: "branch" as const,
    };
  }

  const chainKey = branch.chainName.trim().toLowerCase();
  const chain = chains.find((item) => item.name.trim().toLowerCase() === chainKey);
  if (chain) {
    return {
      lateThreshold: chain.lateThreshold,
      unassignedThreshold: chain.unassignedThreshold,
      source: "chain" as const,
    };
  }

  return {
    lateThreshold: globalThresholds.lateThreshold,
    unassignedThreshold: globalThresholds.unassignedThreshold,
    source: "global" as const,
  };
}

function sourceTone(source: ThresholdProfile["source"] | "branch" | "chain" | "global") {
  if (source === "branch") return { bg: "rgba(14,165,233,0.10)", color: "#0369a1" };
  if (source === "chain") return { bg: "rgba(15,23,42,0.06)", color: "#334155" };
  return { bg: "rgba(148,163,184,0.12)", color: "#475569" };
}

function sectionCardSx() {
  return {
    borderRadius: 4,
    border: "1px solid rgba(148,163,184,0.14)",
    boxShadow: "0 18px 40px rgba(15,23,42,0.06)",
  };
}

function formatSyncTime(value: string | null) {
  if (!value) return "No sync yet";
  return new Date(value).toLocaleString([], {
    hour: "2-digit",
    minute: "2-digit",
    month: "short",
    day: "numeric",
  });
}

function scoreCatalogItem(item: BranchCatalogItem, query: string) {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) return 100;
  const name = item.name?.trim().toLowerCase() ?? "";
  const availabilityId = item.availabilityVendorId.toLowerCase();
  const ordersId = item.ordersVendorId ? String(item.ordersVendorId) : "";

  if (availabilityId === normalizedQuery || ordersId === normalizedQuery) return 0;
  if (name === normalizedQuery) return 1;
  if (name.startsWith(normalizedQuery)) return 2;
  if (availabilityId.startsWith(normalizedQuery) || ordersId.startsWith(normalizedQuery)) return 3;
  if (name.includes(normalizedQuery)) return 4;
  if (availabilityId.includes(normalizedQuery) || ordersId.includes(normalizedQuery)) return 5;
  return 100;
}

function matchesBranchQuery(branch: BranchMappingItem, query: string) {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) return true;
  return branch.name.toLowerCase().includes(normalizedQuery)
    || branch.chainName.toLowerCase().includes(normalizedQuery)
    || branch.availabilityVendorId.toLowerCase().includes(normalizedQuery)
    || String(branch.ordersVendorId).includes(normalizedQuery);
}

export function Mapping() {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("sm"));
  const { canManageBranches, canDeleteBranches, canManageMonitor, canManageSettings } = useAuth();
  const { monitoring, startMonitoring, stopMonitoring } = useMonitorStatus();

  const [settings, setSettings] = useState<SettingsMasked | null>(null);
  const [branches, setBranches] = useState<BranchMappingItem[]>([]);
  const [catalog, setCatalog] = useState<BranchCatalogResponse>(emptyCatalogResponse());
  const [loadError, setLoadError] = useState<string | null>(null);
  const [toast, setToast] = useState<{ type: "success" | "error" | "info"; msg: string } | null>(null);
  const [rulesMode, setRulesMode] = useState<"chains" | "overrides">("chains");
  const [thresholdForm, setThresholdForm] = useState({
    chains: [] as ChainThreshold[],
    lateThreshold: 5,
    unassignedThreshold: 5,
  });
  const [chainEditor, setChainEditor] = useState<ChainEditorDraft>(emptyChainEditor());
  const [editingChainIndex, setEditingChainIndex] = useState<number | null>(null);
  const [branchThresholdEditor, setBranchThresholdEditor] = useState<BranchThresholdEditorDraft>(emptyBranchThresholdEditor());
  const [editingThresholdBranchId, setEditingThresholdBranchId] = useState<number | null>(null);
  const [savingThresholdBranchId, setSavingThresholdBranchId] = useState<number | null>(null);
  const [savingMonitorBranchId, setSavingMonitorBranchId] = useState<number | null>(null);
  const [refreshingCatalog, setRefreshingCatalog] = useState(false);
  const [addingBranch, setAddingBranch] = useState(false);
  const [mobileStudioSection, setMobileStudioSection] = useState<"branches" | "catalog">("branches");
  const [mobileRulesSection, setMobileRulesSection] = useState<"base" | "rules">("rules");
  const [savedBranchSections, setSavedBranchSections] = useState({
    missing: false,
    paused: false,
    monitor: false,
  });
  const [branchQuery, setBranchQuery] = useState("");
  const [catalogQuery, setCatalogQuery] = useState("");
  const [selectedAvailabilityVendorId, setSelectedAvailabilityVendorId] = useState<string | null>(null);
  const [selectedChainName, setSelectedChainName] = useState("");
  const deferredCatalogQuery = useDeferredValue(catalogQuery);

  const applySettings = (nextSettings: SettingsMasked) => {
    const normalizedChains = normalizeChains(nextSettings.chains);
    setSettings(nextSettings);
    setThresholdForm({
      chains: normalizedChains,
      lateThreshold: nextSettings.lateThreshold,
      unassignedThreshold: nextSettings.unassignedThreshold,
    });
  };

  const loadMappingData = async (options?: { silent?: boolean }) => {
    const results = await Promise.allSettled([api.getSettings(), api.listBranches(), api.branchCatalog()]);
    const [settingsResult, branchesResult, catalogResult] = results;

    if (settingsResult.status === "rejected" || branchesResult.status === "rejected") {
      const failureReason = settingsResult.status === "rejected"
        ? settingsResult.reason
        : (branchesResult as PromiseRejectedResult).reason;
      const message = describeApiError(failureReason, "Failed to load branch management");
      setLoadError(message);
      if (!options?.silent) setToast({ type: "error", msg: message });
      return;
    }

    applySettings(settingsResult.value);
    setBranches(branchesResult.value.items);
    setLoadError(null);

    if (catalogResult.status === "fulfilled") {
      setCatalog(catalogResult.value);
    } else {
      const message = describeApiError(catalogResult.reason, "Branch catalog failed to load");
      setCatalog((current) => ({ ...current, syncState: "error", lastError: message }));
      if (!options?.silent) setToast({ type: "error", msg: message });
    }
  };

  useEffect(() => {
    void loadMappingData();
  }, []);

  const globalThresholds = {
    lateThreshold: Number(thresholdForm.lateThreshold ?? settings?.lateThreshold ?? 5),
    unassignedThreshold: Number(thresholdForm.unassignedThreshold ?? settings?.unassignedThreshold ?? 5),
  };

  const sourceByAvailabilityVendorId = useMemo(
    () => new Map(catalog.items.map((item) => [item.availabilityVendorId, item] as const)),
    [catalog.items],
  );

  const selectedCatalogItem = useMemo(
    () => catalog.items.find((item) => item.availabilityVendorId === selectedAvailabilityVendorId) ?? null,
    [catalog.items, selectedAvailabilityVendorId],
  );

  useEffect(() => {
    if (!selectedAvailabilityVendorId) return;
    if (!catalog.items.some((item) => item.availabilityVendorId === selectedAvailabilityVendorId)) {
      setSelectedAvailabilityVendorId(null);
    }
  }, [catalog.items, selectedAvailabilityVendorId]);

  const filteredBranches = useMemo(
    () => branches.filter((branch) => matchesBranchQuery(branch, branchQuery)),
    [branchQuery, branches],
  );
  const monitoredBranches = useMemo(
    () => filteredBranches.filter((branch) => branch.enabled && (sourceByAvailabilityVendorId.get(branch.availabilityVendorId)?.presentInSource ?? true)),
    [filteredBranches, sourceByAvailabilityVendorId],
  );
  const pausedBranches = useMemo(
    () => filteredBranches.filter((branch) => !branch.enabled && (sourceByAvailabilityVendorId.get(branch.availabilityVendorId)?.presentInSource ?? true)),
    [filteredBranches, sourceByAvailabilityVendorId],
  );
  const missingSourceBranches = useMemo(
    () => filteredBranches.filter((branch) => sourceByAvailabilityVendorId.get(branch.availabilityVendorId)?.presentInSource === false),
    [filteredBranches, sourceByAvailabilityVendorId],
  );

  const catalogSearchResults = useMemo(() => {
    const query = deferredCatalogQuery.trim();
    if (!query) return [];

    const rows = catalog.items.filter((item) => scoreCatalogItem(item, query) < 100);

    return [...rows]
      .sort((left, right) => {
        const leftScore = query ? scoreCatalogItem(left, query) : 100;
        const rightScore = query ? scoreCatalogItem(right, query) : 100;
        if (leftScore !== rightScore) return leftScore - rightScore;
        if (left.alreadyAdded !== right.alreadyAdded) return left.alreadyAdded ? 1 : -1;
        if (left.presentInSource !== right.presentInSource) return left.presentInSource ? -1 : 1;
        return (left.name ?? left.availabilityVendorId).localeCompare(right.name ?? right.availabilityVendorId);
      })
      .slice(0, 60);
  }, [catalog.items, deferredCatalogQuery]);

  const branchCount = branches.length;
  const monitoredBranchCount = branches.filter((branch) => branch.enabled).length;
  const pausedBranchCount = branchCount - monitoredBranchCount;
  const customOverrideCount = branches.filter((branch) => typeof branch.lateThresholdOverride === "number").length;
  const hasCatalogSearchQuery = deferredCatalogQuery.trim().length > 0;

  const chainOptions = useMemo(() => {
    const names = thresholdForm.chains.map((item) => item.name);
    if (selectedChainName && !names.includes(selectedChainName)) {
      return [...names, selectedChainName].sort((a, b) => a.localeCompare(b));
    }
    return names;
  }, [selectedChainName, thresholdForm.chains]);

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

  const refreshCatalog = async () => {
    try {
      setRefreshingCatalog(true);
      setCatalog(await api.refreshBranchCatalog());
      setToast({ type: "success", msg: "Branch catalog refreshed" });
    } catch (error) {
      const message = describeApiError(error, "Branch catalog refresh failed");
      setCatalog((current) => ({ ...current, syncState: "error", lastError: message }));
      setToast({ type: "error", msg: message });
    } finally {
      setRefreshingCatalog(false);
    }
  };

  const setBranchMonitoringState = async (branch: BranchMappingItem, enabled: boolean) => {
    if (!canManageBranches) {
      setToast({ type: "info", msg: "No access" });
      return;
    }

    try {
      setSavingMonitorBranchId(branch.id);
      const response = await api.setBranchMonitoring(branch.id, enabled);
      setBranches((current) => current.map((item) => (item.id === branch.id ? response.item : item)));
      setCatalog((current) => ({
        ...current,
        items: current.items.map((item) => (
          item.branchId === branch.id
            ? { ...item, alreadyAdded: true, enabled: response.item.enabled, chainName: response.item.chainName }
            : item
        )),
      }));
      setToast({ type: "success", msg: enabled ? "Branch enabled in monitor" : "Branch paused from monitor" });
    } catch (error) {
      setToast({ type: "error", msg: describeApiError(error, "Monitor state update failed") });
    } finally {
      setSavingMonitorBranchId(null);
    }
  };

  const deleteBranch = async (branchId: number) => {
    if (!canDeleteBranches) {
      setToast({ type: "info", msg: "Admins only" });
      return;
    }

    try {
      await api.deleteBranch(branchId);
      setBranches((current) => current.filter((item) => item.id !== branchId));
      setCatalog((current) => ({
        ...current,
        items: current.items.map((item) => (
          item.branchId === branchId
            ? { ...item, alreadyAdded: false, branchId: null, chainName: null, enabled: null }
            : item
        )),
      }));
      if (editingThresholdBranchId === branchId) {
        setEditingThresholdBranchId(null);
        setBranchThresholdEditor(emptyBranchThresholdEditor());
      }
      setToast({ type: "success", msg: "Branch deleted" });
    } catch (error) {
      setToast({ type: "error", msg: describeApiError(error, "Delete failed") });
    }
  };

  const addBranchFromCatalog = async () => {
    if (!canManageBranches) {
      setToast({ type: "info", msg: "No access" });
      return;
    }
    if (!selectedCatalogItem) {
      setToast({ type: "error", msg: "Select a branch first" });
      return;
    }
    if (!selectedCatalogItem.presentInSource) {
      setToast({ type: "error", msg: "This branch is not in the current source catalog" });
      return;
    }
    if (selectedCatalogItem.alreadyAdded) {
      setToast({ type: "info", msg: "This branch is already added" });
      return;
    }
    if (selectedCatalogItem.resolveStatus !== "resolved" || !selectedCatalogItem.ordersVendorId) {
      setToast({ type: "error", msg: "This branch is not resolved yet. Refresh the catalog and try again." });
      return;
    }

    try {
      setAddingBranch(true);
      await api.addBranch({
        availabilityVendorId: selectedCatalogItem.availabilityVendorId,
        chainName: selectedChainName.trim(),
        enabled: true,
      });
      await loadMappingData({ silent: true });
      setSelectedAvailabilityVendorId(null);
      setSelectedChainName("");
      setCatalogQuery("");
      if (isMobile) setMobileStudioSection("branches");
      setToast({ type: "success", msg: "Branch added" });
    } catch (error) {
      setToast({ type: "error", msg: describeApiError(error, "Branch add failed") });
    } finally {
      setAddingBranch(false);
    }
  };

  const saveGlobalThresholds = async () => {
    if (!canManageSettings) {
      setToast({ type: "info", msg: "Admins only" });
      return;
    }
    const lateThreshold = Number(thresholdForm.lateThreshold);
    const unassignedThreshold = Number(thresholdForm.unassignedThreshold);
    if (!Number.isFinite(lateThreshold) || lateThreshold < 0) {
      setToast({ type: "error", msg: "Enter valid default late threshold" });
      return;
    }
    if (!Number.isFinite(unassignedThreshold) || unassignedThreshold < 0) {
      setToast({ type: "error", msg: "Enter valid default unassigned threshold" });
      return;
    }

    try {
      await api.putSettings({
        lateThreshold: Math.round(lateThreshold),
        unassignedThreshold: Math.round(unassignedThreshold),
      });
      applySettings(await api.getSettings());
      setToast({ type: "success", msg: "Defaults saved" });
    } catch (error) {
      setToast({ type: "error", msg: describeApiError(error, "Default threshold save failed") });
    }
  };

  const persistChains = async (nextChains: ChainThreshold[]) => {
    if (!canManageSettings) {
      setToast({ type: "info", msg: "Admins only" });
      return;
    }
    const normalized = normalizeChains(nextChains);
    try {
      await api.putSettings({ chains: normalized });
      setSettings((current) => current ? { ...current, chainNames: normalized.map((item) => item.name), chains: normalized } : current);
      setThresholdForm((current) => ({ ...current, chains: normalized }));
      setEditingChainIndex(null);
      setChainEditor(emptyChainEditor());
      setToast({ type: "success", msg: "Chains saved" });
    } catch (error) {
      setToast({ type: "error", msg: describeApiError(error, "Chain save failed") });
    }
  };

  const upsertChain = async () => {
    if (!canManageSettings) {
      setToast({ type: "info", msg: "Admins only" });
      return;
    }
    const name = chainEditor.name.trim();
    const lateThreshold = Number(chainEditor.lateThreshold);
    const unassignedThreshold = Number(chainEditor.unassignedThreshold);
    if (!name) {
      setToast({ type: "error", msg: "Enter chain name" });
      return;
    }
    if (!Number.isFinite(lateThreshold) || lateThreshold < 0) {
      setToast({ type: "error", msg: "Enter valid late threshold" });
      return;
    }
    if (!Number.isFinite(unassignedThreshold) || unassignedThreshold < 0) {
      setToast({ type: "error", msg: "Enter valid unassigned threshold" });
      return;
    }

    const nextChains = normalizeChains(
      thresholdForm.chains.filter((_item, index) => index !== editingChainIndex),
    ).filter((item) => item.name.trim().toLowerCase() !== name.toLowerCase());
    nextChains.push({ name, lateThreshold: Math.round(lateThreshold), unassignedThreshold: Math.round(unassignedThreshold) });
    await persistChains(nextChains);
  };

  const buildBranchPayload = (
    branch: BranchMappingItem,
    overrides: { lateThresholdOverride: number | null; unassignedThresholdOverride: number | null },
  ) => ({
    name: branch.name,
    chainName: branch.chainName,
    ordersVendorId: branch.ordersVendorId,
    availabilityVendorId: branch.availabilityVendorId,
    globalEntityId: branch.globalEntityId,
    enabled: branch.enabled,
    lateThresholdOverride: overrides.lateThresholdOverride,
    unassignedThresholdOverride: overrides.unassignedThresholdOverride,
  });

  const startBranchThresholdEdit = (branch: BranchMappingItem) => {
    const effective = resolveEffectiveThresholds(branch, thresholdForm.chains, globalThresholds);
    setEditingThresholdBranchId(branch.id);
    setBranchThresholdEditor({
      lateThreshold: String(branch.lateThresholdOverride ?? effective.lateThreshold),
      unassignedThreshold: String(branch.unassignedThresholdOverride ?? effective.unassignedThreshold),
    });
    setRulesMode("overrides");
  };

  const saveBranchThresholdOverride = async (branch: BranchMappingItem) => {
    if (!canManageSettings) {
      setToast({ type: "info", msg: "Admins only" });
      return;
    }
    const lateThreshold = Number(branchThresholdEditor.lateThreshold);
    const unassignedThreshold = Number(branchThresholdEditor.unassignedThreshold);
    if (!Number.isFinite(lateThreshold) || lateThreshold < 0 || !Number.isFinite(unassignedThreshold) || unassignedThreshold < 0) {
      setToast({ type: "error", msg: "Enter valid branch thresholds" });
      return;
    }

    try {
      setSavingThresholdBranchId(branch.id);
      const response = await api.updateBranch(
        branch.id,
        buildBranchPayload(branch, {
          lateThresholdOverride: Math.round(lateThreshold),
          unassignedThresholdOverride: Math.round(unassignedThreshold),
        }),
      );
      setBranches((current) => current.map((item) => (item.id === branch.id ? response.item : item)));
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
    if (!canManageSettings) {
      setToast({ type: "info", msg: "Admins only" });
      return;
    }
    try {
      setSavingThresholdBranchId(branch.id);
      const response = await api.updateBranch(
        branch.id,
        buildBranchPayload(branch, { lateThresholdOverride: null, unassignedThresholdOverride: null }),
      );
      setBranches((current) => current.map((item) => (item.id === branch.id ? response.item : item)));
      if (editingThresholdBranchId === branch.id) {
        setEditingThresholdBranchId(null);
        setBranchThresholdEditor(emptyBranchThresholdEditor());
      }
      setToast({ type: "success", msg: "Using inherited thresholds" });
    } catch (error) {
      setToast({ type: "error", msg: describeApiError(error, "Branch override reset failed") });
    } finally {
      setSavingThresholdBranchId(null);
    }
  };

  const renderBranchCard = (branch: BranchMappingItem) => {
    const effective = resolveEffectiveThresholds(branch, thresholdForm.chains, globalThresholds);
    const tone = sourceTone(effective.source);
    const sourceItem = sourceByAvailabilityVendorId.get(branch.availabilityVendorId) ?? null;
    const sourceMissing = sourceItem?.presentInSource === false;

    return (
      <Box
        key={branch.id}
        sx={{
          p: 1.25,
          borderRadius: 3,
          border: sourceMissing
            ? "1px solid rgba(245,158,11,0.18)"
            : branch.enabled
              ? "1px solid rgba(22,163,74,0.12)"
              : "1px solid rgba(99,102,241,0.14)",
          bgcolor: sourceMissing
            ? "rgba(255,251,235,0.82)"
            : branch.enabled
              ? "rgba(240,253,244,0.76)"
              : "rgba(238,242,255,0.72)",
        }}
      >
        <Stack spacing={1}>
          <Stack direction={{ xs: "column", sm: "row" }} justifyContent="space-between" spacing={0.8}>
            <Box sx={{ minWidth: 0, flex: 1 }}>
              <Typography sx={{ fontWeight: 900, color: "#0f172a" }}>{branch.name}</Typography>
              <Typography variant="caption" sx={{ color: "text.secondary", display: "block" }}>
                Orders {branch.ordersVendorId} • Availability {branch.availabilityVendorId}
              </Typography>
            </Box>
            <IconButton onClick={() => void deleteBranch(branch.id)} disabled={!canDeleteBranches} size="small" aria-label={`Delete ${branch.name}`}>
              <DeleteOutlineIcon fontSize="small" />
            </IconButton>
          </Stack>

          <Stack direction="row" spacing={0.7} flexWrap="wrap" useFlexGap>
            <Chip size="small" label={branch.chainName || "No chain"} sx={{ fontWeight: 800, bgcolor: "rgba(15,23,42,0.06)", color: "#334155" }} />
            <Chip size="small" label={`L ${effective.lateThreshold} · U ${effective.unassignedThreshold}`} sx={{ fontWeight: 800, bgcolor: tone.bg, color: tone.color }} />
            <Chip size="small" label={branch.enabled ? "In Monitor" : "Paused"} sx={{ fontWeight: 800, bgcolor: branch.enabled ? "rgba(22,163,74,0.10)" : "rgba(99,102,241,0.12)", color: branch.enabled ? "#166534" : "#4338ca" }} />
            {sourceMissing ? <Chip size="small" label="Not in current source" sx={{ fontWeight: 800, bgcolor: "rgba(245,158,11,0.12)", color: "#b45309" }} /> : null}
          </Stack>

          <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 1 }}>
            <Typography variant="caption" sx={{ color: branch.enabled ? "#166534" : "#4338ca", fontWeight: 800 }}>
              {branch.enabled ? "Included in live monitor cycles" : "Skipped from live monitor cycles"}
            </Typography>
            <Switch
              checked={branch.enabled}
              onChange={(_event, checked) => void setBranchMonitoringState(branch, checked)}
              disabled={!canManageBranches || savingMonitorBranchId === branch.id}
              inputProps={{ "aria-label": `Toggle monitor for ${branch.name}` }}
            />
          </Box>
        </Stack>
      </Box>
    );
  };

  const renderBranchSectionContent = (items: BranchMappingItem[], emptyText: string) => (
    <Stack spacing={1}>
      {items.length ? items.map(renderBranchCard) : (
        <Box sx={{ px: 1.1, py: 1.2, borderRadius: 2.6, border: "1px dashed rgba(148,163,184,0.24)", bgcolor: "rgba(248,250,252,0.55)" }}>
          <Typography variant="caption" sx={{ color: "#64748b", fontWeight: 700 }}>{emptyText}</Typography>
        </Box>
      )}
    </Stack>
  );

  const renderSavedBranchSection = (
    key: keyof typeof savedBranchSections,
    title: string,
    items: BranchMappingItem[],
    emptyText: string,
  ) => {
    const expanded = savedBranchSections[key];

    return (
      <Box>
        <Box
          role="button"
          tabIndex={0}
          onClick={() => setSavedBranchSections((current) => ({ ...current, [key]: !current[key] }))}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              setSavedBranchSections((current) => ({ ...current, [key]: !current[key] }));
            }
          }}
          sx={{
            px: 1.1,
            py: 0.95,
            borderRadius: 2.8,
            border: "1px solid rgba(148,163,184,0.12)",
            bgcolor: "rgba(255,255,255,0.9)",
            cursor: "pointer",
            transition: "border-color 160ms ease, box-shadow 160ms ease",
            "&:hover": {
              borderColor: "rgba(100,116,139,0.18)",
              boxShadow: "0 10px 24px rgba(15,23,42,0.06)",
            },
            "&:focus-visible": {
              outline: "2px solid rgba(37,99,235,0.24)",
              outlineOffset: 2,
            },
          }}
        >
          <Stack direction="row" justifyContent="space-between" alignItems="center" gap={1}>
            <Stack direction="row" spacing={1} alignItems="center" sx={{ minWidth: 0 }}>
              <Box
                sx={{
                  width: 28,
                  height: 28,
                  borderRadius: "9px",
                  display: "grid",
                  placeItems: "center",
                  bgcolor: "rgba(241,245,249,0.95)",
                  color: "#334155",
                  flexShrink: 0,
                }}
              >
                <ExpandMoreRoundedIcon
                  sx={{
                    fontSize: 20,
                    transform: expanded ? "rotate(180deg)" : "rotate(90deg)",
                    transition: "transform 180ms ease",
                  }}
                />
              </Box>
              <Typography sx={{ fontWeight: 900, color: "#0f172a" }}>{title}</Typography>
            </Stack>
            <Chip size="small" label={items.length} sx={{ fontWeight: 900 }} />
          </Stack>
        </Box>
        <Collapse in={expanded} timeout={220} unmountOnExit>
          <Box sx={{ pt: 1 }}>
            {renderBranchSectionContent(items, emptyText)}
          </Box>
        </Collapse>
      </Box>
    );
  };

  return (
    <Box sx={{ minHeight: "100vh", bgcolor: "background.default" }}>
      <TopBar
        running={monitoring.running}
        degraded={monitoring.degraded}
        onStart={onStart}
        onStop={onStop}
        canControlMonitor={canManageMonitor}
      />

      <Container maxWidth="xl" sx={{ py: { xs: 2, md: 3 } }}>
        {loadError ? <Alert severity="error" variant="outlined" sx={{ mb: 2 }}>{loadError}</Alert> : null}

        <Box sx={{ display: "grid", gap: { xs: 1.5, md: 2 }, gridTemplateColumns: { xs: "1fr", xl: "minmax(0, 1.18fr) minmax(390px, 0.92fr)" }, alignItems: "start" }}>
          <Card sx={sectionCardSx()}>
            <CardContent sx={{ p: { xs: 1.35, md: 1.8 }, display: "grid", gap: 2, gridTemplateColumns: { xs: "1fr", lg: "minmax(0, 1.08fr) minmax(340px, 0.92fr)" } }}>
              {isMobile ? (
                <Box sx={{ gridColumn: "1 / -1", borderRadius: 999, border: "1px solid rgba(148,163,184,0.14)", bgcolor: "rgba(248,250,252,0.92)", overflow: "hidden" }}>
                  <Tabs value={mobileStudioSection} onChange={(_event, value) => setMobileStudioSection(value)} variant="fullWidth" sx={{ minHeight: 42, "& .MuiTab-root": { minHeight: 42, fontWeight: 900, textTransform: "none" } }}>
                    <Tab value="branches" label={`Branches ${branchCount}`} />
                    <Tab value="catalog" label="Add" />
                  </Tabs>
                </Box>
              ) : null}

              <Box sx={{ display: { xs: !isMobile || mobileStudioSection === "branches" ? "block" : "none", lg: "block" }, minWidth: 0 }}>
                <Stack spacing={1.3}>
                  <Card variant="outlined" sx={{ borderRadius: 3 }}>
                    <CardContent sx={{ p: { xs: 1.3, md: 1.45 } }}>
                      <Stack direction={{ xs: "column", sm: "row" }} justifyContent="space-between" spacing={1} alignItems={{ xs: "flex-start", sm: "center" }}>
                        <Box>
                          <Typography sx={{ fontWeight: 900, color: "#0f172a" }}>Saved Branches</Typography>
                          <Typography variant="caption" sx={{ color: "text.secondary" }}>Monitor toggle and delete live here. No edit mode.</Typography>
                        </Box>
                        <Chip size="small" label={canManageBranches ? "Manage monitor" : "Read only"} sx={{ fontWeight: 800, bgcolor: canManageBranches ? "rgba(22,163,74,0.10)" : "rgba(15,23,42,0.06)", color: canManageBranches ? "#166534" : "#334155" }} />
                      </Stack>

                      <Box sx={{ mt: 1.2, display: "grid", gap: 1, gridTemplateColumns: "repeat(3, minmax(0, 1fr))" }}>
                        <Box sx={{ p: 1, borderRadius: 2.6, bgcolor: "rgba(37,99,235,0.06)" }}><Typography variant="caption" sx={{ color: "#1d4ed8", fontWeight: 900 }}>Total</Typography><Typography sx={{ fontWeight: 900, color: "#0f172a", fontSize: { xs: 18, md: 22 } }}>{branchCount}</Typography></Box>
                        <Box sx={{ p: 1, borderRadius: 2.6, bgcolor: "rgba(22,163,74,0.06)" }}><Typography variant="caption" sx={{ color: "#166534", fontWeight: 900 }}>In Monitor</Typography><Typography sx={{ fontWeight: 900, color: "#0f172a", fontSize: { xs: 18, md: 22 } }}>{monitoredBranchCount}</Typography></Box>
                        <Box sx={{ p: 1, borderRadius: 2.6, bgcolor: "rgba(99,102,241,0.08)" }}><Typography variant="caption" sx={{ color: "#4338ca", fontWeight: 900 }}>Paused</Typography><Typography sx={{ fontWeight: 900, color: "#0f172a", fontSize: { xs: 18, md: 22 } }}>{pausedBranchCount}</Typography></Box>
                      </Box>

                      <TextField
                        placeholder="Search saved branches or vendor IDs"
                        value={branchQuery}
                        onChange={(event) => setBranchQuery(event.target.value)}
                        fullWidth
                        size="small"
                        sx={{ mt: 1.2, "& .MuiOutlinedInput-root": { borderRadius: 999, bgcolor: "rgba(255,255,255,0.94)" } }}
                        InputProps={{ startAdornment: <InputAdornment position="start"><SearchRoundedIcon sx={{ color: "#64748b", fontSize: 18 }} /></InputAdornment> }}
                      />
                    </CardContent>
                  </Card>

                  {renderSavedBranchSection("missing", "Not In Current Source", missingSourceBranches, "No saved branches outside the current source.")}
                  {renderSavedBranchSection("paused", "Paused", pausedBranches, "No paused branches in this view.")}
                  {renderSavedBranchSection("monitor", "In Monitor", monitoredBranches, "No live branches in this view.")}
                </Stack>
              </Box>

              <Box sx={{ display: { xs: !isMobile || mobileStudioSection === "catalog" ? "block" : "none", lg: "block" }, alignSelf: "start", position: { lg: "sticky" }, top: { lg: 88 } }}>
                <Card variant="outlined" sx={{ borderRadius: 3.5 }}>
                  <CardContent sx={{ p: { xs: 1.35, md: 1.5 } }}>
                    <Stack direction="row" justifyContent="space-between" alignItems="center" gap={1}>
                      <Box>
                        <Typography sx={{ fontWeight: 900, color: "#0f172a" }}>Add From Source</Typography>
                        <Typography variant="caption" sx={{ color: "text.secondary" }}>Search local catalog, choose a chain, then add.</Typography>
                      </Box>
                      <Stack direction="row" spacing={0.8} alignItems="center">
                        <Chip size="small" label={catalog.syncState} sx={{ fontWeight: 800, textTransform: "capitalize" }} />
                        <IconButton onClick={() => void refreshCatalog()} disabled={refreshingCatalog} aria-label="Refresh branch catalog">
                          {refreshingCatalog ? <CircularProgress size={18} /> : <RefreshRoundedIcon fontSize="small" />}
                        </IconButton>
                      </Stack>
                    </Stack>

                    {catalog.lastError ? <Alert severity="error" variant="outlined" sx={{ mt: 1.1 }}>{catalog.lastError}</Alert> : null}
                    {!catalog.lastError ? (
                      <Typography variant="caption" sx={{ mt: 1.05, display: "block", color: "#64748b", fontWeight: 700 }}>
                        Last sync: {formatSyncTime(catalog.lastSyncedAt)}
                      </Typography>
                    ) : null}

                    <TextField
                      placeholder="Search by branch name or availability ID"
                      value={catalogQuery}
                      onChange={(event) => setCatalogQuery(event.target.value)}
                      fullWidth
                      size="small"
                      sx={{ mt: 1.2, "& .MuiOutlinedInput-root": { borderRadius: 999, bgcolor: "rgba(255,255,255,0.94)" } }}
                      InputProps={{ startAdornment: <InputAdornment position="start"><SearchRoundedIcon sx={{ color: "#64748b", fontSize: 18 }} /></InputAdornment> }}
                    />

                    <Stack spacing={0.8} sx={{ mt: 1.2, maxHeight: 320, overflowY: "auto" }}>
                      {!hasCatalogSearchQuery ? (
                        <Box sx={{ px: 1.1, py: 1.25, borderRadius: 2.6, border: "1px dashed rgba(148,163,184,0.24)", bgcolor: "rgba(248,250,252,0.55)" }}>
                          <Typography variant="caption" sx={{ color: "#64748b", fontWeight: 700 }}>
                            Start typing to search source branches.
                          </Typography>
                        </Box>
                      ) : catalogSearchResults.length ? catalogSearchResults.map((item) => (
                        <Box
                          key={item.availabilityVendorId}
                          role="button"
                          tabIndex={0}
                          onClick={() => setSelectedAvailabilityVendorId(item.availabilityVendorId)}
                          onKeyDown={(event) => {
                            if (event.key === "Enter" || event.key === " ") {
                              event.preventDefault();
                              setSelectedAvailabilityVendorId(item.availabilityVendorId);
                            }
                          }}
                          sx={{
                            p: 1,
                            borderRadius: 2.6,
                            border: item.availabilityVendorId === selectedAvailabilityVendorId ? "1px solid rgba(37,99,235,0.26)" : "1px solid rgba(148,163,184,0.12)",
                            bgcolor: item.availabilityVendorId === selectedAvailabilityVendorId ? "rgba(37,99,235,0.06)" : "rgba(248,250,252,0.72)",
                            cursor: "pointer",
                          }}
                        >
                          <Typography sx={{ fontWeight: 900, color: "#0f172a" }}>{item.name?.trim() || `Availability ${item.availabilityVendorId}`}</Typography>
                          <Typography variant="caption" sx={{ color: "text.secondary", display: "block" }}>
                            Availability {item.availabilityVendorId}{item.ordersVendorId ? ` • Orders ${item.ordersVendorId}` : " • Orders unresolved"}
                          </Typography>
                          <Stack direction="row" spacing={0.6} flexWrap="wrap" useFlexGap sx={{ mt: 0.6 }}>
                            <Chip size="small" label={item.alreadyAdded ? "Already added" : item.resolveStatus === "resolved" ? "Ready" : item.resolveStatus === "error" ? "Resolver error" : "Needs resolver"} sx={{ fontWeight: 800 }} />
                            {item.presentInSource ? <Chip size="small" label={item.availabilityState} sx={{ fontWeight: 800 }} /> : <Chip size="small" label="Not in source" sx={{ fontWeight: 800, bgcolor: "rgba(245,158,11,0.12)", color: "#b45309" }} />}
                          </Stack>
                        </Box>
                      )) : (
                        <Box sx={{ px: 1.1, py: 1.2, borderRadius: 2.6, border: "1px dashed rgba(148,163,184,0.24)", bgcolor: "rgba(248,250,252,0.55)" }}>
                          <Typography variant="caption" sx={{ color: "#64748b", fontWeight: 700 }}>No branch match.</Typography>
                        </Box>
                      )}
                    </Stack>

                    <Box sx={{ mt: 1.2, p: 1.2, borderRadius: 3, border: "1px solid rgba(148,163,184,0.14)", bgcolor: "rgba(248,250,252,0.72)" }}>
                      {selectedCatalogItem ? (
                        <Stack spacing={1.1}>
                          <Box>
                            <Typography sx={{ fontWeight: 900, color: "#0f172a" }}>{selectedCatalogItem.name?.trim() || `Availability ${selectedCatalogItem.availabilityVendorId}`}</Typography>
                            <Typography variant="caption" sx={{ color: "text.secondary" }}>
                              Availability {selectedCatalogItem.availabilityVendorId}{selectedCatalogItem.ordersVendorId ? ` • Orders ${selectedCatalogItem.ordersVendorId}` : " • Orders unresolved"}
                            </Typography>
                          </Box>

                          {!selectedCatalogItem.presentInSource ? <Alert severity="warning" variant="outlined" icon={<WarningAmberRoundedIcon fontSize="inherit" />}>This branch is not in the current source feed and cannot be added right now.</Alert> : null}
                          {selectedCatalogItem.lastError ? <Alert severity="warning" variant="outlined">{selectedCatalogItem.lastError}</Alert> : null}
                          {selectedCatalogItem.alreadyAdded ? <Alert severity="info" variant="outlined">This branch is already saved.</Alert> : null}

                          <TextField select label="Chain" value={selectedChainName} onChange={(event) => setSelectedChainName(event.target.value)} disabled={!canManageBranches} fullWidth>
                            <MenuItem value="">No Chain</MenuItem>
                            {chainOptions.map((chainName) => <MenuItem key={chainName} value={chainName}>{chainName}</MenuItem>)}
                          </TextField>

                          <Button
                            variant="contained"
                            onClick={() => void addBranchFromCatalog()}
                            disabled={!canManageBranches || addingBranch || !selectedCatalogItem.presentInSource || selectedCatalogItem.alreadyAdded || selectedCatalogItem.resolveStatus !== "resolved" || !selectedCatalogItem.ordersVendorId}
                            startIcon={<AddRoundedIcon />}
                            sx={{ borderRadius: 999 }}
                          >
                            {addingBranch ? "Adding..." : "Add Branch"}
                          </Button>
                        </Stack>
                      ) : (
                        <Typography variant="caption" sx={{ color: "#64748b", fontWeight: 700 }}>Select a source branch, choose a chain, then add it.</Typography>
                      )}
                    </Box>
                  </CardContent>
                </Card>
              </Box>
            </CardContent>
          </Card>

          <Stack spacing={2}>
            {isMobile ? (
              <Box sx={{ borderRadius: 999, border: "1px solid rgba(148,163,184,0.14)", bgcolor: "rgba(248,250,252,0.92)", overflow: "hidden" }}>
                <Tabs value={mobileRulesSection} onChange={(_event, value) => setMobileRulesSection(value)} variant="fullWidth" sx={{ minHeight: 42, "& .MuiTab-root": { minHeight: 42, fontWeight: 900, textTransform: "none" } }}>
                  <Tab value="base" label="Base" />
                  <Tab value="rules" label="Rules" />
                </Tabs>
              </Box>
            ) : null}

            <Card sx={{ ...sectionCardSx(), display: { xs: !isMobile || mobileRulesSection === "base" ? "block" : "none" } }}>
              <CardContent sx={{ p: { xs: 1.4, md: 1.7 } }}>
                <Stack direction={{ xs: "column", sm: "row" }} spacing={1.2} justifyContent="space-between" alignItems={{ xs: "flex-start", sm: "center" }}>
                  <Box>
                    <Typography sx={{ fontWeight: 900, color: "#0f172a" }}>Base</Typography>
                    <Typography variant="caption" sx={{ color: "text.secondary" }}>Default fallback</Typography>
                  </Box>
                  <Chip size="small" label={canManageSettings ? "Admin edit" : "Read only"} sx={{ fontWeight: 800 }} />
                </Stack>

                <Box sx={{ mt: 1.35, display: "grid", gap: 1, gridTemplateColumns: { xs: "1fr", sm: "repeat(2, minmax(0, 1fr))" } }}>
                  <TextField label="Late" type="number" value={thresholdForm.lateThreshold} onChange={(event) => setThresholdForm((current) => ({ ...current, lateThreshold: Number(event.target.value) }))} disabled={!canManageSettings} size="small" inputProps={{ min: 0 }} fullWidth />
                  <TextField label="Unassigned" type="number" value={thresholdForm.unassignedThreshold} onChange={(event) => setThresholdForm((current) => ({ ...current, unassignedThreshold: Number(event.target.value) }))} disabled={!canManageSettings} size="small" inputProps={{ min: 0 }} fullWidth />
                </Box>

                <Button variant="contained" onClick={() => void saveGlobalThresholds()} disabled={!canManageSettings} sx={{ mt: 1.2, minWidth: { xs: "100%", sm: 120 }, borderRadius: 999 }}>
                  {canManageSettings ? "Save" : "Locked"}
                </Button>
              </CardContent>
            </Card>

            <Card sx={{ ...sectionCardSx(), display: { xs: !isMobile || mobileRulesSection === "rules" ? "block" : "none" } }}>
              <CardContent sx={{ p: { xs: 1.45, md: 1.7 } }}>
                <Stack spacing={1.35}>
                  <Stack direction={{ xs: "column", sm: "row" }} spacing={1.2} justifyContent="space-between" alignItems={{ xs: "flex-start", sm: "center" }}>
                    <Box>
                      <Typography sx={{ fontWeight: 900, color: "#0f172a" }}>Rule Studio</Typography>
                      <Typography variant="caption" sx={{ color: "text.secondary" }}>Chains first. Overrides only when needed.</Typography>
                    </Box>
                    <Stack direction="row" spacing={0.8} flexWrap="wrap">
                      <Chip size="small" label={`${thresholdForm.chains.length} chains`} sx={{ fontWeight: 800 }} />
                      <Chip size="small" label={`${customOverrideCount} custom`} sx={{ fontWeight: 800 }} />
                    </Stack>
                  </Stack>

                  <Box sx={{ display: "inline-flex", gap: 0.75, p: 0.55, borderRadius: 999, bgcolor: "rgba(15,23,42,0.05)", border: "1px solid rgba(148,163,184,0.14)", width: { xs: "100%", sm: "auto" } }}>
                    <Button variant={rulesMode === "chains" ? "contained" : "text"} size="small" onClick={() => setRulesMode("chains")} sx={{ minWidth: 104, borderRadius: 999, fontWeight: 800, flex: 1 }}>Chains</Button>
                    <Button variant={rulesMode === "overrides" ? "contained" : "text"} size="small" onClick={() => setRulesMode("overrides")} sx={{ minWidth: 104, borderRadius: 999, fontWeight: 800, flex: 1 }}>Overrides</Button>
                  </Box>

                  <Box sx={{ p: 0.65, borderRadius: 3.2, border: "1px solid rgba(148,163,184,0.12)", bgcolor: "rgba(248,250,252,0.62)" }}>
                    {rulesMode === "chains" ? (
                      <ChainThresholdManager
                        chains={thresholdForm.chains}
                        editingChainIndex={editingChainIndex}
                        chainEditor={chainEditor}
                        readOnly={!canManageSettings}
                        onChangeEditor={(patch) => setChainEditor((current) => ({ ...current, ...patch }))}
                        onEditChain={(chain, index) => {
                          setEditingChainIndex(index);
                          setChainEditor({ name: chain.name, lateThreshold: String(chain.lateThreshold), unassignedThreshold: String(chain.unassignedThreshold) });
                        }}
                        onRemoveChain={(index) => void persistChains(thresholdForm.chains.filter((_item, itemIndex) => itemIndex !== index))}
                        onSaveChain={() => void upsertChain()}
                        onCancelEdit={() => {
                          setEditingChainIndex(null);
                          setChainEditor(emptyChainEditor());
                        }}
                      />
                    ) : (
                      <BranchThresholdOverrideManager
                        branches={branches}
                        chains={thresholdForm.chains}
                        globalThresholds={globalThresholds}
                        editingBranchId={editingThresholdBranchId}
                        branchEditor={branchThresholdEditor}
                        savingBranchId={savingThresholdBranchId}
                        readOnly={!canManageSettings}
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
                  </Box>
                </Stack>
              </CardContent>
            </Card>
          </Stack>
        </Box>
      </Container>

      <Snackbar open={!!toast} autoHideDuration={2500} onClose={() => setToast(null)} anchorOrigin={{ vertical: "bottom", horizontal: "center" }}>
        {toast ? <Alert severity={toast.type}>{toast.msg}</Alert> : undefined}
      </Snackbar>
    </Box>
  );
}

export { Mapping as MappingPage };
