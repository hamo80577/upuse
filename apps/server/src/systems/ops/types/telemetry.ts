export const OPS_SYSTEM_IDS = ["upuse", "scano", "ops", "unknown"] as const;
export const OPS_SESSION_STATES = ["active", "idle", "offline"] as const;
export const OPS_EVENT_TYPES = [
  "page_view",
  "route_change",
  "heartbeat",
  "user_active",
  "user_idle",
  "api_request",
  "api_error",
  "js_error",
  "unhandled_rejection",
  "dashboard_opened",
  "performance_opened",
  "settings_opened",
  "token_test_started",
  "token_test_finished",
] as const;
export const OPS_EVENT_SEVERITIES = ["info", "warning", "error", "critical"] as const;
export const OPS_EVENT_SOURCES = ["frontend", "backend", "websocket", "integration", "unknown"] as const;

export type OpsSystemId = typeof OPS_SYSTEM_IDS[number];
export type OpsSessionState = typeof OPS_SESSION_STATES[number];
export type OpsEventType = typeof OPS_EVENT_TYPES[number];
export type OpsEventSeverity = typeof OPS_EVENT_SEVERITIES[number];
export type OpsEventSource = typeof OPS_EVENT_SOURCES[number];
export type OpsMetadataValue = string | number | boolean | null;
export type OpsMetadata = Record<string, OpsMetadataValue>;
export type OpsUsageSatisfactionStatus = "positive" | "mixed" | "friction";

export interface OpsSessionInput {
  sessionId?: string;
  system?: OpsSystemId;
  path?: string;
  state?: Exclude<OpsSessionState, "offline">;
  referrer?: string;
  source?: string;
  userAgent?: string;
  occurredAt?: string;
}

export interface OpsTelemetryErrorInput {
  message: string;
  name?: string;
  code?: string;
  statusCode?: number;
  source?: OpsEventSource;
  severity?: OpsEventSeverity;
  stack?: string;
  signature?: string;
  metadata?: OpsMetadata;
}

export interface OpsTelemetryEventInput {
  type: OpsEventType;
  occurredAt?: string;
  system?: OpsSystemId;
  path?: string;
  routePattern?: string;
  pageTitle?: string;
  endpoint?: string;
  method?: string;
  statusCode?: number;
  durationMs?: number;
  success?: boolean;
  source?: OpsEventSource;
  severity?: OpsEventSeverity;
  metadata?: OpsMetadata;
  error?: OpsTelemetryErrorInput;
}

export interface OpsSessionItem {
  id: string;
  userId: number | null;
  userEmail: string | null;
  userName: string | null;
  currentSystem: OpsSystemId;
  currentPath: string | null;
  referrer: string | null;
  source: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
  lastActiveAt: string | null;
  endedAt: string | null;
  state: OpsSessionState;
  userAgentSummary: string | null;
  browserSummary: string | null;
  deviceSummary: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface OpsEventItem {
  id: number;
  sessionId: string | null;
  userId: number | null;
  eventType: OpsEventType;
  category: string;
  system: OpsSystemId;
  path: string | null;
  routePattern: string | null;
  pageTitle: string | null;
  endpoint: string | null;
  method: string | null;
  statusCode: number | null;
  durationMs: number | null;
  success: boolean | null;
  source: OpsEventSource;
  severity: OpsEventSeverity;
  occurredAt: string;
  createdAt: string;
  metadata: OpsMetadata;
}

export interface OpsErrorItem {
  id: number;
  signature: string;
  source: OpsEventSource;
  severity: OpsEventSeverity;
  system: OpsSystemId;
  path: string | null;
  routePattern: string | null;
  message: string;
  code: string | null;
  statusCode: number | null;
  stackFingerprint: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
  count: number;
  lastEventId: number | null;
  lastSessionId: string | null;
  lastUserId: number | null;
  sampleMetadata: OpsMetadata;
  createdAt: string;
  updatedAt: string;
}

export interface OpsPaginationMeta {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface OpsUsageSatisfactionSignal {
  score: number;
  status: OpsUsageSatisfactionStatus;
  note: string;
}

export interface OpsUsageDaySatisfactionSummary extends OpsUsageSatisfactionSignal {
  positiveUsers: number;
  mixedUsers: number;
  frictionUsers: number;
}

export interface OpsUsageHistoryUserReport {
  userId: number | null;
  userEmail: string | null;
  userName: string | null;
  systems: OpsSystemId[];
  sessionCount: number;
  pageViews: number;
  totalDurationMs: number;
  averageSessionDurationMs: number;
  topPage: string | null;
  topPageViews: number;
  errorCount: number;
  satisfaction: OpsUsageSatisfactionSignal;
}

export interface OpsUsageHistoryDaySummary {
  dayKey: string;
  label: string;
  startUtcIso: string;
  endUtcExclusiveIso: string;
  uniqueUsers: number;
  sessionCount: number;
  pageViews: number;
  totalDurationMs: number;
  averageSessionDurationMs: number;
  topPage: string | null;
  topPageViews: number;
  usersWithErrors: number;
  satisfaction: OpsUsageDaySatisfactionSummary;
}

export interface OpsUsageHistoryDayDetail extends OpsUsageHistoryDaySummary {
  users: OpsUsageHistoryUserReport[];
}

export interface OpsUsageHistoryResponse {
  ok: true;
  generatedAt: string;
  timezone: string;
  selectedDayKey: string | null;
  days: OpsUsageHistoryDaySummary[];
  selectedDay: OpsUsageHistoryDayDetail | null;
}
