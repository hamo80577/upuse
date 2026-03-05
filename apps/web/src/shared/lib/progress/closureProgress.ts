export function closureProgress(startIso: string | undefined, endIso: string | undefined, nowMs: number) {
  if (!startIso || !endIso) return 0;
  const startMs = new Date(startIso).getTime();
  const endMs = new Date(endIso).getTime();
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return 0;
  if (nowMs <= startMs) return 0;
  if (nowMs >= endMs) return 100;
  const ratio = ((nowMs - startMs) / (endMs - startMs)) * 100;
  return Math.max(0, Math.min(100, ratio));
}

export function hasDeadlinePassed(endIso: string | undefined, nowMs: number) {
  if (!endIso) return false;
  const endMs = new Date(endIso).getTime();
  if (!Number.isFinite(endMs)) return false;
  return nowMs >= endMs;
}
