import AccountTreeRoundedIcon from "@mui/icons-material/AccountTreeRounded";
import TuneRoundedIcon from "@mui/icons-material/TuneRounded";
import { Alert, Box, Button, Card, CardContent, Container, Divider, Snackbar, Stack, Tab, Tabs, TextField, Typography, useMediaQuery, useTheme } from "@mui/material";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, describeApiError } from "../../../api/client";
import { useAuth } from "../../../app/providers/AuthProvider";
import { useMonitorStatus } from "../../../app/providers/MonitorStatusProvider";
import type { SettingsMasked, SettingsTokenTestSnapshot } from "../../../api/types";
import { TopBar } from "../../../widgets/top-bar/ui/TopBar";

export function SettingsPage() {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("sm"));
  const navigate = useNavigate();
  const { canManageMonitor, canManageSettings, canManageTokens, canTestTokens } = useAuth();
  const { monitoring, startMonitoring, stopMonitoring } = useMonitorStatus();

  const [s, setS] = useState<SettingsMasked | null>(null);
  const [form, setForm] = useState<any>({});
  const [toast, setToast] = useState<{ type: "success" | "error" | "info"; msg: string } | null>(null);
  const [test, setTest] = useState<SettingsTokenTestSnapshot | null>(null);
  const [testJobId, setTestJobId] = useState<string | null>(null);
  const [mobileSection, setMobileSection] = useState<"monitor" | "tokens">("monitor");
  const canSave = canManageSettings || canManageTokens;
  const canAccessTokenSection = canManageTokens || canTestTokens;
  const testPollTimerRef = useRef<number | null>(null);

  const clearTestPollTimer = () => {
    if (testPollTimerRef.current != null) {
      window.clearTimeout(testPollTimerRef.current);
      testPollTimerRef.current = null;
    }
  };

  const applySettings = (settings: SettingsMasked) => {
    setS(settings);
    setForm({
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

  useEffect(() => {
    return () => {
      clearTestPollTimer();
    };
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
      setTestJobId(null);
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
      clearTestPollTimer();
      const started = await api.startTokenTest();
      setTestJobId(started.jobId);
      setTest(started.snapshot);
    } catch (error) {
      setToast({ type: "error", msg: describeApiError(error, "Test failed") });
    }
  };

  useEffect(() => {
    if (!testJobId) return;
    if (!test || (test.status !== "pending" && test.status !== "running")) return;

    clearTestPollTimer();
    testPollTimerRef.current = window.setTimeout(() => {
      void api.getTokenTest(testJobId)
        .then((snapshot) => {
          setTest(snapshot);
          if (snapshot.status === "completed" || snapshot.status === "failed") {
            setTestJobId(null);
          }
        })
        .catch((error) => {
          clearTestPollTimer();
          setTestJobId(null);
          setToast({ type: "error", msg: describeApiError(error, "Test failed") });
        });
    }, 1200);

    return () => {
      clearTestPollTimer();
    };
  }, [test, testJobId]);

  return (
    <Box sx={{ minHeight: "100vh", bgcolor: "background.default" }}>
      <TopBar
        running={monitoring.running}
        degraded={monitoring.degraded}
        onStart={onStart}
        onStop={onStop}
        canControlMonitor={canManageMonitor}
      />

      <Container maxWidth="lg" sx={{ py: { xs: 2, md: 3 } }}>
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
                <Typography variant="body2" sx={{ color: "text.secondary", display: { xs: "none", sm: "block" } }}>
                  Manage monitor timing and API tokens.
                </Typography>
              </Box>

              <Stack direction={{ xs: "column", sm: "row" }} spacing={1}>
                <Button
                  variant="outlined"
                  startIcon={<AccountTreeRoundedIcon />}
                  onClick={() => navigate("/branches")}
                  sx={{ borderRadius: 999, fontWeight: 800 }}
                >
                  Branches
                </Button>
                <Button
                  variant="outlined"
                  startIcon={<TuneRoundedIcon />}
                  onClick={() => navigate("/thresholds")}
                  sx={{ borderRadius: 999, fontWeight: 800 }}
                >
                  Thresholds
                </Button>
              </Stack>
            </Stack>

            {isMobile ? (
              <Box
                sx={{
                  borderRadius: 999,
                  border: "1px solid rgba(148,163,184,0.14)",
                  bgcolor: "rgba(248,250,252,0.92)",
                  overflow: "hidden",
                }}
              >
                <Tabs value={mobileSection} onChange={(_event, value) => setMobileSection(value)} variant="fullWidth" sx={{ minHeight: 42, "& .MuiTab-root": { minHeight: 42, fontWeight: 900, textTransform: "none" } }}>
                  <Tab value="monitor" label="Monitor" />
                  {canAccessTokenSection ? <Tab value="tokens" label="Tokens" /> : null}
                </Tabs>
              </Box>
            ) : null}

            <Box sx={{ display: { xs: !isMobile || mobileSection === "monitor" ? "block" : "none", sm: "block" } }}>
              <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5}>
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

              <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5} sx={{ mt: 1.5 }}>
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

              <Stack direction={{ xs: "column", sm: "row" }} spacing={1.2} sx={{ mt: 1.5 }}>
                {canManageSettings ? <Button variant="contained" onClick={save}>Save</Button> : null}
              </Stack>
            </Box>

            {canAccessTokenSection ? (
              <Box sx={{ display: { xs: !isMobile || mobileSection === "tokens" ? "block" : "none", sm: "block" } }}>
                <Divider sx={{ display: { xs: isMobile ? "none" : "block", sm: "block" }, mb: { xs: 0, sm: 0 } }} />

                <Typography variant="subtitle2" sx={{ fontWeight: 900, mb: 1.5, display: { xs: "none", sm: "block" } }}>
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

                <Stack direction={{ xs: "column", sm: "row" }} spacing={1.2} sx={{ mt: 1.5 }}>
                  {canManageTokens ? <Button variant="contained" onClick={save}>Save</Button> : null}
                  {canTestTokens ? (
                    <Button variant="outlined" onClick={runTest} disabled={!!testJobId}>
                      {testJobId ? "Testing..." : "Test Tokens"}
                    </Button>
                  ) : null}
                </Stack>

                {test ? (
                  <Box sx={{ mt: 1 }}>
                    <Stack spacing={1}>
                      <Alert severity={test.status === "failed" ? "error" : test.status === "completed" ? "success" : "info"}>
                        Token Test Job: {test.status} • {test.progress.processedBranches}/{test.progress.totalBranches} branches • {test.progress.percent}%
                      </Alert>
                      <Alert severity={test.availability.ok ? "success" : test.availability.configured ? "error" : "warning"}>
                        Availability Token:{" "}
                        {test.availability.ok
                          ? "OK"
                          : test.availability.message || `Failed${test.availability.status ? ` (HTTP ${test.availability.status})` : ""}`}
                      </Alert>
                      <Alert severity={test.orders.configValid ? "success" : "warning"}>
                        Orders Config: {test.orders.configValid ? "Ready for branch checks" : test.orders.configMessage || "Configuration incomplete"}
                      </Alert>
                      {test.orders.probe ? (
                        <Alert severity={test.orders.probe.ok ? "success" : test.orders.probe.configured ? "warning" : "warning"}>
                          Orders Probe:{" "}
                          {test.orders.probe.ok
                            ? "OK"
                            : test.orders.probe.message || `Failed${test.orders.probe.status ? ` (HTTP ${test.orders.probe.status})` : ""}`}
                        </Alert>
                      ) : null}
                      <Alert severity={test.orders.ok ? "success" : test.orders.failedBranchCount > 0 ? "warning" : "info"}>
                        Orders Branch Sweep: {test.orders.passedBranchCount}/{test.orders.enabledBranchCount} enabled branches passed
                        {test.orders.failedBranchCount > 0 ? `, ${test.orders.failedBranchCount} failed` : ""}
                      </Alert>
                      {test.orders.branches.length ? (
                        <Stack spacing={0.75}>
                          {test.orders.branches.map((branch) => (
                            <Alert key={branch.branchId} severity={branch.ok ? "success" : "error"} variant="outlined">
                              {branch.name} ({branch.ordersVendorId}):{" "}
                              {branch.ok ? branch.sampleVendorName || branch.message || "Token OK" : branch.message || `Failed${branch.status ? ` (HTTP ${branch.status})` : ""}`}
                            </Alert>
                          ))}
                        </Stack>
                      ) : null}
                    </Stack>
                  </Box>
                ) : null}
              </Box>
            ) : null}

            {!canAccessTokenSection ? (
              <Alert severity="info" variant="outlined">
                Token management and token tests are not available for this role.
              </Alert>
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
