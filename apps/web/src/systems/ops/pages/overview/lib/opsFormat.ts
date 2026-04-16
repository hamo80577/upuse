import type { OpsEventSeverity, OpsHealthStatus, OpsSessionState, OpsSystemId } from "../../../api/types";

export function formatOpsNumber(value: number) {
  return value.toLocaleString("en-US");
}

export function formatOpsRate(value: number) {
  if (!Number.isFinite(value)) return "0.0";
  return value < 10 ? value.toFixed(1) : Math.round(value).toLocaleString("en-US");
}

export function formatOpsDateTime(value: string | null | undefined) {
  if (!value) return "No data";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString("en-GB", {
    timeZone: "Africa/Cairo",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatOpsRelativeTime(value: string | null | undefined, now = Date.now()) {
  if (!value) return "No activity";
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return value;
  const diffSeconds = Math.max(0, Math.round((now - parsed) / 1000));
  if (diffSeconds < 45) return "just now";
  const minutes = Math.round(diffSeconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

export function formatOpsDuration(start: string | null | undefined, end: string | null | undefined, now = Date.now()) {
  if (!start) return "Unknown";
  const startMs = Date.parse(start);
  const endMs = end ? Date.parse(end) : now;
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return "Unknown";
  const totalMinutes = Math.max(0, Math.round((endMs - startMs) / 60_000));
  if (totalMinutes < 60) return `${totalMinutes}m`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes ? `${hours}h ${minutes}m` : `${hours}h`;
}

export function systemLabel(system: OpsSystemId | string | null | undefined) {
  switch (system) {
    case "upuse":
      return "UPuse";
    case "scano":
      return "Scano";
    case "ops":
      return "Ops";
    default:
      return "Unknown";
  }
}

export function stateLabel(state: OpsSessionState | string | null | undefined) {
  switch (state) {
    case "active":
      return "Active";
    case "idle":
      return "Idle";
    case "offline":
      return "Offline";
    default:
      return "Unknown";
  }
}

export function severityLabel(severity: OpsEventSeverity | string | null | undefined) {
  switch (severity) {
    case "critical":
      return "Critical";
    case "error":
      return "Error";
    case "warning":
      return "Warning";
    case "info":
      return "Info";
    default:
      return "Unknown";
  }
}

export function healthStatusLabel(status: OpsHealthStatus | string | null | undefined) {
  switch (status) {
    case "healthy":
      return "Healthy";
    case "degraded":
      return "Degraded";
    case "critical":
      return "Critical";
    default:
      return "Unknown";
  }
}

export function systemColor(system: OpsSystemId | string | null | undefined) {
  switch (system) {
    case "upuse":
      return "#2563eb";
    case "scano":
      return "#0f766e";
    case "ops":
      return "#be123c";
    default:
      return "#64748b";
  }
}

export function stateColor(state: OpsSessionState | string | null | undefined) {
  switch (state) {
    case "active":
      return "#16a34a";
    case "idle":
      return "#ca8a04";
    case "offline":
      return "#64748b";
    default:
      return "#64748b";
  }
}

export function severityColor(severity: OpsEventSeverity | string | null | undefined) {
  switch (severity) {
    case "critical":
      return "#b91c1c";
    case "error":
      return "#dc2626";
    case "warning":
      return "#ca8a04";
    case "info":
      return "#2563eb";
    default:
      return "#64748b";
  }
}

export function healthStatusColor(status: OpsHealthStatus | string | null | undefined) {
  switch (status) {
    case "healthy":
      return "#15803d";
    case "degraded":
      return "#ca8a04";
    case "critical":
      return "#dc2626";
    default:
      return "#64748b";
  }
}
