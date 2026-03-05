export function toUnixMs(iso?: string) {
  if (!iso) return 0;
  const parsed = new Date(iso).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

export function getLatestMonitoringUpdateAt(input: {
  lastOrdersFetchAt?: string;
  lastAvailabilityFetchAt?: string;
  lastHealthyAt?: string;
}) {
  const candidates = [
    input.lastOrdersFetchAt,
    input.lastAvailabilityFetchAt,
    input.lastHealthyAt,
  ];

  let latest: string | undefined;
  let latestMs = 0;

  candidates.forEach((candidate) => {
    const ms = toUnixMs(candidate);
    if (!ms || ms <= latestMs) return;
    latestMs = ms;
    latest = candidate;
  });

  return latest;
}

export function getStaleThresholdMs(input: {
  ordersRefreshSeconds: number;
  availabilityRefreshSeconds: number;
}) {
  return Math.max(input.ordersRefreshSeconds, input.availabilityRefreshSeconds) * 1000;
}

export function getSyncAgeMs(input: {
  latestMonitoringUpdateAt?: string;
  syncClockMs: number;
}) {
  if (!input.latestMonitoringUpdateAt) return 0;
  return Math.max(0, input.syncClockMs - toUnixMs(input.latestMonitoringUpdateAt));
}

export function isSyncStale(input: {
  running: boolean;
  latestMonitoringUpdateAt?: string;
  syncAgeMs: number;
  staleThresholdMs: number;
}) {
  return Boolean(
    input.running &&
      input.latestMonitoringUpdateAt &&
      input.syncAgeMs > input.staleThresholdMs,
  );
}
