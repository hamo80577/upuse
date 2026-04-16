import CheckCircleRoundedIcon from "@mui/icons-material/CheckCircleRounded";
import ErrorOutlineRoundedIcon from "@mui/icons-material/ErrorOutlineRounded";
import KeyRoundedIcon from "@mui/icons-material/KeyRounded";
import RefreshRoundedIcon from "@mui/icons-material/RefreshRounded";
import ScienceRoundedIcon from "@mui/icons-material/ScienceRounded";
import SaveRoundedIcon from "@mui/icons-material/SaveRounded";
import WarningAmberRoundedIcon from "@mui/icons-material/WarningAmberRounded";
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Skeleton,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, describeApiError } from "../../../../../api/client";
import type {
  OpsManagedToken,
  OpsManagedTokenId,
  OpsScanoTokenTestResult,
  OpsTokenTestPayload,
  OpsTokenUpdatePayload,
} from "../../../api/types";
import type { SettingsTokenTestSnapshot } from "../../../../../api/types";
import { opsTelemetry } from "../../../telemetry/opsTelemetryClient";
import { TokenTestResults } from "../../../../upuse/pages/settings/ui/TokenTestResults";

const EMPTY_DRAFTS: Record<OpsManagedTokenId, string> = {
  upuse_orders: "",
  upuse_availability: "",
  scano_catalog: "",
};

function payloadFromDrafts(drafts: Record<OpsManagedTokenId, string>): OpsTokenUpdatePayload {
  const payload: OpsTokenUpdatePayload = {};
  const upuseOrdersToken = drafts.upuse_orders.trim();
  const upuseAvailabilityToken = drafts.upuse_availability.trim();
  const scanoCatalogToken = drafts.scano_catalog.trim();

  if (upuseOrdersToken) payload.upuseOrdersToken = upuseOrdersToken;
  if (upuseAvailabilityToken) payload.upuseAvailabilityToken = upuseAvailabilityToken;
  if (scanoCatalogToken) payload.scanoCatalogToken = scanoCatalogToken;

  return payload;
}

function isTerminalTokenTest(status: SettingsTokenTestSnapshot["status"]) {
  return status === "completed" || status === "failed";
}

function tokenTone(token: OpsManagedToken) {
  return token.configured
    ? { color: "#0f766e", label: "Configured", icon: <CheckCircleRoundedIcon fontSize="small" /> }
    : { color: "#b45309", label: "Missing", icon: <WarningAmberRoundedIcon fontSize="small" /> };
}

function TokenStatusRow(props: {
  token: OpsManagedToken;
  draft: string;
  onDraftChange: (value: string) => void;
  disabled: boolean;
}) {
  const tone = tokenTone(props.token);
  return (
    <Box
      sx={{
        minWidth: 0,
        p: { xs: 1.4, md: 1.8 },
        borderRadius: "8px",
        border: "1px solid rgba(148,163,184,0.2)",
        bgcolor: "#fff",
      }}
    >
      <Stack spacing={1.4}>
        <Stack direction={{ xs: "column", sm: "row" }} spacing={1.2} justifyContent="space-between" alignItems={{ xs: "flex-start", sm: "center" }}>
          <Stack direction="row" spacing={1} alignItems="center" sx={{ minWidth: 0 }}>
            <Box
              sx={{
                width: 34,
                height: 34,
                borderRadius: "8px",
                display: "grid",
                placeItems: "center",
                color: tone.color,
                bgcolor: `${tone.color}14`,
                flex: "0 0 auto",
              }}
            >
              <KeyRoundedIcon fontSize="small" />
            </Box>
            <Box sx={{ minWidth: 0 }}>
              <Typography sx={{ color: "#102033", fontWeight: 950 }}>
                {props.token.label}
              </Typography>
              <Typography variant="body2" sx={{ color: "#64748b", lineHeight: 1.5 }}>
                {props.token.description}
              </Typography>
            </Box>
          </Stack>
          <Chip
            icon={tone.icon}
            label={tone.label}
            sx={{
              borderRadius: "8px",
              fontWeight: 900,
              color: tone.color,
              bgcolor: `${tone.color}14`,
              "& .MuiChip-icon": { color: tone.color },
            }}
          />
        </Stack>

        <Stack direction={{ xs: "column", md: "row" }} spacing={1.2} alignItems={{ xs: "stretch", md: "center" }}>
          <Box
            sx={{
              flex: 1,
              minHeight: 56,
              borderRadius: "8px",
              border: "1px solid rgba(148,163,184,0.2)",
              px: 1.5,
              display: "flex",
              alignItems: "center",
              bgcolor: "#f8fafc",
            }}
          >
            <Stack spacing={0.2}>
              <Typography variant="caption" sx={{ color: "#64748b", fontWeight: 900 }}>
                Current stored token
              </Typography>
              <Typography sx={{ color: props.token.mask ? "#102033" : "#64748b", fontWeight: 900, fontFamily: "monospace" }}>
                {props.token.mask || "Not configured"}
              </Typography>
            </Stack>
          </Box>
          <TextField
            label={`New ${props.token.label} token`}
            type="password"
            value={props.draft}
            onChange={(event) => props.onDraftChange(event.target.value)}
            disabled={props.disabled}
            autoComplete="new-password"
            fullWidth
            sx={{
              flex: 1.4,
              "& .MuiOutlinedInput-root": { borderRadius: "8px", bgcolor: "#fff" },
            }}
          />
        </Stack>
      </Stack>
    </Box>
  );
}

