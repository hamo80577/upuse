import PersonAddAlt1RoundedIcon from "@mui/icons-material/PersonAddAlt1Rounded";
import ArchiveRoundedIcon from "@mui/icons-material/ArchiveRounded";
import EditRoundedIcon from "@mui/icons-material/EditRounded";
import VisibilityOffRoundedIcon from "@mui/icons-material/VisibilityOffRounded";
import VisibilityRoundedIcon from "@mui/icons-material/VisibilityRounded";
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Checkbox,
  Chip,
  Container,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  MenuItem,
  Snackbar,
  Stack,
  Step,
  StepLabel,
  Stepper,
  TextField,
  Typography,
} from "@mui/material";
import { useEffect, useMemo, useState } from "react";
import { api, describeApiError } from "../../../api/client";
import { useAuth } from "../../../app/providers/AuthProvider";
import { useMonitorStatus } from "../../../app/providers/MonitorStatusProvider";
import type { AppUser, AppUserRole, ScanoRole } from "../../../api/types";
import { TopBar } from "../../../widgets/top-bar/ui/TopBar";

const USER_WIZARD_STEPS = ["Account Details", "Workspace Access"] as const;

interface UserWizardState {
  name: string;
  email: string;
  password: string;
  upuseAccess: boolean;
  upuseRole: AppUserRole;
  scanoAccess: boolean;
  scanoRole: ScanoRole;
}

function emptyWizardState(): UserWizardState {
  return {
    name: "",
    email: "",
    password: "",
    upuseAccess: true,
    upuseRole: "user",
    scanoAccess: false,
    scanoRole: "scanner",
  };
}

function hasAnyWorkspaceAccess(state: UserWizardState) {
  return state.upuseAccess || state.scanoAccess;
}

