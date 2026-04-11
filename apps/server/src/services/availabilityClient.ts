import axios from "axios";
import { z } from "zod";
import type { AvailabilityRecord } from "../types/models.js";

const WRITE_BASE = "https://vss.me.restaurant-partners.com";
const VSS_STATUS_URL = `${WRITE_BASE}/api/v1/vendors/status`;

const FallbackAvailabilityRootSchema = z.object({
  vendors: z.record(z.unknown()),
});

const FallbackVendorStatusSchema = z.object({
  platformVendorId: z.string().min(1),
  changeable: z.boolean().optional(),
  nextOpeningAt: z.string().optional(),
  endTime: z.string().optional(),
  adjustmentMinutes: z.number().optional(),
}).passthrough();

export interface FetchAvailabilitiesOptions {
  expectedVendorIds?: Iterable<string>;
}

function createMalformedAvailabilityPayloadError(message: string) {
  const error = new Error(`Availability API returned malformed payload: ${message}`);
  (error as any).status = 502;
  return error;
}

function normalizeExpectedVendorIds(expectedVendorIds?: Iterable<string>) {
  if (!expectedVendorIds) return [];

  const normalized = new Set<string>();
  for (const vendorId of expectedVendorIds) {
    const value = String(vendorId ?? "").trim();
    if (value) {
      normalized.add(value);
    }
  }

  return Array.from(normalized);
}

function collectFallbackVendorStatusGroups(node: unknown, path: string[] = []): Array<{ path: string[]; items: unknown[] }> {
  if (!node || typeof node !== "object" || Array.isArray(node)) {
    return [];
  }

  const groups: Array<{ path: string[]; items: unknown[] }> = [];
  const entries = Object.entries(node as Record<string, unknown>);

  for (const [key, value] of entries) {
    if (key === "vendorStatuses") {
      if (!Array.isArray(value)) {
        throw createMalformedAvailabilityPayloadError(`fallback payload ${path.join(".")} vendorStatuses: expected an array`);
      }
      groups.push({ path, items: value });
      continue;
    }

    groups.push(...collectFallbackVendorStatusGroups(value, [...path, key]));
  }

  return groups;
}

function mapFallbackPathToAvailabilityState(path: string[]): AvailabilityRecord["availabilityState"] {
  const normalizedPath = path.map((segment) => segment.toLowerCase());
  if (normalizedPath.includes("temporarilyclosed")) {
    return "CLOSED_UNTIL";
  }
  if (normalizedPath.includes("offhours")) {
    return "CLOSED";
  }
  if (normalizedPath.includes("closed")) {
    return "CLOSED";
  }
  if (normalizedPath.includes("open")) {
    return "OPEN";
  }
  return "UNKNOWN";
}

function normalizeFallbackAvailabilityPayload(payload: unknown): AvailabilityRecord[] {
  const parsedRoot = FallbackAvailabilityRootSchema.safeParse(payload);
  if (!parsedRoot.success) {
    throw createMalformedAvailabilityPayloadError("fallback payload expected an object with vendors");
  }

  const groups = collectFallbackVendorStatusGroups(parsedRoot.data.vendors, ["vendors"]);
  const records = new Map<string, AvailabilityRecord>();

  for (const group of groups) {
    const availabilityState = mapFallbackPathToAvailabilityState(group.path);
    for (const [index, item] of group.items.entries()) {
      const parsedItem = FallbackVendorStatusSchema.safeParse(item);
      if (!parsedItem.success) {
        const issue = parsedItem.error.issues[0];
        const issuePath = issue?.path?.length ? issue.path.join(".") : "record";
        throw createMalformedAvailabilityPayloadError(
          `fallback payload ${group.path.join(".")} item ${index} ${issuePath}: ${issue?.message ?? "invalid shape"}`,
        );
      }

      const value = parsedItem.data;
      records.set(value.platformVendorId, {
        platformKey: "vss_vendor_status",
        changeable: value.changeable ?? false,
        availabilityState,
        platformRestaurantId: value.platformVendorId,
        currentSlotEndAt: typeof value.endTime === "string" ? value.endTime : undefined,
        closedUntil: typeof value.nextOpeningAt === "string" ? value.nextOpeningAt : undefined,
        closedReason: typeof value.closedReason === "string" ? value.closedReason : undefined,
      });
    }
  }

  return Array.from(records.values());
}

