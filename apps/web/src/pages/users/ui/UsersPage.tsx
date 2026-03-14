import PersonAddAlt1RoundedIcon from "@mui/icons-material/PersonAddAlt1Rounded";
import DeleteOutlineRoundedIcon from "@mui/icons-material/DeleteOutlineRounded";
import EditRoundedIcon from "@mui/icons-material/EditRounded";
import VisibilityOffRoundedIcon from "@mui/icons-material/VisibilityOffRounded";
import VisibilityRoundedIcon from "@mui/icons-material/VisibilityRounded";
import { Alert, Box, Button, Card, CardContent, Chip, Container, MenuItem, Snackbar, Stack, TextField, Typography } from "@mui/material";
import { useEffect, useState } from "react";
import { api, describeApiError } from "../../../api/client";
import { useAuth } from "../../../app/providers/AuthProvider";
import { useMonitorStatus } from "../../../app/providers/MonitorStatusProvider";
import type { AppUser, AppUserRole } from "../../../api/types";
import { TopBar } from "../../../widgets/top-bar/ui/TopBar";

function emptyForm() {
  return {
    name: "",
    email: "",
    password: "",
    role: "user" as AppUserRole,
  };
}

export function UsersPage() {
  const { user } = useAuth();
  const { monitoring, startMonitoring, stopMonitoring } = useMonitorStatus();
  const [items, setItems] = useState<AppUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [toast, setToast] = useState<{ type: "success" | "error"; msg: string } | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [editingUserId, setEditingUserId] = useState<number | null>(null);
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

  const submit = async () => {
    if (submitting) return;

    try {
      setSubmitting(true);
      if (editingUserId != null) {
        await api.updateUser(editingUserId, {
          email: form.email,
          name: form.name,
          role: form.role,
          password: form.password.trim() ? form.password : undefined,
        });
        setToast({ type: "success", msg: "User updated" });
      } else {
        await api.createUser(form);
        setToast({ type: "success", msg: "User created" });
      }
      setForm(emptyForm());
      setEditingUserId(null);
      setShowPassword(false);
      await load();
    } catch (submitError) {
      setToast({
        type: "error",
        msg: describeApiError(submitError, editingUserId != null ? "Failed to update user" : "Failed to create user"),
      });
    } finally {
      setSubmitting(false);
    }
  };

  const startEdit = (item: AppUser) => {
    setEditingUserId(item.id);
    setForm({
      name: item.name,
      email: item.email,
      password: "",
      role: item.role,
    });
    setShowPassword(false);
  };

  const cancelEdit = () => {
    setEditingUserId(null);
    setForm(emptyForm());
    setShowPassword(false);
  };

  const removeUser = async (item: AppUser) => {
    if (submitting) return;
    if (!window.confirm(`Delete ${item.name} (${item.email})?`)) return;

    try {
      setSubmitting(true);
      await api.deleteUser(item.id);
      if (editingUserId === item.id) {
        cancelEdit();
      }
      setToast({ type: "success", msg: "User deleted" });
      await load();
    } catch (deleteError) {
      setToast({ type: "error", msg: describeApiError(deleteError, "Failed to delete user") });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Box sx={{ minHeight: "100vh", bgcolor: "background.default" }}>
      <TopBar running={monitoring.running} degraded={monitoring.degraded} onStart={onStart} onStop={onStop} canControlMonitor />

      <Container maxWidth="lg" sx={{ py: { xs: 2, md: 3 } }}>
        <Stack spacing={2}>
          <Card>
            <CardContent sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
              <Box>
                <Typography variant="h6" sx={{ fontWeight: 900 }}>
                  User Access
                </Typography>
                <Typography variant="body2" sx={{ color: "text.secondary", display: { xs: "none", sm: "block" } }}>
                  Create users, update existing users, and revoke access when needed.
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
                        alignItems: { xs: "flex-start", sm: "center" },
                        flexDirection: { xs: "column", sm: "row" },
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
                      {item.id === user?.id ? (
                        <Chip size="small" label="Current session" variant="outlined" />
                      ) : null}
                      <Button size="small" startIcon={<EditRoundedIcon />} onClick={() => startEdit(item)}>
                        Edit
                      </Button>
                      <Button
                        size="small"
                        color="error"
                        startIcon={<DeleteOutlineRoundedIcon />}
                        onClick={() => void removeUser(item)}
                        disabled={submitting || item.id === user?.id}
                      >
                        Delete
                      </Button>
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
                {editingUserId != null ? "Edit User" : "Create User"}
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
                  helperText={editingUserId != null ? "Leave blank to keep the current password." : undefined}
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
                  disabled={editingUserId === user?.id}
                  fullWidth
                >
                  <MenuItem value="user">User</MenuItem>
                  <MenuItem value="admin">Admin</MenuItem>
                </TextField>
              </Stack>

              <Stack direction={{ xs: "column", sm: "row" }} spacing={1.2}>
                <Button variant="contained" startIcon={<PersonAddAlt1RoundedIcon />} onClick={submit} disabled={submitting}>
                  {submitting ? (editingUserId != null ? "Saving..." : "Creating...") : (editingUserId != null ? "Save Changes" : "Create User")}
                </Button>
                {editingUserId != null ? (
                  <Button variant="outlined" onClick={cancelEdit} disabled={submitting}>
                    Cancel
                  </Button>
                ) : null}
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