function buildUserPayload(state: UserWizardState) {
  return {
    email: state.email.trim(),
    name: state.name.trim(),
    upuseAccess: state.upuseAccess,
    ...(state.upuseAccess ? { upuseRole: state.upuseRole } : {}),
    ...(state.scanoAccess ? { scanoAccessRole: state.scanoRole } : {}),
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
  const [dialogOpen, setDialogOpen] = useState(false);
  const [activeStep, setActiveStep] = useState(0);
  const [form, setForm] = useState<UserWizardState>(emptyWizardState);
  const [editingUser, setEditingUser] = useState<AppUser | null>(null);
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

  const editingPrimaryAdmin = editingUser?.isPrimaryAdmin === true;

  const canMoveNext = useMemo(() => {
    if (activeStep === 0) {
      if (!form.name.trim() || !form.email.trim()) {
        return false;
      }
      if (!editingUser && !form.password.trim()) {
        return false;
      }
      return true;
    }

    if (editingPrimaryAdmin) {
      return true;
    }

    if (!hasAnyWorkspaceAccess(form)) {
      return false;
    }
    if (form.upuseAccess && !form.upuseRole) {
      return false;
    }
    if (form.scanoAccess && !form.scanoRole) {
      return false;
    }
    return true;
  }, [activeStep, editingPrimaryAdmin, editingUser, form]);

  function openCreateDialog() {
    setEditingUser(null);
    setForm(emptyWizardState());
    setActiveStep(0);
    setShowPassword(false);
    setDialogOpen(true);
  }

  function openEditDialog(item: AppUser) {
    if (!item.active) return;
    setEditingUser(item);
    setForm({
      name: item.name,
      email: item.email,
      password: "",
      upuseAccess: item.upuseAccess,
      upuseRole: item.role,
      scanoAccess: !!item.scanoRole,
      scanoRole: item.scanoRole ?? "scanner",
    });
    setActiveStep(0);
    setShowPassword(false);
    setDialogOpen(true);
  }

  function closeDialog() {
    if (submitting) return;
    setDialogOpen(false);
    setEditingUser(null);
    setForm(emptyWizardState());
    setActiveStep(0);
    setShowPassword(false);
  }

  async function handleSubmit() {
    if (submitting) return;

    if (!form.name.trim() || !form.email.trim()) {
      setToast({ type: "error", msg: "Enter the user name and email first." });
      return;
    }
    if (!editingUser && !form.password.trim()) {
      setToast({ type: "error", msg: "Enter a password for the new user." });
      return;
    }
    if (!editingPrimaryAdmin && !hasAnyWorkspaceAccess(form)) {
      setToast({ type: "error", msg: "Grant at least one workspace access." });
      return;
    }

    try {
      setSubmitting(true);
      if (editingUser) {
        await api.updateUser(editingUser.id, {
          ...buildUserPayload(form),
          ...(form.password.trim() ? { password: form.password.trim() } : {}),
          ...(editingPrimaryAdmin ? { upuseAccess: true, upuseRole: "admin", scanoAccessRole: editingUser.scanoRole } : {}),
        });
        setToast({ type: "success", msg: "User updated" });
      } else {
        await api.createUser({
          ...buildUserPayload(form),
          password: form.password.trim(),
        });
        setToast({ type: "success", msg: "User created" });
      }

      closeDialog();
      await load();
    } catch (submitError) {
      setToast({
        type: "error",
        msg: describeApiError(submitError, editingUser ? "Failed to update user" : "Failed to create user"),
      });
    } finally {
      setSubmitting(false);
    }
  }

  const archiveUser = async (item: AppUser) => {
    if (submitting) return;
    if (!window.confirm(`Archive ${item.name} (${item.email})?`)) return;

    try {
      setSubmitting(true);
      await api.deleteUser(item.id);
      if (editingUser?.id === item.id) {
        closeDialog();
      }
      setToast({ type: "success", msg: "User archived" });
      await load();
    } catch (archiveError) {
      setToast({ type: "error", msg: describeApiError(archiveError, "Failed to archive user") });
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
              <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5} justifyContent="space-between" alignItems={{ xs: "flex-start", sm: "center" }}>
                <Box>
                  <Typography variant="h6" sx={{ fontWeight: 900 }}>
                    User Access
                  </Typography>
                  <Typography variant="body2" sx={{ color: "text.secondary", display: { xs: "none", sm: "block" } }}>
                    Create users, archive access safely, and manage UPuse versus Scano visibility from one flow.
                  </Typography>
                </Box>

                <Button variant="contained" startIcon={<PersonAddAlt1RoundedIcon />} onClick={openCreateDialog}>
                  Create New User
                </Button>
              </Stack>

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
                        bgcolor: item.active ? "rgba(248,250,252,0.82)" : "rgba(241,245,249,0.92)",
                        opacity: item.active ? 1 : 0.78,
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
                      <Stack direction="row" spacing={0.7} flexWrap="wrap" useFlexGap>
                        {!item.active ? (
                          <Chip size="small" label="Archived" color="default" variant="filled" />
                        ) : null}
                        {item.upuseAccess ? (
                          <Chip
                            size="small"
                            label={item.role === "admin" ? "UPuse Admin" : "UPuse User"}
                            color={item.role === "admin" ? "primary" : "default"}
                            variant={item.role === "admin" ? "filled" : "outlined"}
                          />
                        ) : (
                          <Chip size="small" label="No UPuse" variant="outlined" />
                        )}
                        {item.isPrimaryAdmin ? (
                          <Chip size="small" label="Primary Admin" color="warning" variant="outlined" />
                        ) : item.scanoRole ? (
                          <Chip
                            size="small"
                            label={item.scanoRole === "team_lead" ? "Scano Team Lead" : "Scano Scanner"}
                            sx={{
                              fontWeight: 800,
                              bgcolor: item.scanoRole === "team_lead" ? "rgba(219,234,254,0.95)" : "rgba(224,242,254,0.95)",
                              color: item.scanoRole === "team_lead" ? "#1d4ed8" : "#0369a1",
                            }}
                          />
                        ) : (
                          <Chip size="small" label="No Scano" variant="outlined" />
                        )}
                        {item.id === user?.id ? (
                          <Chip size="small" label="Current session" variant="outlined" />
                        ) : null}
                      </Stack>
                      <Button size="small" startIcon={<EditRoundedIcon />} onClick={() => openEditDialog(item)} disabled={submitting || !item.active}>
                        Edit
                      </Button>
                      <Button
                        size="small"
                        color="warning"
                        startIcon={<ArchiveRoundedIcon />}
                        onClick={() => void archiveUser(item)}
                        disabled={submitting || !item.active || item.id === user?.id || item.isPrimaryAdmin}
                      >
                        Archive
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
        </Stack>
      </Container>

      <Dialog open={dialogOpen} onClose={closeDialog} fullWidth maxWidth="md">
        <DialogTitle>{editingUser ? "Edit User" : "Create New User"}</DialogTitle>
        <DialogContent dividers>
          <Stack spacing={2}>
            <Stepper activeStep={activeStep} alternativeLabel>
              {USER_WIZARD_STEPS.map((step) => (
                <Step key={step}>
                  <StepLabel>{step}</StepLabel>
                </Step>
              ))}
            </Stepper>

            {activeStep === 0 ? (
              <Stack spacing={1.5}>
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
                <TextField
                  label="Password"
                  type={showPassword ? "text" : "password"}
                  value={form.password}
                  onChange={(event) => setForm((current) => ({ ...current, password: event.target.value }))}
                  helperText={editingUser ? "Leave blank to keep the current password." : "Required for new users."}
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
              </Stack>
            ) : (
              <Stack spacing={1.5}>
                {editingPrimaryAdmin ? (
                  <Alert severity="info" variant="outlined">
                    The primary admin keeps fixed workspace access to UPuse and Scano.
                  </Alert>
                ) : (
                  <>
                    <FormControlLabel
                      control={(
                        <Checkbox
                          checked={form.upuseAccess}
                          onChange={(event) => setForm((current) => ({
                            ...current,
                            upuseAccess: event.target.checked,
                            upuseRole: current.upuseRole || "user",
                          }))}
                        />
                      )}
                      label="UPuse access"
                    />
                    {form.upuseAccess ? (
                      <TextField
                        select
                        label="UPuse Role"
                        value={form.upuseRole}
                        onChange={(event) => setForm((current) => ({ ...current, upuseRole: event.target.value as AppUserRole }))}
                        fullWidth
                      >
                        <MenuItem value="user">User</MenuItem>
                        <MenuItem value="admin">Admin</MenuItem>
                      </TextField>
                    ) : null}

                    <FormControlLabel
                      control={(
                        <Checkbox
                          checked={form.scanoAccess}
                          onChange={(event) => setForm((current) => ({
                            ...current,
                            scanoAccess: event.target.checked,
                            scanoRole: current.scanoRole || "scanner",
                          }))}
                        />
                      )}
                      label="Scano access"
                    />
                    {form.scanoAccess ? (
                      <TextField
                        select
                        label="Scano Role"
                        value={form.scanoRole}
                        onChange={(event) => setForm((current) => ({ ...current, scanoRole: event.target.value as ScanoRole }))}
                        fullWidth
                      >
                        <MenuItem value="team_lead">Team Lead</MenuItem>
                        <MenuItem value="scanner">Scanner</MenuItem>
                      </TextField>
                    ) : null}

                    {!hasAnyWorkspaceAccess(form) ? (
                      <Alert severity="warning" variant="outlined">
                        Select at least one workspace access before saving this user.
                      </Alert>
                    ) : null}
                  </>
                )}
              </Stack>
            )}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={closeDialog} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={() => setActiveStep((current) => Math.max(0, current - 1))} disabled={activeStep === 0 || submitting}>
            Back
          </Button>
          {activeStep < USER_WIZARD_STEPS.length - 1 ? (
            <Button variant="contained" onClick={() => setActiveStep((current) => current + 1)} disabled={!canMoveNext || submitting}>
              Next
            </Button>
          ) : (
            <Button variant="contained" onClick={() => void handleSubmit()} disabled={!canMoveNext || submitting}>
              {submitting ? (editingUser ? "Saving..." : "Creating...") : (editingUser ? "Save Changes" : "Create User")}
            </Button>
          )}
        </DialogActions>
      </Dialog>

      <Snackbar open={!!toast} autoHideDuration={2500} onClose={() => setToast(null)} anchorOrigin={{ vertical: "bottom", horizontal: "center" }}>
        {toast ? <Alert severity={toast.type}>{toast.msg}</Alert> : undefined}
      </Snackbar>
    </Box>
  );
}
