import TuneRoundedIcon from "@mui/icons-material/TuneRounded";
import { Alert, Box, Button, Card, CardContent, Container, Divider, Snackbar, Stack, TextField, Typography } from "@mui/material";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, describeApiError } from "../api/client";
import { useAuth } from "../app/providers/AuthProvider";
import { useMonitorStatus } from "../app/providers/MonitorStatusProvider";
import type { SettingsMasked, SettingsTokenTestResponse } from "../api/types";
import { TopBar } from "../components/TopBar";

export function Settings() {
  const navigate = useNavigate();
  const { canManageMonitor, canManageSettings, canManageTokens, canTestTokens } = useAuth();
  const { monitoring, startMonitoring, stopMonitoring } = useMonitorStatus();

  const [s, setS] = useState<SettingsMasked | null>(null);
  const [form, setForm] = useState<any>({});
  const [toast, setToast] = useState<{ type: "success" | "error" | "info"; msg: string } | null>(null);
  const [test, setTest] = useState<SettingsTokenTestResponse | null>(null);
  const canSave = canManageSettings || canManageTokens;

  const applySettings = (settings: SettingsMasked) => {
    setS(settings);
    setForm({
      globalEntityId: settings.globalEntityId,
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
      const settings = await api.getSettings();
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

  const save = async () => {
    if (!canSave) {
      setToast({ type: "info", msg: "No access" });
      return;
    }
    try {
      const payload: any = canManageSettings
        ? {
            globalEntityId: form.globalEntityId,
            tempCloseMinutes: form.tempCloseMinutes,
            graceMinutes: form.graceMinutes,
            ordersRefreshSeconds: form.ordersRefreshSeconds,
            availabilityRefreshSeconds: form.availabilityRefreshSeconds,
            maxVendorsPerOrdersRequest: form.maxVendorsPerOrdersRequest,
          }
        : {};

      if (canManageTokens) {
        const ordersToken = String(form.ordersToken ?? "").trim();
        const availabilityToken = String(form.availabilityToken ?? "").trim();

        if (ordersToken) payload.ordersToken = ordersToken;
        if (availabilityToken) payload.availabilityToken = availabilityToken;
      }

      if (!canManageSettings && !Object.keys(payload).length) {
        setToast({ type: "info", msg: "Enter at least one token before saving." });
        return;
      }

      if (!payload.ordersToken) delete payload.ordersToken;
      if (!payload.availabilityToken) delete payload.availabilityToken;

      await api.putSettings(payload);
      const fresh = await api.getSettings();
      applySettings(fresh);
      setToast({ type: "success", msg: "Saved" });
      setTest(null);
    } catch {
      setToast({ type: "error", msg: "Save failed" });
    }
  };

  const runTest = async () => {
    if (!canTestTokens) {
      setToast({ type: "info", msg: "No access" });
      return;
    }
    try {
      const r = await api.testTokens();
      setTest(r);
    } catch {
      setToast({ type: "error", msg: "Test failed" });
    }
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
                  Settings
                </Typography>
                <Typography variant="body2" sx={{ color: "text.secondary" }}>
                  Manage monitor timing and API tokens.
                </Typography>
              </Box>

              <Button
                variant="outlined"
                startIcon={<TuneRoundedIcon />}
                onClick={() => navigate("/settings/thresholds")}
                sx={{ borderRadius: 999, fontWeight: 800 }}
              >
                Threshold Rules
              </Button>
            </Stack>

            <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5}>
              <TextField
                label="Global Entity ID"
                value={form.globalEntityId ?? ""}
                onChange={(e) => setForm((p: any) => ({ ...p, globalEntityId: e.target.value }))}
                disabled={!canManageSettings}
                fullWidth
              />
              <TextField
                label="Temp Close (minutes)"
                type="number"
                value={form.tempCloseMinutes ?? 30}
                onChange={(e) => setForm((p: any) => ({ ...p, tempCloseMinutes: Number(e.target.value) }))}
                disabled={!canManageSettings}
                fullWidth
              />
              <TextField
                label="Grace (minutes)"
                type="number"
                value={form.graceMinutes ?? 5}
                onChange={(e) => setForm((p: any) => ({ ...p, graceMinutes: Number(e.target.value) }))}
                disabled={!canManageSettings}
                fullWidth
              />
            </Stack>

            <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5}>
              <TextField
                label="Orders Refresh (seconds)"
                type="number"
                value={form.ordersRefreshSeconds ?? 30}
                onChange={(e) => setForm((p: any) => ({ ...p, ordersRefreshSeconds: Number(e.target.value) }))}
                disabled={!canManageSettings}
                fullWidth
              />
              <TextField
                label="Availability Refresh (seconds)"
                type="number"
                value={form.availabilityRefreshSeconds ?? 30}
                onChange={(e) => setForm((p: any) => ({ ...p, availabilityRefreshSeconds: Number(e.target.value) }))}
                disabled={!canManageSettings}
                fullWidth
              />
              <TextField
                label="Max Vendors / Orders Request"
                type="number"
                value={form.maxVendorsPerOrdersRequest ?? 50}
                onChange={(e) => setForm((p: any) => ({ ...p, maxVendorsPerOrdersRequest: Number(e.target.value) }))}
                disabled={!canManageSettings}
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
                disabled={!canManageTokens}
                fullWidth
              />
              <TextField
                label="Availability API Token"
                type="password"
                placeholder={s?.availabilityToken ? s.availabilityToken : ""}
                value={form.availabilityToken ?? ""}
                onChange={(e) => setForm((p: any) => ({ ...p, availabilityToken: e.target.value }))}
                disabled={!canManageTokens}
                fullWidth
              />
            </Stack>

            <Stack direction="row" spacing={1.2} sx={{ mt: 1 }}>
              <Button variant="contained" onClick={save} disabled={!canSave}>
                {canSave ? "Save" : "Read Only"}
              </Button>
              <Button variant="outlined" onClick={runTest} disabled={!canTestTokens}>
                Test Tokens
              </Button>
            </Stack>

            {test ? (
              <Box sx={{ mt: 1 }}>
                <Stack spacing={1}>
                  <Alert severity={test.availability.ok ? "success" : test.availability.configured ? "error" : "warning"}>
                    Availability Token:{" "}
                    {test.availability.ok
                      ? "OK"
                      : test.availability.message || `Failed${test.availability.status ? ` (HTTP ${test.availability.status})` : ""}`}
                  </Alert>
                  <Alert severity={test.orders.configValid ? "success" : "warning"}>
                    Orders Config: {test.orders.configValid ? "Ready for branch checks" : test.orders.configMessage || "Configuration incomplete"}
                  </Alert>
                  <Alert severity={test.orders.ok ? "success" : test.orders.failedBranchCount > 0 ? "warning" : "info"}>
                    Orders Branch Sweep: {test.orders.passedBranchCount}/{test.orders.enabledBranchCount} enabled branches passed
                    {test.orders.failedBranchCount > 0 ? `, ${test.orders.failedBranchCount} failed` : ""}
                  </Alert>
                  {test.orders.branches.length ? (
                    <Stack spacing={0.75}>
                      {test.orders.branches.map((branch) => (
                        <Alert key={branch.branchId} severity={branch.ok ? "success" : "error"} variant="outlined">
                          {branch.name} ({branch.ordersVendorId}, {branch.globalEntityId || "missing entity"}):{" "}
                          {branch.ok ? branch.sampleVendorName || branch.message || "Token OK" : branch.message || `Failed${branch.status ? ` (HTTP ${branch.status})` : ""}`}
                        </Alert>
                      ))}
                    </Stack>
                  ) : null}
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
