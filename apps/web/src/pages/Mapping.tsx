import AddRoundedIcon from "@mui/icons-material/AddRounded";
import AutoFixHighRoundedIcon from "@mui/icons-material/AutoFixHighRounded";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import EditOutlinedIcon from "@mui/icons-material/EditOutlined";
import ExpandMoreRoundedIcon from "@mui/icons-material/ExpandMoreRounded";
import RestartAltRoundedIcon from "@mui/icons-material/RestartAltRounded";
import SearchRoundedIcon from "@mui/icons-material/SearchRounded";
import { Alert, Box, Button, Card, CardContent, Chip, Collapse, Container, IconButton, InputAdornment, MenuItem, Snackbar, Stack, Switch, Tab, Tabs, TextField, Typography, useMediaQuery, useTheme } from "@mui/material";
import { useEffect, useMemo, useState } from "react";
import { api, describeApiError } from "../api/client";
import { useAuth } from "../app/providers/AuthProvider";
import { useMonitorStatus } from "../app/providers/MonitorStatusProvider";
import type { BranchMappingItem, ChainThreshold, SettingsMasked, ThresholdProfile } from "../api/types";
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

function emptyBranchForm(globalEntityId = "HF_EG") {
  return {
    name: "",
    chainName: "",
    ordersVendorId: "",
    availabilityVendorId: "",
    globalEntityId,
    enabled: true,
  };
}

function emptyChainEditor() {
  return { name: "", lateThreshold: "5", unassignedThreshold: "5" };
}

function emptyBranchThresholdEditor() {
  return { lateThreshold: "", unassignedThreshold: "" };
}

function describeBranchSaveError(error: unknown, fallback: string) {
  const message = describeApiError(error, fallback);
  if (/unique constraint failed/i.test(message) && message.includes("availabilityVendorId")) {
    return "Availability Vendor ID already exists";
  }
  if (/unique constraint failed/i.test(message) && message.includes("ordersVendorId")) {
    return "Orders Vendor ID already exists";
  }
  return message;
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
  if (chainKey) {
    const chain = chains.find((item) => item.name.trim().toLowerCase() === chainKey);
    if (chain) {
      return {
        lateThreshold: chain.lateThreshold,
        unassignedThreshold: chain.unassignedThreshold,
        source: "chain" as const,
      };
    }
  }

  return {
    lateThreshold: globalThresholds.lateThreshold,
    unassignedThreshold: globalThresholds.unassignedThreshold,
    source: "global" as const,
  };
}

function sourceTone(source: ThresholdProfile["source"] | "branch" | "chain" | "global") {
  if (source === "branch") {
    return { bg: "rgba(14,165,233,0.10)", color: "#0369a1" };
  }
  if (source === "chain") {
    return { bg: "rgba(15,23,42,0.06)", color: "#334155" };
  }
  return { bg: "rgba(148,163,184,0.12)", color: "#475569" };
}

function sectionCardSx() {
  return {
    borderRadius: 4,
    border: "1px solid rgba(148,163,184,0.14)",
    boxShadow: "0 18px 40px rgba(15,23,42,0.06)",
  };
}

