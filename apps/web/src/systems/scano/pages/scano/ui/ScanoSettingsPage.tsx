import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  CircularProgress,
  Container,
  Snackbar,
  Stack,
  TextField,
} from "@mui/material";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api, describeApiError } from "../../../api/client";
import { TopBar } from "../../../widgets/top-bar/ui/TopBar";

type ToastState = { type: "success" | "error"; msg: string } | null;

export function ScanoSettingsPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [pageError, setPageError] = useState("");
  const [toast, setToast] = useState<ToastState>(null);
  const [catalogBaseUrl, setCatalogBaseUrl] = useState("");
  const [catalogToken, setCatalogToken] = useState("");

  const loadSettings = useCallback(async (signal?: AbortSignal) => {
    try {
      setLoading(true);
      setPageError("");
      const response = await api.getScanoSettings({ signal });
      if (signal?.aborted) return;
      setCatalogBaseUrl(response.catalogBaseUrl);
      setCatalogToken("");
    } catch (error) {
      if (signal?.aborted) return;
      setPageError(describeApiError(error, "Failed to load Scano settings"));
    } finally {
      if (!signal?.aborted) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void loadSettings(controller.signal);
    return () => controller.abort();
  }, [loadSettings]);

  const hasConfiguredBaseUrl = catalogBaseUrl.trim().length > 0;
  const hasTypedToken = catalogToken.trim().length > 0;
  const canSave = useMemo(() => hasTypedToken && !saving && !testing, [hasTypedToken, saving, testing]);
  const canTest = useMemo(() => hasConfiguredBaseUrl && !saving && !testing, [hasConfiguredBaseUrl, saving, testing]);

  async function handleSave() {
    if (!hasTypedToken) {
      setToast({ type: "error", msg: "Enter the new Scano token first." });
      return;
    }

    try {
      setSaving(true);
      const response = await api.putScanoSettings({
        catalogToken: catalogToken.trim(),
      });
      setCatalogBaseUrl(response.settings.catalogBaseUrl);
      setCatalogToken("");
      setToast({ type: "success", msg: "Scano settings updated" });
    } catch (error) {
      setToast({ type: "error", msg: describeApiError(error, "Failed to update Scano settings") });
    } finally {
      setSaving(false);
    }
  }

  async function handleTestToken() {
    if (!hasConfiguredBaseUrl) {
      setToast({ type: "error", msg: "Scano catalog base URL is not configured." });
      return;
    }

    try {
      setTesting(true);
      const response = await api.testScanoSettings(
        catalogToken.trim() ? { catalogToken: catalogToken.trim() } : {},
      );
      setToast({ type: "success", msg: response.message });
    } catch (error) {
      setToast({ type: "error", msg: describeApiError(error, "Scano catalog token test failed") });
    } finally {
      setTesting(false);
    }
  }

  return (
    <Box
      sx={{
        minHeight: "100vh",
        bgcolor: "#f5f7fb",
        background:
          "radial-gradient(circle at top left, rgba(14,165,233,0.11), transparent 28%), radial-gradient(circle at bottom right, rgba(15,23,42,0.08), transparent 32%), linear-gradient(180deg, #f7fafc 0%, #edf4f8 100%)",
      }}
    >
      <TopBar />

      <Container maxWidth="lg" sx={{ py: { xs: 2.25, md: 3.5 } }}>
        <Stack spacing={2}>
          {pageError ? (
            <Alert severity="error" variant="outlined">
              {pageError}
            </Alert>
          ) : null}

          <Card
            sx={{
              borderRadius: 4,
              border: "1px solid rgba(148,163,184,0.14)",
              bgcolor: "rgba(255,255,255,0.9)",
            }}
          >
            <CardContent>
              {loading ? (
                <Stack spacing={1} alignItems="center" justifyContent="center" sx={{ minHeight: 220 }}>
                  <CircularProgress size={28} />
                </Stack>
              ) : (
                <Stack spacing={2.2}>
                  <TextField
                    label="Catalog Token"
                    type="password"
                    value={catalogToken}
                    onChange={(event) => setCatalogToken(event.target.value)}
                    placeholder="Enter catalog token"
                    autoComplete="new-password"
                    fullWidth
                  />

                  <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                    <Button
                      variant="outlined"
                      onClick={() => void handleTestToken()}
                      disabled={!canTest}
                      startIcon={testing ? <CircularProgress size={16} color="inherit" /> : undefined}
                    >
                      Test Token
                    </Button>
                    <Button variant="contained" onClick={() => void handleSave()} disabled={!canSave} startIcon={saving ? <CircularProgress size={16} color="inherit" /> : undefined}>
                      Save Token
                    </Button>
                  </Stack>
                </Stack>
              )}
            </CardContent>
          </Card>
        </Stack>
      </Container>

      <Snackbar
        open={!!toast}
        autoHideDuration={2600}
        onClose={() => setToast(null)}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
      >
        <Alert severity={toast?.type === "error" ? "error" : "success"} variant="filled" onClose={() => setToast(null)}>
          {toast?.msg}
        </Alert>
      </Snackbar>
    </Box>
  );
}
