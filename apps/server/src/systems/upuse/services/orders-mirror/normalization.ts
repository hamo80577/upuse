import type { MirrorOrderFallbacks, NormalizedMirrorOrder } from "./types.js";

export function stableOrderKey(order: any) {
  if (order?.id != null) return String(order.id);
  if (order?.externalId != null) return String(order.externalId);
  if (order?.shortCode != null) return String(order.shortCode);
  return "";
}

function toIsoOrNull(value: unknown) {
  return typeof value === "string" && value.trim().length ? value : null;
}

function resolveShopperId(order: any) {
  const raw = order?.shopper?.id;
  return typeof raw === "number" && Number.isFinite(raw)
    ? raw
    : typeof raw === "string" && raw.trim().length && Number.isFinite(Number(raw))
      ? Number(raw)
      : null;
}

function resolveShopperFirstName(order: any) {
  return typeof order?.shopper?.firstName === "string" && order.shopper.firstName.trim().length
    ? order.shopper.firstName.trim()
    : null;
}

function resolveVendorId(order: any) {
  const raw =
    typeof order?.vendor?.id !== "undefined"
      ? order.vendor.id
      : typeof order?.vendorId !== "undefined"
        ? order.vendorId
        : null;

  if (typeof raw === "number" && Number.isFinite(raw)) return Math.trunc(raw);
  if (typeof raw === "string" && raw.trim().length && Number.isFinite(Number(raw))) {
    return Math.trunc(Number(raw));
  }
  return 0;
}

function resolveVendorName(order: any) {
  if (typeof order?.vendor?.name === "string" && order.vendor.name.trim().length) {
    return order.vendor.name.trim();
  }
  if (typeof order?.vendorName === "string" && order.vendorName.trim().length) {
    return order.vendorName.trim();
  }
  return null;
}

export function extractTransportType(payload: unknown) {
  const transportType = (payload as { transportType?: unknown } | null | undefined)?.transportType;
  if (typeof transportType !== "string") return null;
  const normalized = transportType.trim().toUpperCase();
  return normalized.length ? normalized : null;
}

export function normalizeMirrorOrder(
  order: any,
  dayKey: string,
  globalEntityId: string,
  nowIso: string,
  fallbacks: MirrorOrderFallbacks = {},
): NormalizedMirrorOrder | null {
  const fallbackOrderId = typeof fallbacks.orderId === "string" && fallbacks.orderId.trim().length
    ? fallbacks.orderId
    : "";
  const fallbackExternalId = typeof fallbacks.externalId === "string" && fallbacks.externalId.trim().length
    ? fallbacks.externalId
    : null;
  const fallbackVendorId = typeof fallbacks.vendorId === "number" && Number.isFinite(fallbacks.vendorId)
    ? Math.trunc(fallbacks.vendorId)
    : 0;
  const orderId = stableOrderKey(order) || fallbackOrderId;
  const vendorId = resolveVendorId(order) || fallbackVendorId;
  if (!orderId || !vendorId) return null;

  const isCompleted = Boolean(order?.isCompleted);
  const status = String(order?.status ?? "UNKNOWN");
  const isActiveNow = isCompleted ? 0 : 1;

  return {
    dayKey,
    globalEntityId,
    vendorId,
    vendorName: resolveVendorName(order) ?? fallbacks.vendorName ?? null,
    orderId,
    externalId: String(order?.externalId ?? order?.shortCode ?? fallbackExternalId ?? order?.id ?? ""),
    status,
    transportType: extractTransportType(order),
    isCompleted: isCompleted ? 1 : 0,
    isCancelled: status === "CANCELLED" ? 1 : 0,
    isUnassigned: status === "UNASSIGNED" || order?.shopper == null ? 1 : 0,
    placedAt: toIsoOrNull(order?.placedAt),
    pickupAt: toIsoOrNull(order?.pickupAt),
    customerFirstName:
      typeof order?.customerFirstName === "string" && order.customerFirstName.trim().length
        ? order.customerFirstName.trim()
        : null,
    shopperId: resolveShopperId(order),
    shopperFirstName: resolveShopperFirstName(order),
    isActiveNow,
    lastSeenAt: nowIso,
    lastActiveSeenAt: isActiveNow ? nowIso : null,
  };
}
