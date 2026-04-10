import { describeApiError } from "../../../../../shared/api/httpClient";
import type {
  SaveScanoTaskProductPayload,
  ScanoRunnerBootstrapResponse,
  ScanoTaskProduct,
  ScanoTaskProductDraft,
  ScanoTaskProductSourceMeta,
} from "../../../../../api/types";

export function dedupeBarcodes(values: string[]) {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const rawValue of values) {
    const value = rawValue.trim();
    if (!value) continue;
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(value);
  }
  return result;
}

function matchesProductBarcode(product: ScanoTaskProduct, barcode: string) {
  const normalizedBarcode = barcode.trim().toLowerCase();
  if (!normalizedBarcode) return false;
  return product.barcodes.some((value) => value.trim().toLowerCase() === normalizedBarcode);
}

function determineSourceType(flags: Pick<ScanoTaskProductSourceMeta, "vendor" | "chain" | "masterfile">) {
  if (flags.vendor === "yes") return "vendor" as const;
  if (flags.chain === "yes") return "chain" as const;
  if (flags.masterfile === "yes") return "master" as const;
  return "manual" as const;
}

export function buildSourceMeta(flags: Pick<ScanoTaskProductSourceMeta, "vendor" | "chain" | "masterfile">): ScanoTaskProductSourceMeta {
  const isExisting = flags.vendor === "yes" || flags.chain === "yes" || flags.masterfile === "yes";
  return {
    sourceType: determineSourceType(flags),
    vendor: flags.vendor,
    chain: flags.chain,
    masterfile: flags.masterfile,
    new: isExisting ? "no" : "yes",
  };
}

export function buildPayloadFromDraft(draft: ScanoTaskProductDraft): SaveScanoTaskProductPayload {
  return {
    externalProductId: draft.externalProductId,
    barcode: draft.barcode,
    barcodes: draft.barcodes,
    sku: draft.sku?.trim() ?? "",
    price: draft.price ?? null,
    itemNameEn: draft.itemNameEn?.trim() ?? "",
    itemNameAr: draft.itemNameAr?.trim() || null,
    sourceMeta: buildSourceMeta({
      vendor: draft.vendor,
      chain: draft.chain,
      masterfile: draft.masterfile,
    }),
    imageUrls: draft.images,
    existingImageIds: [],
  };
}

export function buildDisplayValueFromSavedProduct(
  product: ScanoTaskProduct,
  previousValue: ScanoTaskProductDraft | ScanoTaskProduct | null,
): ScanoTaskProductDraft | ScanoTaskProduct {
  const previousImages = previousValue
    ? ("createdBy" in previousValue ? previousValue.images.map((image) => image.url) : previousValue.images)
    : [];

  if (product.images.length || previousImages.length < 1) {
    return product;
  }

  return {
    externalProductId: product.externalProductId,
    previewImageUrl: product.previewImageUrl,
    barcode: product.barcode,
    barcodes: product.barcodes,
    sku: product.sku,
    price: product.price,
    itemNameEn: product.itemNameEn,
    itemNameAr: product.itemNameAr,
    chain: product.chain,
    vendor: product.vendor,
    masterfile: product.masterfile,
    new: product.new,
    sourceType: product.sourceType,
    images: previousImages,
    warning: null,
  };
}

export function mergeConfirmedProductIntoBootstrap(
  current: ScanoRunnerBootstrapResponse | null,
  product: ScanoTaskProduct,
) {
  if (!current) return current;
  const nextProducts = [product, ...current.confirmedProducts.filter((item) => item.id !== product.id)];
  return {
    ...current,
    confirmedProducts: nextProducts,
    confirmedBarcodes: dedupeBarcodes(nextProducts.flatMap((item) => item.barcodes)),
  };
}

export function findDuplicateProductInBootstrap(
  bootstrap: ScanoRunnerBootstrapResponse | null,
  barcode: string,
) {
  if (!bootstrap) return null;
  return bootstrap.confirmedProducts.find((product) => matchesProductBarcode(product, barcode)) ?? null;
}

function draftNeedsImage(draft: ScanoTaskProductDraft) {
  return (draft.sourceType === "manual" || draft.sourceType === "master")
    && draft.images.length < 1
    && !draft.previewImageUrl?.trim();
}

function draftNeedsPrice(draft: ScanoTaskProductDraft) {
  return (draft.sourceType === "manual" || draft.sourceType === "master")
    && !draft.price?.trim();
}

export function canAutoSaveDraft(draft: ScanoTaskProductDraft) {
  return !!draft.sku?.trim()
    && !!draft.itemNameEn?.trim()
    && !draftNeedsPrice(draft)
    && !draftNeedsImage(draft);
}

export function getDraftReviewWarning(draft: ScanoTaskProductDraft) {
  const requirementWarning = draft.sourceType === "manual"
    ? "Manual products require an image, SKU, price, and English item name before saving."
    : draft.sourceType === "master"
      ? "Master-file products require an image and a price before saving."
      : "Product found, but SKU or item name is missing. Complete it manually before saving.";

  if (!draft.warning?.trim()) {
    return requirementWarning;
  }

  if (draft.warning.includes(requirementWarning)) {
    return draft.warning;
  }

  return `${draft.warning} ${requirementWarning}`;
}

export function isDuplicateSaveError(error: unknown) {
  const message = describeApiError(error, "").trim().toLowerCase();
  return message.includes("already exists") || message.includes("already scanned") || message.includes("duplicate");
}

export function canSubmitProductDialogValue(value: ScanoTaskProductDraft | ScanoTaskProduct) {
  return !("createdBy" in value) || value.canEdit;
}
