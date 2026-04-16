import type { SettingsTokenTestSnapshot, SettingsTokenTestStartResponse } from "../../../api/types";

export type OpsSystemId = "upuse" | "scano" | "ops" | "unknown";
export type OpsSessionState = "active" | "idle" | "offline";
export type OpsTelemetryWriteSessionState = Exclude<OpsSessionState, "offline">;
export type OpsEventSeverity = "info" | "warning" | "error" | "critical";
export type OpsEventSource = "frontend" | "backend" | "websocket" | "integration" | "unknown";
export type OpsHealthStatus = "healthy" | "degraded" | "critical";
export type OpsTelemetryEventType =
  | "page_view"
  | "route_change"
  | "heartbeat"
  | "user_active"
  | "user_idle"
  | "api_request"
  | "api_error"
  | "js_error"
  | "unhandled_rejection"
  | "dashboard_opened"
  | "performance_opened"
  | "settings_opened"
  | "token_test_started"
  | "token_test_finished";

export type OpsTelemetryMetadataValue = string | number | boolean | null;
export type OpsTelemetryMetadata = Record<string, OpsTelemetryMetadataValue>;

export interface OpsTelemetrySessionPayload {
  sessionId?: string;
  system?: OpsSystemId;
  path?: string;
  state?: OpsTelemetryWriteSessionState;
  referrer?: string;
  source?: string;
  userAgent?: string;
  occurredAt?: string;
}

export interface OpsTelemetryErrorPayload {
  message: string;
  name?: string;
  code?: string;
  statusCode?: number;
  source?: OpsEventSource;
  severity?: OpsEventSeverity;
  stack?: string;
  signature?: string;
  metadata?: OpsTelemetryMetadata;
}

export interface OpsTelemetryEventPayload {
  type: OpsTelemetryEventType;
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
  metadata?: OpsTelemetryMetadata;
  error?: OpsTelemetryErrorPayload;
}

