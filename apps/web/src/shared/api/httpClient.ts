import { getStoredAdminKey } from "./adminKeyStorage";

const DEFAULT_TIMEOUT_MS = 25_000;
const TIMEOUT_MESSAGE = "Request timed out. Please try again.";

export interface HttpRequestOptions {
  timeoutMs?: number;
}

export function describeApiError(error: unknown, fallback = "Request failed") {
  if (error instanceof Error && error.message.trim()) {
    if (error.message === "Unauthorized") {
      return "Enter the Admin Key to access protected API routes.";
    }

    return error.message;
  }

  return fallback;
}

function withApiInit(init?: RequestInit): RequestInit | undefined {
  const headers = new Headers(init?.headers);
  const adminKey = getStoredAdminKey();
  if (adminKey && !headers.has("Authorization")) {
    headers.set("Authorization", `Bearer ${adminKey}`);
  }

  if (!init && !headers.has("Authorization")) {
    return undefined;
  }

  return {
    ...init,
    headers,
  };
}

async function fetchWithTimeout(url: string, init: RequestInit | undefined, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const controller = new AbortController();
  const sourceSignal = init?.signal;
  let timedOut = false;

  const onAbortFromSource = () => {
    controller.abort();
  };

  if (sourceSignal) {
    if (sourceSignal.aborted) {
      controller.abort();
    } else {
      sourceSignal.addEventListener("abort", onAbortFromSource, { once: true });
    }
  }

  const timeoutId = globalThis.setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
    });
  } catch (error) {
    if (timedOut) {
      throw new Error(TIMEOUT_MESSAGE);
    }
    throw error;
  } finally {
    globalThis.clearTimeout(timeoutId);
    if (sourceSignal) {
      sourceSignal.removeEventListener("abort", onAbortFromSource);
    }
  }
}

export async function requestJson<T>(url: string, init?: RequestInit, options?: HttpRequestOptions): Promise<T> {
  const response = await fetchWithTimeout(url, withApiInit(init), options?.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    if (text) {
      let parsedMessage = "";
      try {
        const parsed = JSON.parse(text) as { message?: unknown; error?: unknown; field?: unknown };
        if (typeof parsed?.message === "string" && parsed.message.length) {
          parsedMessage = parsed.message;
        } else if (typeof parsed?.error === "string" && parsed.error.length) {
          parsedMessage = parsed.error;
        } else if (response.status === 409 && typeof parsed?.field === "string") {
          if (parsed.field === "availabilityVendorId") {
            parsedMessage = "Availability Vendor ID already exists";
          } else if (parsed.field === "ordersVendorId") {
            parsedMessage = "Orders Vendor ID already exists";
          }
        }
      } catch {}
      if (parsedMessage) throw new Error(parsedMessage);
    }
    throw new Error(text || `HTTP ${response.status}`);
  }
  return response.json() as Promise<T>;
}

export async function requestCsvDownload(url: string, options?: HttpRequestOptions) {
  const response = await fetchWithTimeout(url, withApiInit(), options?.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(text || `HTTP ${response.status}`);
  }

  const blob = await response.blob();
  const contentDisposition = response.headers.get("Content-Disposition") || "";
  const fileNameMatch = contentDisposition.match(/filename="([^"]+)"/i);
  return {
    blob,
    fileName: fileNameMatch?.[1] || "report.csv",
  };
}
