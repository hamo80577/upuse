import AccountTreeRoundedIcon from "@mui/icons-material/AccountTreeRounded";
import AddPhotoAlternateRoundedIcon from "@mui/icons-material/AddPhotoAlternateRounded";
import CheckCircleRoundedIcon from "@mui/icons-material/CheckCircleRounded";
import CloseRoundedIcon from "@mui/icons-material/CloseRounded";
import EditRoundedIcon from "@mui/icons-material/EditRounded";
import Inventory2RoundedIcon from "@mui/icons-material/Inventory2Rounded";
import PhotoRoundedIcon from "@mui/icons-material/PhotoRounded";
import StorefrontRoundedIcon from "@mui/icons-material/StorefrontRounded";
import WarningAmberRoundedIcon from "@mui/icons-material/WarningAmberRounded";
import ZoomInRoundedIcon from "@mui/icons-material/ZoomInRounded";
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  IconButton,
  Skeleton,
  Stack,
  TextField,
  Tooltip,
  Typography,
  useMediaQuery,
  useTheme,
} from "@mui/material";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import type {
  SaveScanoTaskProductPayload,
  ScanoTaskProduct,
  ScanoTaskProductDraft,
  ScanoTaskProductSourceMeta,
} from "../../../api/types";
import { formatCairoFullDateTime } from "./scanoShared";

type DialogMode = "draft" | "edit" | "view" | "duplicate";

interface PersistedImageRef {
  key: string;
  id: string | null;
  url: string;
  fileName?: string;
}

interface ProductFormState {
  externalProductId: string | null;
  barcode: string;
  barcodesText: string;
  sku: string;
  price: string;
  itemNameEn: string;
  itemNameAr: string;
  sourceMeta: ScanoTaskProductSourceMeta;
  persistedImages: PersistedImageRef[];
  newFiles: File[];
}

interface ProductImageCard {
  key: string;
  url: string;
  fileName: string;
  removable: boolean;
  remove?: () => void;
}

interface ProductValidationErrors {
  barcode?: string;
  sku?: string;
  price?: string;
  itemNameEn?: string;
  images?: string;
}

