import AddRoundedIcon from "@mui/icons-material/AddRounded";
import DeleteSweepRoundedIcon from "@mui/icons-material/DeleteSweepRounded";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import ExpandMoreRoundedIcon from "@mui/icons-material/ExpandMoreRounded";
import PauseCircleOutlineRoundedIcon from "@mui/icons-material/PauseCircleOutlineRounded";
import PlayCircleOutlineRoundedIcon from "@mui/icons-material/PlayCircleOutlineRounded";
import SearchRoundedIcon from "@mui/icons-material/SearchRounded";
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Checkbox,
  Chip,
  Collapse,
  IconButton,
  InputAdornment,
  MenuItem,
  Snackbar,
  Stack,
  Switch,
  Tab,
  Tabs,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import { useDeferredValue, useEffect, useMemo, useState, type KeyboardEvent } from "react";
import { api, describeApiError } from "../api/client";
import type { BranchMappingItem, ChainThreshold, LocalVendorCatalogItem, SettingsMasked, ThresholdProfile } from "../api/types";
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

function safeBranchName(branch: Pick<BranchMappingItem, "name" | "availabilityVendorId">) {
  return branch.name?.trim() || `Availability ${branch.availabilityVendorId}`;
}

function resolveEffectiveThresholds(
  branch: BranchMappingItem,
  chains: ChainThreshold[],
  globalThresholds: Pick<ThresholdProfile, "lateThreshold" | "unassignedThreshold">,
) {
  if (typeof branch.lateThresholdOverride === "number" && typeof branch.unassignedThresholdOverride === "number") {
    return { lateThreshold: branch.lateThresholdOverride, unassignedThreshold: branch.unassignedThresholdOverride, source: "branch" as const };
  }
  const chain = chains.find((item) => item.name.trim().toLowerCase() === branch.chainName.trim().toLowerCase());
  if (chain) {
    return { lateThreshold: chain.lateThreshold, unassignedThreshold: chain.unassignedThreshold, source: "chain" as const };
  }
  return { lateThreshold: globalThresholds.lateThreshold, unassignedThreshold: globalThresholds.unassignedThreshold, source: "global" as const };
}

function scoreSourceItem(item: LocalVendorCatalogItem, query: string) {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) return 100;
  const name = item.name.toLowerCase();
  const availabilityId = item.availabilityVendorId.toLowerCase();
  const ordersId = String(item.ordersVendorId);
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
  return safeBranchName(branch).toLowerCase().includes(normalizedQuery)
    || branch.chainName.toLowerCase().includes(normalizedQuery)
    || branch.availabilityVendorId.toLowerCase().includes(normalizedQuery)
    || String(branch.ordersVendorId ?? "").includes(normalizedQuery);
}

function mergeSourceItemsWithBranches(sourceItems: LocalVendorCatalogItem[], branches: BranchMappingItem[]) {
  const branchByAvailabilityVendorId = new Map(
    branches.map((branch) => [branch.availabilityVendorId, branch] as const),
  );

  return sourceItems.map((item) => {
    const branch = branchByAvailabilityVendorId.get(item.availabilityVendorId);
    if (!branch) {
      return {
        ...item,
        alreadyAdded: false,
        branchId: null,
        chainName: null,
        enabled: null,
      };
    }

    return {
      ...item,
      alreadyAdded: true,
      branchId: branch.id,
      chainName: branch.chainName || null,
      enabled: branch.enabled,
    };
  });
}

function formatBranchCount(count: number) {
  return `${count} branch${count === 1 ? "" : "es"}`;
}

interface SavedChainGroup {
  key: string;
  label: string;
  branches: BranchMappingItem[];
  availableCount: number;
  enabledCount: number;
  pausedCount: number;
  missingCount: number;
}

function buildSavedChainGroups(branches: BranchMappingItem[]) {
  const groups = new Map<string, SavedChainGroup>();

  for (const branch of branches) {
    const label = branch.chainName.trim() || "No Chain";
    const key = label.toLowerCase();
    const existing = groups.get(key) ?? {
      key,
      label,
      branches: [],
      availableCount: 0,
      enabledCount: 0,
      pausedCount: 0,
      missingCount: 0,
    };

    existing.branches.push(branch);
    if (branch.catalogState === "missing") {
      existing.missingCount += 1;
    } else {
      existing.availableCount += 1;
      if (branch.enabled) {
        existing.enabledCount += 1;
      } else {
        existing.pausedCount += 1;
      }
    }

    groups.set(key, existing);
  }

  return [...groups.values()]
    .map((group) => ({
      ...group,
      branches: [...group.branches].sort((left, right) => safeBranchName(left).localeCompare(safeBranchName(right))),
    }))
    .sort((left, right) => {
      if (left.label === "No Chain") return 1;
      if (right.label === "No Chain") return -1;
      return left.label.localeCompare(right.label);
    });
}

