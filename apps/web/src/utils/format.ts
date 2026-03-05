export function fmtInt(n: number) {
  return new Intl.NumberFormat("en-US").format(n ?? 0);
}

export function fmtTimeCairo(isoUtc?: string) {
  if (!isoUtc) return "";
  try {
    const d = new Date(isoUtc);
    return d.toLocaleTimeString("en-GB", { timeZone: "Africa/Cairo", hour: "2-digit", minute: "2-digit" });
  } catch {
    return "";
  }
}

export function fmtCountdown(isoUtc?: string, nowMs = Date.now()) {
  if (!isoUtc) return "";
  const t = new Date(isoUtc).getTime();
  const ms = t - nowMs;
  if (ms <= 0) return "00:00";

  const totalSeconds = Math.ceil(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }

  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}
