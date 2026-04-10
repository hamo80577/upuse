export function fmtPlacedAt(iso?: string) {
  if (!iso) return "--";
  try {
    return new Date(iso).toLocaleTimeString("en-GB", {
      timeZone: "Africa/Cairo",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "--";
  }
}

export function fmtSignedPickupDiff(iso: string | undefined, nowMs: number) {
  if (!iso) return { text: "--", positive: true };
  const diffMs = new Date(iso).getTime() - nowMs;
  const positive = diffMs >= 0;
  const totalSeconds = Math.floor(Math.abs(diffMs) / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const core =
    hours > 0
      ? `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
      : `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  return { text: `${positive ? "+" : "-"}${core}`, positive };
}

export function fmtElapsedDuration(iso: string | undefined, nowMs: number) {
  if (!iso) return "--";
  const startMs = new Date(iso).getTime();
  if (Number.isNaN(startMs)) return "--";
  const diffMs = Math.max(0, nowMs - startMs);
  const totalSeconds = Math.floor(diffMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return hours > 0
    ? `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
    : `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}