function ScanoTestResult(props: { result: OpsScanoTokenTestResult | null }) {
  if (!props.result) return null;

  return (
    <Alert
      severity={props.result.ok ? "success" : "error"}
      sx={{ borderRadius: "8px" }}
    >
      <Typography sx={{ fontWeight: 800 }}>
        Scano Catalog: {props.result.message}
        {!props.result.ok && props.result.status ? ` (HTTP ${props.result.status})` : ""}
      </Typography>
    </Alert>
  );
}

export function OpsTokenManagementPanel() {
  const [tokens, setTokens] = useState<OpsManagedToken[]>([]);
  const [drafts, setDrafts] = useState<Record<OpsManagedTokenId, string>>(EMPTY_DRAFTS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error" | "info"; text: string } | null>(null);
  const [upuseTest, setUpuseTest] = useState<SettingsTokenTestSnapshot | null>(null);
  const [upuseJobId, setUpuseJobId] = useState<string | null>(null);
  const [scanoResult, setScanoResult] = useState<OpsScanoTokenTestResult | null>(null);
  const pollTimerRef = useRef<number | null>(null);

  const clearPollTimer = useCallback(() => {
    if (pollTimerRef.current != null) {
      window.clearTimeout(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  }, []);

  const loadTokens = useCallback(async (options: { silent?: boolean } = {}) => {
    try {
      if (!options.silent) setLoading(true);
      const response = await api.opsTokens();
      setTokens(response.tokens);
      if (!options.silent) setMessage(null);
    } catch (error) {
      setMessage({ type: "error", text: describeApiError(error, "Unable to load token status.") });
    } finally {
      if (!options.silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadTokens();
  }, [loadTokens]);

  useEffect(() => () => clearPollTimer(), [clearPollTimer]);

  const hasDraftTokens = useMemo(() => Object.values(drafts).some((value) => value.trim().length > 0), [drafts]);

  const reportTokenTestFinished = useCallback((params: {
    jobId: string | null;
    upuseStatus: SettingsTokenTestSnapshot["status"] | "failed" | null;
    scanoOk: boolean | null;
  }) => {
    opsTelemetry.track("token_test_finished", {
      metadata: {
        source: "ops",
        jobId: params.jobId,
        upuseStatus: params.upuseStatus,
        scanoOk: params.scanoOk,
      },
    });
  }, []);

  const updateDraft = (id: OpsManagedTokenId, value: string) => {
    setDrafts((current) => ({
      ...current,
      [id]: value,
    }));
  };

  const saveTokens = async () => {
    const payload = payloadFromDrafts(drafts);
    if (!Object.keys(payload).length) {
      setMessage({ type: "info", text: "Enter at least one replacement token before saving." });
      return;
    }

    try {
      setSaving(true);
      setMessage(null);
      const response = await api.opsUpdateTokens(payload);
      setTokens(response.tokens);
      setDrafts(EMPTY_DRAFTS);
      setUpuseTest(null);
      setScanoResult(null);
      setUpuseJobId(null);
      clearPollTimer();
      setMessage({ type: "success", text: "Token settings saved." });
    } catch (error) {
      setMessage({ type: "error", text: describeApiError(error, "Unable to save token settings.") });
    } finally {
      setSaving(false);
    }
  };

  const testTokens = async () => {
    const draftPayload = payloadFromDrafts(drafts);
    const payload: OpsTokenTestPayload = {
      ...draftPayload,
      targets: ["upuse", "scano"],
    };

    try {
      setTesting(true);
      setMessage(null);
      setUpuseTest(null);
      setScanoResult(null);
      clearPollTimer();
      opsTelemetry.track("token_test_started", {
        metadata: {
          source: "ops",
          hasUpuseOrdersToken: Boolean(draftPayload.upuseOrdersToken),
          hasUpuseAvailabilityToken: Boolean(draftPayload.upuseAvailabilityToken),
          hasScanoCatalogToken: Boolean(draftPayload.scanoCatalogToken),
        },
      });

      const response = await api.opsTestTokens(payload);
      const nextUpuseTest = response.upuse?.snapshot ?? null;
      const nextScanoResult = response.scano ?? null;
      setUpuseTest(nextUpuseTest);
      setScanoResult(nextScanoResult);

      if (nextUpuseTest && !isTerminalTokenTest(nextUpuseTest.status)) {
        setUpuseJobId(nextUpuseTest.jobId);
        return;
      }

      setUpuseJobId(null);
      setTesting(false);
      reportTokenTestFinished({
        jobId: nextUpuseTest?.jobId ?? null,
        upuseStatus: nextUpuseTest?.status ?? null,
        scanoOk: nextScanoResult?.ok ?? null,
      });
    } catch (error) {
      setTesting(false);
      setUpuseJobId(null);
      reportTokenTestFinished({
        jobId: null,
        upuseStatus: "failed",
        scanoOk: null,
      });
      setMessage({ type: "error", text: describeApiError(error, "Token test failed.") });
    }
  };

  useEffect(() => {
    if (!upuseJobId || !upuseTest || isTerminalTokenTest(upuseTest.status)) return undefined;

    clearPollTimer();
    pollTimerRef.current = window.setTimeout(() => {
      void api.opsTokenTestSnapshot(upuseJobId)
        .then((response) => {
          setUpuseTest(response.snapshot);
          if (isTerminalTokenTest(response.snapshot.status)) {
            setUpuseJobId(null);
            setTesting(false);
            reportTokenTestFinished({
              jobId: response.snapshot.jobId,
              upuseStatus: response.snapshot.status,
              scanoOk: scanoResult?.ok ?? null,
            });
          }
        })
        .catch((error) => {
          clearPollTimer();
          setUpuseJobId(null);
          setTesting(false);
          reportTokenTestFinished({
            jobId: upuseJobId,
            upuseStatus: "failed",
            scanoOk: scanoResult?.ok ?? null,
          });
          setMessage({ type: "error", text: describeApiError(error, "Token test failed.") });
        });
    }, 1200);

    return () => clearPollTimer();
  }, [clearPollTimer, reportTokenTestFinished, scanoResult?.ok, upuseJobId, upuseTest]);

  return (
    <Box
      sx={{
        p: { xs: 1.6, md: 2 },
        borderRadius: "8px",
        border: "1px solid rgba(148,163,184,0.18)",
        bgcolor: "#ffffff",
        boxShadow: "0 16px 34px rgba(15,23,42,0.045)",
      }}
    >
      <Stack spacing={2}>
        <Stack direction={{ xs: "column", lg: "row" }} spacing={1.5} justifyContent="space-between" alignItems={{ xs: "flex-start", lg: "center" }}>
          <Box>
            <Typography variant="h5" sx={{ color: "#102033", fontWeight: 950, letterSpacing: 0 }}>
              Token Management
            </Typography>
            <Typography variant="body2" sx={{ color: "#64748b", mt: 0.45, maxWidth: 760 }}>
              Review masked integration token state, save replacements, and run existing token checks from the primary-admin Ops surface.
            </Typography>
          </Box>
          <Stack direction={{ xs: "column", sm: "row" }} spacing={1} sx={{ width: { xs: "100%", sm: "auto" } }}>
            <Button
              variant="outlined"
              startIcon={<RefreshRoundedIcon />}
              onClick={() => void loadTokens()}
              disabled={loading || saving || testing}
              sx={{ borderRadius: "8px", fontWeight: 900 }}
            >
              Reload
            </Button>
            <Button
              variant="outlined"
              startIcon={testing ? <CircularProgress size={16} color="inherit" /> : <ScienceRoundedIcon />}
              onClick={() => void testTokens()}
              disabled={loading || saving || testing}
              sx={{ borderRadius: "8px", fontWeight: 900 }}
            >
              Test Tokens
            </Button>
            <Button
              variant="contained"
              startIcon={saving ? <CircularProgress size={16} color="inherit" /> : <SaveRoundedIcon />}
              onClick={() => void saveTokens()}
              disabled={loading || saving || testing || !hasDraftTokens}
              sx={{ borderRadius: "8px", fontWeight: 900 }}
            >
              Save Changes
            </Button>
          </Stack>
        </Stack>

        {message ? (
          <Alert
            severity={message.type}
            icon={message.type === "error" ? <ErrorOutlineRoundedIcon /> : undefined}
            sx={{ borderRadius: "8px" }}
          >
            {message.text}
          </Alert>
        ) : null}

        {loading ? (
          <Stack spacing={1.2}>
            {[0, 1, 2].map((item) => (
              <Skeleton key={item} variant="rounded" height={132} sx={{ borderRadius: "8px" }} />
            ))}
          </Stack>
        ) : (
          <Stack spacing={1.2}>
            {tokens.map((token) => (
              <TokenStatusRow
                key={token.id}
                token={token}
                draft={drafts[token.id]}
                onDraftChange={(value) => updateDraft(token.id, value)}
                disabled={saving || testing}
              />
            ))}
          </Stack>
        )}

        <Stack spacing={1}>
          <ScanoTestResult result={scanoResult} />
          <TokenTestResults test={upuseTest} isLoading={testing && !upuseTest} />
        </Stack>
      </Stack>
    </Box>
  );
}
