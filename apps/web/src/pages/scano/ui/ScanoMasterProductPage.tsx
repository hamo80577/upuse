import AddRoundedIcon from "@mui/icons-material/AddRounded";
import DeleteOutlineRoundedIcon from "@mui/icons-material/DeleteOutlineRounded";
import EditRoundedIcon from "@mui/icons-material/EditRounded";
import Inventory2RoundedIcon from "@mui/icons-material/Inventory2Rounded";
import SearchRoundedIcon from "@mui/icons-material/SearchRounded";
import VisibilityOutlinedIcon from "@mui/icons-material/VisibilityOutlined";
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Container,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  MenuItem,
  Paper,
  Stack,
  Step,
  StepLabel,
  Stepper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from "@mui/material";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api, describeApiError } from "../../../api/client";
import type {
  ScanoChainOption,
  ScanoMasterProductDetail,
  ScanoMasterProductField,
  ScanoMasterProductListItem,
  ScanoMasterProductMapping,
  ScanoMasterProductPreviewResponse,
} from "../../../api/types";
import { TopBar } from "../../../widgets/top-bar/ui/TopBar";
import { formatCairoFullDateTime } from "./scanoShared";

const MASTER_PRODUCT_STEPS = ["Select Chain", "Upload CSV", "Map Headers"] as const;
const MASTER_PRODUCT_FIELDS: Array<{ value: ScanoMasterProductField; label: string; required?: boolean }> = [
  { value: "sku", label: "SKU", required: true },
  { value: "barcode", label: "Barcode", required: true },
  { value: "price", label: "Price" },
  { value: "itemNameEn", label: "Item Name EN", required: true },
  { value: "itemNameAr", label: "Item Name AR" },
  { value: "image", label: "Image" },
];
const REQUIRED_MASTER_PRODUCT_FIELDS = MASTER_PRODUCT_FIELDS.filter((field) => field.required).map((field) => field.value);

type ToastState = { type: "success" | "error"; msg: string } | null;
type WizardMode = "create" | "edit";

function useDebouncedValue<T>(value: T, delayMs: number) {
  const [debouncedValue, setDebouncedValue] = useState(value);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setDebouncedValue(value);
    }, delayMs);

    return () => {
      window.clearTimeout(timeout);
    };
  }, [delayMs, value]);

  return debouncedValue;
}

function createEmptyMapping(): ScanoMasterProductMapping {
  return {
    barcode: null,
    sku: null,
    price: null,
    itemNameEn: null,
    itemNameAr: null,
    image: null,
  };
}

function getFieldLabel(field: ScanoMasterProductField) {
  return MASTER_PRODUCT_FIELDS.find((item) => item.value === field)?.label ?? field;
}

function getSelectedFieldForHeader(mapping: ScanoMasterProductMapping, header: string) {
  return MASTER_PRODUCT_FIELDS.find((field) => mapping[field.value] === header)?.value ?? "";
}

function getPreviewColumnKeys(preview: ScanoMasterProductPreviewResponse | null) {
  if (!preview?.sampleRows.length) return [];
  return preview.headers;
}

