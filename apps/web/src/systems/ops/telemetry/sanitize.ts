import type { OpsTelemetryMetadata, OpsTelemetryMetadataValue } from "../api/types";

const MAX_METADATA_KEYS = 20;
const MAX_METADATA_STRING_LENGTH = 500;
const MAX_METADATA_KEY_LENGTH = 80;
const DEFAULT_TEXT_LIMIT = 240;
const SENSITIVE_KEY_PATTERN = /token|password|secret|authorization|cookie|api[_-]?key|apikey/i;

export function redactOpsSensitiveText(value: string) {
  return value
    .replace(/(authorization\s*[:=]\s*bearer\s+)[^\s,;&]+/gi, "$1[redacted]")
    .replace(/((?:token|password|secret|api[_-]?key|cookie)\s*[:=]\s*)[^\s,;&]+/gi, "$1[redacted]")
    .replace(/([?&](?:token|password|secret|api[_-]?key|cookie)=)[^&\s]+/gi, "$1[redacted]");
}

export function truncateOpsText(value: string, maxLength = DEFAULT_TEXT_LIMIT) {
  return value.length > maxLength ? value.slice(0, maxLength) : value;
}

export function sanitizeOpsText(value: unknown, maxLength = DEFAULT_TEXT_LIMIT) {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return truncateOpsText(redactOpsSensitiveText(trimmed), maxLength);
}

function sanitizeMetadataValue(value: unknown): OpsTelemetryMetadataValue | undefined {
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value === "string") return sanitizeOpsText(value, MAX_METADATA_STRING_LENGTH);
  return undefined;
}

export function sanitizeOpsMetadata(input: unknown): OpsTelemetryMetadata {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return {};
  }

  const sanitized: OpsTelemetryMetadata = {};
  for (const [key, value] of Object.entries(input).slice(0, MAX_METADATA_KEYS)) {
    const normalizedKey = key.trim();
    if (!normalizedKey || normalizedKey.length > MAX_METADATA_KEY_LENGTH || SENSITIVE_KEY_PATTERN.test(normalizedKey)) {
      continue;
    }

    const sanitizedValue = sanitizeMetadataValue(value);
    if (sanitizedValue !== undefined) {
      sanitized[normalizedKey] = sanitizedValue;
    }
  }

  return sanitized;
}

export function sanitizeOpsPath(value: unknown, maxLength = DEFAULT_TEXT_LIMIT) {
  const text = sanitizeOpsText(value, maxLength);
  if (!text) return undefined;

  try {
    const baseUrl = typeof window === "undefined" ? "http://localhost" : window.location.origin;
    const url = new URL(text, baseUrl);
    return truncateOpsText(url.pathname || "/", maxLength);
  } catch {
    const stripped = text.split(/[?#]/, 1)[0]?.trim();
    return stripped ? truncateOpsText(stripped, maxLength) : undefined;
  }
}

export function sanitizeOpsStack(value: unknown) {
  return sanitizeOpsText(value, 2_000);
}
