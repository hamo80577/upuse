import axios from "axios";

export function resolveOrdersHttpTimeoutMs() {
  const raw = Number(process.env.UPUSE_ORDERS_HTTP_TIMEOUT_MS ?? "25000");
  if (!Number.isFinite(raw)) return 25_000;
  return Math.max(5_000, Math.min(120_000, Math.floor(raw)));
}

export function isRetryableOrdersRequestError(error: any) {
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

export async function getWithRetry(url: string, headers: Record<string, string>, retries = 2) {
  let lastErr: any;
  const timeoutMs = resolveOrdersHttpTimeoutMs();
  for (let index = 0; index <= retries; index += 1) {
    try {
      return await axios.get(url, { headers, timeout: timeoutMs });
    } catch (error: any) {
      lastErr = error;
      const backoff = 400 * Math.pow(2, index);
      if (index < retries && isRetryableOrdersRequestError(error)) {
        await new Promise((resolve) => setTimeout(resolve, backoff));
        continue;
      }
      break;
    }
  }
  throw lastErr;
}