export function ScanoMasterProductPage() {
  const [items, setItems] = useState<ScanoMasterProductListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [pageError, setPageError] = useState("");
  const [toast, setToast] = useState<ToastState>(null);

  const [wizardOpen, setWizardOpen] = useState(false);
  const [wizardMode, setWizardMode] = useState<WizardMode>("create");
  const [activeStep, setActiveStep] = useState(0);
  const [saving, setSaving] = useState(false);

  const [chainSearch, setChainSearch] = useState("");
  const [chainOptions, setChainOptions] = useState<ScanoChainOption[]>([]);
  const [chainLoading, setChainLoading] = useState(false);
  const [chainError, setChainError] = useState("");
  const [selectedChain, setSelectedChain] = useState<ScanoChainOption | null>(null);

  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ScanoMasterProductPreviewResponse | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState("");
  const [mapping, setMapping] = useState<ScanoMasterProductMapping>(createEmptyMapping());

  const [viewChainId, setViewChainId] = useState<number | null>(null);
  const [viewDetail, setViewDetail] = useState<ScanoMasterProductDetail | null>(null);
  const [viewLoading, setViewLoading] = useState(false);
  const [viewError, setViewError] = useState("");

  const [deleteTarget, setDeleteTarget] = useState<ScanoMasterProductListItem | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);

  const debouncedChainSearch = useDebouncedValue(chainSearch, 280);
  const previewColumnKeys = useMemo(() => getPreviewColumnKeys(preview), [preview]);
  const missingRequiredFields = useMemo(
    () => REQUIRED_MASTER_PRODUCT_FIELDS.filter((field) => !mapping[field]),
    [mapping],
  );

  const loadMasterProducts = useCallback(async (signal?: AbortSignal) => {
    try {
      setLoading(true);
      setPageError("");
      const response = await api.listScanoMasterProducts({ signal });
      if (signal?.aborted) return;
      setItems(response.items);
    } catch (error) {
      if (signal?.aborted) return;
      setPageError(describeApiError(error, "Failed to load master product chains"));
    } finally {
      if (!signal?.aborted) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void loadMasterProducts(controller.signal);
    return () => controller.abort();
  }, [loadMasterProducts]);

  useEffect(() => {
    if (!wizardOpen || activeStep !== 0 || wizardMode !== "create") return;

    const query = debouncedChainSearch.trim();
    if (!query) {
      setChainOptions(selectedChain ? [selectedChain] : []);
      setChainLoading(false);
      setChainError("");
      return;
    }

    const controller = new AbortController();
    setChainLoading(true);
    setChainError("");

    void api.listScanoChains(query, { signal: controller.signal })
      .then((response) => {
        if (controller.signal.aborted) return;
        const nextItems = selectedChain && !response.items.some((item) => item.id === selectedChain.id)
          ? [selectedChain, ...response.items]
          : response.items;
        setChainOptions(nextItems);
      })
      .catch((error) => {
        if (controller.signal.aborted) return;
        setChainError(describeApiError(error, "Failed to search chains"));
        setChainOptions(selectedChain ? [selectedChain] : []);
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setChainLoading(false);
        }
      });

    return () => controller.abort();
  }, [activeStep, debouncedChainSearch, selectedChain, wizardMode, wizardOpen]);

  useEffect(() => {
    if (!viewChainId) return;

    const controller = new AbortController();
    setViewLoading(true);
    setViewError("");

    void api.getScanoMasterProduct(viewChainId, { signal: controller.signal })
      .then((response) => {
        if (controller.signal.aborted) return;
        setViewDetail(response.item);
      })
      .catch((error) => {
        if (controller.signal.aborted) return;
        setViewError(describeApiError(error, "Failed to load chain details"));
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setViewLoading(false);
        }
      });

    return () => controller.abort();
  }, [viewChainId]);

  function resetWizard() {
    setWizardMode("create");
    setActiveStep(0);
    setSaving(false);
    setChainSearch("");
    setChainOptions([]);
    setChainLoading(false);
    setChainError("");
    setSelectedChain(null);
    setSelectedFile(null);
    setPreview(null);
    setPreviewLoading(false);
    setPreviewError("");
    setMapping(createEmptyMapping());
  }

  function openCreateWizard() {
    resetWizard();
    setWizardMode("create");
    setWizardOpen(true);
  }

  function openEditWizard(item: ScanoMasterProductListItem) {
    resetWizard();
    const chain: ScanoChainOption = {
      id: item.chainId,
      name: item.chainName,
      active: true,
      globalId: "",
      type: "",
    };
    setWizardMode("edit");
    setSelectedChain(chain);
    setChainSearch(item.chainName);
    setChainOptions([chain]);
    setWizardOpen(true);
  }

  function closeWizard() {
    setWizardOpen(false);
    resetWizard();
  }

  async function handleFileSelection(file: File | null) {
    setSelectedFile(file);
    setPreview(null);
    setPreviewError("");
    setMapping(createEmptyMapping());

    if (!file) {
      return;
    }

    try {
      setPreviewLoading(true);
      const response = await api.previewScanoMasterProducts(file);
      setPreview(response);
      setMapping(response.suggestedMapping);
    } catch (error) {
      setPreviewError(describeApiError(error, "Failed to preview CSV file"));
    } finally {
      setPreviewLoading(false);
    }
  }

  function handleHeaderMappingChange(header: string, nextField: string) {
    setMapping((current) => {
      const next = { ...current };
      for (const field of MASTER_PRODUCT_FIELDS) {
        if (next[field.value] === header) {
          next[field.value] = null;
        }
      }
      if (nextField) {
        next[nextField as ScanoMasterProductField] = header;
      }
      return next;
    });
  }

  async function handleSave() {
    if (!selectedChain || !selectedFile) {
      setToast({ type: "error", msg: "Select a chain and upload a CSV file first." });
      return;
    }
    if (missingRequiredFields.length) {
      setToast({ type: "error", msg: "Map the required fields before saving." });
      return;
    }

    try {
      setSaving(true);
      const payload = {
        chainId: selectedChain.id,
        chainName: selectedChain.name,
        mapping,
        file: selectedFile,
      };

      const response = wizardMode === "edit"
        ? await api.updateScanoMasterProduct(selectedChain.id, payload)
        : await api.createScanoMasterProduct(payload);

      setItems((current) => [
        response.item,
        ...current.filter((item) => item.chainId !== response.item.chainId),
      ].sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt) || left.chainName.localeCompare(right.chainName)));
      setToast({ type: "success", msg: wizardMode === "edit" ? "Chain import replaced." : "Chain import saved." });
      closeWizard();
    } catch (error) {
      setToast({
        type: "error",
        msg: describeApiError(error, wizardMode === "edit" ? "Failed to replace chain import" : "Failed to save chain import"),
      });
    } finally {
      setSaving(false);
    }
  }

  async function handleConfirmDelete() {
    if (!deleteTarget) return;

    try {
      setDeleteLoading(true);
      await api.deleteScanoMasterProduct(deleteTarget.chainId);
      setItems((current) => current.filter((item) => item.chainId !== deleteTarget.chainId));
      if (viewChainId === deleteTarget.chainId) {
        setViewChainId(null);
        setViewDetail(null);
      }
      setToast({ type: "success", msg: "Chain import deleted." });
      setDeleteTarget(null);
    } catch (error) {
      setToast({ type: "error", msg: describeApiError(error, "Failed to delete chain import") });
    } finally {
      setDeleteLoading(false);
    }
  }

  const canMoveNext = (
    activeStep === 0 && !!selectedChain
  ) || (
    activeStep === 1 && !!selectedFile && !!preview && !previewLoading
  );

  return (
    <Box
      sx={{
        minHeight: "100vh",
        bgcolor: "#f5f7fb",
        background:
          "radial-gradient(circle at top left, rgba(34,197,94,0.08), transparent 26%), radial-gradient(circle at bottom right, rgba(15,23,42,0.08), transparent 32%), linear-gradient(180deg, #f8fafc 0%, #edf4f8 100%)",
      }}
    >
      <TopBar />

      <Container maxWidth="xl" sx={{ py: { xs: 2.25, md: 3.5 } }}>
        <Stack spacing={2.2}>
          <Card
            sx={{
              borderRadius: 5,
              bgcolor: "rgba(255,255,255,0.8)",
              border: "1px solid rgba(148,163,184,0.18)",
              boxShadow: "0 24px 80px rgba(15,23,42,0.08)",
              backdropFilter: "blur(14px)",
            }}
          >
            <CardContent sx={{ px: { xs: 2, md: 3.2 }, py: { xs: 2.1, md: 2.7 } }}>
              <Stack direction={{ xs: "column", md: "row" }} spacing={1.5} justifyContent="space-between" alignItems={{ xs: "flex-start", md: "center" }}>
                <Box>
                  <Typography variant="h4" sx={{ fontWeight: 950, letterSpacing: "-0.04em", color: "#0f172a" }}>
                    Master Product
                  </Typography>
                  <Typography variant="body2" sx={{ color: "#64748b", mt: 0.5 }}>
                    Keep one normalized product import per chain, review its mapping, and replace it with a fresh CSV whenever needed.
                  </Typography>
                </Box>

                <Button
                  variant="contained"
                  startIcon={<AddRoundedIcon />}
                  onClick={openCreateWizard}
                  sx={{
                    borderRadius: 999,
                    px: 2.4,
                    py: 1.1,
                    boxShadow: "0 16px 34px rgba(22,163,74,0.18)",
                    bgcolor: "#166534",
                    "&:hover": {
                      bgcolor: "#14532d",
                    },
                  }}
                >
                  Add Chain
                </Button>
              </Stack>
            </CardContent>
          </Card>

          {toast ? (
            <Alert severity={toast.type} onClose={() => setToast(null)} variant="outlined">
              {toast.msg}
            </Alert>
          ) : null}

          {pageError ? (
            <Alert severity="error" variant="outlined">
              {pageError}
            </Alert>
          ) : null}

          <Card
            sx={{
              borderRadius: 4,
              border: "1px solid rgba(148,163,184,0.14)",
              bgcolor: "rgba(255,255,255,0.94)",
            }}
          >
            <CardContent sx={{ p: 0 }}>
              <Box sx={{ px: { xs: 2, md: 2.5 }, py: 1.6, borderBottom: "1px solid rgba(148,163,184,0.12)" }}>
                <Stack direction={{ xs: "column", sm: "row" }} spacing={1} justifyContent="space-between" alignItems={{ xs: "flex-start", sm: "center" }}>
                  <Typography variant="h6" sx={{ fontWeight: 900 }}>
                    Imported Chains
                  </Typography>
                  <Chip
                    size="small"
                    label={`${items.length} chain${items.length === 1 ? "" : "s"}`}
                    sx={{ fontWeight: 900, bgcolor: "rgba(15,23,42,0.06)", color: "#0f172a" }}
                  />
                </Stack>
              </Box>

              {loading ? (
                <Stack spacing={1} alignItems="center" justifyContent="center" sx={{ minHeight: 220 }}>
                  <CircularProgress size={28} />
                  <Typography variant="body2" sx={{ color: "text.secondary" }}>
                    Loading master product chains...
                  </Typography>
                </Stack>
              ) : items.length ? (
                <TableContainer component={Paper} elevation={0} sx={{ bgcolor: "transparent" }}>
                  <Table sx={{ minWidth: 720 }}>
                    <TableHead>
                      <TableRow>
                        <TableCell sx={{ fontWeight: 900 }}>Chain</TableCell>
                        <TableCell sx={{ fontWeight: 900 }}>Last Update</TableCell>
                        <TableCell sx={{ fontWeight: 900 }}>Products Count</TableCell>
                        <TableCell align="right" sx={{ fontWeight: 900 }}>Actions</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {items.map((item) => (
                        <TableRow key={item.chainId} hover>
                          <TableCell>
                            <Stack spacing={0.35}>
                              <Typography sx={{ fontWeight: 900, color: "#0f172a" }}>{item.chainName}</Typography>
                              <Typography variant="caption" sx={{ color: "text.secondary" }}>Chain ID: {item.chainId}</Typography>
                            </Stack>
                          </TableCell>
                          <TableCell>{formatCairoFullDateTime(item.updatedAt)}</TableCell>
                          <TableCell>
                            <Chip
                              icon={<Inventory2RoundedIcon fontSize="small" />}
                              label={`${item.productCount} rows`}
                              size="small"
                              sx={{ fontWeight: 900, bgcolor: "rgba(22,163,74,0.08)", color: "#166534" }}
                            />
                          </TableCell>
                          <TableCell align="right">
                            <Stack direction="row" spacing={1} justifyContent="flex-end">
                              <Button size="small" startIcon={<VisibilityOutlinedIcon />} onClick={() => {
                                setViewChainId(item.chainId);
                                setViewDetail(null);
                                setViewError("");
                              }}>
                                View
                              </Button>
                              <Button size="small" startIcon={<EditRoundedIcon />} onClick={() => openEditWizard(item)}>
                                Edit
                              </Button>
                              <Button size="small" color="error" startIcon={<DeleteOutlineRoundedIcon />} onClick={() => setDeleteTarget(item)}>
                                Delete
                              </Button>
                            </Stack>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
              ) : (
                <Stack spacing={1.2} alignItems="center" justifyContent="center" sx={{ minHeight: 220, px: 2, textAlign: "center" }}>
                  <Typography variant="h6" sx={{ fontWeight: 900, color: "#0f172a" }}>
                    No chain imports yet
                  </Typography>
                  <Typography variant="body2" sx={{ color: "text.secondary", maxWidth: 520 }}>
                    Add a chain, upload its CSV, map the headers once, and this table will track the saved import plus the stored product count.
                  </Typography>
                </Stack>
              )}
            </CardContent>
          </Card>
        </Stack>
      </Container>

      <Dialog open={wizardOpen} onClose={saving ? undefined : closeWizard} fullWidth maxWidth="lg">
        <DialogTitle sx={{ fontWeight: 900 }}>
          {wizardMode === "edit" ? "Replace Chain Import" : "Add Chain"}
        </DialogTitle>
        <DialogContent dividers>
          <Stack spacing={2.2}>
            <Stepper activeStep={activeStep} alternativeLabel sx={{ pt: 0.5 }}>
              {MASTER_PRODUCT_STEPS.map((step) => (
                <Step key={step}>
                  <StepLabel>{step}</StepLabel>
                </Step>
              ))}
            </Stepper>

            {activeStep === 0 ? (
              <Card variant="outlined" sx={{ borderRadius: 3 }}>
                <CardContent>
                  <Stack spacing={1.5}>
                    <Typography sx={{ fontWeight: 900, color: "#0f172a" }}>
                      {wizardMode === "edit" ? "Selected chain" : "Search Scano chains"}
                    </Typography>
                    {wizardMode === "edit" && selectedChain ? (
                      <>
                        <Alert severity="info" variant="outlined">
                          Edit keeps the same chain. Upload a fresh CSV in the next step to replace the current import.
                        </Alert>
                        <Paper variant="outlined" sx={{ p: 1.5, borderRadius: 2.5 }}>
                          <Typography sx={{ fontWeight: 900 }}>{selectedChain.name}</Typography>
                          <Typography variant="body2" sx={{ color: "text.secondary" }}>Chain ID: {selectedChain.id}</Typography>
                        </Paper>
                      </>
                    ) : (
                      <>
                        <TextField
                          label="Search Chains"
                          value={chainSearch}
                          onChange={(event) => setChainSearch(event.target.value)}
                          placeholder="Type a chain name"
                          InputProps={{
                            endAdornment: chainLoading ? <CircularProgress size={18} /> : <SearchRoundedIcon fontSize="small" />,
                          }}
                        />
                        {chainError ? (
                          <Alert severity="error" variant="outlined">
                            {chainError}
                          </Alert>
                        ) : null}
                        <Stack spacing={1}>
                          {chainOptions.length ? chainOptions.map((chain) => (
                            <Paper
                              key={chain.id}
                              variant="outlined"
                              onClick={() => setSelectedChain(chain)}
                              sx={{
                                p: 1.5,
                                borderRadius: 2.5,
                                cursor: "pointer",
                                borderColor: selectedChain?.id === chain.id ? "rgba(22,163,74,0.45)" : "rgba(148,163,184,0.22)",
                                bgcolor: selectedChain?.id === chain.id ? "rgba(240,253,244,0.98)" : "white",
                              }}
                            >
                              <Typography sx={{ fontWeight: 900 }}>{chain.name}</Typography>
                              <Typography variant="body2" sx={{ color: "text.secondary" }}>
                                Chain ID: {chain.id}
                              </Typography>
                            </Paper>
                          )) : (
                            <Typography variant="body2" sx={{ color: "text.secondary" }}>
                              Search for a chain to continue.
                            </Typography>
                          )}
                        </Stack>
                      </>
                    )}
                  </Stack>
                </CardContent>
              </Card>
            ) : null}

            {activeStep === 1 ? (
              <Card variant="outlined" sx={{ borderRadius: 3 }}>
                <CardContent>
                  <Stack spacing={1.5}>
                    <Typography sx={{ fontWeight: 900, color: "#0f172a" }}>
                      Upload CSV for {selectedChain?.name ?? "the selected chain"}
                    </Typography>
                    <Stack direction={{ xs: "column", sm: "row" }} spacing={1.2} alignItems={{ xs: "stretch", sm: "center" }}>
                      <Button component="label" variant="contained" sx={{ alignSelf: { xs: "stretch", sm: "flex-start" } }}>
                        Choose CSV File
                        <input
                          hidden
                          type="file"
                          accept=".csv,text/csv"
                          onChange={(event) => {
                            const file = event.target.files?.[0] ?? null;
                            void handleFileSelection(file);
                            event.target.value = "";
                          }}
                        />
                      </Button>
                      <Typography variant="body2" sx={{ color: "text.secondary" }}>
                        {selectedFile ? selectedFile.name : "No file selected"}
                      </Typography>
                    </Stack>

                    {previewLoading ? (
                      <Stack direction="row" spacing={1} alignItems="center">
                        <CircularProgress size={20} />
                        <Typography variant="body2" sx={{ color: "text.secondary" }}>
                          Reading CSV headers and preview rows...
                        </Typography>
                      </Stack>
                    ) : null}

                    {previewError ? (
                      <Alert severity="error" variant="outlined">
                        {previewError}
                      </Alert>
                    ) : null}

                    {preview ? (
                      <Stack spacing={1.2}>
                        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                          {preview.headers.map((header) => (
                            <Chip key={header} label={header} size="small" sx={{ fontWeight: 800 }} />
                          ))}
                        </Stack>
                        <Typography variant="body2" sx={{ color: "text.secondary" }}>
                          Preview ready. Continue to map the source headers to the normalized fields.
                        </Typography>
                      </Stack>
                    ) : null}
                  </Stack>
                </CardContent>
              </Card>
            ) : null}

            {activeStep === 2 ? (
              <Stack spacing={2}>
                <Card variant="outlined" sx={{ borderRadius: 3 }}>
                  <CardContent>
                    <Stack spacing={1.5}>
                      <Typography sx={{ fontWeight: 900, color: "#0f172a" }}>
                        Map CSV headers
                      </Typography>
                      <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                        {MASTER_PRODUCT_FIELDS.map((field) => (
                          <Chip
                            key={field.value}
                            label={`${field.label}${field.required ? " *" : ""}`}
                            size="small"
                            sx={{
                              fontWeight: 800,
                              bgcolor: field.required ? "rgba(251,191,36,0.14)" : "rgba(15,23,42,0.05)",
                              color: field.required ? "#92400e" : "#0f172a",
                            }}
                          />
                        ))}
                      </Stack>
                      {missingRequiredFields.length ? (
                        <Alert severity="warning" variant="outlined">
                          Required mappings missing: {missingRequiredFields.map(getFieldLabel).join(", ")}
                        </Alert>
                      ) : (
                        <Alert severity="success" variant="outlined">
                          Required mappings are complete. You can save this chain import now.
                        </Alert>
                      )}
                      <Stack spacing={1.1}>
                        {preview?.headers.map((header) => {
                          const selectedField = getSelectedFieldForHeader(mapping, header);
                          return (
                            <Paper key={header} variant="outlined" sx={{ p: 1.35, borderRadius: 2.5 }}>
                              <Stack direction={{ xs: "column", md: "row" }} spacing={1.2} alignItems={{ xs: "flex-start", md: "center" }}>
                                <Box sx={{ flex: 1, minWidth: 0 }}>
                                  <Typography sx={{ fontWeight: 900 }} noWrap>{header}</Typography>
                                  <Typography variant="body2" sx={{ color: "text.secondary" }}>
                                    Select what this source header represents.
                                  </Typography>
                                </Box>
                                <TextField
                                  select
                                  label="Maps To"
                                  value={selectedField}
                                  onChange={(event) => handleHeaderMappingChange(header, event.target.value)}
                                  sx={{ minWidth: { xs: "100%", md: 220 } }}
                                >
                                  <MenuItem value="">Ignore This Column</MenuItem>
                                  {MASTER_PRODUCT_FIELDS.map((field) => {
                                    const takenByAnotherHeader = !!mapping[field.value] && mapping[field.value] !== header;
                                    return (
                                      <MenuItem key={field.value} value={field.value} disabled={takenByAnotherHeader}>
                                        {field.label}{field.required ? " *" : ""}
                                      </MenuItem>
                                    );
                                  })}
                                </TextField>
                              </Stack>
                            </Paper>
                          );
                        })}
                      </Stack>
                    </Stack>
                  </CardContent>
                </Card>

                <Card variant="outlined" sx={{ borderRadius: 3 }}>
                  <CardContent>
                    <Stack spacing={1.2}>
                      <Typography sx={{ fontWeight: 900, color: "#0f172a" }}>
                        Example Rows
                      </Typography>
                      {preview?.sampleRows.length ? (
                        <TableContainer component={Paper} variant="outlined" sx={{ maxHeight: 360 }}>
                          <Table stickyHeader size="small">
                            <TableHead>
                              <TableRow>
                                {previewColumnKeys.map((key) => (
                                  <TableCell key={key} sx={{ fontWeight: 900, whiteSpace: "nowrap" }}>
                                    {key}
                                  </TableCell>
                                ))}
                              </TableRow>
                            </TableHead>
                            <TableBody>
                              {preview.sampleRows.map((row, index) => (
                                <TableRow key={`sample-${index}`}>
                                  {previewColumnKeys.map((key) => (
                                    <TableCell key={key}>{row[key] || "--"}</TableCell>
                                  ))}
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        </TableContainer>
                      ) : (
                        <Typography variant="body2" sx={{ color: "text.secondary" }}>
                          No preview rows were returned from the CSV file.
                        </Typography>
                      )}
                    </Stack>
                  </CardContent>
                </Card>
              </Stack>
            ) : null}
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, py: 2 }}>
          <Button onClick={closeWizard} disabled={saving}>Cancel</Button>
          {activeStep > 0 ? (
            <Button onClick={() => setActiveStep((current) => current - 1)} disabled={saving}>
              Back
            </Button>
          ) : null}
          {activeStep < MASTER_PRODUCT_STEPS.length - 1 ? (
            <Button variant="contained" onClick={() => setActiveStep((current) => current + 1)} disabled={!canMoveNext || saving}>
              Next
            </Button>
          ) : (
            <Button variant="contained" onClick={() => void handleSave()} disabled={saving || !!missingRequiredFields.length || !selectedFile || !selectedChain}>
              {saving ? "Saving..." : wizardMode === "edit" ? "Replace Import" : "Save Chain"}
            </Button>
          )}
        </DialogActions>
      </Dialog>

      <Dialog open={!!viewChainId} onClose={() => setViewChainId(null)} fullWidth maxWidth="lg">
        <DialogTitle sx={{ fontWeight: 900 }}>Chain Import Details</DialogTitle>
        <DialogContent dividers>
          {viewLoading ? (
            <Stack spacing={1} alignItems="center" justifyContent="center" sx={{ minHeight: 220 }}>
              <CircularProgress size={26} />
              <Typography variant="body2" sx={{ color: "text.secondary" }}>
                Loading chain details...
              </Typography>
            </Stack>
          ) : viewError ? (
            <Alert severity="error" variant="outlined">
              {viewError}
            </Alert>
          ) : viewDetail ? (
            <Stack spacing={2}>
              <Stack direction={{ xs: "column", md: "row" }} spacing={1.2} justifyContent="space-between">
                <Box>
                  <Typography variant="h6" sx={{ fontWeight: 900 }}>{viewDetail.chainName}</Typography>
                  <Typography variant="body2" sx={{ color: "text.secondary" }}>
                    Chain ID: {viewDetail.chainId}
                  </Typography>
                </Box>
                <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                  <Chip label={`${viewDetail.productCount} rows`} size="small" sx={{ fontWeight: 800 }} />
                  <Chip label={`Updated ${formatCairoFullDateTime(viewDetail.updatedAt)}`} size="small" sx={{ fontWeight: 800 }} />
                </Stack>
              </Stack>

              <Card variant="outlined" sx={{ borderRadius: 3 }}>
                <CardContent>
                  <Stack spacing={1.2}>
                    <Typography sx={{ fontWeight: 900 }}>Header Mapping</Typography>
                    <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                      {MASTER_PRODUCT_FIELDS.map((field) => (
                        <Chip
                          key={field.value}
                          label={`${field.label}: ${viewDetail.mapping[field.value] ?? "--"}`}
                          size="small"
                          sx={{ fontWeight: 800 }}
                        />
                      ))}
                    </Stack>
                  </Stack>
                </CardContent>
              </Card>

              <Card variant="outlined" sx={{ borderRadius: 3 }}>
                <CardContent>
                  <Stack spacing={1.2}>
                    <Typography sx={{ fontWeight: 900 }}>First 10 Saved Rows</Typography>
                    <TableContainer component={Paper} variant="outlined">
                      <Table size="small">
                        <TableHead>
                          <TableRow>
                            <TableCell sx={{ fontWeight: 900 }}>#</TableCell>
                            <TableCell sx={{ fontWeight: 900 }}>SKU</TableCell>
                            <TableCell sx={{ fontWeight: 900 }}>Barcode</TableCell>
                            <TableCell sx={{ fontWeight: 900 }}>Price</TableCell>
                            <TableCell sx={{ fontWeight: 900 }}>Item Name EN</TableCell>
                            <TableCell sx={{ fontWeight: 900 }}>Item Name AR</TableCell>
                            <TableCell sx={{ fontWeight: 900 }}>Image</TableCell>
                          </TableRow>
                        </TableHead>
                        <TableBody>
                          {viewDetail.exampleRows.length ? viewDetail.exampleRows.map((row) => (
                            <TableRow key={row.rowNumber}>
                              <TableCell>{row.rowNumber}</TableCell>
                              <TableCell>{row.sku ?? "--"}</TableCell>
                              <TableCell>{row.barcode ?? "--"}</TableCell>
                              <TableCell>{row.price ?? "--"}</TableCell>
                              <TableCell>{row.itemNameEn ?? "--"}</TableCell>
                              <TableCell>{row.itemNameAr ?? "--"}</TableCell>
                              <TableCell>{row.image ?? "--"}</TableCell>
                            </TableRow>
                          )) : (
                            <TableRow>
                              <TableCell colSpan={7} align="center">No saved rows found.</TableCell>
                            </TableRow>
                          )}
                        </TableBody>
                      </Table>
                    </TableContainer>
                  </Stack>
                </CardContent>
              </Card>
            </Stack>
          ) : null}
        </DialogContent>
        <DialogActions sx={{ px: 3, py: 2 }}>
          <Button onClick={() => setViewChainId(null)}>Close</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={!!deleteTarget} onClose={deleteLoading ? undefined : () => setDeleteTarget(null)} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ fontWeight: 900 }}>Delete Chain Import</DialogTitle>
        <DialogContent dividers>
          <Typography variant="body2" sx={{ color: "text.secondary" }}>
            Delete the saved master product import for <strong>{deleteTarget?.chainName ?? "--"}</strong>? This removes the chain mapping metadata and all normalized rows permanently.
          </Typography>
        </DialogContent>
        <DialogActions sx={{ px: 3, py: 2 }}>
          <Button onClick={() => setDeleteTarget(null)} disabled={deleteLoading}>Cancel</Button>
          <Button color="error" variant="contained" onClick={() => void handleConfirmDelete()} disabled={deleteLoading}>
            {deleteLoading ? "Deleting..." : "Delete"}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