export function isRetryableAvailabilityRequestError(error: any) {
  const status = typeof error?.response?.status === "number" ? error.response.status : null;
  if (status === 408 || status === 409 || status === 425 || status === 429) {
    return true;
  }
  if (typeof status === "number" && status >= 500) {
    return true;
  }

  const code = typeof error?.code === "string" ? error.code.toUpperCase() : "";
  if ([
    "ECONNABORTED",
    "ETIMEDOUT",
    "ECONNRESET",
    "EAI_AGAIN",
    "ENOTFOUND",
    "ERR_NETWORK",
    "ERR_SOCKET_CONNECTION_TIMEOUT",
  ].includes(code)) {
    return true;
  }

  const message = typeof error?.message === "string" ? error.message.toLowerCase() : "";
  return message.includes("timeout") || message.includes("socket hang up") || message.includes("network error");
}

async function getWithRetry(url: string, headers: Record<string, string>, retries = 2) {
  let lastErr: any;
  for (let i = 0; i <= retries; i += 1) {
    try {
      return await axios.get(url, { headers, timeout: 15000 });
    } catch (error: any) {
      lastErr = error;
      const backoff = 400 * Math.pow(2, i);
      if (i < retries && isRetryableAvailabilityRequestError(error)) {
        await new Promise((r) => setTimeout(r, backoff));
        continue;
      }
      break;
    }
  }
  throw lastErr;
}

async function putWithRetry(url: string, payload: any, headers: Record<string, string>, retries = 1) {
  let lastErr: any;
  for (let i = 0; i <= retries; i += 1) {
    try {
      return await axios.put(url, payload, { headers, timeout: 15000 });
    } catch (error: any) {
      lastErr = error;
      const backoff = 400 * Math.pow(2, i);
      if (i < retries && isRetryableAvailabilityRequestError(error)) {
        await new Promise((r) => setTimeout(r, backoff));
        continue;
      }
      break;
    }
  }
  throw lastErr;
}

async function fetchVssAvailabilities(token: string, expectedVendorIds: string[]) {
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: "application/json, text/plain, */*",
    Origin: "https://partner-app.talabat.com",
    Referer: "https://partner-app.talabat.com/",
  };

  const res = await getWithRetry(VSS_STATUS_URL, headers, 1);
  const fallbackRows = normalizeFallbackAvailabilityPayload(res.data);
  if (!expectedVendorIds.length) {
    return fallbackRows;
  }

  const missingVendorIds = new Set(expectedVendorIds);
  return fallbackRows.filter((row) => missingVendorIds.has(row.platformRestaurantId));
}

export async function fetchAvailabilities(token: string, options: FetchAvailabilitiesOptions = {}): Promise<AvailabilityRecord[]> {
  const expectedVendorIds = normalizeExpectedVendorIds(options.expectedVendorIds);
  // Temporarily pin all availability reads to VSS until the legacy vendor-api endpoint is revalidated.
  return fetchVssAvailabilities(token, expectedVendorIds);
}

export async function setAvailability(params: {
  token: string;
  globalEntityId: string;
  availabilityVendorId: string; // vendorId in vss endpoint
  state: "OPEN" | "TEMPORARY_CLOSURE";
  durationMinutes?: number;
}) {
  const url = `${WRITE_BASE}/api/v2/globalEntities/${params.globalEntityId}/vendors/${params.availabilityVendorId}/availability`;
  const headers = { Authorization: `Bearer ${params.token}`, "Content-Type": "application/json", Accept: "application/json" };

  const payload =
    params.state === "OPEN"
      ? { availabilityState: "OPEN" }
      : { availabilityState: "TEMPORARY_CLOSURE", durationMinutes: params.durationMinutes ?? 30 };

  const res = await putWithRetry(url, payload, headers, 1);
  if (res.data == null) {
    return {};
  }
  if (typeof res.data !== "object" || Array.isArray(res.data)) {
    throw createMalformedAvailabilityPayloadError("expected an object response from availability mutation");
  }
  return res.data as Record<string, unknown>;
}
