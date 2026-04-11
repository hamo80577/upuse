export function extractCancellationOwner(payload: unknown) {
  const owner = (payload as { cancellation?: { owner?: unknown } } | null | undefined)?.cancellation?.owner;
  if (typeof owner !== "string") return null;
  const normalized = owner.trim().toUpperCase();
  return normalized.length ? normalized : null;
}

function extractCancellationText(payload: unknown, key: "reason" | "stage" | "source") {
  const value = (payload as { cancellation?: Record<string, unknown> } | null | undefined)?.cancellation?.[key];
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized.length ? normalized : null;
}

function extractCancellationIso(payload: unknown, key: "createdAt" | "updatedAt") {
  const value = (payload as { cancellation?: Record<string, unknown> } | null | undefined)?.cancellation?.[key];
  return typeof value === "string" && value.trim().length ? value.trim() : null;
}

export function extractCancellationDetail(payload: unknown) {
  return {
    owner: extractCancellationOwner(payload),
    reason: extractCancellationText(payload, "reason"),
    stage: extractCancellationText(payload, "stage"),
    source: extractCancellationText(payload, "source"),
    createdAt: extractCancellationIso(payload, "createdAt"),
    updatedAt: extractCancellationIso(payload, "updatedAt"),
  };
}

export function normalizeLookupError(error: any) {
  const status = typeof error?.response?.status === "number" ? error.response.status : null;
  const responseMessage =
    typeof error?.response?.data?.message === "string" && error.response.data.message.trim().length
      ? error.response.data.message.trim()
      : null;
  const baseMessage =
    responseMessage ||
    (typeof error?.message === "string" && error.message.trim().length ? error.message.trim() : "Cancellation lookup failed.");

  return {
    status,
    message: status ? `HTTP ${status}: ${baseMessage}` : baseMessage,
  };
}