export interface OpsTelemetryIngestPayload {
  session?: OpsTelemetrySessionPayload;
  events: OpsTelemetryEventPayload[];
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

export interface OpsTelemetryHeartbeatResponse {
  ok: true;
  sessionId: string;
  session: OpsSessionItem;
}

export interface OpsTelemetryEndResponse {
  ok: true;
  sessionId?: string;
  ended?: boolean;
}

export interface OpsTelemetryIngestResponse {
  ok: true;
  sessionId: string;
  accepted: {
    events: number;
    errors: number;
  };
}

export interface OpsPaginationMeta {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface OpsKpi {
  key: string;
  label: string;
  value: number;
  previousValue: number;
  delta: number;
  direction: "up" | "down" | "flat";
  status: "good" | "warning" | "neutral";
}

export interface OpsBucket {
  key: string;
  count: number;
}

export interface OpsTopPage {
  path: string;
  views: number;
  uniqueSessions: number;
}

export interface OpsTopEventType {
  type: OpsTelemetryEventType;
  count: number;
}

export interface OpsSummaryTopError {
  signature: string;
  message: string;
  severity: OpsEventSeverity;
  count: number;
  lastSeenAt: string;
}

export interface OpsQualityFactor {
  key: string;
  label: string;
  status: OpsHealthStatus;
  penalty: number;
  value: number | null;
  unit: string;
  detail: string;
  threshold: number | null;
}

export interface OpsQualityAlert {
  id: string;
  severity: "info" | "warning" | "critical";
  subsystem: "overall" | "dashboard" | "performance" | "api" | "frontend" | "monitor" | "token" | "telemetry";
  title: string;
  message: string;
  metric: string;
  value: number | null;
  threshold: number | null;
  createdAt: string;
}

export interface OpsQualitySummary {
  score: number;
  status: OpsHealthStatus;
  factors: OpsQualityFactor[];
  trend: {
    previousScore: number;
    delta: number;
    direction: "up" | "down" | "flat";
  };
  metrics: {
    apiFailureRate: number;
    runtimeErrorRate: number;
    p95LatencyMs: number | null;
    websocketFailures: number;
    telemetryAgeMinutes: number | null;
    tokenTestFailures: number;
  };
}

export interface OpsSubsystemHealth {
  label: string;
  status: OpsHealthStatus;
  score: number;
  message: string;
}

export interface OpsDashboardSubsystemHealth extends OpsSubsystemHealth {
  monitorRunning: boolean;
  monitorDegraded: boolean;
  ordersSyncState: string;
  staleBranchCount: number;
  failures: number;
  websocketFailures: number;
  p95LatencyMs: number | null;
  lastHealthyAt: string | null;
}

export interface OpsPerformanceSubsystemHealth extends OpsSubsystemHealth {
  failures: number;
  apiFailureCount: number;
  websocketFailures: number;
  p95LatencyMs: number | null;
  lastOpenedAt: string | null;
}

export interface OpsTelemetrySubsystemHealth extends OpsSubsystemHealth {
  lastSignalAt: string | null;
  ageMinutes: number | null;
  websocketFailures: number;
}

export interface OpsSummaryResponse {
  ok: true;
  generatedAt: string;
  freshness: {
    sessionsLastSeenAt: string | null;
    eventsLastSeenAt: string | null;
    errorsLastSeenAt: string | null;
  };
  windows: {
    current: {
      startUtcIso: string;
      endUtcIso: string;
    };
    previous: {
      startUtcIso: string;
      endUtcIso: string;
    };
    today: {
      startUtcIso: string;
      endUtcIso: string;
    };
    timezone: string;
  };
  counts: {
    onlineUsers: number;
    activeUsers: number;
    idleUsers: number;
    sessionsToday: number;
    pageViewsToday: number;
    errorCountToday: number;
    apiRequestCount: number;
    apiFailureCount: number;
  };
  kpis: OpsKpi[];
  statusBuckets: {
    sessionsByState: OpsBucket[];
    sessionsBySystem: OpsBucket[];
    apiStatus: OpsBucket[];
  };
  errorBuckets: {
    bySeverity: OpsBucket[];
    bySource: OpsBucket[];
    top: OpsSummaryTopError[];
  };
  topPages: OpsTopPage[];
  topEventTypes: OpsTopEventType[];
  health: {
    dashboard: {
      name?: string;
      live?: boolean;
      ready?: boolean;
      readiness?: {
        state?: string;
        message?: string;
      };
      monitorRunning?: boolean;
      monitorDegraded?: boolean;
      lastSnapshotAt?: string | null;
      lastErrorAt?: string | null;
      ordersSync?: {
        mode?: string;
        state?: string;
        staleBranchCount?: number;
        consecutiveSourceFailures?: number;
        lastSuccessfulSyncAt?: string | null;
      };
    };
    performance: {
      status: "good" | "warning" | "critical";
      lastOpenedAt: string | null;
      errorCount: number;
      apiFailureCount: number;
      websocketFailureCount: number;
      p95LatencyMs: number | null;
    };
  };
  quality: OpsQualitySummary;
  alerts: OpsQualityAlert[];
  subsystems: {
    dashboard: OpsDashboardSubsystemHealth;
    performance: OpsPerformanceSubsystemHealth;
    telemetry: OpsTelemetrySubsystemHealth;
  };
}

export interface OpsEventItem {
  id: number;
  sessionId: string | null;
  userId: number | null;
  eventType: OpsTelemetryEventType;
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
  metadata: OpsTelemetryMetadata;
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
  sampleMetadata: OpsTelemetryMetadata;
  createdAt: string;
  updatedAt: string;
}

export interface OpsPageResponse<TItem> {
  items: TItem[];
  meta: OpsPaginationMeta;
}

export interface OpsSummaryQuery {
  windowMinutes?: number;
}

export interface OpsListQuery {
  page?: number;
  pageSize?: number;
  system?: OpsSystemId;
  state?: OpsSessionState;
  type?: OpsTelemetryEventType;
  source?: OpsEventSource;
  severity?: OpsEventSeverity;
  sessionId?: string;
  from?: string;
  to?: string;
  query?: string;
}

export type OpsManagedTokenId = "upuse_orders" | "upuse_availability" | "scano_catalog";

export interface OpsManagedToken {
  id: OpsManagedTokenId;
  label: string;
  system: Extract<OpsSystemId, "upuse" | "scano">;
  description: string;
  configured: boolean;
  mask: string;
  updatedAt: string | null;
}

export interface OpsTokensResponse {
  ok: true;
  tokens: OpsManagedToken[];
}

export interface OpsTokenUpdatePayload {
  upuseOrdersToken?: string;
  upuseAvailabilityToken?: string;
  scanoCatalogToken?: string;
}

export interface OpsTokenTestPayload extends OpsTokenUpdatePayload {
  targets?: Array<"upuse" | "scano">;
}

export interface OpsScanoTokenTestResult {
  ok: boolean;
  status?: number | null;
  message: string;
  baseUrl?: string | null;
}

export interface OpsTokenTestResponse {
  ok: true;
  upuse?: SettingsTokenTestStartResponse;
  scano?: OpsScanoTokenTestResult;
}

export interface OpsTokenTestSnapshotResponse {
  ok: true;
  snapshot: SettingsTokenTestSnapshot;
}
