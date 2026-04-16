export type OpsSystemId = "upuse" | "scano" | "ops" | "unknown";
export type OpsSessionState = "active" | "idle" | "offline";
export type OpsTelemetryWriteSessionState = Exclude<OpsSessionState, "offline">;
export type OpsEventSeverity = "info" | "warning" | "error" | "critical";
export type OpsEventSource = "frontend" | "backend" | "websocket" | "integration" | "unknown";
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
