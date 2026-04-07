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
  const [thresholdForm, setThresholdForm] = useState({
    chains: [] as ChainThreshold[],
    lateThreshold: 5,
    lateReopenThreshold: 0,
    unassignedThreshold: 5,
    unassignedReopenThreshold: 0,
    readyThreshold: 0,
    readyReopenThreshold: 0,
  });
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
      lateReopenThreshold: settings.lateReopenThreshold ?? 0,
      unassignedThreshold: settings.unassignedThreshold,
      unassignedReopenThreshold: settings.unassignedReopenThreshold ?? 0,
      readyThreshold: settings.readyThreshold ?? 0,
      readyReopenThreshold: settings.readyReopenThreshold ?? 0,
    });
  }, [settings]);

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
  };

  const saveGlobalThresholds = async () => {
    const lateThreshold = Number(thresholdForm.lateThreshold);
    const lateReopenThreshold = Number(thresholdForm.lateReopenThreshold);
    const unassignedThreshold = Number(thresholdForm.unassignedThreshold);
    const unassignedReopenThreshold = Number(thresholdForm.unassignedReopenThreshold);
    const readyThreshold = Number(thresholdForm.readyThreshold);
    const readyReopenThreshold = Number(thresholdForm.readyReopenThreshold);

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
    setRulesMode("overrides");
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
                <Stack spacing={1.2}>
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
                      label="Default Late Reopen Threshold"
                      type="number"
                      size="small"
                      value={thresholdForm.lateReopenThreshold}
                      onChange={(event) => setThresholdForm((current) => ({ ...current, lateReopenThreshold: Number(event.target.value) }))}
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
                  </Stack>
                  <Stack direction={{ xs: "column", sm: "row" }} spacing={1.2}>
                    <TextField
                      label="Default Unassigned Reopen Threshold"
                      type="number"
                      size="small"
                      value={thresholdForm.unassignedReopenThreshold}
                      onChange={(event) => setThresholdForm((current) => ({ ...current, unassignedReopenThreshold: Number(event.target.value) }))}
                      disabled={!canManageThresholds}
                    />
                    <TextField
                      label="Default Ready To Pickup Threshold"
                      type="number"
                      size="small"
                      value={thresholdForm.readyThreshold}
                      onChange={(event) => setThresholdForm((current) => ({ ...current, readyThreshold: Number(event.target.value) }))}
                      disabled={!canManageThresholds}
                    />
                    <TextField
                      label="Default Ready To Pickup Reopen Threshold"
                      type="number"
                      size="small"
                      value={thresholdForm.readyReopenThreshold}
                      onChange={(event) => setThresholdForm((current) => ({ ...current, readyReopenThreshold: Number(event.target.value) }))}
                      disabled={!canManageThresholds}
                    />
                    <Button variant="contained" onClick={() => void saveGlobalThresholds()} disabled={!canManageThresholds}>
                      Save Defaults
                    </Button>
                  </Stack>
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
                      lateReopenThreshold: String(chain.lateReopenThreshold ?? 0),
                      unassignedThreshold: String(chain.unassignedThreshold),
                      unassignedReopenThreshold: String(chain.unassignedReopenThreshold ?? 0),
                      readyThreshold: String(chain.readyThreshold ?? 0),
                      readyReopenThreshold: String(chain.readyReopenThreshold ?? 0),
                      capacityRuleEnabled: chain.capacityRuleEnabled !== false,
                      capacityPerHourEnabled: chain.capacityPerHourEnabled === true,
                      capacityPerHourLimit: chain.capacityPerHourLimit == null ? "" : String(chain.capacityPerHourLimit),
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
