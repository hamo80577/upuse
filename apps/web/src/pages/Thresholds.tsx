import { Alert, Box, Button, Card, CardContent, Chip, Container, Snackbar, Stack, TextField, Typography } from "@mui/material";
import { useEffect, useState } from "react";
import { api, describeApiError } from "../api/client";
import { useAuth } from "../app/providers/AuthProvider";
import { useMonitorStatus } from "../app/providers/MonitorStatusProvider";
import type { BranchMappingItem, ChainThreshold, SettingsMasked } from "../api/types";
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

  return out;
}

function emptyChainEditor() {
  return { name: "", lateThreshold: "5", unassignedThreshold: "5" };
}

function emptyBranchThresholdEditor() {
  return { lateThreshold: "", unassignedThreshold: "" };
}

export function ThresholdsPage() {
  const { canManageMonitor, canManageSettings } = useAuth();
  const { monitoring, startMonitoring, stopMonitoring } = useMonitorStatus();

  const [s, setS] = useState<SettingsMasked | null>(null);
  const [branches, setBranches] = useState<BranchMappingItem[]>([]);
  const [form, setForm] = useState<any>({});
  const [toast, setToast] = useState<{ type: "success" | "error" | "info"; msg: string } | null>(null);
  const [chainEditor, setChainEditor] = useState<ChainEditorDraft>(emptyChainEditor());
  const [editingChainIndex, setEditingChainIndex] = useState<number | null>(null);
  const [branchThresholdEditor, setBranchThresholdEditor] = useState<BranchThresholdEditorDraft>(emptyBranchThresholdEditor());
  const [editingThresholdBranchId, setEditingThresholdBranchId] = useState<number | null>(null);
  const [savingThresholdBranchId, setSavingThresholdBranchId] = useState<number | null>(null);

  const applySettings = (settings: SettingsMasked) => {
    setS(settings);
    setForm({
      chains: normalizeChains(settings.chains),
      lateThreshold: settings.lateThreshold,
      unassignedThreshold: settings.unassignedThreshold,
    });
  };

  const loadThresholdData = async (options?: { silent?: boolean }) => {
    try {
      const [settings, branchResponse] = await Promise.all([api.getSettings(), api.listBranches()]);
      applySettings(settings);
      setBranches(branchResponse.items);
      return { ok: true as const };
    } catch (error) {
      const message = describeApiError(error, "Failed to load threshold rules");
      if (!options?.silent) {
        setToast({ type: "error", msg: message });
      }
      return { ok: false as const, message };
    }
  };

  useEffect(() => {
    void loadThresholdData();
  }, []);

  const resetChainEditor = () => {
    setEditingChainIndex(null);
    setChainEditor(emptyChainEditor());
  };

  const resetBranchThresholdEditor = () => {
    setEditingThresholdBranchId(null);
    setBranchThresholdEditor(emptyBranchThresholdEditor());
  };

  const resolveEffectiveThresholds = (branch: BranchMappingItem) => {
    if (typeof branch.lateThresholdOverride === "number" && typeof branch.unassignedThresholdOverride === "number") {
      return {
        lateThreshold: branch.lateThresholdOverride,
        unassignedThreshold: branch.unassignedThresholdOverride,
      };
    }

    const chainMatch = (form.chains ?? []).find(
      (chain: ChainThreshold) => chain.name.trim().toLowerCase() === branch.chainName.trim().toLowerCase(),
    );
    if (chainMatch) {
      return {
        lateThreshold: chainMatch.lateThreshold,
        unassignedThreshold: chainMatch.unassignedThreshold,
      };
    }

    return {
      lateThreshold: Number(form.lateThreshold ?? s?.lateThreshold ?? 5),
      unassignedThreshold: Number(form.unassignedThreshold ?? s?.unassignedThreshold ?? 5),
    };
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

  const saveGlobalThresholds = async () => {
    if (!canManageSettings) {
      setToast({ type: "info", msg: "Admins only" });
      return;
    }

    const lateThreshold = Number(form.lateThreshold);
    const unassignedThreshold = Number(form.unassignedThreshold);

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
      setToast({ type: "success", msg: "Default thresholds saved" });
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
      setS((current) => (
        current
          ? {
              ...current,
              chainNames: normalized.map((item) => item.name),
              chains: normalized,
            }
          : current
      ));
      setForm((current: any) => ({
        ...current,
        chains: normalized,
      }));
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
      (form.chains ?? []).filter((_item: ChainThreshold, index: number) => index !== editingChainIndex),
    ).filter((item) => item.name.trim().toLowerCase() !== name.toLowerCase());

    nextChains.push({
      name,
      lateThreshold: Math.round(lateThreshold),
      unassignedThreshold: Math.round(unassignedThreshold),
    });
    nextChains.sort((a, b) => a.name.localeCompare(b.name));

    await persistChains(nextChains);
  };

  const startChainEdit = (chain: ChainThreshold, index: number) => {
    if (!canManageSettings) return;
    setEditingChainIndex(index);
    setChainEditor({
      name: chain.name,
      lateThreshold: String(chain.lateThreshold),
      unassignedThreshold: String(chain.unassignedThreshold),
    });
  };

  const removeChain = async (index: number) => {
    if (!canManageSettings) {
      setToast({ type: "info", msg: "Admins only" });
      return;
    }
    const nextChains = (form.chains ?? []).filter((_item: ChainThreshold, itemIndex: number) => itemIndex !== index);
    await persistChains(nextChains);
  };

  const startBranchThresholdEdit = (branch: BranchMappingItem) => {
    const effective = resolveEffectiveThresholds(branch);
    setEditingThresholdBranchId(branch.id);
    setBranchThresholdEditor({
      lateThreshold: String(branch.lateThresholdOverride ?? effective.lateThreshold),
      unassignedThreshold: String(branch.unassignedThresholdOverride ?? effective.unassignedThreshold),
    });
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
      setToast({ type: "success", msg: "Branch override saved" });
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
      setToast({ type: "success", msg: "Branch override cleared" });
    } catch (error) {
      setToast({ type: "error", msg: describeApiError(error, "Branch override reset failed") });
    } finally {
      setSavingThresholdBranchId(null);
    }
  };

  const onStart = async () => {
    if (!canManageMonitor) {
      setToast({ type: "info", msg: "No access" });
      return;
    }
    try {
      await startMonitoring();
      setToast({ type: "success", msg: "Monitoring started" });
    } catch {
      setToast({ type: "error", msg: "Failed to start" });
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
    } catch {
      setToast({ type: "error", msg: "Failed to stop" });
    }
  };

  const chains: ChainThreshold[] = form.chains ?? [];

  return (
    <Box sx={{ minHeight: "100vh", bgcolor: "background.default" }}>
      <TopBar
        running={monitoring.running}
        degraded={monitoring.degraded}
        onStart={onStart}
        onStop={onStop}
        canControlMonitor={canManageMonitor}
      />

      <Container maxWidth="lg" sx={{ py: 3 }}>
        <Card
          sx={{
            borderRadius: 4,
            border: "1px solid rgba(148,163,184,0.14)",
            boxShadow: "0 18px 40px rgba(15,23,42,0.06)",
          }}
        >
          <CardContent sx={{ display: "flex", flexDirection: "column", gap: 2.25, p: { xs: 2, md: 2.5 } }}>
            <Stack direction={{ xs: "column", md: "row" }} spacing={1.5} justifyContent="space-between" alignItems={{ xs: "flex-start", md: "center" }}>
              <Box>
                <Typography variant="h6" sx={{ fontWeight: 900 }}>
                  Threshold Rules
                </Typography>
                <Typography variant="body2" sx={{ color: "text.secondary" }}>
                  Global defaults, per-chain rules, and optional per-branch overrides.
                </Typography>
              </Box>

              <Chip
                size="small"
                label={canManageSettings ? "Admin Edit" : "User Read Only"}
                sx={{
                  fontWeight: 800,
                  bgcolor: canManageSettings ? "rgba(22,163,74,0.10)" : "rgba(15,23,42,0.06)",
                  color: canManageSettings ? "#166534" : "#334155",
                }}
              />
            </Stack>

            <Box
              sx={{
                p: { xs: 1.5, md: 1.8 },
                borderRadius: 3,
                border: "1px solid rgba(148,163,184,0.12)",
                bgcolor: "rgba(255,255,255,0.86)",
              }}
            >
              <Stack direction={{ xs: "column", md: "row" }} spacing={1.25} alignItems={{ xs: "flex-start", md: "center" }} justifyContent="space-between">
                <Box>
                  <Typography sx={{ fontWeight: 900, color: "#0f172a" }}>
                    Global Defaults
                  </Typography>
                  <Typography variant="caption" sx={{ color: "text.secondary" }}>
                    Used only when a branch has no custom override and no chain rule is assigned.
                  </Typography>
                </Box>

                <Stack direction="row" spacing={0.7}>
                  <Chip size="small" label={`L ${form.lateThreshold ?? s?.lateThreshold ?? 5}`} sx={{ fontWeight: 800, bgcolor: "rgba(251,146,60,0.10)", color: "#c2410c" }} />
                  <Chip size="small" label={`U ${form.unassignedThreshold ?? s?.unassignedThreshold ?? 5}`} sx={{ fontWeight: 800, bgcolor: "rgba(239,68,68,0.10)", color: "#b91c1c" }} />
                </Stack>
              </Stack>

              <Stack direction={{ xs: "column", md: "row" }} spacing={1.2} sx={{ mt: 1.3 }}>
                <TextField
                  label="Default Late Threshold"
                  type="number"
                  value={form.lateThreshold ?? 5}
                  onChange={(event) => setForm((current: any) => ({ ...current, lateThreshold: Number(event.target.value) }))}
                  disabled={!canManageSettings}
                  sx={{ width: { xs: "100%", md: 220 } }}
                />
                <TextField
                  label="Default Unassigned Threshold"
                  type="number"
                  value={form.unassignedThreshold ?? 5}
                  onChange={(event) => setForm((current: any) => ({ ...current, unassignedThreshold: Number(event.target.value) }))}
                  disabled={!canManageSettings}
                  sx={{ width: { xs: "100%", md: 260 } }}
                />
                <Box sx={{ flex: 1 }} />
                <Button variant="contained" onClick={saveGlobalThresholds} disabled={!canManageSettings} sx={{ alignSelf: { xs: "stretch", md: "center" } }}>
                  {canManageSettings ? "Save Defaults" : "Read Only"}
                </Button>
              </Stack>
            </Box>

            <ChainThresholdManager
              chains={chains}
              editingChainIndex={editingChainIndex}
              chainEditor={chainEditor}
              readOnly={!canManageSettings}
              onChangeEditor={(patch) => setChainEditor((current) => ({ ...current, ...patch }))}
              onEditChain={startChainEdit}
              onRemoveChain={removeChain}
              onSaveChain={upsertChain}
              onCancelEdit={resetChainEditor}
            />

            <BranchThresholdOverrideManager
              branches={branches}
              chains={chains}
              globalThresholds={{
                lateThreshold: Number(form.lateThreshold ?? s?.lateThreshold ?? 5),
                unassignedThreshold: Number(form.unassignedThreshold ?? s?.unassignedThreshold ?? 5),
              }}
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
          </CardContent>
        </Card>
      </Container>

      <Snackbar open={!!toast} autoHideDuration={2500} onClose={() => setToast(null)} anchorOrigin={{ vertical: "bottom", horizontal: "center" }}>
        {toast ? <Alert severity={toast.type}>{toast.msg}</Alert> : undefined}
      </Snackbar>
    </Box>
  );
}