export function Mapping() {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("sm"));
  const { canManageBranches, canDeleteBranches, canManageMonitor, canManageSettings } = useAuth();
  const { monitoring, startMonitoring, stopMonitoring } = useMonitorStatus();

  const [settings, setSettings] = useState<SettingsMasked | null>(null);
  const [branches, setBranches] = useState<BranchMappingItem[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [toast, setToast] = useState<{ type: "success" | "error" | "info"; msg: string } | null>(null);
  const [defaultGlobalEntityId, setDefaultGlobalEntityId] = useState("HF_EG");
  const [branchForm, setBranchForm] = useState<any>(emptyBranchForm());
  const [editingBranchId, setEditingBranchId] = useState<number | null>(null);
  const [autoNameLoading, setAutoNameLoading] = useState(false);
  const [branchQuery, setBranchQuery] = useState("");
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
  const [mobileStudioSection, setMobileStudioSection] = useState<"branches" | "editor">("branches");
  const [mobileRulesSection, setMobileRulesSection] = useState<"base" | "rules">("rules");
  const [pausedExpanded, setPausedExpanded] = useState(true);
  const [monitoredExpanded, setMonitoredExpanded] = useState(true);

  const applySettings = (nextSettings: SettingsMasked) => {
    const normalizedChains = normalizeChains(nextSettings.chains);
    setSettings(nextSettings);
    setDefaultGlobalEntityId(nextSettings.globalEntityId);
    setThresholdForm({
      chains: normalizedChains,
      lateThreshold: nextSettings.lateThreshold,
      unassignedThreshold: nextSettings.unassignedThreshold,
    });
    setBranchForm((current: any) => (
      editingBranchId === null
        ? { ...current, globalEntityId: current.globalEntityId || nextSettings.globalEntityId }
        : current
    ));
  };

  const loadMappingData = async (options?: { silent?: boolean }) => {
    try {
      const [settingsResponse, branchResponse] = await Promise.all([api.getSettings(), api.listBranches()]);
      applySettings(settingsResponse);
      setBranches(branchResponse.items);
      setLoadError(null);
      return { ok: true as const };
    } catch (error) {
      const message = describeApiError(error, "Failed to load mapping");
      setLoadError(message);
      if (!options?.silent) {
        setToast({ type: "error", msg: message });
      }
      return { ok: false as const, message };
    }
  };

  useEffect(() => {
    void loadMappingData();
  }, []);

  const resetBranchEditor = () => {
    setEditingBranchId(null);
    setBranchForm(emptyBranchForm(defaultGlobalEntityId));
  };

  const resetChainEditor = () => {
    setEditingChainIndex(null);
    setChainEditor(emptyChainEditor());
  };

  const resetBranchThresholdEditor = () => {
    setEditingThresholdBranchId(null);
    setBranchThresholdEditor(emptyBranchThresholdEditor());
  };

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

  const saveBranch = async () => {
    if (!canManageBranches) {
      setToast({ type: "info", msg: "No access" });
      return;
    }

    try {
      const payload = {
        name: branchForm.name,
        chainName: String(branchForm.chainName ?? ""),
        ordersVendorId: Number(branchForm.ordersVendorId),
        availabilityVendorId: String(branchForm.availabilityVendorId),
        globalEntityId: branchForm.globalEntityId,
        enabled: !!branchForm.enabled,
      };

      if (editingBranchId !== null) {
        await api.updateBranch(editingBranchId, payload);
        setToast({ type: "success", msg: "Updated" });
      } else {
        await api.addBranch(payload);
        setToast({ type: "success", msg: "Added" });
      }

      resetBranchEditor();
      if (isMobile) setMobileStudioSection("branches");
      await loadMappingData({ silent: true });
    } catch (error) {
      setToast({
        type: "error",
        msg: describeBranchSaveError(error, editingBranchId !== null ? "Update failed" : "Add failed"),
      });
    }
  };

  const startBranchEdit = (branch: BranchMappingItem) => {
    if (!canManageBranches) return;
    setEditingBranchId(branch.id);
    if (isMobile) setMobileStudioSection("editor");
    setBranchForm({
      name: branch.name,
      chainName: branch.chainName ?? "",
      ordersVendorId: String(branch.ordersVendorId),
      availabilityVendorId: String(branch.availabilityVendorId),
      globalEntityId: branch.globalEntityId,
      enabled: !!branch.enabled,
    });
  };

  const deleteBranch = async (branchId: number) => {
    if (!canDeleteBranches) {
      setToast({ type: "info", msg: "Admins only" });
      return;
    }
    try {
      await api.deleteBranch(branchId);
      setToast({ type: "success", msg: "Deleted" });
      if (editingBranchId === branchId) resetBranchEditor();
      if (editingThresholdBranchId === branchId) resetBranchThresholdEditor();
      await loadMappingData({ silent: true });
    } catch (error) {
      setToast({ type: "error", msg: describeApiError(error, "Delete failed") });
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
      if (editingBranchId === branch.id) {
        setBranchForm((current: any) => ({ ...current, enabled: response.item.enabled }));
      }
      setToast({ type: "success", msg: enabled ? "Branch live in monitor" : "Branch paused from monitor" });
    } catch (error) {
      setToast({ type: "error", msg: describeApiError(error, "Monitor state update failed") });
    } finally {
      setSavingMonitorBranchId(null);
    }
  };

  const fetchBranchName = async () => {
    if (!canManageBranches) {
      setToast({ type: "info", msg: "No access" });
      return;
    }

    const vendorId = Number(branchForm.ordersVendorId);
    if (!vendorId) {
      setToast({ type: "error", msg: "Enter Orders Vendor ID" });
      return;
    }

    try {
      setAutoNameLoading(true);
      const response = await api.lookupVendorName(vendorId, branchForm.globalEntityId);
      if (response.name) {
        setBranchForm((current: any) => ({ ...current, name: response.name }));
        setToast({ type: "success", msg: response.note });
      } else {
        setToast({ type: "info", msg: response.note });
      }
    } catch (error) {
      setToast({ type: "error", msg: describeApiError(error, "Name lookup failed") });
    } finally {
      setAutoNameLoading(false);
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
      const fresh = await api.getSettings();
      applySettings(fresh);
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
      setSettings((current) => (
        current
          ? {
              ...current,
              chainNames: normalized.map((item) => item.name),
              chains: normalized,
            }
          : current
      ));
      setThresholdForm((current) => ({ ...current, chains: normalized }));
      resetChainEditor();
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

    nextChains.push({
      name,
      lateThreshold: Math.round(lateThreshold),
      unassignedThreshold: Math.round(unassignedThreshold),
    });

    await persistChains(nextChains);
  };

  const removeChain = async (index: number) => {
    if (!canManageSettings) {
      setToast({ type: "info", msg: "Admins only" });
      return;
    }
    await persistChains(thresholdForm.chains.filter((_item, itemIndex) => itemIndex !== index));
  };

  const startChainEdit = (chain: ChainThreshold, index: number) => {
    if (!canManageSettings) return;
    setEditingChainIndex(index);
    setChainEditor({
      name: chain.name,
      lateThreshold: String(chain.lateThreshold),
      unassignedThreshold: String(chain.unassignedThreshold),
    });
    setRulesMode("chains");
  };

  const globalThresholds = {
    lateThreshold: Number(thresholdForm.lateThreshold ?? settings?.lateThreshold ?? 5),
    unassignedThreshold: Number(thresholdForm.unassignedThreshold ?? settings?.unassignedThreshold ?? 5),
  };

  const buildBranchPayload = (branch: BranchMappingItem, overrides: { lateThresholdOverride: number | null; unassignedThresholdOverride: number | null }) => ({
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

    if (!Number.isFinite(lateThreshold) || lateThreshold < 0) {
      setToast({ type: "error", msg: "Enter valid branch late threshold" });
      return;
    }
    if (!Number.isFinite(unassignedThreshold) || unassignedThreshold < 0) {
      setToast({ type: "error", msg: "Enter valid branch unassigned threshold" });
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
      resetBranchThresholdEditor();
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
        buildBranchPayload(branch, {
          lateThresholdOverride: null,
          unassignedThresholdOverride: null,
        }),
      );
      setBranches((current) => current.map((item) => (item.id === branch.id ? response.item : item)));
      if (editingThresholdBranchId === branch.id) {
        resetBranchThresholdEditor();
      }
      setToast({ type: "success", msg: "Using inherited" });
    } catch (error) {
      setToast({ type: "error", msg: describeApiError(error, "Branch override reset failed") });
    } finally {
      setSavingThresholdBranchId(null);
    }
  };

  const branchCount = branches.length;
  const monitoredBranchCount = branches.filter((branch) => branch.enabled).length;
  const pausedBranchCount = branchCount - monitoredBranchCount;
  const customOverrideCount = branches.filter((branch) => typeof branch.lateThresholdOverride === "number").length;
  const filteredBranches = useMemo(() => {
    const query = branchQuery.trim().toLowerCase();
    if (!query) return branches;
    return branches.filter((branch) => (
      branch.name.toLowerCase().includes(query) ||
      branch.chainName.toLowerCase().includes(query) ||
      String(branch.ordersVendorId).includes(query) ||
      branch.availabilityVendorId.toLowerCase().includes(query)
    ));
  }, [branchQuery, branches]);
  const filteredPausedBranches = useMemo(
    () => filteredBranches.filter((branch) => !branch.enabled),
    [filteredBranches],
  );
  const filteredMonitoredBranches = useMemo(
    () => filteredBranches.filter((branch) => branch.enabled),
    [filteredBranches],
  );

  const branchFormChainOptions = useMemo(() => {
    const available = thresholdForm.chains.map((chain) => chain.name);
    if (branchForm.chainName && !available.includes(branchForm.chainName)) {
      return [...available, branchForm.chainName].sort((a, b) => a.localeCompare(b));
    }
    return available;
  }, [branchForm.chainName, thresholdForm.chains]);

  const renderBranchCard = (branch: BranchMappingItem) => {
    const selected = editingBranchId === branch.id;
    const effective = resolveEffectiveThresholds(branch, thresholdForm.chains, globalThresholds);
    const tone = sourceTone(effective.source);
    const paused = !branch.enabled;
    const savingMonitoring = savingMonitorBranchId === branch.id;

    return (
      <Box
        key={branch.id}
        sx={{
          p: 1.2,
          borderRadius: 3,
          border: paused
            ? "1px solid rgba(99,102,241,0.16)"
            : selected
              ? "1px solid rgba(37,99,235,0.20)"
              : "1px solid rgba(148,163,184,0.10)",
          bgcolor: paused
            ? "rgba(238,242,255,0.72)"
            : selected
              ? "rgba(37,99,235,0.05)"
              : "rgba(255,255,255,0.88)",
          boxShadow: paused
            ? "0 10px 24px rgba(99,102,241,0.08)"
            : selected
              ? "0 12px 24px rgba(37,99,235,0.10)"
              : "0 6px 18px rgba(15,23,42,0.04)",
          transition: "transform 140ms ease, box-shadow 140ms ease, border-color 140ms ease",
          "&:hover": {
            transform: "translateY(-1px)",
            boxShadow: paused ? "0 14px 28px rgba(99,102,241,0.10)" : "0 10px 22px rgba(15,23,42,0.06)",
            borderColor: paused ? "rgba(79,70,229,0.20)" : "rgba(59,130,246,0.18)",
          },
        }}
      >
        <Stack spacing={1}>
          <Stack direction={{ xs: "column", sm: "row" }} spacing={0.85} justifyContent="space-between" alignItems={{ xs: "stretch", sm: "flex-start" }}>
            <Stack direction="row" spacing={1} sx={{ minWidth: 0, flex: 1 }}>
              <Box
                sx={{
                  width: 40,
                  minWidth: 40,
                  height: 40,
                  borderRadius: 2.4,
                  display: "grid",
                  placeItems: "center",
                  bgcolor: paused
                    ? "rgba(99,102,241,0.14)"
                    : selected
                      ? "rgba(37,99,235,0.14)"
                      : "rgba(15,23,42,0.06)",
                  color: paused ? "#4338ca" : selected ? "#1d4ed8" : "#334155",
                  fontWeight: 900,
                  fontSize: 13,
                }}
              >
                {branch.id}
              </Box>

              <Box sx={{ minWidth: 0, flex: 1 }}>
                <Typography sx={{ fontWeight: 900, color: "#0f172a" }} noWrap>
                  {branch.name}
                </Typography>
                <Typography variant="caption" sx={{ color: "text.secondary" }} noWrap>
                  Orders {branch.ordersVendorId} • Availability {branch.availabilityVendorId}
                </Typography>
              </Box>
            </Stack>

            <Stack direction="row" spacing={0.35} justifyContent={{ xs: "flex-end", sm: "flex-start" }}>
              <IconButton
                onClick={() => startBranchEdit(branch)}
                color={selected ? "primary" : "default"}
                disabled={!canManageBranches}
                size="small"
                sx={{ borderRadius: 2 }}
              >
                <EditOutlinedIcon fontSize="small" />
              </IconButton>
              <IconButton
                onClick={() => deleteBranch(branch.id)}
                disabled={!canDeleteBranches}
                size="small"
                sx={{ borderRadius: 2 }}
              >
                <DeleteOutlineIcon fontSize="small" />
              </IconButton>
            </Stack>
          </Stack>

          <Stack direction="row" spacing={0.7} flexWrap="wrap" useFlexGap>
            <Chip
              size="small"
              label={branch.chainName || "No chain"}
              sx={{ fontWeight: 800, bgcolor: "rgba(15,23,42,0.06)", color: "#334155" }}
            />
            <Chip
              size="small"
              label={`L ${effective.lateThreshold} · U ${effective.unassignedThreshold}`}
              sx={{ fontWeight: 800, bgcolor: tone.bg, color: tone.color }}
            />
            <Chip
              size="small"
              label={(
                <>
                  <Box component="span" sx={{ display: { xs: "inline", sm: "none" } }}>
                    {paused ? "Paused" : "Live"}
                  </Box>
                  <Box component="span" sx={{ display: { xs: "none", sm: "inline" } }}>
                    {paused ? "Paused" : "In Monitor"}
                  </Box>
                </>
              )}
              sx={{
                fontWeight: 800,
                bgcolor: paused ? "rgba(99,102,241,0.12)" : "rgba(22,163,74,0.10)",
                color: paused ? "#4338ca" : "#166534",
              }}
            />
          </Stack>

          <Box
            sx={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 1,
              px: 0.2,
            }}
          >
            <Box>
              <Typography variant="caption" sx={{ color: "#64748b", fontWeight: 800, display: { xs: "none", sm: "block" } }}>
                Monitor
              </Typography>
              <Typography variant="caption" sx={{ display: { xs: "none", sm: "block" }, color: paused ? "#4338ca" : "#166534", fontWeight: 800 }}>
                {paused ? "Skipped from live cycles" : "Included in live cycles"}
              </Typography>
              <Typography variant="caption" sx={{ display: { xs: "block", sm: "none" }, color: paused ? "#4338ca" : "#166534", fontWeight: 800 }}>
                {paused ? "Paused from monitor" : "Live in monitor"}
              </Typography>
            </Box>
            <Switch
              checked={branch.enabled}
              onChange={(_event, checked) => void setBranchMonitoringState(branch, checked)}
              disabled={!canManageBranches || savingMonitoring}
              inputProps={{ "aria-label": `Toggle monitor for ${branch.name}` }}
            />
          </Box>
        </Stack>
      </Box>
    );
  };

  const renderBranchSectionHeader = (options: {
    label: string;
    count: number;
    expanded: boolean;
    onToggle: () => void;
    tone: "paused" | "live";
  }) => (
    <Box
      role="button"
      tabIndex={0}
      onClick={options.onToggle}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          options.onToggle();
        }
      }}
      sx={{
        p: 1,
        borderRadius: 2.6,
        border: options.tone === "paused" ? "1px solid rgba(99,102,241,0.12)" : "1px solid rgba(22,163,74,0.12)",
        bgcolor: options.tone === "paused" ? "rgba(238,242,255,0.72)" : "rgba(240,253,244,0.8)",
        cursor: "pointer",
        transition: "border-color 140ms ease, box-shadow 140ms ease, background-color 140ms ease",
        "&:hover": {
          borderColor: options.tone === "paused" ? "rgba(79,70,229,0.18)" : "rgba(22,163,74,0.18)",
          boxShadow: "0 10px 22px rgba(15,23,42,0.05)",
        },
        "&:focus-visible": {
          outline: "2px solid rgba(37,99,235,0.24)",
          outlineOffset: 2,
        },
      }}
    >
      <Stack direction="row" justifyContent="space-between" alignItems="center" gap={1}>
        <Stack direction="row" spacing={0.9} alignItems="center" sx={{ minWidth: 0 }}>
          <ExpandMoreRoundedIcon
            sx={{
              color: options.tone === "paused" ? "#4338ca" : "#166534",
              transform: options.expanded ? "rotate(180deg)" : "rotate(90deg)",
              transition: "transform 180ms ease",
            }}
          />
          <Typography sx={{ fontWeight: 900, color: options.tone === "paused" ? "#312e81" : "#166534" }}>
            {options.label}
          </Typography>
        </Stack>
        <Chip
          size="small"
          label={options.count}
          sx={{
            fontWeight: 900,
            bgcolor: options.tone === "paused" ? "rgba(99,102,241,0.12)" : "rgba(22,163,74,0.10)",
            color: options.tone === "paused" ? "#4338ca" : "#166534",
          }}
        />
      </Stack>
    </Box>
  );

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
        {loadError ? (
          <Alert severity="error" variant="outlined" sx={{ mb: 2 }}>
            {loadError}
          </Alert>
        ) : null}

        <Box
          sx={{
            display: "grid",
            gap: { xs: 1.5, md: 2 },
            gridTemplateColumns: { xs: "1fr", xl: "minmax(0, 1.22fr) minmax(370px, 0.92fr)" },
            alignItems: "start",
          }}
        >
          <Card sx={sectionCardSx()}>
            <CardContent
              sx={{
                p: { xs: 1.35, md: 1.8 },
                display: "grid",
                gap: 2,
                gridTemplateColumns: { xs: "1fr", lg: "minmax(0, 1.08fr) minmax(330px, 0.92fr)" },
              }}
            >
              {isMobile ? (
                <Box
                  sx={{
                    gridColumn: "1 / -1",
                    borderRadius: 999,
                    border: "1px solid rgba(148,163,184,0.14)",
                    bgcolor: "rgba(248,250,252,0.92)",
                    overflow: "hidden",
                  }}
                >
                  <Tabs value={mobileStudioSection} onChange={(_event, value) => setMobileStudioSection(value)} variant="fullWidth" sx={{ minHeight: 42, "& .MuiTab-root": { minHeight: 42, fontWeight: 900, textTransform: "none" } }}>
                    <Tab value="branches" label={`Branches ${filteredBranches.length}`} />
                    <Tab value="editor" label={editingBranchId ? "Edit" : "New"} />
                  </Tabs>
                </Box>
              ) : null}
              <Box
                sx={{
                  minWidth: 0,
                  display: { xs: !isMobile || mobileStudioSection === "branches" ? "block" : "none", lg: "block" },
                  p: { xs: 1.25, md: 1.45 },
                  borderRadius: 3.5,
                  border: "1px solid rgba(148,163,184,0.12)",
                  background: "linear-gradient(180deg, rgba(248,250,252,0.9) 0%, rgba(255,255,255,0.96) 100%)",
                }}
              >
                <Stack direction={{ xs: "column", sm: "row" }} spacing={1.1} justifyContent="space-between" alignItems={{ xs: "flex-start", sm: "center" }} sx={{ mb: 1.25 }}>
                  <Box>
                    <Typography sx={{ fontWeight: 900, color: "#0f172a" }}>
                      Branch Studio
                    </Typography>
                    <Typography variant="caption" sx={{ color: "text.secondary", display: { xs: "none", sm: "block" } }}>
                      Search, scan, edit
                    </Typography>
                  </Box>

                  <Chip
                    size="small"
                    label={canManageBranches ? "Editable" : "Read only"}
                    sx={{
                      fontWeight: 800,
                      bgcolor: canManageBranches ? "rgba(22,163,74,0.10)" : "rgba(15,23,42,0.06)",
                      color: canManageBranches ? "#166534" : "#334155",
                    }}
                  />
                </Stack>

                <Box
                  sx={{
                    display: "grid",
                    gap: 1,
                    gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
                    mb: 1.2,
                  }}
                >
                  <Box
                    sx={{
                      p: 1.1,
                      borderRadius: 2.8,
                      border: "1px solid rgba(37,99,235,0.12)",
                      bgcolor: "rgba(37,99,235,0.06)",
                    }}
                  >
                    <Typography variant="caption" sx={{ color: "#1d4ed8", fontWeight: 900 }}>
                      Shown
                    </Typography>
                    <Typography sx={{ mt: 0.2, fontWeight: 900, color: "#0f172a", fontSize: { xs: 18, md: 22 }, lineHeight: 1 }}>
                      {filteredBranches.length}
                    </Typography>
                  </Box>
                  <Box
                    sx={{
                      p: 1.1,
                      borderRadius: 2.8,
                      border: "1px solid rgba(22,163,74,0.12)",
                      bgcolor: "rgba(22,163,74,0.06)",
                    }}
                  >
                    <Typography variant="caption" sx={{ color: "#166534", fontWeight: 900 }}>
                      <Box component="span" sx={{ display: { xs: "inline", sm: "none" } }}>
                        Live
                      </Box>
                      <Box component="span" sx={{ display: { xs: "none", sm: "inline" } }}>
                        In Monitor
                      </Box>
                    </Typography>
                    <Typography sx={{ mt: 0.2, fontWeight: 900, color: "#0f172a", fontSize: { xs: 18, md: 22 }, lineHeight: 1 }}>
                      {monitoredBranchCount}
                    </Typography>
                  </Box>
                  <Box
                    sx={{
                      p: 1.1,
                      borderRadius: 2.8,
                      border: "1px solid rgba(99,102,241,0.14)",
                      bgcolor: "rgba(99,102,241,0.08)",
                    }}
                  >
                    <Typography variant="caption" sx={{ color: "#4338ca", fontWeight: 900 }}>
                      Paused
                    </Typography>
                    <Typography sx={{ mt: 0.2, fontWeight: 900, color: "#0f172a", fontSize: { xs: 18, md: 22 }, lineHeight: 1 }}>
                      {pausedBranchCount}
                    </Typography>
                  </Box>
                </Box>

                <TextField
                  placeholder="Search branch or vendor"
                  value={branchQuery}
                  onChange={(event) => setBranchQuery(event.target.value)}
                  fullWidth
                  size="small"
                  sx={{
                    mb: 1.3,
                    "& .MuiOutlinedInput-root": {
                      borderRadius: 999,
                      bgcolor: "rgba(255,255,255,0.94)",
                    },
                  }}
                  InputProps={{
                    startAdornment: (
                      <InputAdornment position="start">
                        <SearchRoundedIcon sx={{ color: "#64748b", fontSize: 18 }} />
                      </InputAdornment>
                    ),
                  }}
                />

                <Box
                  sx={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 1,
                  }}
                >
                  {filteredBranches.length ? (
                    <Stack spacing={1.15}>
                      {renderBranchSectionHeader({
                        label: "Paused",
                        count: filteredPausedBranches.length,
                        expanded: pausedExpanded,
                        onToggle: () => setPausedExpanded((current) => !current),
                        tone: "paused",
                      })}
                      <Collapse in={pausedExpanded} timeout={180} unmountOnExit>
                        <Stack spacing={1.15} sx={{ pt: 1 }}>
                          {filteredPausedBranches.length ? filteredPausedBranches.map(renderBranchCard) : (
                            <Box
                              sx={{
                                px: 1.1,
                                py: 0.9,
                                borderRadius: 2.6,
                                border: "1px dashed rgba(148,163,184,0.24)",
                                bgcolor: "rgba(248,250,252,0.55)",
                              }}
                            >
                              <Typography variant="caption" sx={{ color: "#64748b", fontWeight: 700 }}>
                                No paused branches
                              </Typography>
                            </Box>
                          )}
                        </Stack>
                      </Collapse>

                      {renderBranchSectionHeader({
                        label: "In Monitor",
                        count: filteredMonitoredBranches.length,
                        expanded: monitoredExpanded,
                        onToggle: () => setMonitoredExpanded((current) => !current),
                        tone: "live",
                      })}
                      <Collapse in={monitoredExpanded} timeout={180} unmountOnExit>
                        <Stack spacing={1.15} sx={{ pt: 1 }}>
                          {filteredMonitoredBranches.length ? filteredMonitoredBranches.map(renderBranchCard) : (
                            <Box
                              sx={{
                                px: 1.1,
                                py: 0.9,
                                borderRadius: 2.6,
                                border: "1px dashed rgba(148,163,184,0.24)",
                                bgcolor: "rgba(248,250,252,0.55)",
                              }}
                            >
                              <Typography variant="caption" sx={{ color: "#64748b", fontWeight: 700 }}>
                                No live branches in this view
                              </Typography>
                            </Box>
                          )}
                        </Stack>
                      </Collapse>
                    </Stack>
                  ) : (
                    <Box
                      sx={{
                        p: 2.1,
                        borderRadius: 3,
                        border: "1px dashed rgba(148,163,184,0.24)",
                        bgcolor: "rgba(248,250,252,0.75)",
                        textAlign: "center",
                      }}
                    >
                      <Typography sx={{ fontWeight: 900, color: "#0f172a" }}>
                        No match
                      </Typography>
                      <Typography variant="caption" sx={{ color: "text.secondary", display: { xs: "none", sm: "block" } }}>
                        Try another name or vendor ID.
                      </Typography>
                    </Box>
                  )}
                </Box>
              </Box>

              <Box
                sx={{
                  display: { xs: !isMobile || mobileStudioSection === "editor" ? "block" : "none", lg: "block" },
                  alignSelf: "start",
                  position: { lg: "sticky" },
                  top: { lg: 88 },
                }}
              >
                <Box
                  sx={{
                    p: { xs: 1.35, md: 1.5 },
                    borderRadius: 3.5,
                    border: "1px solid rgba(148,163,184,0.14)",
                    bgcolor: "rgba(255,255,255,0.96)",
                    backgroundImage: "linear-gradient(180deg, rgba(248,250,252,0.8) 0%, rgba(255,255,255,0.98) 100%)",
                    boxShadow: "0 16px 30px rgba(15,23,42,0.06)",
                  }}
                >
                  <Stack direction="row" spacing={1} justifyContent="space-between" alignItems="center" sx={{ mb: 1.25 }}>
                    <Box>
                      <Typography sx={{ fontWeight: 900, color: "#0f172a" }}>
                        {editingBranchId ? "Edit branch" : "New branch"}
                      </Typography>
                      <Typography variant="caption" sx={{ color: "text.secondary", display: { xs: "none", sm: "block" } }}>
                        {editingBranchId ? "Update mapping" : "Create mapping"}
                      </Typography>
                    </Box>

                    <Stack direction="row" spacing={0.8} alignItems="center">
                      <Chip
                        size="small"
                        label={editingBranchId ? "Editing" : "Ready"}
                        sx={{
                          fontWeight: 800,
                          bgcolor: editingBranchId ? "rgba(37,99,235,0.10)" : "rgba(15,23,42,0.06)",
                          color: editingBranchId ? "#1d4ed8" : "#334155",
                        }}
                      />
                      {editingBranchId ? (
                        <Button variant="text" size="small" startIcon={<RestartAltRoundedIcon />} onClick={resetBranchEditor}>
                          Reset
                        </Button>
                      ) : null}
                    </Stack>
                  </Stack>

                  <Box
                    sx={{
                      display: "grid",
                      gap: 1.05,
                      gridTemplateColumns: { xs: "1fr", sm: "repeat(2, minmax(0, 1fr))" },
                    }}
                  >
                    <TextField
                      label="Orders Vendor ID"
                      value={branchForm.ordersVendorId}
                      onChange={(event) => setBranchForm((current: any) => ({ ...current, ordersVendorId: event.target.value }))}
                      disabled={!canManageBranches}
                      fullWidth
                    />
                    <TextField
                      label="Availability Vendor ID"
                      value={branchForm.availabilityVendorId}
                      onChange={(event) => setBranchForm((current: any) => ({ ...current, availabilityVendorId: event.target.value }))}
                      disabled={!canManageBranches}
                      fullWidth
                    />
                    <TextField
                      label="Branch Name"
                      value={branchForm.name}
                      onChange={(event) => setBranchForm((current: any) => ({ ...current, name: event.target.value }))}
                      disabled={!canManageBranches}
                      fullWidth
                      sx={{ gridColumn: { sm: "span 2" } }}
                    />
                    <TextField
                      select
                      label="Chain"
                      value={branchForm.chainName ?? ""}
                      onChange={(event) => setBranchForm((current: any) => ({ ...current, chainName: event.target.value }))}
                      disabled={!canManageBranches}
                      fullWidth
                    >
                      <MenuItem value="">No Chain</MenuItem>
                      {branchFormChainOptions.map((chainName) => (
                        <MenuItem key={chainName} value={chainName}>
                          {chainName}
                        </MenuItem>
                      ))}
                    </TextField>
                    <TextField
                      label="Global Entity ID"
                      value={branchForm.globalEntityId}
                      onChange={(event) => setBranchForm((current: any) => ({ ...current, globalEntityId: event.target.value }))}
                      disabled={!canManageBranches}
                      fullWidth
                    />
                  </Box>

                  <Box
                    sx={{
                      mt: 1.15,
                      px: 1.2,
                      py: 1,
                      borderRadius: 2.8,
                      border: "1px solid rgba(99,102,241,0.12)",
                      bgcolor: branchForm.enabled ? "rgba(240,253,244,0.8)" : "rgba(238,242,255,0.72)",
                    }}
                  >
                    <Stack direction="row" justifyContent="space-between" alignItems="center" gap={1}>
                      <Box>
                        <Typography variant="caption" sx={{ color: "text.secondary", fontWeight: 800 }}>
                          In Monitor
                        </Typography>
                        <Typography sx={{ fontWeight: 900, color: "#0f172a", lineHeight: 1.1 }}>
                          {branchForm.enabled ? "Running" : "Paused"}
                        </Typography>
                        <Typography variant="caption" sx={{ color: "#64748b", display: { xs: "none", sm: "block" } }}>
                          {branchForm.enabled ? "Included in live cycles" : "Skipped from live cycles"}
                        </Typography>
                      </Box>
                      <Switch
                        checked={!!branchForm.enabled}
                        onChange={(_event, checked) => setBranchForm((current: any) => ({ ...current, enabled: checked }))}
                        disabled={!canManageBranches}
                        inputProps={{ "aria-label": "Toggle branch monitor state in form" }}
                      />
                    </Stack>
                  </Box>

                  <Stack direction={{ xs: "column", sm: "row" }} spacing={1} sx={{ mt: 1.2 }}>
                    <Button
                      variant="outlined"
                      onClick={fetchBranchName}
                      disabled={!canManageBranches || autoNameLoading}
                      startIcon={<AutoFixHighRoundedIcon />}
                      sx={{ flex: 1, borderRadius: 999 }}
                    >
                      {autoNameLoading ? "Loading..." : "Auto-fill Name"}
                    </Button>
                    <Button
                      variant="contained"
                      onClick={saveBranch}
                      disabled={!canManageBranches}
                      startIcon={<AddRoundedIcon />}
                      sx={{ flex: 1, borderRadius: 999 }}
                    >
                      {editingBranchId ? "Save" : "Add"}
                    </Button>
                  </Stack>
                </Box>
              </Box>
            </CardContent>
          </Card>

          <Stack spacing={2} sx={{ position: { xl: "sticky" }, top: { xl: 88 } }}>
            {isMobile ? (
              <Box
                sx={{
                  borderRadius: 999,
                  border: "1px solid rgba(148,163,184,0.14)",
                  bgcolor: "rgba(248,250,252,0.92)",
                  overflow: "hidden",
                }}
              >
                <Tabs value={mobileRulesSection} onChange={(_event, value) => setMobileRulesSection(value)} variant="fullWidth" sx={{ minHeight: 42, "& .MuiTab-root": { minHeight: 42, fontWeight: 900, textTransform: "none" } }}>
                  <Tab value="base" label="Base" />
                  <Tab value="rules" label="Rules" />
                </Tabs>
              </Box>
            ) : null}
            <Card sx={{ ...sectionCardSx(), display: { xs: !isMobile || mobileRulesSection === "base" ? "block" : "none", xl: "block" } }}>
              <CardContent sx={{ p: { xs: 1.4, md: 1.7 } }}>
                <Stack direction={{ xs: "column", sm: "row" }} spacing={1.2} justifyContent="space-between" alignItems={{ xs: "flex-start", sm: "center" }}>
                  <Box>
                    <Typography sx={{ fontWeight: 900, color: "#0f172a" }}>
                      Base
                    </Typography>
                    <Typography variant="caption" sx={{ color: "text.secondary", display: { xs: "none", sm: "block" } }}>
                      Default fallback
                    </Typography>
                  </Box>

                  <Chip
                    size="small"
                    label={canManageSettings ? "Admin edit" : "Read only"}
                    sx={{
                      fontWeight: 800,
                      bgcolor: canManageSettings ? "rgba(14,165,233,0.10)" : "rgba(15,23,42,0.06)",
                      color: canManageSettings ? "#0369a1" : "#334155",
                    }}
                  />
                </Stack>

                <Box
                  sx={{
                    mt: 1.35,
                    display: "grid",
                    gap: 1,
                    gridTemplateColumns: { xs: "1fr", sm: "repeat(2, minmax(0, 1fr))" },
                  }}
                >
                  <Box
                    sx={{
                      p: 1.15,
                      borderRadius: 3,
                      border: "1px solid rgba(251,146,60,0.16)",
                      bgcolor: "rgba(251,146,60,0.07)",
                    }}
                  >
                    <Typography variant="caption" sx={{ color: "#c2410c", fontWeight: 900 }}>
                      Late
                    </Typography>
                    <TextField
                      label="Late"
                      type="number"
                      value={thresholdForm.lateThreshold}
                      onChange={(event) => setThresholdForm((current) => ({ ...current, lateThreshold: Number(event.target.value) }))}
                      disabled={!canManageSettings}
                      size="small"
                      inputProps={{ min: 0 }}
                      fullWidth
                      sx={{
                        mt: 0.7,
                        "& .MuiOutlinedInput-root": {
                          bgcolor: "rgba(255,255,255,0.9)",
                        },
                      }}
                    />
                  </Box>

                  <Box
                    sx={{
                      p: 1.15,
                      borderRadius: 3,
                      border: "1px solid rgba(239,68,68,0.16)",
                      bgcolor: "rgba(239,68,68,0.06)",
                    }}
                  >
                    <Typography variant="caption" sx={{ color: "#b91c1c", fontWeight: 900 }}>
                      Unassigned
                    </Typography>
                    <TextField
                      label="Unassigned"
                      type="number"
                      value={thresholdForm.unassignedThreshold}
                      onChange={(event) => setThresholdForm((current) => ({ ...current, unassignedThreshold: Number(event.target.value) }))}
                      disabled={!canManageSettings}
                      size="small"
                      inputProps={{ min: 0 }}
                      fullWidth
                      sx={{
                        mt: 0.7,
                        "& .MuiOutlinedInput-root": {
                          bgcolor: "rgba(255,255,255,0.9)",
                        },
                      }}
                    />
                  </Box>
                </Box>

                <Button
                  variant="contained"
                  onClick={saveGlobalThresholds}
                  disabled={!canManageSettings}
                  sx={{ mt: 1.2, minWidth: { xs: "100%", sm: 120 }, borderRadius: 999 }}
                >
                  {canManageSettings ? "Save" : "Locked"}
                </Button>
              </CardContent>
            </Card>

            <Card sx={{ ...sectionCardSx(), display: { xs: !isMobile || mobileRulesSection === "rules" ? "block" : "none", xl: "block" } }}>
              <CardContent sx={{ p: { xs: 1.45, md: 1.7 } }}>
                <Stack spacing={1.35}>
                  <Stack direction={{ xs: "column", sm: "row" }} spacing={1.2} justifyContent="space-between" alignItems={{ xs: "flex-start", sm: "center" }}>
                    <Box>
                      <Typography sx={{ fontWeight: 900, color: "#0f172a" }}>
                        Rule Studio
                      </Typography>
                      <Typography variant="caption" sx={{ color: "text.secondary", display: { xs: "none", sm: "block" } }}>
                        Chains first. Overrides only when needed.
                      </Typography>
                    </Box>

                    <Stack direction="row" spacing={0.8} flexWrap="wrap">
                      <Chip
                        size="small"
                        label={`${thresholdForm.chains.length} chains`}
                        sx={{ fontWeight: 800, bgcolor: "rgba(15,23,42,0.06)", color: "#334155" }}
                      />
                      <Chip
                        size="small"
                        label={`${customOverrideCount} custom`}
                        sx={{ fontWeight: 800, bgcolor: "rgba(14,165,233,0.10)", color: "#0369a1" }}
                      />
                    </Stack>
                  </Stack>

                  <Box
                    sx={{
                      display: "inline-flex",
                      gap: 0.75,
                      p: 0.55,
                      borderRadius: 999,
                      bgcolor: "rgba(15,23,42,0.05)",
                      border: "1px solid rgba(148,163,184,0.14)",
                      width: { xs: "100%", sm: "auto" },
                    }}
                  >
                    <Button
                      variant={rulesMode === "chains" ? "contained" : "text"}
                      size="small"
                      onClick={() => setRulesMode("chains")}
                      sx={{ minWidth: 104, borderRadius: 999, fontWeight: 800, flex: 1 }}
                    >
                      Chains
                    </Button>
                    <Button
                      variant={rulesMode === "overrides" ? "contained" : "text"}
                      size="small"
                      onClick={() => setRulesMode("overrides")}
                      sx={{ minWidth: 104, borderRadius: 999, fontWeight: 800, flex: 1 }}
                    >
                      Overrides
                    </Button>
                  </Box>

                  <Box
                    sx={{
                      p: 0.65,
                      borderRadius: 3.2,
                      border: "1px solid rgba(148,163,184,0.12)",
                      bgcolor: "rgba(248,250,252,0.62)",
                    }}
                  >
                    <Box
                      sx={{
                        maxHeight: { xs: "none", xl: 720 },
                        overflowY: { xs: "visible", xl: "auto" },
                        pr: { xl: 0.5 },
                      }}
                    >
                      {rulesMode === "chains" ? (
                        <ChainThresholdManager
                          chains={thresholdForm.chains}
                          editingChainIndex={editingChainIndex}
                          chainEditor={chainEditor}
                          readOnly={!canManageSettings}
                          onChangeEditor={(patch) => setChainEditor((current) => ({ ...current, ...patch }))}
                          onEditChain={startChainEdit}
                          onRemoveChain={removeChain}
                          onSaveChain={upsertChain}
                          onCancelEdit={resetChainEditor}
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
                          onSaveBranch={saveBranchThresholdOverride}
                          onClearBranchOverride={clearBranchThresholdOverride}
                          onCancelEdit={resetBranchThresholdEditor}
                        />
                      )}
                    </Box>
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
