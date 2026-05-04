import type {
  MonitorErrorCategory,
  MonitorIssueSource,
  MonitorSourceError,
} from "../../types/models.js";

export type MonitorErrorDetail = {
  statusCode?: number;
  code?: string;
  detail?: string;
  category: MonitorErrorCategory;
  retryable: boolean;
};

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

function isCloudflareTunnelHtml(value: string, title: string) {
  return (
    /cloudflare/i.test(value) ||
    /cloudflare/i.test(title) ||
    /tunnel error/i.test(value) ||
    /cf-error/i.test(value)
  );
}

function summarizeUpstreamErrorDetail(rawDetail: unknown) {
  if (typeof rawDetail !== "string") return undefined;

  const detail = rawDetail.trim();
  if (!detail) return undefined;

  if (looksLikeHtmlDocument(detail)) {
    const title = extractHtmlTitle(detail);

    if (isCloudflareTunnelHtml(detail, title)) {
      return "Cloudflare tunnel error";
    }

    if (title) {
      return `HTML error page: ${title}`;
    }

    return "Unexpected HTML error page";
  }

  const normalized = collapseWhitespace(detail);
  return normalized.length > 220 ? `${normalized.slice(0, 217)}...` : normalized;
}

function getObjectProperty(value: unknown, key: string) {
  if (typeof value !== "object" || value === null || !(key in value)) {
    return undefined;
  }

  return (value as Record<string, unknown>)[key];
}

function getSourceLabel(source: MonitorIssueSource) {
  return source === "availability" ? "Availability" : "Orders";
}

function getSourceFeedLabel(source: MonitorIssueSource) {
  return source === "availability" ? "VSS availability" : "Orders";
}

function getTokenLabel(source: MonitorIssueSource) {
  return source === "availability" ? "Availability API token" : "Orders API token";
}

function extractStatusCode(error: unknown) {
  const response = getObjectProperty(error, "response");
  return typeof getObjectProperty(response, "status") === "number"
    ? getObjectProperty(response, "status") as number
    : undefined;
}

function extractCode(error: unknown) {
  const response = getObjectProperty(error, "response");
  const responseData = getObjectProperty(response, "data");
  const candidates = [
    getObjectProperty(responseData, "code"),
    getObjectProperty(responseData, "errorCode"),
    getObjectProperty(error, "code"),
  ];

  return candidates.find((candidate): candidate is string => typeof candidate === "string" && candidate.trim().length > 0);
}

function extractDetail(error: unknown) {
  const response = getObjectProperty(error, "response");
  const responseData = getObjectProperty(response, "data");
  const responseDetails = getObjectProperty(responseData, "details");
  const candidates = [
    getObjectProperty(responseData, "message"),
    getObjectProperty(responseData, "error"),
    getObjectProperty(responseDetails, "message"),
    typeof responseData === "string" ? responseData : undefined,
    getObjectProperty(error, "message"),
  ];

  return candidates
    .map((value) => summarizeUpstreamErrorDetail(value))
    .find((value) => typeof value === "string" && value.length > 0);
}

function isTimeoutCode(code?: string) {
  const normalized = code?.toUpperCase() ?? "";
  return normalized === "ECONNABORTED" || normalized === "ETIMEDOUT" || normalized === "ERR_SOCKET_CONNECTION_TIMEOUT";
}

function isNetworkCode(code?: string) {
  const normalized = code?.toUpperCase() ?? "";
  return [
    "ECONNRESET",
    "ECONNREFUSED",
    "EAI_AGAIN",
    "ENOTFOUND",
    "ERR_NETWORK",
    "ERR_CONNECTION_CLOSED",
  ].includes(normalized);
}

function classifyMonitorError(error: unknown): Pick<MonitorErrorDetail, "category" | "retryable"> {
  const statusCode = extractStatusCode(error);
  const code = extractCode(error)?.toUpperCase();
  const detail = extractDetail(error)?.toLowerCase() ?? "";

  if (
    code === "UPUSE_AVAILABILITY_TOKEN_MISSING" ||
    code === "UPUSE_ORDERS_TOKEN_MISSING" ||
    detail.includes("token is not configured")
  ) {
    return { category: "token_missing", retryable: false };
  }

  if (statusCode === 401 || statusCode === 403 || detail.includes("unauthorized") || detail.includes("forbidden")) {
    return { category: "auth", retryable: false };
  }

  if (statusCode === 409) {
    return { category: "conflict", retryable: true };
  }

  if (detail.includes("cloudflare tunnel error") || detail.includes("tunnel is temporarily unavailable")) {
    return { category: "tunnel", retryable: true };
  }

  if (code === "UPUSE_AVAILABILITY_MALFORMED_RESPONSE" || detail.includes("malformed payload") || detail.includes("html error page")) {
    return { category: "malformed_response", retryable: true };
  }

  if (isTimeoutCode(code) || detail.includes("timeout")) {
    return { category: "timeout", retryable: true };
  }

  if (isNetworkCode(code) || detail.includes("network error") || detail.includes("socket hang up")) {
    return { category: "network", retryable: true };
  }

  return { category: "upstream", retryable: true };
}