export function Mapping() {
  const { canManageBranches, canDeleteBranches, canManageMonitor, canManageSettings } = useAuth();
  const { monitoring, startMonitoring, stopMonitoring } = useMonitorStatus();

  const [settings, setSettings] = useState<SettingsMasked | null>(null);
  const [branches, setBranches] = useState<BranchMappingItem[]>([]);
  const [sourceItems, setSourceItems] = useState<LocalVendorCatalogItem[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [toast, setToast] = useState<{ type: "success" | "error" | "info"; msg: string } | null>(null);
  const [rulesMode, setRulesMode] = useState<"chains" | "overrides">("chains");
  const [thresholdForm, setThresholdForm] = useState({ chains: [] as ChainThreshold[], lateThreshold: 5, unassignedThreshold: 5 });
  const [chainEditor, setChainEditor] = useState<ChainEditorDraft>(emptyChainEditor());
  const [editingChainIndex, setEditingChainIndex] = useState<number | null>(null);
  const [branchThresholdEditor, setBranchThresholdEditor] = useState<BranchThresholdEditorDraft>(emptyBranchThresholdEditor());
  const [editingThresholdBranchId, setEditingThresholdBranchId] = useState<number | null>(null);
  const [savingThresholdBranchId, setSavingThresholdBranchId] = useState<number | null>(null);
  const [savingMonitorBranchId, setSavingMonitorBranchId] = useState<number | null>(null);
  const [processingChainKey, setProcessingChainKey] = useState<string | null>(null);
  const [addingBranch, setAddingBranch] = useState(false);
  const [branchQuery, setBranchQuery] = useState("");
  const [sourceQuery, setSourceQuery] = useState("");
  const [expandedChainGroups, setExpandedChainGroups] = useState<Record<string, boolean>>({});
  const [selectedAvailabilityVendorIds, setSelectedAvailabilityVendorIds] = useState<string[]>([]);
  const [selectedChainName, setSelectedChainName] = useState("");
  const deferredSourceQuery = useDeferredValue(sourceQuery);

  const applySettings = (nextSettings: SettingsMasked) => {
    const normalizedChains = normalizeChains(nextSettings.chains);
    setSettings(nextSettings);
    setThresholdForm({
      chains: normalizedChains,
      lateThreshold: nextSettings.lateThreshold,
      unassignedThreshold: nextSettings.unassignedThreshold,
    });
  };

  const loadData = async (options?: { silent?: boolean }) => {
    const results = await Promise.allSettled([api.getSettings(), api.listBranches(), api.listBranchSource()]);
    const [settingsResult, branchesResult, sourceResult] = results;
    if (settingsResult.status === "rejected" || branchesResult.status === "rejected" || sourceResult.status === "rejected") {
      const rejection = settingsResult.status === "rejected"
        ? settingsResult.reason
        : branchesResult.status === "rejected"
          ? branchesResult.reason
          : (sourceResult as PromiseRejectedResult).reason;
      const message = describeApiError(rejection, "Failed to load branch management");
      setLoadError(message);
      if (!options?.silent) setToast({ type: "error", msg: message });
      return;
    }
    const mergedSourceItems = mergeSourceItemsWithBranches(sourceResult.value.items, branchesResult.value.items);
    applySettings(settingsResult.value);
    setBranches(branchesResult.value.items);
    setSourceItems(mergedSourceItems);
    setSelectedAvailabilityVendorIds((current) => current.filter((availabilityVendorId) => {
      const item = mergedSourceItems.find((sourceItem) => sourceItem.availabilityVendorId === availabilityVendorId);
      return !!item && !item.alreadyAdded;
    }));
    setLoadError(null);
  };

  useEffect(() => {
    void loadData();
  }, []);

  const globalThresholds = {
    lateThreshold: Number(thresholdForm.lateThreshold ?? settings?.lateThreshold ?? 5),
    unassignedThreshold: Number(thresholdForm.unassignedThreshold ?? settings?.unassignedThreshold ?? 5),
  };

  const filteredBranches = useMemo(() => branches.filter((branch) => matchesBranchQuery(branch, branchQuery)), [branchQuery, branches]);
  const savedChainGroups = useMemo(() => buildSavedChainGroups(filteredBranches), [filteredBranches]);
  const selectedAvailabilityVendorIdSet = useMemo(
    () => new Set(selectedAvailabilityVendorIds),
    [selectedAvailabilityVendorIds],
  );
  const sourceSearchResults = useMemo(() => {
    const query = deferredSourceQuery.trim();
    if (!query) return [];
    return [...sourceItems]
      .filter((item) => scoreSourceItem(item, query) < 100)
      .sort((left, right) => {
        const leftScore = scoreSourceItem(left, query);
        const rightScore = scoreSourceItem(right, query);
        if (leftScore !== rightScore) return leftScore - rightScore;
        if (left.alreadyAdded !== right.alreadyAdded) return left.alreadyAdded ? 1 : -1;
        return left.name.localeCompare(right.name);
      })
      .slice(0, 60);
  }, [deferredSourceQuery, sourceItems]);
  const visibleAddableSourceItems = useMemo(
    () => sourceSearchResults.filter((item) => !item.alreadyAdded),
    [sourceSearchResults],
  );
  const selectedSourceItems = useMemo(
    () => sourceItems.filter((item) => selectedAvailabilityVendorIdSet.has(item.availabilityVendorId) && !item.alreadyAdded),
    [selectedAvailabilityVendorIdSet, sourceItems],
  );
  const allVisibleAddableSelected = visibleAddableSourceItems.length > 0
    && visibleAddableSourceItems.every((item) => selectedAvailabilityVendorIdSet.has(item.availabilityVendorId));

  const chainOptions = useMemo(() => {
    const names = thresholdForm.chains.map((item) => item.name);
    if (selectedChainName && !names.includes(selectedChainName)) return [...names, selectedChainName].sort((a, b) => a.localeCompare(b));
    return names;
  }, [selectedChainName, thresholdForm.chains]);

  const onStart = async () => {
    if (!canManageMonitor) return setToast({ type: "info", msg: "No access" });
    try {
      await startMonitoring();
      setToast({ type: "success", msg: "Monitoring started" });
    } catch (error) {
      setToast({ type: "error", msg: describeApiError(error, "Failed to start") });
    }
  };

  const onStop = async () => {
    if (!canManageMonitor) return setToast({ type: "info", msg: "No access" });
    try {
      await stopMonitoring();
      setToast({ type: "success", msg: "Monitoring stopped" });
    } catch (error) {
      setToast({ type: "error", msg: describeApiError(error, "Failed to stop") });
    }
  };

  const toggleChainGroup = (groupKey: string) => {
    setExpandedChainGroups((current) => ({
      ...current,
      [groupKey]: !current[groupKey],
    }));
  };

  const toggleSourceSelection = (availabilityVendorId: string) => {
    setSelectedAvailabilityVendorIds((current) => (
      current.includes(availabilityVendorId)
        ? current.filter((item) => item !== availabilityVendorId)
        : [...current, availabilityVendorId]
    ));
  };

  const toggleVisibleSourceSelection = () => {
    const visibleIds = visibleAddableSourceItems.map((item) => item.availabilityVendorId);
    if (!visibleIds.length) return;

    setSelectedAvailabilityVendorIds((current) => {
      const next = new Set(current);
      if (allVisibleAddableSelected) {
        visibleIds.forEach((availabilityVendorId) => next.delete(availabilityVendorId));
      } else {
        visibleIds.forEach((availabilityVendorId) => next.add(availabilityVendorId));
      }
      return Array.from(next);
    });
  };

  const clearSelectedSourceItems = () => {
    setSelectedAvailabilityVendorIds([]);
  };

  const setBranchMonitoringState = async (branch: BranchMappingItem, enabled: boolean) => {
    if (!canManageBranches) return setToast({ type: "info", msg: "No access" });
    try {
      setSavingMonitorBranchId(branch.id);
      const response = await api.setBranchMonitoring(branch.id, enabled);
      setBranches((current) => current.map((item) => (item.id === branch.id ? response.item : item)));
      setSourceItems((current) => current.map((item) => item.branchId === branch.id ? { ...item, enabled: response.item.enabled, chainName: response.item.chainName } : item));
      setToast({ type: "success", msg: enabled ? "Branch enabled in monitor" : "Branch paused from monitor" });
    } catch (error) {
      setToast({ type: "error", msg: describeApiError(error, "Monitor state update failed") });
    } finally {
      setSavingMonitorBranchId(null);
    }
  };

  const deleteBranch = async (branchId: number) => {
    if (!canDeleteBranches) return setToast({ type: "info", msg: "Admins only" });
    try {
      await api.deleteBranch(branchId);
      setBranches((current) => current.filter((item) => item.id !== branchId));
      setSourceItems((current) => current.map((item) => item.branchId === branchId ? { ...item, alreadyAdded: false, branchId: null, chainName: null, enabled: null } : item));
      setToast({ type: "success", msg: "Branch deleted" });
    } catch (error) {
      setToast({ type: "error", msg: describeApiError(error, "Delete failed") });
    }
  };

  const setChainMonitoringState = async (group: SavedChainGroup, enabled: boolean) => {
    if (!canManageBranches) return setToast({ type: "info", msg: "No access" });

    const targets = group.branches.filter((branch) => branch.catalogState === "available" && branch.enabled !== enabled);
    if (!targets.length) {
      return setToast({
        type: "info",
        msg: enabled ? "This chain is already active in monitor" : "This chain is already paused",
      });
    }

    try {
      setProcessingChainKey(group.key);
      const results = await Promise.allSettled(
        targets.map((branch) => api.setBranchMonitoring(branch.id, enabled)),
      );
      await loadData({ silent: true });

      const failedCount = results.filter((result) => result.status === "rejected").length;
      if (!failedCount) {
        setToast({ type: "success", msg: enabled ? `${group.label} resumed` : `${group.label} paused` });
        return;
      }

      const succeededCount = results.length - failedCount;
      setToast({
        type: "error",
        msg: succeededCount
          ? `${formatBranchCount(succeededCount)} updated, ${formatBranchCount(failedCount)} failed`
          : `Could not update ${group.label}`,
      });
    } catch (error) {
      setToast({ type: "error", msg: describeApiError(error, "Chain monitor update failed") });
    } finally {
      setProcessingChainKey(null);
    }
  };

  const deleteChainBranches = async (group: SavedChainGroup) => {
    if (!canDeleteBranches) return setToast({ type: "info", msg: "Admins only" });

    try {
      setProcessingChainKey(group.key);
      const results = await Promise.allSettled(
        group.branches.map((branch) => api.deleteBranch(branch.id)),
      );
      await loadData({ silent: true });

      const failedCount = results.filter((result) => result.status === "rejected").length;
      if (!failedCount) {
        setToast({ type: "success", msg: `${group.label} removed` });
        return;
      }

      const succeededCount = results.length - failedCount;
      setToast({
        type: "error",
        msg: succeededCount
          ? `${formatBranchCount(succeededCount)} deleted, ${formatBranchCount(failedCount)} failed`
          : `Could not delete ${group.label}`,
      });
    } catch (error) {
      setToast({ type: "error", msg: describeApiError(error, "Chain delete failed") });
    } finally {
      setProcessingChainKey(null);
    }
  };

  const addSelectedBranches = async () => {
    if (!canManageBranches) return setToast({ type: "info", msg: "No access" });
    if (!selectedSourceItems.length) return setToast({ type: "error", msg: "Select at least one branch first" });
    try {
      setAddingBranch(true);
      const results = await Promise.allSettled(
        selectedSourceItems.map((item) => api.addBranch({
          availabilityVendorId: item.availabilityVendorId,
          chainName: selectedChainName.trim(),
          name: item.name,
          ordersVendorId: item.ordersVendorId,
        })),
      );

      const failedAvailabilityVendorIds = selectedSourceItems
        .filter((_item, index) => results[index]?.status === "rejected")
        .map((item) => item.availabilityVendorId);
      const addedCount = results.length - failedAvailabilityVendorIds.length;

      await loadData({ silent: true });
      setSelectedAvailabilityVendorIds(failedAvailabilityVendorIds);

      if (!failedAvailabilityVendorIds.length) {
        setSelectedChainName("");
        setSourceQuery("");
        setToast({ type: "success", msg: `${formatBranchCount(addedCount)} added` });
        return;
      }

      if (addedCount > 0) {
        setToast({ type: "error", msg: `${formatBranchCount(addedCount)} added, ${formatBranchCount(failedAvailabilityVendorIds.length)} failed` });
        return;
      }

      setToast({ type: "error", msg: "Selected branches could not be added" });
    } catch (error) {
      setToast({ type: "error", msg: describeApiError(error, "Branch add failed") });
    } finally {
      setAddingBranch(false);
    }
  };

  const persistChains = async (nextChains: ChainThreshold[]) => {
    if (!canManageSettings) return setToast({ type: "info", msg: "Admins only" });
    const normalized = normalizeChains(nextChains);
    try {
      await api.putSettings({ chains: normalized });
      setThresholdForm((current) => ({ ...current, chains: normalized }));
      setSettings((current) => current ? { ...current, chainNames: normalized.map((item) => item.name), chains: normalized } : current);
      setEditingChainIndex(null);
      setChainEditor(emptyChainEditor());
      setToast({ type: "success", msg: "Chains saved" });
    } catch (error) {
      setToast({ type: "error", msg: describeApiError(error, "Chain save failed") });
    }
  };

  const upsertChain = async () => {
    const name = chainEditor.name.trim();
    const lateThreshold = Number(chainEditor.lateThreshold);
    const unassignedThreshold = Number(chainEditor.unassignedThreshold);
    if (!name) return setToast({ type: "error", msg: "Enter chain name" });
    if (!Number.isFinite(lateThreshold) || lateThreshold < 0 || !Number.isFinite(unassignedThreshold) || unassignedThreshold < 0) {
      return setToast({ type: "error", msg: "Enter valid thresholds" });
    }
    const nextChains = normalizeChains(thresholdForm.chains.filter((_item, index) => index !== editingChainIndex))
      .filter((item) => item.name.trim().toLowerCase() !== name.toLowerCase());
    nextChains.push({ name, lateThreshold: Math.round(lateThreshold), unassignedThreshold: Math.round(unassignedThreshold) });
    await persistChains(nextChains);
  };

  const saveGlobalThresholds = async () => {
    const lateThreshold = Number(thresholdForm.lateThreshold);
    const unassignedThreshold = Number(thresholdForm.unassignedThreshold);
    if (!canManageSettings) return setToast({ type: "info", msg: "Admins only" });
    if (!Number.isFinite(lateThreshold) || lateThreshold < 0 || !Number.isFinite(unassignedThreshold) || unassignedThreshold < 0) {
      return setToast({ type: "error", msg: "Enter valid thresholds" });
    }
    try {
      await api.putSettings({ lateThreshold: Math.round(lateThreshold), unassignedThreshold: Math.round(unassignedThreshold) });
      applySettings(await api.getSettings());
      setToast({ type: "success", msg: "Defaults saved" });
    } catch (error) {
      setToast({ type: "error", msg: describeApiError(error, "Default threshold save failed") });
    }
  };

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
    if (!canManageSettings) return setToast({ type: "info", msg: "Admins only" });
    const lateThreshold = Number(branchThresholdEditor.lateThreshold);
    const unassignedThreshold = Number(branchThresholdEditor.unassignedThreshold);
    if (!Number.isFinite(lateThreshold) || lateThreshold < 0 || !Number.isFinite(unassignedThreshold) || unassignedThreshold < 0) {
      return setToast({ type: "error", msg: "Enter valid branch thresholds" });
    }
    try {
      setSavingThresholdBranchId(branch.id);
      const response = await api.setBranchThresholdOverrides(branch.id, {
        lateThresholdOverride: Math.round(lateThreshold),
        unassignedThresholdOverride: Math.round(unassignedThreshold),
      });
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
    if (!canManageSettings) return setToast({ type: "info", msg: "Admins only" });
    try {
      setSavingThresholdBranchId(branch.id);
      const response = await api.setBranchThresholdOverrides(branch.id, {
        lateThresholdOverride: null,
        unassignedThresholdOverride: null,
      });
      setBranches((current) => current.map((item) => (item.id === branch.id ? response.item : item)));
      setEditingThresholdBranchId(null);
      setBranchThresholdEditor(emptyBranchThresholdEditor());
      setToast({ type: "success", msg: "Using inherited thresholds" });
    } catch (error) {
      setToast({ type: "error", msg: describeApiError(error, "Branch override reset failed") });
    } finally {
      setSavingThresholdBranchId(null);
    }
  };

  const renderBranchCard = (branch: BranchMappingItem) => {
    const effective = resolveEffectiveThresholds(branch, thresholdForm.chains, globalThresholds);
    const missing = branch.catalogState === "missing";
    return (
      <Box key={branch.id} sx={{ p: 1.2, borderRadius: 3, border: "1px solid rgba(148,163,184,0.12)", bgcolor: missing ? "rgba(255,251,235,0.82)" : "rgba(248,250,252,0.72)" }}>
        <Stack spacing={1}>
          <Stack direction={{ xs: "column", sm: "row" }} justifyContent="space-between" spacing={1}>
            <Box>
              <Typography sx={{ fontWeight: 900, color: "#0f172a" }}>{safeBranchName(branch)}</Typography>
              <Typography variant="caption" sx={{ color: "text.secondary" }}>
                {branch.ordersVendorId ? `Orders ${branch.ordersVendorId} • ` : "Orders unavailable • "}Availability {branch.availabilityVendorId}
              </Typography>
            </Box>
            <Button size="small" color="inherit" startIcon={<DeleteOutlineIcon />} onClick={() => void deleteBranch(branch.id)} disabled={!canDeleteBranches}>Delete</Button>
          </Stack>
          <Stack direction="row" spacing={0.75} useFlexGap flexWrap="wrap">
            <Chip size="small" label={`L ${effective.lateThreshold} · U ${effective.unassignedThreshold}`} />
            <Chip size="small" label={missing ? "Missing" : branch.enabled ? "In Monitor" : "Paused"} color={missing ? "warning" : branch.enabled ? "success" : "default"} />
          </Stack>
          <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 1 }}>
            <Typography variant="caption" sx={{ color: missing ? "#b45309" : "#475569", fontWeight: 700 }}>
              {missing ? "Disabled until it returns to the local catalog." : branch.enabled ? "Included in live monitor cycles" : "Skipped from live monitor cycles"}
            </Typography>
            <Switch
              checked={branch.enabled}
              onChange={(_event, checked) => void setBranchMonitoringState(branch, checked)}
              disabled={!canManageBranches || missing || savingMonitorBranchId === branch.id}
              inputProps={{ "aria-label": `Toggle monitor for ${safeBranchName(branch)}` }}
            />
          </Box>
        </Stack>
      </Box>
    );
  };

  const renderChainGroup = (group: SavedChainGroup) => {
    const expanded = expandedChainGroups[group.key] ?? false;
    const canToggleChain = group.availableCount > 0;
    const shouldResumeChain = group.enabledCount === 0 && group.availableCount > 0;
    const chainActionLabel = shouldResumeChain ? "Resume Chain" : "Pause Chain";
    const processing = processingChainKey === group.key;
    const chainActionTone = shouldResumeChain
      ? {
          color: "#166534",
          bgcolor: "rgba(220,252,231,0.82)",
          borderColor: "rgba(34,197,94,0.18)",
          shadowColor: "rgba(34,197,94,0.12)",
        }
      : {
          color: "#9a3412",
          bgcolor: "rgba(255,247,237,0.92)",
          borderColor: "rgba(249,115,22,0.18)",
          shadowColor: "rgba(249,115,22,0.12)",
        };

    return (
      <Box key={group.key}>
        <Box
          role="button"
          tabIndex={0}
          aria-label={`Toggle ${group.label} group`}
          aria-expanded={expanded}
          onClick={() => toggleChainGroup(group.key)}
          onKeyDown={(event: KeyboardEvent<HTMLDivElement>) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              toggleChainGroup(group.key);
            }
          }}
          sx={{
            px: 1.2,
            py: 1.05,
            borderRadius: 3,
            border: "1px solid rgba(148,163,184,0.14)",
            bgcolor: "rgba(255,255,255,0.94)",
            cursor: "pointer",
            transition: "border-color 160ms ease, box-shadow 160ms ease, background-color 160ms ease",
            "&:hover": {
              borderColor: "rgba(100,116,139,0.24)",
              boxShadow: "0 12px 28px rgba(15,23,42,0.06)",
              bgcolor: "rgba(255,255,255,0.98)",
            },
            "&:focus-visible": {
              outline: "2px solid rgba(37,99,235,0.22)",
              outlineOffset: 2,
            },
          }}
        >
          <Stack direction={{ xs: "column", md: "row" }} spacing={1.1} alignItems={{ xs: "flex-start", md: "center" }} justifyContent="space-between">
            <Stack direction="row" spacing={1} alignItems="center" sx={{ minWidth: 0, flex: 1 }}>
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
                <Typography sx={{ fontWeight: 900, color: "#0f172a" }}>{group.label}</Typography>
                <Typography variant="caption" sx={{ color: "text.secondary", display: { xs: "none", sm: "block" } }}>
                  {formatBranchCount(group.branches.length)} • {expanded ? "Click to collapse" : "Click to expand"}
                </Typography>
              </Box>
            </Stack>

            <Stack direction={{ xs: "column", sm: "row" }} spacing={0.8} alignItems={{ xs: "stretch", sm: "center" }} sx={{ width: { xs: "100%", md: "auto" } }}>
              <Stack direction="row" spacing={0.7} flexWrap="wrap">
                <Chip size="small" label={`Total ${group.branches.length}`} sx={{ fontWeight: 900, bgcolor: "rgba(15,23,42,0.06)", color: "#0f172a" }} />
                {group.enabledCount ? <Chip size="small" label={`Live ${group.enabledCount}`} sx={{ fontWeight: 900, bgcolor: "rgba(236,253,245,0.92)", color: "#166534" }} /> : null}
                {group.pausedCount ? <Chip size="small" label={`Paused ${group.pausedCount}`} sx={{ fontWeight: 900, bgcolor: "rgba(241,245,249,0.95)", color: "#334155" }} /> : null}
                {group.missingCount ? <Chip size="small" label={`Missing ${group.missingCount}`} sx={{ fontWeight: 900, bgcolor: "rgba(255,247,237,0.95)", color: "#b45309" }} /> : null}
              </Stack>
              <Stack direction="row" spacing={0.65} sx={{ flexWrap: "wrap" }}>
                <Tooltip title={processing ? `${chainActionLabel}...` : chainActionLabel}>
                  <span>
                    <IconButton
                      size="small"
                      aria-label={chainActionLabel}
                      disabled={!canManageBranches || !canToggleChain || processing}
                      onClick={(event) => {
                        event.stopPropagation();
                        void setChainMonitoringState(group, shouldResumeChain);
                      }}
                      sx={{
                        width: 36,
                        height: 36,
                        borderRadius: "12px",
                        color: chainActionTone.color,
                        bgcolor: chainActionTone.bgcolor,
                        border: `1px solid ${chainActionTone.borderColor}`,
                        boxShadow: `0 8px 18px ${chainActionTone.shadowColor}`,
                        transition: "transform 160ms ease, background-color 160ms ease, box-shadow 160ms ease, color 160ms ease",
                        "@keyframes chainActionPulse": {
                          "0%": { transform: "scale(1)" },
                          "50%": { transform: "scale(0.95)" },
                          "100%": { transform: "scale(1)" },
                        },
                        ...(processing ? { animation: "chainActionPulse 900ms ease-in-out infinite" } : null),
                        "&:hover": {
                          bgcolor: shouldResumeChain ? "rgba(220,252,231,0.98)" : "rgba(255,237,213,0.98)",
                          transform: "translateY(-1px)",
                          boxShadow: `0 12px 22px ${chainActionTone.shadowColor}`,
                        },
                        "&.Mui-disabled": {
                          bgcolor: "rgba(241,245,249,0.92)",
                          color: "rgba(100,116,139,0.58)",
                          borderColor: "rgba(148,163,184,0.16)",
                          boxShadow: "none",
                        },
                      }}
                    >
                      {shouldResumeChain ? <PlayCircleOutlineRoundedIcon sx={{ fontSize: 21 }} /> : <PauseCircleOutlineRoundedIcon sx={{ fontSize: 21 }} />}
                    </IconButton>
                  </span>
                </Tooltip>
                <Tooltip title={processing ? "Delete disabled while another chain action is running" : "Delete Chain"}>
                  <span>
                    <IconButton
                      size="small"
                      aria-label="Delete Chain"
                      disabled={!canDeleteBranches || processing}
                      onClick={(event) => {
                        event.stopPropagation();
                        void deleteChainBranches(group);
                      }}
                      sx={{
                        width: 36,
                        height: 36,
                        borderRadius: "12px",
                        color: "#b91c1c",
                        bgcolor: "rgba(254,242,242,0.96)",
                        border: "1px solid rgba(248,113,113,0.2)",
                        boxShadow: "0 8px 18px rgba(239,68,68,0.1)",
                        transition: "transform 160ms ease, background-color 160ms ease, box-shadow 160ms ease, color 160ms ease",
                        "&:hover": {
                          bgcolor: "rgba(254,226,226,0.98)",
                          transform: "translateY(-1px)",
                          boxShadow: "0 12px 22px rgba(239,68,68,0.14)",
                        },
                        "&.Mui-disabled": {
                          bgcolor: "rgba(241,245,249,0.92)",
                          color: "rgba(100,116,139,0.58)",
                          borderColor: "rgba(148,163,184,0.16)",
                          boxShadow: "none",
                        },
                      }}
                    >
                      <DeleteSweepRoundedIcon sx={{ fontSize: 21 }} />
                    </IconButton>
                  </span>
                </Tooltip>
              </Stack>
            </Stack>
          </Stack>
        </Box>

        <Collapse in={expanded} timeout={220} unmountOnExit>
          <Stack spacing={1} sx={{ pt: 1 }}>
            {group.branches.map(renderBranchCard)}
          </Stack>
        </Collapse>
      </Box>
    );
  };

  return (
    <Box sx={{ minHeight: "100vh", bgcolor: "background.default" }}>
      <TopBar running={monitoring.running} degraded={monitoring.degraded} onStart={onStart} onStop={onStop} canControlMonitor={canManageMonitor} />
      <Box sx={{ p: { xs: 2, md: 3 }, display: "grid", gap: 2 }}>
        {loadError ? <Alert severity="error" variant="outlined">{loadError}</Alert> : null}

        <Card>
          <CardContent sx={{ display: "grid", gap: 2, gridTemplateColumns: { xs: "1fr", xl: "1.2fr 0.95fr" } }}>
            <Stack spacing={1.25}>
              <Stack direction={{ xs: "column", sm: "row" }} spacing={1} justifyContent="space-between" alignItems={{ xs: "flex-start", sm: "center" }}>
                <Typography sx={{ fontWeight: 900 }}>Saved Branches</Typography>
                <Stack direction="row" spacing={0.8} flexWrap="wrap">
                  <Chip
                    size="small"
                    label={`${formatBranchCount(filteredBranches.length)} in view`}
                    sx={{ fontWeight: 900, bgcolor: "rgba(15,23,42,0.06)", color: "#0f172a" }}
                  />
                  <Chip
                    size="small"
                    label={`${savedChainGroups.length} chain${savedChainGroups.length === 1 ? "" : "s"}`}
                    sx={{ fontWeight: 900, bgcolor: "rgba(37,99,235,0.10)", color: "#1d4ed8" }}
                  />
                </Stack>
              </Stack>
              <TextField
                placeholder="Search saved branches or vendor IDs"
                value={branchQuery}
                onChange={(event) => setBranchQuery(event.target.value)}
                size="small"
                InputProps={{ startAdornment: <InputAdornment position="start"><SearchRoundedIcon fontSize="small" /></InputAdornment> }}
              />
              {savedChainGroups.length ? (
                <Stack spacing={1}>
                  {savedChainGroups.map(renderChainGroup)}
                </Stack>
              ) : (
                <Alert severity="info" variant="outlined">No saved branches in this view.</Alert>
              )}
            </Stack>

            <Stack spacing={1.25}>
              <Stack direction={{ xs: "column", sm: "row" }} spacing={1} justifyContent="space-between" alignItems={{ xs: "flex-start", sm: "center" }}>
                <Typography sx={{ fontWeight: 900 }}>Add From Local Source</Typography>
                <Stack direction="row" spacing={0.8} flexWrap="wrap">
                  <Chip
                    size="small"
                    label={`Selected ${selectedSourceItems.length}`}
                    sx={{ fontWeight: 900, bgcolor: "rgba(37,99,235,0.10)", color: "#1d4ed8" }}
                  />
                  <Button
                    size="small"
                    color="inherit"
                    onClick={toggleVisibleSourceSelection}
                    disabled={!visibleAddableSourceItems.length}
                    sx={{ borderRadius: 999, fontWeight: 800 }}
                  >
                    {allVisibleAddableSelected ? "Clear Visible" : "Select Visible"}
                  </Button>
                  <Button
                    size="small"
                    color="inherit"
                    onClick={clearSelectedSourceItems}
                    disabled={!selectedSourceItems.length}
                    sx={{ borderRadius: 999, fontWeight: 800 }}
                  >
                    Clear Selection
                  </Button>
                </Stack>
              </Stack>
              <TextField
                placeholder="Search by branch name or availability ID"
                value={sourceQuery}
                onChange={(event) => setSourceQuery(event.target.value)}
                size="small"
                InputProps={{ startAdornment: <InputAdornment position="start"><SearchRoundedIcon fontSize="small" /></InputAdornment> }}
              />
              {selectedSourceItems.length ? (
                <Box sx={{ p: 1.25, borderRadius: 3, border: "1px solid rgba(37,99,235,0.14)", bgcolor: "rgba(239,246,255,0.9)" }}>
                  <Stack spacing={1.1}>
                    <Box>
                      <Typography sx={{ fontWeight: 900, color: "#0f172a" }}>Ready to add {formatBranchCount(selectedSourceItems.length)}</Typography>
                      <Typography variant="caption" sx={{ color: "text.secondary" }}>
                        Apply one chain to all selected branches, then add them in one step.
                      </Typography>
                    </Box>
                    <Stack direction="row" spacing={0.75} useFlexGap flexWrap="wrap">
                      {selectedSourceItems.slice(0, 8).map((item) => (
                        <Chip
                          key={item.availabilityVendorId}
                          label={item.name}
                          onDelete={() => toggleSourceSelection(item.availabilityVendorId)}
                          sx={{ maxWidth: "100%", "& .MuiChip-label": { display: "block", overflow: "hidden", textOverflow: "ellipsis" } }}
                        />
                      ))}
                      {selectedSourceItems.length > 8 ? (
                        <Chip
                          label={`+${selectedSourceItems.length - 8} more`}
                          sx={{ fontWeight: 900, bgcolor: "rgba(15,23,42,0.06)", color: "#334155" }}
                        />
                      ) : null}
                    </Stack>
                    <TextField select label="Chain for selected branches" value={selectedChainName} onChange={(event) => setSelectedChainName(event.target.value)} disabled={!canManageBranches || addingBranch} fullWidth>
                      <MenuItem value="">No Chain</MenuItem>
                      {chainOptions.map((chainName) => <MenuItem key={chainName} value={chainName}>{chainName}</MenuItem>)}
                    </TextField>
                    <Button variant="contained" startIcon={<AddRoundedIcon />} onClick={() => void addSelectedBranches()} disabled={!canManageBranches || addingBranch || !selectedSourceItems.length}>
                      {addingBranch ? `Adding ${selectedSourceItems.length}...` : `Add ${formatBranchCount(selectedSourceItems.length)}`}
                    </Button>
                  </Stack>
                </Box>
              ) : null}
              {!deferredSourceQuery.trim() ? (
                <Alert severity="info" variant="outlined">Start typing to search source branches.</Alert>
              ) : sourceSearchResults.length ? (
                <Stack spacing={0.75} sx={{ maxHeight: 320, overflowY: "auto" }}>
                  {sourceSearchResults.map((item) => (
                    <Box
                      key={item.availabilityVendorId}
                      role="button"
                      tabIndex={0}
                      aria-label={item.alreadyAdded ? `${item.name} already added` : `Select ${item.name}`}
                      onClick={() => {
                        if (item.alreadyAdded) return;
                        toggleSourceSelection(item.availabilityVendorId);
                      }}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          if (item.alreadyAdded) return;
                          toggleSourceSelection(item.availabilityVendorId);
                        }
                      }}
                      sx={{
                        p: 1.1,
                        borderRadius: 2.5,
                        border: selectedAvailabilityVendorIdSet.has(item.availabilityVendorId) ? "1px solid rgba(37,99,235,0.26)" : "1px solid rgba(148,163,184,0.12)",
                        bgcolor: selectedAvailabilityVendorIdSet.has(item.availabilityVendorId) ? "rgba(37,99,235,0.06)" : item.alreadyAdded ? "rgba(241,245,249,0.82)" : "rgba(248,250,252,0.72)",
                        cursor: item.alreadyAdded ? "default" : "pointer",
                        opacity: item.alreadyAdded ? 0.78 : 1,
                      }}
                    >
                      <Stack direction="row" spacing={1} alignItems="flex-start">
                        <Checkbox
                          checked={selectedAvailabilityVendorIdSet.has(item.availabilityVendorId)}
                          disabled={item.alreadyAdded}
                          onClick={(event) => event.stopPropagation()}
                          onChange={() => toggleSourceSelection(item.availabilityVendorId)}
                          inputProps={{ "aria-label": `Select ${item.name}` }}
                          sx={{ mt: -0.35, ml: -0.35 }}
                        />
                        <Box sx={{ minWidth: 0, flex: 1 }}>
                          <Stack direction={{ xs: "column", sm: "row" }} spacing={0.8} justifyContent="space-between" alignItems={{ xs: "flex-start", sm: "center" }}>
                            <Typography sx={{ fontWeight: 900 }}>{item.name}</Typography>
                            <Chip
                              size="small"
                              label={item.alreadyAdded ? "Saved" : selectedAvailabilityVendorIdSet.has(item.availabilityVendorId) ? "Selected" : "Ready"}
                              color={item.alreadyAdded ? "default" : selectedAvailabilityVendorIdSet.has(item.availabilityVendorId) ? "primary" : "success"}
                            />
                          </Stack>
                          <Typography variant="caption" sx={{ color: "text.secondary" }}>Availability {item.availabilityVendorId} • Orders {item.ordersVendorId}</Typography>
                        </Box>
                      </Stack>
                    </Box>
                  ))}
                </Stack>
              ) : (
                <Alert severity="info" variant="outlined">No branch match.</Alert>
              )}
            </Stack>
          </CardContent>
        </Card>

        <Card>
          <CardContent sx={{ display: "grid", gap: 2 }}>
            <Tabs value={rulesMode} onChange={(_event, value) => setRulesMode(value)} sx={{ minHeight: 42 }}>
              <Tab value="chains" label="Chains" />
              <Tab value="overrides" label="Overrides" />
            </Tabs>

            <Stack direction={{ xs: "column", sm: "row" }} spacing={1.2}>
              <TextField label="Default Late Threshold" type="number" size="small" value={thresholdForm.lateThreshold} onChange={(event) => setThresholdForm((current) => ({ ...current, lateThreshold: Number(event.target.value) }))} disabled={!canManageSettings} />
              <TextField label="Default Unassigned Threshold" type="number" size="small" value={thresholdForm.unassignedThreshold} onChange={(event) => setThresholdForm((current) => ({ ...current, unassignedThreshold: Number(event.target.value) }))} disabled={!canManageSettings} />
              <Button variant="contained" onClick={() => void saveGlobalThresholds()} disabled={!canManageSettings}>Save Defaults</Button>
            </Stack>

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
          </CardContent>
        </Card>
      </Box>

      <Snackbar open={!!toast} autoHideDuration={2500} onClose={() => setToast(null)} anchorOrigin={{ vertical: "bottom", horizontal: "center" }}>
        {toast ? <Alert severity={toast.type}>{toast.msg}</Alert> : undefined}
      </Snackbar>
    </Box>
  );
}

export { Mapping as MappingPage };