function dedupeBarcodes(value: string) {
  const seen = new Set<string>();
  return value
    .split(",")
    .map((item) => item.trim())
    .filter((item) => {
      if (!item) return false;
      const key = item.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function createFormState(value: ScanoTaskProductDraft | ScanoTaskProduct | null): ProductFormState {
  if (!value) {
    return {
      externalProductId: null,
      barcode: "",
      barcodesText: "",
      sku: "",
      price: "",
      itemNameEn: "",
      itemNameAr: "",
      sourceMeta: {
        sourceType: "manual",
        chain: "no",
        vendor: "no",
        masterfile: "no",
        new: "yes",
      },
      persistedImages: [],
      newFiles: [],
    };
  }

  const persistedImages = "createdBy" in value
    ? [
      ...value.images.map((image) => ({ key: image.id, id: image.id, url: image.url, fileName: image.fileName })),
      ...(value.images.length < 1 && value.previewImageUrl
        ? [{ key: `preview-${value.previewImageUrl}`, id: null, url: value.previewImageUrl, fileName: value.itemNameEn || "Preview image" }]
        : []),
    ]
    : [
      ...value.images.map((url: string, index: number) => ({ key: `${url}-${index}`, id: null, url, fileName: `Image ${index + 1}` })),
      ...(value.images.length < 1 && value.previewImageUrl
        ? [{ key: `preview-${value.previewImageUrl}`, id: null, url: value.previewImageUrl, fileName: value.itemNameEn || "Preview image" }]
        : []),
    ];

  return {
    externalProductId: value.externalProductId,
    barcode: value.barcode,
    barcodesText: value.barcodes.join(", "),
    sku: value.sku ?? "",
    price: value.price ?? "",
    itemNameEn: value.itemNameEn ?? "",
    itemNameAr: value.itemNameAr ?? "",
    sourceMeta: {
      sourceType: value.sourceType,
      chain: value.chain,
      vendor: value.vendor,
      masterfile: value.masterfile,
      new: value.new,
    },
    persistedImages,
    newFiles: [],
  };
}

function shouldStartEditing(mode: DialogMode, value: ScanoTaskProductDraft | ScanoTaskProduct | null) {
  if (mode === "edit") return true;
  if (mode === "draft") {
    return !value?.externalProductId;
  }
  return false;
}

function buildProductPayload(form: ProductFormState): SaveScanoTaskProductPayload {
  return {
    externalProductId: form.externalProductId,
    barcode: form.barcode.trim(),
    barcodes: dedupeBarcodes(form.barcodesText),
    sku: form.sku.trim(),
    price: form.price.trim() || null,
    itemNameEn: form.itemNameEn.trim(),
    itemNameAr: form.itemNameAr.trim() || null,
    sourceMeta: form.sourceMeta,
    imageUrls: form.persistedImages.filter((image) => !image.id).map((image) => image.url),
    existingImageIds: form.persistedImages.filter((image) => !!image.id).map((image) => image.id as string),
  };
}

function ProductImagePlaceholder(props: { compact?: boolean }) {
  return (
    <Stack
      spacing={0.7}
      alignItems="center"
      justifyContent="center"
      sx={{
        width: "100%",
        height: "100%",
        minHeight: props.compact ? 68 : 180,
        bgcolor: "#ffffff",
        color: "#64748b",
        border: "1px dashed rgba(148,163,184,0.38)",
      }}
    >
      <PhotoRoundedIcon sx={{ fontSize: props.compact ? 22 : 34 }} />
      {!props.compact ? (
        <Typography variant="caption" sx={{ opacity: 0.92 }}>
          Image unavailable
        </Typography>
      ) : null}
    </Stack>
  );
}

function SourceIndicator(props: {
  label: string;
  active: boolean;
  icon: ReactNode;
}) {
  return (
    <Tooltip title={props.label}>
      <Box
        sx={{
          width: 30,
          height: 30,
          borderRadius: "999px",
          display: "grid",
          placeItems: "center",
          bgcolor: props.active ? "rgba(14,165,233,0.12)" : "#ffffff",
          color: props.active ? "#0369a1" : "#94a3b8",
          border: props.active ? "1px solid rgba(14,165,233,0.32)" : "1px solid rgba(148,163,184,0.24)",
        }}
      >
        {props.icon}
      </Box>
    </Tooltip>
  );
}

function MetadataCard(props: { label: string; value: string | null | undefined; tone?: "default" | "subtle" }) {
  return (
    <Stack
      spacing={0.5}
      sx={{
        minWidth: 0,
        height: "100%",
        p: 1.2,
        borderRadius: 3,
        bgcolor: props.tone === "subtle" ? "rgba(255,255,255,0.72)" : "#ffffff",
        border: "1px solid rgba(148,163,184,0.18)",
      }}
    >
      <Typography variant="caption" sx={{ color: "text.secondary", textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 800 }}>
        {props.label}
      </Typography>
      <Typography
        sx={{
          minWidth: 0,
          fontWeight: 800,
          color: "#0f172a",
          lineHeight: 1.45,
          whiteSpace: "normal",
          overflowWrap: "anywhere",
          wordBreak: "break-word",
        }}
      >
        {props.value?.trim() ? props.value : "-"}
      </Typography>
    </Stack>
  );
}

export function ScanoTaskProductDialog(props: {
  open: boolean;
  mode: DialogMode;
  title: string;
  value: ScanoTaskProductDraft | ScanoTaskProduct | null;
  warning?: string | null;
  busyState?: "hydrating" | "saving" | null;
  duplicateMeta?: { scannerName: string; scannedAt: string };
  submitting?: boolean;
  onClose: () => void;
  onSubmit?: (payload: SaveScanoTaskProductPayload, images: File[]) => void;
}) {
  const theme = useTheme();
  const fullScreen = useMediaQuery(theme.breakpoints.down("sm"));
  const [form, setForm] = useState<ProductFormState>(() => createFormState(props.value));
  const [editing, setEditing] = useState(() => shouldStartEditing(props.mode, props.value));
  const [selectedImageKey, setSelectedImageKey] = useState<string | null>(null);
  const [failedImageKeys, setFailedImageKeys] = useState<string[]>([]);
  const [imagePreviewOpen, setImagePreviewOpen] = useState(false);
  const [validationErrors, setValidationErrors] = useState<ProductValidationErrors>({});

  useEffect(() => {
    if (!props.open) return;
    setForm(createFormState(props.value));
    setEditing(shouldStartEditing(props.mode, props.value));
    setSelectedImageKey(null);
    setFailedImageKeys([]);
    setImagePreviewOpen(false);
    setValidationErrors({});
  }, [props.mode, props.open, props.value]);

  const newImagePreviews = useMemo(
    () => form.newFiles.map((file) => ({ key: `${file.name}-${file.size}-${file.lastModified}`, url: URL.createObjectURL(file), fileName: file.name })),
    [form.newFiles],
  );

  useEffect(() => () => {
    newImagePreviews.forEach((preview) => URL.revokeObjectURL(preview.url));
  }, [newImagePreviews]);

  const readOnly = props.mode === "duplicate" || !editing;
  const canToggleEdit = props.mode !== "duplicate" && !!props.onSubmit && (
    props.mode === "view"
    || (props.mode === "draft" && !!props.value?.externalProductId)
  );

  const imageCards = useMemo<ProductImageCard[]>(() => ([
    ...form.persistedImages.map((image) => ({
      key: image.key,
      url: image.url,
      fileName: image.fileName ?? "Image",
      removable: !readOnly,
      remove: !readOnly ? () => {
        setForm((current) => ({
          ...current,
          persistedImages: current.persistedImages.filter((item) => item.key !== image.key),
        }));
      } : undefined,
    })),
    ...newImagePreviews.map((image) => ({
      key: image.key,
      url: image.url,
      fileName: image.fileName,
      removable: !readOnly,
      remove: !readOnly ? () => {
        setForm((current) => ({
          ...current,
          newFiles: current.newFiles.filter((file) => `${file.name}-${file.size}-${file.lastModified}` !== image.key),
        }));
      } : undefined,
    })),
  ]), [form.persistedImages, newImagePreviews, readOnly]);

  const selectedImage = useMemo(() => {
    if (!imageCards.length) return null;
    const preferred = selectedImageKey
      ? imageCards.find((image) => image.key === selectedImageKey)
      : imageCards.find((image) => !failedImageKeys.includes(image.key)) ?? imageCards[0];
    return preferred ?? imageCards[0];
  }, [failedImageKeys, imageCards, selectedImageKey]);

  useEffect(() => {
    if (!selectedImageKey && imageCards.length) {
      setSelectedImageKey(imageCards[0].key);
    }
  }, [imageCards, selectedImageKey]);

  function markImageFailed(key: string) {
    setFailedImageKeys((current) => current.includes(key) ? current : [...current, key]);
  }

  function updateField<Key extends keyof ProductFormState>(key: Key, value: ProductFormState[Key]) {
    if (key === "barcode" || key === "sku" || key === "price" || key === "itemNameEn") {
      setValidationErrors((current) => ({ ...current, [key]: undefined }));
    }
    setForm((current) => ({ ...current, [key]: value }));
  }

  function handleFileChange(fileList: FileList | null) {
    if (!fileList?.length) return;
    setValidationErrors((current) => ({ ...current, images: undefined }));
    updateField("newFiles", [...form.newFiles, ...Array.from(fileList)]);
  }

  function validateForm() {
    const nextErrors: ProductValidationErrors = {};
    const requiresImage = form.sourceMeta.sourceType === "manual" || form.sourceMeta.sourceType === "master";
    const requiresPrice = form.sourceMeta.sourceType === "manual" || form.sourceMeta.sourceType === "master";
    if (!form.barcode.trim()) {
      nextErrors.barcode = "Barcode is required.";
    }
    if (!form.sku.trim()) {
      nextErrors.sku = "SKU is required.";
    }
    if (requiresPrice && !form.price.trim()) {
      nextErrors.price = "Price is required.";
    }
    if (!form.itemNameEn.trim()) {
      nextErrors.itemNameEn = "English item name is required.";
    }
    if (requiresImage && imageCards.length < 1) {
      nextErrors.images = form.sourceMeta.sourceType === "master"
        ? "Master products need at least one image."
        : "Manual products need at least one image.";
    }
    setValidationErrors(nextErrors);
    return Object.keys(nextErrors).length < 1;
  }

  function handleSubmit() {
    if (!props.onSubmit || props.mode === "duplicate") return;
    if (!validateForm()) {
      return;
    }
    props.onSubmit(buildProductPayload(form), form.newFiles);
  }

  const duplicateLabel = props.duplicateMeta
    ? `Already scanned by ${props.duplicateMeta.scannerName} on ${formatCairoFullDateTime(props.duplicateMeta.scannedAt)}.`
    : null;
  const showSecondaryWarning = !!props.warning && (
    !props.duplicateMeta
    || !/already scanned|already exists|duplicate/i.test(props.warning)
  );
  const productId = form.externalProductId?.trim() || "-";

  return (
    <Dialog
      open={props.open}
      onClose={props.onClose}
      fullWidth
      maxWidth="sm"
      fullScreen={fullScreen}
      PaperProps={{
        sx: fullScreen ? {
          bgcolor: "#f8fafc",
          height: "100%",
        } : {
          borderRadius: 4,
          overflow: "hidden",
          bgcolor: "#f8fafc",
          maxHeight: "92vh",
        },
      }}
    >
      <Stack
        sx={{
          minHeight: fullScreen ? "100%" : 0,
          bgcolor: "#f8fafc",
          overflowY: "auto",
          scrollbarWidth: "none",
          "&::-webkit-scrollbar": {
            display: "none",
          },
        }}
      >
        <Box
          sx={{
            position: "relative",
            px: { xs: 1.2, sm: 1.8 },
            pt: { xs: 1.2, sm: 1.5 },
            pb: 1,
            bgcolor: "#f8fafc",
          }}
        >
          <Stack
            direction="row"
            alignItems="center"
            justifyContent="space-between"
            sx={{ mb: 1.1 }}
          >
            <Stack direction="row" spacing={0.8}>
              <SourceIndicator label="Vendor" active={form.sourceMeta.vendor === "yes"} icon={<StorefrontRoundedIcon sx={{ fontSize: 18 }} />} />
              <SourceIndicator label="Chain" active={form.sourceMeta.chain === "yes"} icon={<AccountTreeRoundedIcon sx={{ fontSize: 18 }} />} />
              <SourceIndicator label="Master File" active={form.sourceMeta.masterfile === "yes"} icon={<Inventory2RoundedIcon sx={{ fontSize: 18 }} />} />
              <SourceIndicator label="Manual" active={form.sourceMeta.sourceType === "manual"} icon={<EditRoundedIcon sx={{ fontSize: 18 }} />} />
            </Stack>

            <IconButton
              onClick={props.onClose}
              sx={{
                bgcolor: "#ffffff",
                color: "#0f172a",
                border: "1px solid rgba(148,163,184,0.2)",
                "&:hover": {
                  bgcolor: "#f8fafc",
                },
              }}
            >
              <CloseRoundedIcon />
            </IconButton>
          </Stack>

          <Box
            sx={{
              display: "grid",
              gridTemplateColumns: { xs: "1fr", sm: "minmax(0, 1.12fr) minmax(210px, 0.88fr)" },
              gap: 1.2,
              alignItems: "stretch",
            }}
          >
            <Box
              component={selectedImage ? "button" : "div"}
              aria-label={selectedImage ? "Open product image preview" : undefined}
              onClick={selectedImage ? () => setImagePreviewOpen(true) : undefined}
              sx={{
                position: "relative",
                width: "100%",
                height: { xs: 220, sm: 250 },
                borderRadius: 4,
                overflow: "hidden",
                bgcolor: "#ffffff",
                background: "linear-gradient(180deg, #ffffff 0%, #f8fafc 100%)",
                border: "1px solid rgba(148,163,184,0.18)",
                boxShadow: "0 16px 34px rgba(15,23,42,0.08)",
                cursor: selectedImage ? "zoom-in" : "default",
                display: "grid",
                placeItems: "center",
                appearance: "none",
                textAlign: "inherit",
              }}
            >
              {selectedImage && !failedImageKeys.includes(selectedImage.key) ? (
                <Box
                  component="img"
                  src={selectedImage.url}
                  alt={selectedImage.fileName}
                  onError={() => markImageFailed(selectedImage.key)}
                  sx={{
                    height: "100%",
                    width: "auto",
                    maxWidth: "100%",
                    maxHeight: "100%",
                    objectFit: "contain",
                    objectPosition: "center",
                    display: "block",
                    borderRadius: "inherit",
                  }}
                />
              ) : (
                <ProductImagePlaceholder />
              )}

              {selectedImage ? (
                <Box
                  component="span"
                  aria-hidden="true"
                  sx={{
                    position: "absolute",
                    right: 12,
                    top: 12,
                    color: "#0f172a",
                    filter: "drop-shadow(0 4px 12px rgba(255,255,255,0.9)) drop-shadow(0 2px 10px rgba(15,23,42,0.18))",
                    display: "grid",
                    placeItems: "center",
                  }}
                >
                  <ZoomInRoundedIcon sx={{ fontSize: 22 }} />
                </Box>
              ) : null}
            </Box>

            <Stack spacing={1.1} sx={{ minWidth: 0 }}>
              <Stack
                spacing={0.75}
                sx={{
                  minWidth: 0,
                  p: 1.35,
                  borderRadius: 3.5,
                  bgcolor: "#ffffff",
                  border: "1px solid rgba(148,163,184,0.16)",
                  boxShadow: "0 12px 28px rgba(15,23,42,0.05)",
                }}
              >
                <Typography variant="overline" sx={{ color: "#64748b", letterSpacing: "0.08em", fontWeight: 800 }}>
                  {props.title}
                </Typography>
                <Typography
                  variant="h5"
                  sx={{
                    fontWeight: 900,
                    color: "#0f172a",
                    lineHeight: 1.12,
                    whiteSpace: "normal",
                    overflowWrap: "anywhere",
                    wordBreak: "break-word",
                  }}
                >
                  {form.itemNameEn || "Unnamed Product"}
                </Typography>
                {form.itemNameAr ? (
                  <Typography
                    variant="body2"
                    sx={{
                      color: "#334155",
                      fontWeight: 700,
                      lineHeight: 1.5,
                      whiteSpace: "normal",
                      overflowWrap: "anywhere",
                      wordBreak: "break-word",
                    }}
                  >
                    {form.itemNameAr}
                  </Typography>
                ) : null}
              </Stack>

              <MetadataCard label="ID" value={productId} tone="subtle" />
            </Stack>
          </Box>

          {imageCards.length > 1 ? (
            <Stack direction="row" spacing={1} sx={{ overflowX: "auto", pt: 1, pb: 0.2 }}>
              {imageCards.map((image) => {
                const failed = failedImageKeys.includes(image.key);
                const active = selectedImage?.key === image.key;
                return (
                  <Box
                    key={image.key}
                    component="button"
                    type="button"
                    onClick={() => setSelectedImageKey(image.key)}
                    sx={{
                      p: 0,
                      border: active ? "2px solid #0ea5e9" : "1px solid rgba(148,163,184,0.24)",
                      borderRadius: 2.5,
                      overflow: "hidden",
                      width: 68,
                      height: 68,
                      flex: "0 0 auto",
                      bgcolor: "#ffffff",
                    }}
                  >
                    {failed ? (
                      <ProductImagePlaceholder compact />
                    ) : (
                      <Box
                        component="img"
                        src={image.url}
                        alt={image.fileName}
                        onError={() => markImageFailed(image.key)}
                        sx={{ width: "100%", height: "100%", objectFit: "contain", display: "block", bgcolor: "#ffffff" }}
                      />
                    )}
                  </Box>
                );
              })}
            </Stack>
          ) : null}
        </Box>

        <DialogContent
          sx={{
            px: { xs: 1.5, sm: 2.2 },
            py: 1.3,
            display: "flex",
            flexDirection: "column",
            gap: 1.2,
            overflow: "visible",
          }}
        >
          {duplicateLabel ? (
            <Alert severity="warning" icon={<WarningAmberRoundedIcon />}>
              {duplicateLabel}
            </Alert>
          ) : null}

          {props.busyState ? (
            <Box
              aria-label={props.busyState === "hydrating" ? "Hydrating product details" : "Saving product"}
              sx={{
                p: 1.35,
                borderRadius: 3,
                border: "1px solid rgba(14,165,233,0.16)",
                bgcolor: "rgba(255,255,255,0.82)",
                boxShadow: "0 14px 28px rgba(15,23,42,0.05)",
              }}
            >
              <Stack direction="row" spacing={1.4} alignItems="center">
                <CircularProgress size={18} thickness={4.8} />
                <Stack spacing={0.7} flex={1}>
                  <Skeleton variant="rounded" width={props.busyState === "hydrating" ? "42%" : "34%"} height={14} />
                  <Skeleton variant="rounded" width="100%" height={12} />
                  {props.busyState === "hydrating" ? <Skeleton variant="rounded" width="68%" height={12} /> : null}
                </Stack>
              </Stack>
            </Box>
          ) : null}

          {showSecondaryWarning && !props.busyState ? (
            <Alert severity="warning" variant="outlined">
              {props.warning}
            </Alert>
          ) : null}

          {editing ? (
            <Stack spacing={1.25}>
              <Stack direction={{ xs: "column", sm: "row" }} spacing={1.2}>
                <TextField
                  label="Barcode"
                  value={form.barcode}
                  onChange={(event) => updateField("barcode", event.target.value)}
                  error={!!validationErrors.barcode}
                  helperText={validationErrors.barcode}
                  fullWidth
                />
                <TextField
                  label="SKU"
                  value={form.sku}
                  onChange={(event) => updateField("sku", event.target.value)}
                  error={!!validationErrors.sku}
                  helperText={validationErrors.sku}
                  fullWidth
                />
              </Stack>

              <TextField
                label="All Barcodes"
                value={form.barcodesText}
                onChange={(event) => updateField("barcodesText", event.target.value)}
                helperText="Separate multiple barcodes with commas."
                fullWidth
              />

              <Stack direction={{ xs: "column", sm: "row" }} spacing={1.2}>
                <TextField
                  label="Price"
                  value={form.price}
                  onChange={(event) => updateField("price", event.target.value)}
                  error={!!validationErrors.price}
                  helperText={validationErrors.price}
                  fullWidth
                />
                <TextField
                  label="Item Name EN"
                  value={form.itemNameEn}
                  onChange={(event) => updateField("itemNameEn", event.target.value)}
                  error={!!validationErrors.itemNameEn}
                  helperText={validationErrors.itemNameEn}
                  fullWidth
                />
              </Stack>

              <TextField
                label="Item Name AR"
                value={form.itemNameAr}
                onChange={(event) => updateField("itemNameAr", event.target.value)}
                fullWidth
              />

              <Stack spacing={1}>
                <Stack direction="row" justifyContent="space-between" alignItems="center">
                  <Typography variant="subtitle2" sx={{ fontWeight: 900, color: "#0f172a" }}>
                    Product Images
                  </Typography>
                  <Button component="label" startIcon={<AddPhotoAlternateRoundedIcon />}>
                    Add Images
                    <Box component="input" type="file" accept="image/*" multiple hidden onChange={(event) => handleFileChange(event.target.files)} />
                  </Button>
                </Stack>

                {validationErrors.images ? (
                  <Alert severity="error" variant="filled">
                    {validationErrors.images}
                  </Alert>
                ) : null}

                {imageCards.length ? (
                  <Stack direction="row" spacing={1} sx={{ overflowX: "auto", pb: 0.5 }}>
                    {imageCards.map((image) => {
                      const failed = failedImageKeys.includes(image.key);
                      return (
                        <Stack
                          key={image.key}
                          spacing={0.8}
                          sx={{
                            width: 112,
                            flex: "0 0 auto",
                            p: 0.8,
                            borderRadius: 2.8,
                            bgcolor: "#ffffff",
                            border: "1px solid rgba(148,163,184,0.2)",
                          }}
                        >
                          <Box
                            sx={{
                              width: "100%",
                              height: 86,
                              borderRadius: 2,
                              overflow: "hidden",
                              bgcolor: "#e2e8f0",
                            }}
                          >
                            {failed ? (
                              <ProductImagePlaceholder compact />
                            ) : (
                              <Box
                                component="img"
                                src={image.url}
                                alt={image.fileName}
                                onError={() => markImageFailed(image.key)}
                                sx={{
                                  width: "100%",
                                  height: "100%",
                                  objectFit: "contain",
                                  display: "block",
                                  bgcolor: "#ffffff",
                                  p: 0.75,
                                }}
                              />
                            )}
                          </Box>
                          <Typography variant="caption" noWrap title={image.fileName}>
                            {image.fileName}
                          </Typography>
                          {image.removable && image.remove ? (
                            <Button size="small" color="error" onClick={image.remove}>
                              Remove
                            </Button>
                          ) : null}
                        </Stack>
                      );
                    })}
                  </Stack>
                ) : (
                  <Alert severity={form.sourceMeta.sourceType === "manual" ? "warning" : "info"} variant="outlined">
                    {form.sourceMeta.sourceType === "manual"
                      ? "Add at least one scanner image before confirming this manual product."
                      : "No product images were added yet."}
                  </Alert>
                )}
              </Stack>
            </Stack>
          ) : (
            <Stack spacing={1.4}>
              <Box
                sx={{
                  display: "grid",
                  gridTemplateColumns: { xs: "repeat(2, minmax(0, 1fr))", sm: "repeat(3, minmax(0, 1fr))" },
                  gap: 1,
                }}
              >
                <MetadataCard label="Barcode" value={form.barcode} />
                <MetadataCard label="SKU" value={form.sku} />
                <MetadataCard label="Price" value={form.price} />
              </Box>

              {form.barcodesText ? (
                <MetadataCard label="All Barcodes" value={form.barcodesText} />
              ) : null}

              {form.itemNameAr?.trim() ? (
                <MetadataCard label="Item Name AR" value={form.itemNameAr} />
              ) : null}
            </Stack>
          )}
        </DialogContent>

        <DialogActions
          sx={{
            px: { xs: 1.5, sm: 2.2 },
            py: 1.4,
            position: "sticky",
            bottom: 0,
            bgcolor: "rgba(248,250,252,0.96)",
            borderTop: "1px solid rgba(148,163,184,0.18)",
            backdropFilter: "blur(14px)",
          }}
        >
          <Button onClick={props.onClose}>Close</Button>

          {props.mode === "duplicate" ? (
            <Button variant="contained" disabled startIcon={<WarningAmberRoundedIcon />}>
              Already Scanned
            </Button>
          ) : null}

          {canToggleEdit && !editing ? (
            <Button startIcon={<EditRoundedIcon />} onClick={() => setEditing(true)}>
              Edit
            </Button>
          ) : null}

          {canToggleEdit && editing ? (
            <Button onClick={() => setEditing(false)}>
              Cancel Edit
            </Button>
          ) : null}

          {props.onSubmit && props.mode !== "duplicate" && (props.mode !== "view" || editing) ? (
            <Button
              variant="contained"
              onClick={handleSubmit}
              disabled={props.submitting}
              startIcon={!props.submitting ? <CheckCircleRoundedIcon /> : undefined}
            >
              {props.submitting ? "Saving..." : props.mode === "view" ? "Save Changes" : "Confirm"}
            </Button>
          ) : null}
        </DialogActions>
      </Stack>

      <Dialog
        open={imagePreviewOpen}
        onClose={() => setImagePreviewOpen(false)}
        fullWidth
        maxWidth="md"
        fullScreen={fullScreen}
        PaperProps={{
          sx: {
            bgcolor: "#ffffff",
          },
        }}
      >
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            p: 1.2,
            borderBottom: "1px solid rgba(148,163,184,0.18)",
          }}
        >
          <Typography sx={{ fontWeight: 800, color: "#0f172a" }}>
            Product Image
          </Typography>
          <IconButton onClick={() => setImagePreviewOpen(false)}>
            <CloseRoundedIcon />
          </IconButton>
        </Box>
        <Box
          sx={{
            p: { xs: 1.5, sm: 2.5 },
            bgcolor: "#ffffff",
            minHeight: fullScreen ? "calc(100vh - 72px)" : 420,
            display: "grid",
            placeItems: "center",
          }}
        >
          {selectedImage && !failedImageKeys.includes(selectedImage.key) ? (
            <Box
              component="img"
              src={selectedImage.url}
              alt={selectedImage.fileName}
              onError={() => markImageFailed(selectedImage.key)}
              sx={{
                maxWidth: "100%",
                maxHeight: fullScreen ? "82vh" : "72vh",
                objectFit: "contain",
                display: "block",
                bgcolor: "#ffffff",
              }}
            />
          ) : (
            <Box sx={{ width: "100%", maxWidth: 520 }}>
              <ProductImagePlaceholder />
            </Box>
          )}
        </Box>
      </Dialog>
    </Dialog>
  );
}
