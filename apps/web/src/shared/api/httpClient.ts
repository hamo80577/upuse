import { getStoredAdminKey } from "./adminKeyStorage";

const DEFAULT_TIMEOUT_MS = 25_000;
const TIMEOUT_MESSAGE = "Request timed out. Please try again.";

export interface HttpRequestOptions {
  timeoutMs?: number;
}

export interface JsonEventStreamOptions {
  signal?: AbortSignal;
  init?: RequestInit;
  onOpen?: () => void;
  onMessage: (eventName: string, data: unknown) => void;
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

async function createResponseError(response: Response) {
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

    if (parsedMessage) {
      return new Error(parsedMessage);
    }
  }

  return new Error(text || `HTTP ${response.status}`);
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
    throw await createResponseError(response);
  }
  return response.json() as Promise<T>;
}

function parseSseMessage(rawMessage: string) {
  const lines = rawMessage.split("\n");
  let eventName = "message";
  const dataLines: string[] = [];

  for (const line of lines) {
    if (!line || line.startsWith(":")) continue;
    const separatorIndex = line.indexOf(":");
    const field = separatorIndex === -1 ? line : line.slice(0, separatorIndex);
    let value = separatorIndex === -1 ? "" : line.slice(separatorIndex + 1);
    if (value.startsWith(" ")) {
      value = value.slice(1);
    }

    if (field === "event") {
      eventName = value || "message";
    } else if (field === "data") {
      dataLines.push(value);
    }
  }

  if (!dataLines.length) return null;
  return {
    eventName,
    data: dataLines.join("\n"),
  };
}

function dispatchBufferedSseMessages(bufferRef: { current: string }, onMessage: JsonEventStreamOptions["onMessage"]) {
  bufferRef.current = bufferRef.current.replace(/\r\n/g, "\n");

  while (bufferRef.current.includes("\n\n")) {
    const separatorIndex = bufferRef.current.indexOf("\n\n");
    const rawMessage = bufferRef.current.slice(0, separatorIndex);
    bufferRef.current = bufferRef.current.slice(separatorIndex + 2);
    const message = parseSseMessage(rawMessage);
    if (!message) continue;
    onMessage(message.eventName, JSON.parse(message.data));
  }
}

export async function requestJsonEventStream(url: string, options: JsonEventStreamOptions) {
  const streamInit = options.signal
    ? {
        ...options.init,
        signal: options.signal,
      }
    : options.init;
  const response = await fetch(url, withApiInit(streamInit));
  if (!response.ok) {
    throw await createResponseError(response);
  }

  if (!response.body || typeof response.body.getReader !== "function") {
    throw new Error("Streaming is not supported in this browser.");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const bufferRef = { current: "" };

  options.onOpen?.();

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bufferRef.current += decoder.decode(value, { stream: true });
      dispatchBufferedSseMessages(bufferRef, options.onMessage);
    }

    bufferRef.current += decoder.decode();
    bufferRef.current = bufferRef.current.trim();
    if (bufferRef.current.length) {
      const message = parseSseMessage(bufferRef.current);
      if (message) {
        options.onMessage(message.eventName, JSON.parse(message.data));
      }
    }
  } finally {
    reader.releaseLock();
  }
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
