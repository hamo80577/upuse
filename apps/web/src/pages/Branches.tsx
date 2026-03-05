import { Alert, Box, Button, Card, CardContent, Container, Divider, IconButton, MenuItem, Snackbar, Stack, TextField, Typography } from "@mui/material";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import EditOutlinedIcon from "@mui/icons-material/EditOutlined";
import { useEffect, useState } from "react";
import { api, describeApiError } from "../api/client";
import type { BranchMappingItem } from "../api/types";
import { TopBar } from "../components/TopBar";

function emptyForm(globalEntityId = "HF_EG") {
  return {
    name: "",
    chainName: "",
    ordersVendorId: "",
    availabilityVendorId: "",
    globalEntityId,
    enabled: true,
  };
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

export function Branches() {
  const [running, setRunning] = useState(false);
  const [degraded, setDegraded] = useState<boolean | undefined>(undefined);

  const [items, setItems] = useState<BranchMappingItem[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [toast, setToast] = useState<{ type: "success" | "error"; msg: string } | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [defaultGlobalEntityId, setDefaultGlobalEntityId] = useState("HF_EG");
  const [chainNames, setChainNames] = useState<string[]>([]);

  const [form, setForm] = useState<any>(emptyForm());

  const [autoNameLoading, setAutoNameLoading] = useState(false);

  const load = async () => {
    try {
      const [d, r, s] = await Promise.all([api.dashboard(), api.listBranches(), api.getSettings()]);
      setRunning(d.monitoring.running);
      setDegraded(d.monitoring.degraded);
      setItems(r.items);
      setChainNames(s.chains.map((chain) => chain.name));
      setDefaultGlobalEntityId(s.globalEntityId);
      setLoadError(null);
      setForm((current: any) => (
        editingId === null
          ? { ...current, globalEntityId: current.globalEntityId || s.globalEntityId }
          : current
      ));
    } catch (error) {
      const message = describeApiError(error, "Failed to load branches");
      setLoadError(message);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const onStart = async () => {
    try {
      await api.monitorStart();
      setRunning(true);
      setToast({ type: "success", msg: "Monitoring started" });
    } catch (error) {
      setToast({ type: "error", msg: describeApiError(error, "Failed to start") });
    }
  };
  const onStop = async () => {
    try {
      await api.monitorStop();
      setRunning(false);
      setToast({ type: "success", msg: "Monitoring stopped" });
    } catch (error) {
      setToast({ type: "error", msg: describeApiError(error, "Failed to stop") });
    }
  };

  const add = async () => {
    try {
      const payload = {
        name: form.name,
        chainName: String(form.chainName ?? ""),
        ordersVendorId: Number(form.ordersVendorId),
        availabilityVendorId: String(form.availabilityVendorId),
        globalEntityId: form.globalEntityId,
        enabled: !!form.enabled,
      };

      if (editingId !== null) {
        await api.updateBranch(editingId, payload);
        setToast({ type: "success", msg: "Updated" });
      } else {
        await api.addBranch(payload);
        setToast({ type: "success", msg: "Added" });
      }

      setEditingId(null);
      setForm(emptyForm(defaultGlobalEntityId));
      await load();
    } catch (error) {
      setToast({
        type: "error",
        msg: describeBranchSaveError(error, editingId !== null ? "Update failed" : "Add failed"),
      });
    }
  };

  const startEdit = (item: BranchMappingItem) => {
    setEditingId(item.id);
    setForm({
      name: item.name,
      chainName: item.chainName ?? "",
      ordersVendorId: String(item.ordersVendorId),
      availabilityVendorId: String(item.availabilityVendorId),
      globalEntityId: item.globalEntityId,
      enabled: !!item.enabled,
    });
  };

  const cancelEdit = () => {
    setEditingId(null);
    setForm(emptyForm(defaultGlobalEntityId));
  };

  const del = async (id: number) => {
    try {
      await api.deleteBranch(id);
      setToast({ type: "success", msg: "Deleted" });
      if (editingId === id) {
        cancelEdit();
      }
      await load();
    } catch (error) {
      setToast({ type: "error", msg: describeApiError(error, "Delete failed") });
    }
  };

  const fetchName = async () => {
    const id = Number(form.ordersVendorId);
    if (!id) return setToast({ type: "error", msg: "Enter Orders Vendor ID" });

    try {
      setAutoNameLoading(true);
      const r = await api.lookupVendorName(id, form.globalEntityId);
      if (r.name) setForm((p: any) => ({ ...p, name: r.name }));
      else setToast({ type: "error", msg: "Name not found (no orders today)" });
    } catch (error) {
      setToast({ type: "error", msg: describeApiError(error, "Name lookup failed") });
    } finally {
      setAutoNameLoading(false);
    }
  };

  const chainOptions = form.chainName && !chainNames.includes(form.chainName) ? [...chainNames, form.chainName] : chainNames;

  return (
    <Box sx={{ minHeight: "100vh", bgcolor: "background.default" }}>
      <TopBar running={running} degraded={degraded} onStart={onStart} onStop={onStop} />

      <Container maxWidth="md" sx={{ py: 3 }}>
        <Card>
          <CardContent sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <Typography variant="h6">Branches</Typography>

            {loadError ? (
              <Alert severity="error" variant="outlined">
                {loadError}
              </Alert>
            ) : null}

            <Stack spacing={1.2}>
              {items.map((b) => (
                <Box
                  key={b.id}
                  sx={{
                    display: "flex",
                    gap: 1,
                    alignItems: "center",
                    p: 1.2,
                    borderRadius: 2,
                    bgcolor: editingId === b.id ? "rgba(37,99,235,0.05)" : "rgba(17,24,39,0.03)",
                    border: editingId === b.id ? "1px solid rgba(37,99,235,0.12)" : "1px solid transparent",
                  }}
                >
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Typography sx={{ fontWeight: 900 }} noWrap>
                      {b.name}
                    </Typography>
                    <Typography variant="caption" sx={{ color: "text.secondary" }} noWrap>
                      {b.chainName ? `Chain: ${b.chainName} • ` : ""}
                      Orders Vendor: {b.ordersVendorId} • Availability Vendor: {b.availabilityVendorId}
                    </Typography>
                  </Box>
                  <IconButton onClick={() => startEdit(b)} color={editingId === b.id ? "primary" : "default"}>
                    <EditOutlinedIcon />
                  </IconButton>
                  <IconButton onClick={() => del(b.id)}>
                    <DeleteOutlineIcon />
                  </IconButton>
                </Box>
              ))}
            </Stack>

            <Divider />

            <Typography variant="subtitle2" sx={{ fontWeight: 900 }}>
              {editingId ? "Edit Branch Mapping" : "Add Branch Mapping"}
            </Typography>

            <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5}>
              <TextField
                label="Orders Vendor ID"
                value={form.ordersVendorId}
                onChange={(e) => setForm((p: any) => ({ ...p, ordersVendorId: e.target.value }))}
                fullWidth
              />
              <TextField
                label="Availability Vendor ID"
                value={form.availabilityVendorId}
                onChange={(e) => setForm((p: any) => ({ ...p, availabilityVendorId: e.target.value }))}
                fullWidth
              />
            </Stack>

            <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5}>
              <TextField
                label="Branch Name"
                value={form.name}
                onChange={(e) => setForm((p: any) => ({ ...p, name: e.target.value }))}
                fullWidth
              />
              <TextField
                select
                label="Chain Name"
                value={form.chainName ?? ""}
                onChange={(e) => setForm((p: any) => ({ ...p, chainName: e.target.value }))}
                helperText={chainNames.length ? "Managed from Settings" : "Add chains first in Settings"}
                fullWidth
              >
                <MenuItem value="">No Chain</MenuItem>
                {chainOptions.map((chainName) => (
                  <MenuItem key={chainName} value={chainName}>
                    {chainName}
                  </MenuItem>
                ))}
              </TextField>
            </Stack>

            <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5}>
              <TextField
                label="Global Entity ID"
                value={form.globalEntityId}
                onChange={(e) => setForm((p: any) => ({ ...p, globalEntityId: e.target.value }))}
                fullWidth
              />
            </Stack>

            <Stack direction="row" spacing={1.2}>
              <Button variant="outlined" onClick={fetchName} disabled={autoNameLoading}>
                Auto-fill Name
              </Button>
              <Button variant="contained" onClick={add}>
                {editingId ? "Save Changes" : "Add"}
              </Button>
              {editingId ? (
                <Button variant="text" onClick={cancelEdit}>
                  Cancel
                </Button>
              ) : null}
            </Stack>
          </CardContent>
        </Card>
      </Container>

      <Snackbar open={!!toast} autoHideDuration={2500} onClose={() => setToast(null)} anchorOrigin={{ vertical: "bottom", horizontal: "center" }}>
        {toast ? <Alert severity={toast.type}>{toast.msg}</Alert> : undefined}
      </Snackbar>
    </Box>
  );
}

export { Branches as BranchesPage };
