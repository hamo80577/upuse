import axios from "axios";
import type { AvailabilityRecord } from "../types/models.js";

const READ_BASE = "https://vendor-api-eg.me.restaurant-partners.com";
const WRITE_BASE = "https://vss.me.restaurant-partners.com";

async function getWithRetry(url: string, headers: Record<string, string>, retries = 2) {
  let lastErr: any;
  for (let i = 0; i <= retries; i++) {
    try {
      return await axios.get(url, { headers, timeout: 15000 });
    } catch (e: any) {
      lastErr = e;
      const status = e?.response?.status;
      const backoff = 400 * Math.pow(2, i);
      if (status === 429 || status >= 500) {
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
  for (let i = 0; i <= retries; i++) {
    try {
      return await axios.put(url, payload, { headers, timeout: 15000 });
    } catch (e: any) {
      lastErr = e;
      const status = e?.response?.status;
      const backoff = 400 * Math.pow(2, i);
      if (status === 429 || status >= 500) {
        await new Promise((r) => setTimeout(r, backoff));
        continue;
      }
      break;
    }
  }
  throw lastErr;
}

export async function fetchAvailabilities(token: string): Promise<AvailabilityRecord[]> {
  const url = `${READ_BASE}/api/1/platforms/restaurants/availabilities`;
  const headers = { Authorization: `Bearer ${token}`, Accept: "application/json" };
  const res = await getWithRetry(url, headers, 2);
  return res.data as AvailabilityRecord[];
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
  return res.data;
}