function appendDetail(message: string, detail?: string) {
  if (!detail) return message;
  const normalizedMessage = message.trim();
  const normalizedDetail = detail.trim();
  if (!normalizedDetail || normalizedMessage.toLowerCase().includes(normalizedDetail.toLowerCase())) {
    return normalizedMessage;
  }
  return `${normalizedMessage} ${normalizedDetail}`;
}

function describeStructuredMonitorError(source: MonitorIssueSource, detail: MonitorErrorDetail) {
  const sourceLabel = getSourceLabel(source);
  const sourceFeedLabel = getSourceFeedLabel(source);
  const tokenLabel = getTokenLabel(source);

  switch (detail.category) {
    case "token_missing":
      return {
        summary: `${sourceLabel} token missing`,
        message: `${sourceFeedLabel} sync is blocked because the ${tokenLabel} is not configured.`,
        actionHint: `Open Settings > Tokens to add or test the ${tokenLabel}.`,
      };
    case "auth":
      return {
        summary: `${sourceLabel} authentication failed`,
        message: appendDetail(
          `${sourceFeedLabel} sync is blocked because the upstream rejected the current credentials.`,
          detail.detail,
        ),
        actionHint: `Open Settings > Tokens to update or test the ${tokenLabel}.`,
      };
    case "conflict":
      return {
        summary: `${sourceLabel} request conflict`,
        message: `${sourceFeedLabel} sync hit an upstream conflict${detail.statusCode ? ` (HTTP ${detail.statusCode})` : ""}.`,
        actionHint:
          source === "availability"
            ? "Live availability reads are paused, and temporary close/open writes may also fail until the upstream conflict clears."
            : "Live orders reads are paused until the upstream conflict clears.",
      };
    case "tunnel":
      return {
        summary: `${sourceLabel} tunnel unavailable`,
        message: appendDetail(
          `${sourceFeedLabel} sync could not reach the upstream because a tunnel or edge page was returned instead of API data.`,
          detail.detail,
        ),
        actionHint:
          source === "availability"
            ? "Live availability is paused on the last healthy snapshot until the upstream route responds again."
            : "Cached orders can stay visible for a while, but live counts will drift until the upstream route recovers.",
      };
    case "timeout":
      return {
        summary: `${sourceLabel} request timed out`,
        message: `${sourceFeedLabel} sync did not finish before the request timeout.`,
        actionHint:
          source === "availability"
            ? "Live availability is paused on the last healthy snapshot while the monitor keeps retrying."
            : "Cached orders can still render, but fresh orders data will lag while the monitor keeps retrying.",
      };
    case "network":
      return {
        summary: `${sourceLabel} network error`,
        message: appendDetail(
          `${sourceFeedLabel} sync could not reach the upstream service because of a network problem.`,
          detail.detail,
        ),
        actionHint:
          source === "availability"
            ? "Live availability is paused on the last healthy snapshot while connectivity recovers."
            : "Cached orders can stay available, but fresh orders data will lag until connectivity recovers.",
      };
    case "malformed_response":
      return {
        summary: `${sourceLabel} malformed response`,
        message: appendDetail(
          `${sourceFeedLabel} sync received a response the monitor could not parse safely.`,
          detail.detail,
        ),
        actionHint:
          source === "availability"
            ? "Live availability is paused on the last healthy snapshot until VSS returns valid API data."
            : "Cached orders can stay visible, but fresh orders data will lag until the upstream returns valid API data.",
      };
    case "upstream":
    default:
      return {
        summary: `${sourceLabel} upstream error`,
        message: appendDetail(
          `${sourceFeedLabel} sync failed because the upstream service returned an unexpected error.`,
          detail.detail,
        ),
        actionHint: "The monitor will retry automatically. If the issue continues, verify the upstream service and credentials.",
      };
  }
}

export function getMonitorErrorDetail(error: unknown): MonitorErrorDetail {
  const statusCode = extractStatusCode(error);
  const code = extractCode(error);
  const detail = extractDetail(error);
  const classification = classifyMonitorError(error);

  return {
    statusCode,
    code,
    detail,
    category: classification.category,
    retryable: classification.retryable,
  };
}

export function buildMonitorSourceError(
  source: MonitorIssueSource,
  error: unknown,
  at: string,
): MonitorSourceError {
  const detail = getMonitorErrorDetail(error);
  const copy = describeStructuredMonitorError(source, detail);

  return {
    source,
    category: detail.category,
    summary: copy.summary,
    message: copy.message,
    actionHint: copy.actionHint,
    at,
    statusCode: detail.statusCode,
    retryable: detail.retryable,
  };
}
