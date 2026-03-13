const DEFAULT_TIMEOUT_MS = 25_000;
const TIMEOUT_MESSAGE = "Request timed out. Please try again.";
export const AUTH_UNAUTHORIZED_EVENT = "upuse:auth:unauthorized";

function collapseWhitespace(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function stripHtmlTags(value: string) {
  return collapseWhitespace(
    value
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " "),
  );
}

function extractHtmlTitle(value: string) {
  const match = value.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return match ? stripHtmlTags(match[1]) : "";
}

function looksLikeHtmlDocument(value: string) {
  const sample = value.trim();
  if (!sample) return false;

  return (
    sample.startsWith("<!doctype html") ||
    sample.startsWith("<!DOCTYPE html") ||
    sample.startsWith("<html") ||
    /<html[\s>]/i.test(sample) ||
    /<head[\s>]/i.test(sample) ||
    /<body[\s>]/i.test(sample)
  );
}

function normalizeApiErrorMessage(rawMessage: string, fallback = "Request failed") {
  const message = rawMessage.trim();
  if (!message) return fallback;

  if (looksLikeHtmlDocument(message)) {
    const title = extractHtmlTitle(message);
    const isCloudflareTunnel =
      /cloudflare/i.test(message) ||
      /cloudflare/i.test(title) ||
      /tunnel error/i.test(message) ||
      /cf-error/i.test(message);

    if (isCloudflareTunnel) {
      return "Cloudflare tunnel is temporarily unavailable. Please try again in a moment.";
    }

    if (title) {
      return `The server returned an HTML error page (${title}). Please try again.`;
    }

    return "The server returned an unexpected HTML error page. Please try again.";
  }

  return collapseWhitespace(message);
}

export interface HttpRequestOptions {
  timeoutMs?: number;
}

export interface JsonEventStreamOptions {
  signal?: AbortSignal;
  init?: RequestInit;
  onOpen?: () => void;
  onMessage: (eventName: string, data: unknown) => void;
}

export interface JsonWebSocketOptions {
  signal?: AbortSignal;
  onOpen?: () => void;
  onMessage: (eventName: string, data: unknown) => void;
}

export function describeApiError(error: unknown, fallback = "Request failed") {
  if (error instanceof Error && error.message.trim()) {
    if (error.message === "Unauthorized") {
      return "Sign in again to access protected routes.";
    }

    return normalizeApiErrorMessage(error.message, fallback);
  }

  return fallback;
}

function withApiInit(init?: RequestInit): RequestInit | undefined {
  const headers = new Headers(init?.headers);
  return {
    ...init,
    credentials: init?.credentials ?? "same-origin",
    headers,
  };
}

function notifyUnauthorized() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(AUTH_UNAUTHORIZED_EVENT));
}

async function createResponseError(response: Response, requestUrl?: string) {
  if (response.status === 401 && requestUrl !== "/api/auth/login") {
    notifyUnauthorized();
  }

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
      return new Error(normalizeApiErrorMessage(parsedMessage, `HTTP ${response.status}`));
    }
  }

  return new Error(normalizeApiErrorMessage(text, `HTTP ${response.status}`));
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

function createAbortError() {
  const error = new Error("Aborted");
  error.name = "AbortError";
  return error;
}

function resolveWebSocketUrl(url: string) {
  if (/^wss?:\/\//i.test(url)) {
    return url;
  }

  if (/^https?:\/\//i.test(url)) {
    const resolved = new URL(url);
    resolved.protocol = resolved.protocol === "https:" ? "wss:" : "ws:";
    return resolved.toString();
  }

  if (typeof window === "undefined") {
    throw new Error("WebSocket URLs require a browser context.");
  }

  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return new URL(url, `${protocol}//${window.location.host}`).toString();
}

export async function requestJson<T>(url: string, init?: RequestInit, options?: HttpRequestOptions): Promise<T> {
  const response = await fetchWithTimeout(url, withApiInit(init), options?.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  if (!response.ok) {
    throw await createResponseError(response, url);
  }

  const responseClone = response.clone();
  try {
    return await response.json() as T;
  } catch {
    const text = await responseClone.text().catch(() => "");
    throw new Error(normalizeApiErrorMessage(text, "The server returned invalid API data. Please try again."));
  }
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
    throw await createResponseError(response, url);
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

export async function requestJsonWebSocket(url: string, options: JsonWebSocketOptions) {
  return new Promise<void>((resolve, reject) => {
    if (typeof WebSocket === "undefined") {
      reject(new Error("Streaming is not supported in this browser."));
      return;
    }

    const socket = new WebSocket(resolveWebSocketUrl(url));
    let opened = false;
    let settled = false;
    let closingDueToAbort = false;
    let socketError: Error | null = null;

    const cleanup = () => {
      if (options.signal) {
        options.signal.removeEventListener("abort", onAbort);
      }
      socket.removeEventListener("open", onOpen);
      socket.removeEventListener("message", onMessage);
      socket.removeEventListener("error", onError);
      socket.removeEventListener("close", onClose);
    };

    const finishResolve = () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve();
    };

    const finishReject = (error: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };

    const onAbort = () => {
      closingDueToAbort = true;
      try {
        socket.close(1000, "Client aborted");
      } catch {}
      finishReject(createAbortError());
    };

    const onOpen = () => {
      opened = true;
      options.onOpen?.();
    };

    const onMessage = (event: MessageEvent<string>) => {
      try {
        const parsed = JSON.parse(event.data) as { type?: unknown; data?: unknown };
        if (typeof parsed?.type !== "string") {
          throw new Error("The server returned invalid live update data.");
        }

        options.onMessage(parsed.type, parsed.data);
      } catch (error) {
        socketError = error instanceof Error ? error : new Error("The server returned invalid live update data.");
        try {
          socket.close(1003, "Invalid message");
        } catch {}
      }
    };

    const onError = () => {
      socketError = socketError ?? new Error("Live WebSocket connection failed.");
    };

    const onClose = (event: CloseEvent) => {
      if (settled) return;
      if (closingDueToAbort) {
        finishReject(createAbortError());
        return;
      }

      const reason = normalizeApiErrorMessage(event.reason, "");
      if (reason) {
        finishReject(new Error(reason));
        return;
      }

      if (socketError) {
        finishReject(socketError);
        return;
      }

      if (!opened && event.code !== 1000) {
        finishReject(new Error("Live WebSocket connection failed."));
        return;
      }

      finishResolve();
    };

    if (options.signal) {
      if (options.signal.aborted) {
        finishReject(createAbortError());
        return;
      }

      options.signal.addEventListener("abort", onAbort, { once: true });
    }

    socket.addEventListener("open", onOpen);
    socket.addEventListener("message", onMessage as EventListener);
    socket.addEventListener("error", onError);
    socket.addEventListener("close", onClose as EventListener);
  });
}

export async function requestCsvDownload(url: string, options?: HttpRequestOptions) {
  const response = await fetchWithTimeout(url, withApiInit(), options?.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(normalizeApiErrorMessage(text, `HTTP ${response.status}`));
  }

  const blob = await response.blob();
  const contentDisposition = response.headers.get("Content-Disposition") || "";
  const fileNameMatch = contentDisposition.match(/filename="([^"]+)"/i);
  return {
    blob,
    fileName: fileNameMatch?.[1] || "report.csv",
  };
}
