import { Alert, Box, Button, Card, CardContent, Snackbar, Stack, Tab, Tabs, TextField } from "@mui/material";
import { useEffect, useState } from "react";
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
import { BranchThresholdOverrideManager, type BranchThresholdEditorDraft } from "../../../features/settings/BranchThresholdOverrideManager";
import { ChainThresholdManager, type ChainEditorDraft } from "../../../features/settings/ChainThresholdManager";
import { TopBar } from "../../../widgets/top-bar/ui/TopBar";

export function ThresholdsPage() {
  const { canManageMonitor, canManageThresholds } = useAuth();
  const { monitoring, startMonitoring, stopMonitoring } = useMonitorStatus();
  const {
    settings,
    branches,
    loadError,
    saveChains: persistThresholdChains,
    saveGlobalThresholds: persistGlobalThresholds,
    saveBranchThresholdOverride: persistBranchThresholdOverride,
  } = useBranchMappingState();

  const [toast, setToast] = useState<{ type: "success" | "error" | "info"; msg: string } | null>(null);
  const [rulesMode, setRulesMode] = useState<"chains" | "overrides">("chains");
  const [thresholdForm, setThresholdForm] = useState({ chains: [] as ChainThreshold[], lateThreshold: 5, unassignedThreshold: 5 });
  const [chainEditor, setChainEditor] = useState<ChainEditorDraft>(emptyChainEditor());
  const [editingChainIndex, setEditingChainIndex] = useState<number | null>(null);
  const [branchThresholdEditor, setBranchThresholdEditor] = useState<BranchThresholdEditorDraft>(emptyBranchThresholdEditor());
  const [editingThresholdBranchId, setEditingThresholdBranchId] = useState<number | null>(null);
  const [savingThresholdBranchId, setSavingThresholdBranchId] = useState<number | null>(null);

  useEffect(() => {
    if (!settings) return;
    setThresholdForm({
      chains: normalizeChains(settings.chains),
      lateThreshold: settings.lateThreshold,
      unassignedThreshold: settings.unassignedThreshold,
    });
  }, [settings]);

  const globalThresholds = {
    lateThreshold: Number(thresholdForm.lateThreshold ?? settings?.lateThreshold ?? 5),
    unassignedThreshold: Number(thresholdForm.unassignedThreshold ?? settings?.unassignedThreshold ?? 5),
    capacityRuleEnabled: true,
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
      setToast({ type: "success", msg: "Chains saved" });
    } catch (error) {
      setToast({ type: "error", msg: describeApiError(error, "Chain save failed") });
    }
  };

  const upsertChain = async () => {
    const name = chainEditor.name.trim();
    const lateThreshold = Number(chainEditor.lateThreshold);
    const unassignedThreshold = Number(chainEditor.unassignedThreshold);

    if (!name) {
      setToast({ type: "error", msg: "Enter chain name" });
      return;
    }

    if (!Number.isFinite(lateThreshold) || lateThreshold < 0 || !Number.isFinite(unassignedThreshold) || unassignedThreshold < 0) {
      setToast({ type: "error", msg: "Enter valid thresholds" });
      return;
    }

    const nextChains = normalizeChains(thresholdForm.chains.filter((_item, index) => index !== editingChainIndex))
      .filter((item) => item.name.trim().toLowerCase() !== name.toLowerCase());
    nextChains.push({
      name,
      lateThreshold: Math.round(lateThreshold),
      unassignedThreshold: Math.round(unassignedThreshold),
      capacityRuleEnabled: chainEditor.capacityRuleEnabled,
    });
    await persistChains(nextChains);
  };

  const saveGlobalThresholds = async () => {
    const lateThreshold = Number(thresholdForm.lateThreshold);
    const unassignedThreshold = Number(thresholdForm.unassignedThreshold);

    if (!canManageThresholds) {
      setToast({ type: "info", msg: "No access" });
      return;
    }

    if (!Number.isFinite(lateThreshold) || lateThreshold < 0 || !Number.isFinite(unassignedThreshold) || unassignedThreshold < 0) {
      setToast({ type: "error", msg: "Enter valid thresholds" });
      return;
    }

    try {
      await persistGlobalThresholds(lateThreshold, unassignedThreshold);
      setToast({ type: "success", msg: "Defaults saved" });
    } catch (error) {
      setToast({ type: "error", msg: describeApiError(error, "Default threshold save failed") });
    }
  };

  const startBranchThresholdEdit = (branch: BranchMappingItem) => {
    const effective = resolveEffectiveThresholds(branch, thresholdForm.chains, globalThresholds);
    setEditingThresholdBranchId(branch.id);
    setBranchThresholdEditor({
      lateThreshold: branch.lateThresholdOverride == null ? "" : String(branch.lateThresholdOverride),
      unassignedThreshold: branch.unassignedThresholdOverride == null ? "" : String(branch.unassignedThresholdOverride),
      capacityRuleEnabled: branch.capacityRuleEnabledOverride ?? (effective.capacityRuleEnabled !== false),
    });
    setRulesMode("overrides");
  };

  const saveBranchThresholdOverride = async (branch: BranchMappingItem) => {
    if (!canManageThresholds) {
      setToast({ type: "info", msg: "No access" });
      return;
    }

    const lateThresholdRaw = branchThresholdEditor.lateThreshold.trim();
    const unassignedThresholdRaw = branchThresholdEditor.unassignedThreshold.trim();
    const hasLateThreshold = lateThresholdRaw.length > 0;
    const hasUnassignedThreshold = unassignedThresholdRaw.length > 0;

    if (hasLateThreshold !== hasUnassignedThreshold) {
      setToast({ type: "error", msg: "Enter both branch thresholds or leave both inherited" });
      return;
    }

    const lateThreshold = hasLateThreshold ? Number(lateThresholdRaw) : null;
    const unassignedThreshold = hasUnassignedThreshold ? Number(unassignedThresholdRaw) : null;

    if (
      (lateThreshold != null && (!Number.isFinite(lateThreshold) || lateThreshold < 0))
      || (unassignedThreshold != null && (!Number.isFinite(unassignedThreshold) || unassignedThreshold < 0))
    ) {
      setToast({ type: "error", msg: "Enter valid branch thresholds" });
      return;
    }

    const inherited = resolveEffectiveThresholds(
      { ...branch, capacityRuleEnabledOverride: null },
      thresholdForm.chains,
      globalThresholds,
    );
    const capacityRuleEnabledOverride =
      branchThresholdEditor.capacityRuleEnabled === (inherited.capacityRuleEnabled !== false)
        ? null
        : branchThresholdEditor.capacityRuleEnabled;

    try {
      setSavingThresholdBranchId(branch.id);
      await persistBranchThresholdOverride(
        branch.id,
        lateThreshold == null ? null : Math.round(lateThreshold),
        unassignedThreshold == null ? null : Math.round(unassignedThreshold),
        capacityRuleEnabledOverride,
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
      await persistBranchThresholdOverride(branch.id, null, null, null);
      setEditingThresholdBranchId(null);
      setBranchThresholdEditor(emptyBranchThresholdEditor());
      setToast({ type: "success", msg: "Using inherited thresholds" });
    } catch (error) {
      setToast({ type: "error", msg: describeApiError(error, "Branch override reset failed") });
    } finally {
      setSavingThresholdBranchId(null);
    }
  };

  return (
    <Box sx={{ minHeight: "100vh", bgcolor: "background.default" }}>
      <TopBar running={monitoring.running} degraded={monitoring.degraded} onStart={onStart} onStop={onStop} canControlMonitor={canManageMonitor} />
      <Box sx={{ p: { xs: 2, md: 3 }, display: "grid", gap: 2 }}>
        {loadError ? <Alert severity="error" variant="outlined">{loadError}</Alert> : null}

        <Card>
          <CardContent sx={{ display: "grid", gap: 2 }}>
            <Tabs value={rulesMode} onChange={(_event, value) => setRulesMode(value)} sx={{ minHeight: 42 }}>
              <Tab value="chains" label="Chains" />
              <Tab value="overrides" label="Overrides" />
            </Tabs>

            {rulesMode === "chains" ? (
              <>
                <Stack direction={{ xs: "column", sm: "row" }} spacing={1.2}>
                  <TextField
                    label="Default Late Threshold"
                    type="number"
                    size="small"
                    value={thresholdForm.lateThreshold}
                    onChange={(event) => setThresholdForm((current) => ({ ...current, lateThreshold: Number(event.target.value) }))}
                    disabled={!canManageThresholds}
                  />
                  <TextField
                    label="Default Unassigned Threshold"
                    type="number"
                    size="small"
                    value={thresholdForm.unassignedThreshold}
                    onChange={(event) => setThresholdForm((current) => ({ ...current, unassignedThreshold: Number(event.target.value) }))}
                    disabled={!canManageThresholds}
                  />
                  <Button variant="contained" onClick={() => void saveGlobalThresholds()} disabled={!canManageThresholds}>
                    Save Defaults
                  </Button>
                </Stack>

                <ChainThresholdManager
                  chains={thresholdForm.chains}
                  editingChainIndex={editingChainIndex}
                  chainEditor={chainEditor}
                  readOnly={!canManageThresholds}
                  onChangeEditor={(patch) => setChainEditor((current) => ({ ...current, ...patch }))}
                  onEditChain={(chain, index) => {
                    setEditingChainIndex(index);
                    setChainEditor({
                      name: chain.name,
                      lateThreshold: String(chain.lateThreshold),
                      unassignedThreshold: String(chain.unassignedThreshold),
                      capacityRuleEnabled: chain.capacityRuleEnabled !== false,
                    });
                  }}
                  onRemoveChain={(index) => void persistChains(thresholdForm.chains.filter((_item, itemIndex) => itemIndex !== index))}
                  onSaveChain={() => void upsertChain()}
                  onCancelEdit={() => {
                    setEditingChainIndex(null);
                    setChainEditor(emptyChainEditor());
                  }}
                />
              </>
            ) : (
              <BranchThresholdOverrideManager
                branches={branches}
                chains={thresholdForm.chains}
                globalThresholds={globalThresholds}
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
          </CardContent>
        </Card>
      </Box>

      <Snackbar open={!!toast} autoHideDuration={2500} onClose={() => setToast(null)} anchorOrigin={{ vertical: "bottom", horizontal: "center" }}>
        {toast ? <Alert severity={toast.type}>{toast.msg}</Alert> : undefined}
      </Snackbar>
    </Box>
  );
}
