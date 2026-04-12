export type MonitorErrorDetail = {
  statusCode?: number;
  detail?: string;
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

function summarizeUpstreamErrorDetail(rawDetail: unknown) {
  if (typeof rawDetail !== "string") return undefined;

  const detail = rawDetail.trim();
  if (!detail) return undefined;

  if (looksLikeHtmlDocument(detail)) {
    const title = extractHtmlTitle(detail);
    const isCloudflareTunnel =
      /cloudflare/i.test(detail) ||
      /cloudflare/i.test(title) ||
      /tunnel error/i.test(detail) ||
      /cf-error/i.test(detail);

    if (isCloudflareTunnel) {
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

export function getMonitorErrorDetail(error: unknown): MonitorErrorDetail {
  const response = getObjectProperty(error, "response");
  const statusCode = typeof getObjectProperty(response, "status") === "number"
    ? getObjectProperty(response, "status") as number
    : undefined;
  const responseData = getObjectProperty(response, "data");
  const responseDetails = getObjectProperty(responseData, "details");
  const candidates = [
    getObjectProperty(responseData, "message"),
    getObjectProperty(responseData, "error"),
    getObjectProperty(responseDetails, "message"),
    typeof responseData === "string" ? responseData : undefined,
    getObjectProperty(error, "message"),
  ];

  const detail = candidates
    .map((value) => summarizeUpstreamErrorDetail(value))
    .find((value) => typeof value === "string" && value.length > 0);

  return { statusCode, detail };
}
