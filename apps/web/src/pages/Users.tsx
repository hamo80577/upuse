import PersonAddAlt1RoundedIcon from "@mui/icons-material/PersonAddAlt1Rounded";
import VisibilityOffRoundedIcon from "@mui/icons-material/VisibilityOffRounded";
import VisibilityRoundedIcon from "@mui/icons-material/VisibilityRounded";
import { Alert, Box, Button, Card, CardContent, Chip, Container, MenuItem, Snackbar, Stack, TextField, Typography } from "@mui/material";
import { useEffect, useState } from "react";
import { api, describeApiError } from "../api/client";
import { useMonitorStatus } from "../app/providers/MonitorStatusProvider";
import type { AppUser, AppUserRole } from "../api/types";
import { TopBar } from "../components/TopBar";

function emptyForm() {
  return {
    name: "",
    email: "",
    password: "",
    role: "user" as AppUserRole,
  };
}

export function UsersPage() {
  const { monitoring, startMonitoring, stopMonitoring } = useMonitorStatus();
  const [items, setItems] = useState<AppUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [toast, setToast] = useState<{ type: "success" | "error"; msg: string } | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [showPassword, setShowPassword] = useState(false);

  const load = async () => {
    try {
      setLoading(true);
      setError("");
      const response = await api.listUsers();
      setItems(response.items);
    } catch (loadError) {
      setError(describeApiError(loadError, "Failed to load users"));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const onStart = async () => {
    try {
      await startMonitoring();
      setToast({ type: "success", msg: "Monitoring started" });
    } catch (startError) {
      setToast({ type: "error", msg: describeApiError(startError, "Failed to start") });
    }
  };

  const onStop = async () => {
    try {
      await stopMonitoring();
      setToast({ type: "success", msg: "Monitoring stopped" });
    } catch (stopError) {
      setToast({ type: "error", msg: describeApiError(stopError, "Failed to stop") });
    }
  };

  const create = async () => {
    if (submitting) return;

    try {
      setSubmitting(true);
      await api.createUser(form);
      setToast({ type: "success", msg: "User created" });
      setForm(emptyForm());
      await load();
    } catch (createError) {
      setToast({ type: "error", msg: describeApiError(createError, "Failed to create user") });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Box sx={{ minHeight: "100vh", bgcolor: "background.default" }}>
      <TopBar running={monitoring.running} degraded={monitoring.degraded} onStart={onStart} onStop={onStop} canControlMonitor />

      <Container maxWidth="lg" sx={{ py: 3 }}>
        <Stack spacing={2}>
          <Card>
            <CardContent sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
              <Box>
                <Typography variant="h6" sx={{ fontWeight: 900 }}>
                  User Access
                </Typography>
                <Typography variant="body2" sx={{ color: "text.secondary" }}>
                  Create users and assign roles.
                </Typography>
              </Box>

              {error ? (
                <Alert severity="error" variant="outlined">
                  {error}
                </Alert>
              ) : null}

              <Stack spacing={1.2}>
                {loading ? (
                  <Typography variant="body2" sx={{ color: "text.secondary" }}>
                    Loading users...
                  </Typography>
                ) : items.length ? (
                  items.map((item) => (
                    <Box
                      key={item.id}
                      sx={{
                        display: "flex",
                        gap: 1.2,
                        alignItems: "center",
                        p: 1.2,
                        borderRadius: 2.5,
                        border: "1px solid rgba(148,163,184,0.12)",
                        bgcolor: "rgba(248,250,252,0.82)",
                      }}
                    >
                      <Box sx={{ flex: 1, minWidth: 0 }}>
                        <Typography sx={{ fontWeight: 900 }} noWrap>
                          {item.name}
                        </Typography>
                        <Typography variant="caption" sx={{ color: "text.secondary" }} noWrap>
                          {item.email}
                        </Typography>
                      </Box>
                      <Chip
                        size="small"
                        label={item.role === "admin" ? "Admin" : "User"}
                        color={item.role === "admin" ? "primary" : "default"}
                        variant={item.role === "admin" ? "filled" : "outlined"}
                      />
                    </Box>
                  ))
                ) : (
                  <Alert severity="info" variant="outlined">
                    No users found.
                  </Alert>
                )}
              </Stack>
            </CardContent>
          </Card>

          <Card>
            <CardContent sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
              <Typography variant="subtitle1" sx={{ fontWeight: 900 }}>
                Create User
              </Typography>

              <Stack direction={{ xs: "column", md: "row" }} spacing={1.5}>
                <TextField
                  label="Full Name"
                  value={form.name}
                  onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
                  fullWidth
                />
                <TextField
                  label="Email"
                  type="email"
                  value={form.email}
                  onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))}
                  fullWidth
                />
              </Stack>

              <Stack direction={{ xs: "column", md: "row" }} spacing={1.5}>
                <TextField
                  label="Password"
                  type={showPassword ? "text" : "password"}
                  value={form.password}
                  onChange={(event) => setForm((current) => ({ ...current, password: event.target.value }))}
                  fullWidth
                  InputProps={{
                    endAdornment: (
                      <Button
                        type="button"
                        onClick={() => setShowPassword((current) => !current)}
                        sx={{ minWidth: 0, px: 1, mr: -0.5 }}
                        startIcon={showPassword ? <VisibilityOffRoundedIcon /> : <VisibilityRoundedIcon />}
                      >
                        {showPassword ? "Hide" : "Show"}
                      </Button>
                    ),
                  }}
                />
                <TextField
                  select
                  label="Role"
                  value={form.role}
                  onChange={(event) => setForm((current) => ({ ...current, role: event.target.value as AppUserRole }))}
                  fullWidth
                >
                  <MenuItem value="user">User</MenuItem>
                  <MenuItem value="admin">Admin</MenuItem>
                </TextField>
              </Stack>

              <Stack direction="row" spacing={1.2}>
                <Button variant="contained" startIcon={<PersonAddAlt1RoundedIcon />} onClick={create} disabled={submitting}>
                  {submitting ? "Creating..." : "Create User"}
                </Button>
              </Stack>
            </CardContent>
          </Card>
        </Stack>
      </Container>

      <Snackbar open={!!toast} autoHideDuration={2500} onClose={() => setToast(null)} anchorOrigin={{ vertical: "bottom", horizontal: "center" }}>
        {toast ? <Alert severity={toast.type}>{toast.msg}</Alert> : undefined}
      </Snackbar>
    </Box>
  );
}

export { UsersPage as Users };
