import { Alert, Box, Button, Card, CardContent, Container, Divider, Snackbar, Stack, TextField, Typography } from "@mui/material";
import { useEffect, useState } from "react";
import { api, clearStoredAdminKey, describeApiError, getStoredAdminKey, setStoredAdminKey } from "../api/client";
import type { ChainThreshold, SettingsMasked } from "../api/types";
import { TopBar } from "../components/TopBar";
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

export function Settings() {
  const [running, setRunning] = useState(false);
  const [degraded, setDegraded] = useState<boolean | undefined>(undefined);

  const [s, setS] = useState<SettingsMasked | null>(null);
  const [form, setForm] = useState<any>({});
  const [toast, setToast] = useState<{ type: "success" | "error"; msg: string } | null>(null);
  const [test, setTest] = useState<any>(null);
  const [chainEditor, setChainEditor] = useState<ChainEditorDraft>(emptyChainEditor());
  const [editingChainIndex, setEditingChainIndex] = useState<number | null>(null);
  const [adminKey, setAdminKey] = useState(() => getStoredAdminKey());

  const applySettings = (settings: SettingsMasked) => {
    setS(settings);
    setForm({
      globalEntityId: settings.globalEntityId,
      chains: normalizeChains(settings.chains),
      lateThreshold: settings.lateThreshold,
      unassignedThreshold: settings.unassignedThreshold,
      tempCloseMinutes: settings.tempCloseMinutes,
      graceMinutes: settings.graceMinutes,
      ordersRefreshSeconds: settings.ordersRefreshSeconds,
      availabilityRefreshSeconds: settings.availabilityRefreshSeconds,
      maxVendorsPerOrdersRequest: settings.maxVendorsPerOrdersRequest,
      ordersToken: "",
      availabilityToken: "",
    });
  };

  const loadProtectedData = async (options?: { silent?: boolean }) => {
    try {
      const [dashboard, settings] = await Promise.all([api.dashboard(), api.getSettings()]);
      setRunning(dashboard.monitoring.running);
      setDegraded(dashboard.monitoring.degraded);
      applySettings(settings);
      return { ok: true as const };
    } catch (error) {
      const message = describeApiError(error);
      if (!options?.silent) {
        setToast({ type: "error", msg: message });
      }
      return { ok: false as const, message };
    }
  };

  useEffect(() => {
    void loadProtectedData();
  }, []);

  const resetChainEditor = () => {
    setEditingChainIndex(null);
    setChainEditor(emptyChainEditor());
  };

  const onStart = async () => {
    try {
      await api.monitorStart();
      setRunning(true);
      setToast({ type: "success", msg: "Monitoring started" });
    } catch {
      setToast({ type: "error", msg: "Failed to start" });
    }
  };
  const onStop = async () => {
    try {
      await api.monitorStop();
      setRunning(false);
      setToast({ type: "success", msg: "Monitoring stopped" });
    } catch {
      setToast({ type: "error", msg: "Failed to stop" });
    }
  };

  const saveAdminKey = async () => {
    const normalized = adminKey.trim();
    if (normalized) {
      setStoredAdminKey(normalized);
    } else {
      clearStoredAdminKey();
    }

    const loaded = await loadProtectedData({ silent: true });
    setToast({
      type: loaded.ok ? "success" : "error",
      msg: loaded.ok
        ? (normalized ? "Admin key saved" : "Admin key cleared")
        : loaded.message,
    });
  };

  const resetAdminKey = () => {
    clearStoredAdminKey();
    setAdminKey("");
    setToast({ type: "success", msg: "Admin key cleared" });
  };

  const save = async () => {
    try {
      const payload: any = {
        ...form,
        chains: normalizeChains(form.chains ?? []),
      };

      if (!payload.ordersToken) delete payload.ordersToken;
      if (!payload.availabilityToken) delete payload.availabilityToken;

      await api.putSettings(payload);
      const fresh = await api.getSettings();
      applySettings(fresh);
      resetChainEditor();
      setToast({ type: "success", msg: "Saved" });
      setTest(null);
    } catch {
      setToast({ type: "error", msg: "Save failed" });
    }
  };

  const runTest = async () => {
    try {
      const r = await api.testTokens();
      setTest(r);
    } catch {
      setToast({ type: "error", msg: "Test failed" });
    }
  };

  const persistChains = async (nextChains: ChainThreshold[]) => {
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
    } catch {
      setToast({ type: "error", msg: "Chain save failed" });
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
    if (!Number.isFinite(lateThreshold) || lateThreshold < 0) {
      setToast({ type: "error", msg: "Enter valid late threshold" });
      return;
    }
    if (!Number.isFinite(unassignedThreshold) || unassignedThreshold < 0) {
      setToast({ type: "error", msg: "Enter valid unassigned threshold" });
      return;
    }

    const nextChains = normalizeChains(
      (form.chains ?? []).filter(
        (_item: ChainThreshold, index: number) => index !== editingChainIndex,
      ),
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
    setEditingChainIndex(index);
    setChainEditor({
      name: chain.name,
      lateThreshold: String(chain.lateThreshold),
      unassignedThreshold: String(chain.unassignedThreshold),
    });
  };

  const removeChain = async (index: number) => {
    const nextChains = (form.chains ?? []).filter(
      (_item: ChainThreshold, itemIndex: number) => itemIndex !== index,
    );
    await persistChains(nextChains);
  };

  const chains: ChainThreshold[] = form.chains ?? [];

  return (
    <Box sx={{ minHeight: "100vh", bgcolor: "background.default" }}>
      <TopBar running={running} degraded={degraded} onStart={onStart} onStop={onStop} />

      <Container maxWidth="lg" sx={{ py: 3 }}>
        <Card
          sx={{
            borderRadius: 4,
            border: "1px solid rgba(148,163,184,0.14)",
            boxShadow: "0 18px 40px rgba(15,23,42,0.06)",
          }}
        >
          <CardContent sx={{ display: "flex", flexDirection: "column", gap: 2.25, p: { xs: 2, md: 2.5 } }}>
            <Box>
              <Typography variant="h6" sx={{ fontWeight: 900 }}>
                Settings
              </Typography>
              <Typography variant="body2" sx={{ color: "text.secondary" }}>
                Manage monitor timing, tokens, and per-chain thresholds.
              </Typography>
            </Box>

            <ChainThresholdManager
              chains={chains}
              editingChainIndex={editingChainIndex}
              chainEditor={chainEditor}
              onChangeEditor={(patch) => setChainEditor((current) => ({ ...current, ...patch }))}
              onEditChain={startChainEdit}
              onRemoveChain={removeChain}
              onSaveChain={upsertChain}
              onCancelEdit={resetChainEditor}
            />

            <Divider />

            <Stack spacing={1.2}>
              <Typography variant="subtitle2" sx={{ fontWeight: 900 }}>
                Admin Key
              </Typography>
              <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5}>
                <TextField
                  label="Browser Admin Key"
                  type="password"
                  value={adminKey}
                  onChange={(e) => setAdminKey(e.target.value)}
                  helperText="Stored in this browser session for 8 hours and sent only as Authorization header."
                  fullWidth
                />
                <Stack direction="row" spacing={1.2}>
                  <Button variant="outlined" onClick={saveAdminKey}>
                    Save Key
                  </Button>
                  <Button variant="text" onClick={resetAdminKey}>
                    Clear Key
                  </Button>
                </Stack>
              </Stack>
            </Stack>

            <Divider />

            <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5}>
              <TextField
                label="Global Entity ID"
                value={form.globalEntityId ?? ""}
                onChange={(e) => setForm((p: any) => ({ ...p, globalEntityId: e.target.value }))}
                fullWidth
              />
              <TextField
                label="Temp Close (minutes)"
                type="number"
                value={form.tempCloseMinutes ?? 30}
                onChange={(e) => setForm((p: any) => ({ ...p, tempCloseMinutes: Number(e.target.value) }))}
                fullWidth
              />
              <TextField
                label="Grace (minutes)"
                type="number"
                value={form.graceMinutes ?? 5}
                onChange={(e) => setForm((p: any) => ({ ...p, graceMinutes: Number(e.target.value) }))}
                fullWidth
              />
            </Stack>

            <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5}>
              <TextField
                label="Orders Refresh (seconds)"
                type="number"
                value={form.ordersRefreshSeconds ?? 30}
                onChange={(e) => setForm((p: any) => ({ ...p, ordersRefreshSeconds: Number(e.target.value) }))}
                fullWidth
              />
              <TextField
                label="Availability Refresh (seconds)"
                type="number"
                value={form.availabilityRefreshSeconds ?? 30}
                onChange={(e) => setForm((p: any) => ({ ...p, availabilityRefreshSeconds: Number(e.target.value) }))}
                fullWidth
              />
              <TextField
                label="Max Vendors / Orders Request"
                type="number"
                value={form.maxVendorsPerOrdersRequest ?? 50}
                onChange={(e) => setForm((p: any) => ({ ...p, maxVendorsPerOrdersRequest: Number(e.target.value) }))}
                fullWidth
              />
            </Stack>

            <Divider />

            <Typography variant="subtitle2" sx={{ fontWeight: 900 }}>
              Tokens
            </Typography>
            <Stack spacing={1.5}>
              <TextField
                label="Orders API Token"
                type="password"
                placeholder={s?.ordersToken ? s.ordersToken : ""}
                value={form.ordersToken ?? ""}
                onChange={(e) => setForm((p: any) => ({ ...p, ordersToken: e.target.value }))}
                fullWidth
              />
              <TextField
                label="Availability API Token"
                type="password"
                placeholder={s?.availabilityToken ? s.availabilityToken : ""}
                value={form.availabilityToken ?? ""}
                onChange={(e) => setForm((p: any) => ({ ...p, availabilityToken: e.target.value }))}
                fullWidth
              />
            </Stack>

            <Stack direction="row" spacing={1.2} sx={{ mt: 1 }}>
              <Button variant="contained" onClick={save}>
                Save
              </Button>
              <Button variant="outlined" onClick={runTest}>
                Test Tokens
              </Button>
            </Stack>

            {test ? (
              <Box sx={{ mt: 1 }}>
                <Stack spacing={1}>
                  <Alert severity={test.availability?.ok ? "success" : "error"}>
                    Availability Token: {test.availability?.ok ? "OK" : `Failed${test.availability?.status ? ` (HTTP ${test.availability.status})` : ""}`}
                  </Alert>
                  <Alert severity={test.orders?.ok ? "success" : "error"}>
                    Orders Token: {test.orders?.ok ? "OK" : test.orders?.note ? test.orders.note : `Failed${test.orders?.status ? ` (HTTP ${test.orders.status})` : ""}`}
                  </Alert>
                </Stack>
              </Box>
            ) : null}
          </CardContent>
        </Card>
      </Container>

      <Snackbar open={!!toast} autoHideDuration={2500} onClose={() => setToast(null)} anchorOrigin={{ vertical: "bottom", horizontal: "center" }}>
        {toast ? <Alert severity={toast.type}>{toast.msg}</Alert> : undefined}
      </Snackbar>
    </Box>
  );
}

export { Settings as SettingsPage };
