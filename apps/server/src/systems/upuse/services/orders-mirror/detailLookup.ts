function getObjectProperty(value: unknown, key: string) {
  if (typeof value !== "object" || value === null || !(key in value)) {
    return undefined;
  }

  return (value as Record<string, unknown>)[key];
}

export function extractCancellationOwner(payload: unknown) {
  const cancellation = getObjectProperty(payload, "cancellation");
  const owner = getObjectProperty(cancellation, "owner");
  if (typeof owner !== "string") return null;
  const normalized = owner.trim().toUpperCase();
  return normalized.length ? normalized : null;
}

function extractCancellationText(payload: unknown, key: "reason" | "stage" | "source") {
  const cancellation = getObjectProperty(payload, "cancellation");
  const value = getObjectProperty(cancellation, key);
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized.length ? normalized : null;
}

function extractCancellationIso(payload: unknown, key: "createdAt" | "updatedAt") {
  const cancellation = getObjectProperty(payload, "cancellation");
  const value = getObjectProperty(cancellation, key);
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

export function normalizeLookupError(error: unknown) {
  const response = getObjectProperty(error, "response");
  const responseData = getObjectProperty(response, "data");
  const status = typeof getObjectProperty(response, "status") === "number"
    ? getObjectProperty(response, "status") as number
    : null;
  const responseMessage =
    typeof getObjectProperty(responseData, "message") === "string" && (getObjectProperty(responseData, "message") as string).trim().length
      ? (getObjectProperty(responseData, "message") as string).trim()
      : null;
  const baseMessage =
    responseMessage ||
    (typeof getObjectProperty(error, "message") === "string" && (getObjectProperty(error, "message") as string).trim().length
      ? (getObjectProperty(error, "message") as string).trim()
      : "Cancellation lookup failed.");

  return {
    status,
    message: status ? `HTTP ${status}: ${baseMessage}` : baseMessage,
  };
}
