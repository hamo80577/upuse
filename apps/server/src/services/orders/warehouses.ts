import { getWithRetry } from "./httpClient.js";
import { BASE } from "./types.js";

interface RawWarehouse {
  id?: unknown;
  platformVendorId?: unknown;
  externalId?: unknown;
  name?: unknown;
  globalEntityId?: unknown;
  entityId?: unknown;
}

export interface OrdersWarehouseVendorLookup {
  availabilityVendorId: string;
  ordersVendorId: number;
  name: string;
  globalEntityId: string;
}

function normalizeIdValues(value: unknown) {
  if (Array.isArray(value)) {
    return value
      .map((item) => String(item ?? "").trim())
      .filter(Boolean);
  }

  const normalized = String(value ?? "").trim();
  return normalized ? [normalized] : [];
}

function hasExactAvailabilityId(item: RawWarehouse, availabilityVendorId: string) {
  const ids = [
    ...normalizeIdValues(item.platformVendorId),
    ...normalizeIdValues(item.externalId),
  ];
  return ids.includes(availabilityVendorId);
}

function normalizeWarehouseVendor(item: RawWarehouse, availabilityVendorId: string): OrdersWarehouseVendorLookup | null {
  if (!hasExactAvailabilityId(item, availabilityVendorId)) {
    return null;
  }

  const ordersVendorId = Number(item.id);
  const name = typeof item.name === "string" ? item.name.trim() : "";
  const globalEntityId = typeof item.globalEntityId === "string" && item.globalEntityId.trim()
    ? item.globalEntityId.trim()
    : typeof item.entityId === "string" && item.entityId.trim()
      ? item.entityId.trim()
      : "";

  if (!Number.isInteger(ordersVendorId) || ordersVendorId <= 0 || !name || !globalEntityId) {
    return null;
  }

  return {
    availabilityVendorId,
    ordersVendorId,
    name,
    globalEntityId,
  };
}

export async function lookupWarehouseVendorByAvailabilityId(params: {
  token: string;
  globalEntityId: string;
  availabilityVendorId: string;
}): Promise<OrdersWarehouseVendorLookup | null> {
  const availabilityVendorId = params.availabilityVendorId.trim();
  if (!availabilityVendorId) return null;

  const query = new URLSearchParams({
    permission: "order:read",
    search: availabilityVendorId,
  });
  const url = `${BASE}/v2/entities/${encodeURIComponent(params.globalEntityId)}/warehouses?${query.toString()}`;
  const response = await getWithRetry(url, {
    Authorization: `Bearer ${params.token}`,
    Accept: "application/json, text/plain, */*",
    "x-request-source": "upuse",
  }, 2);

  const rows = Array.isArray(response.data) ? response.data as RawWarehouse[] : [];
  return rows
    .map((item) => normalizeWarehouseVendor(item, availabilityVendorId))
    .find((item): item is OrdersWarehouseVendorLookup => item !== null) ?? null;
}
