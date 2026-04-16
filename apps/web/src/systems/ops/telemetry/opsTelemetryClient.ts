import type { ApiFailureTelemetry } from "../../../shared/api/httpClient";
import { opsApi } from "../api/endpoints";
import type {
  OpsEventSeverity,
  OpsEventSource,
  OpsSystemId,
  OpsTelemetryErrorPayload,
  OpsTelemetryEventPayload,
  OpsTelemetryEventType,
  OpsTelemetryIngestPayload,
  OpsTelemetrySessionPayload,
  OpsTelemetryWriteSessionState,
} from "../api/types";
import type { OpsTelemetryRouteContext } from "./routeContext";
import { sanitizeOpsMetadata, sanitizeOpsPath, sanitizeOpsStack, sanitizeOpsText } from "./sanitize";

export const OPS_TELEMETRY_SESSION_STORAGE_KEY = "upuse.ops.telemetry.session-id";
export const OPS_TELEMETRY_HEARTBEAT_MS = 20_000;
export const OPS_TELEMETRY_IDLE_AFTER_MS = 120_000;
export const OPS_TELEMETRY_FLUSH_MS = 5_000;
export const OPS_TELEMETRY_BATCH_SIZE = 25;
export const OPS_TELEMETRY_QUEUE_CAP = 100;

const ERROR_DEDUPE_MS = 10_000;
const IDLE_CHECK_MS = 5_000;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface OpsTelemetryTransport {
  heartbeat: (payload: OpsTelemetrySessionPayload) => Promise<{ sessionId: string }>;
  end: (payload: { sessionId: string; endedAt?: string }) => Promise<unknown>;
  ingest: (payload: OpsTelemetryIngestPayload) => Promise<unknown>;
  sendBeacon?: (url: string, payload: unknown) => boolean;
}

export interface OpsTelemetryTrackOptions {
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
  metadata?: Record<string, unknown>;
  error?: {
    message?: unknown;
    name?: unknown;
    code?: unknown;
    statusCode?: unknown;
    source?: OpsEventSource;
    severity?: OpsEventSeverity;
    stack?: unknown;
    signature?: unknown;
    metadata?: Record<string, unknown>;
  };
}

function defaultBeacon(url: string, payload: unknown) {
  if (typeof navigator === "undefined" || typeof navigator.sendBeacon !== "function") {
    return false;
  }

  try {
    const body = new Blob([JSON.stringify(payload)], { type: "application/json" });
    return navigator.sendBeacon(url, body);
  } catch {
    return false;
  }
}

const defaultTransport: OpsTelemetryTransport = {
  heartbeat: opsApi.opsTelemetryHeartbeat,
  end: opsApi.opsTelemetryEnd,
  ingest: opsApi.opsTelemetryIngest,
  sendBeacon: defaultBeacon,
};

function nowIso() {
  return new Date().toISOString();
}

function isTerminalTelemetryAuthError(error: unknown) {
  if (!(error instanceof Error)) return false;
  const message = error.message.toLowerCase();
  return message.includes("unauthorized") || message.includes("forbidden") || message.includes("sign in again");
}

function getWindow() {
  return typeof window === "undefined" ? null : window;
}

function getDocument() {
  return typeof document === "undefined" ? null : document;
}

function getSessionStorage() {
  try {
    return getWindow()?.sessionStorage ?? null;
  } catch {
    return null;
  }
}

function fallbackUuid() {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (token) => {
    const random = Math.floor(Math.random() * 16);
    const value = token === "x" ? random : (random & 0x3) | 0x8;
    return value.toString(16);
  });
}

function createSessionId() {
  const cryptoApi = globalThis.crypto;
  if (cryptoApi && typeof cryptoApi.randomUUID === "function") {
    return cryptoApi.randomUUID();
  }
  return fallbackUuid();
}

function getOrCreateSessionId() {
  const storage = getSessionStorage();
  const existing = storage?.getItem(OPS_TELEMETRY_SESSION_STORAGE_KEY);
  if (existing && UUID_PATTERN.test(existing)) {
    return existing;
  }

  const next = createSessionId();
  try {
    storage?.setItem(OPS_TELEMETRY_SESSION_STORAGE_KEY, next);
  } catch {}
  return next;
}

function normalizeStatusCode(value: unknown) {
  return typeof value === "number" && Number.isInteger(value) && value >= 100 && value <= 599 ? value : undefined;
}

function normalizeDurationMs(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.min(3_600_000, Math.round(value))
    : undefined;
}

function normalizeMethod(value: unknown) {
  if (typeof value !== "string") return undefined;
  return sanitizeOpsText(value.toUpperCase(), 16);
}

function severityForApiFailure(statusCode: number | undefined): OpsEventSeverity {
  if (!statusCode) return "error";
  if (statusCode >= 500) return "error";
  return "warning";
}

function severityForEvent(type: OpsTelemetryEventType): OpsEventSeverity {
  if (type === "api_error" || type === "js_error" || type === "unhandled_rejection") {
    return "error";
  }
  return "info";
}

function normalizeRouteContext(input: OpsTelemetryRouteContext): OpsTelemetryRouteContext {
  return {
    system: input.system,
    path: sanitizeOpsPath(input.path) ?? "/",
    routePattern: sanitizeOpsText(input.routePattern, 240) ?? "/",
    ...(sanitizeOpsText(input.pageTitle, 180) ? { pageTitle: sanitizeOpsText(input.pageTitle, 180) } : {}),
  };
}

function buildSessionPayload(params: {
  sessionId: string;
  context: OpsTelemetryRouteContext | null;
  state: OpsTelemetryWriteSessionState;
  referrer?: string;
  userAgent?: string;
}): OpsTelemetrySessionPayload {
  return {
    sessionId: params.sessionId,
    state: params.state,
    source: "frontend",
    occurredAt: nowIso(),
    ...(params.context ? {
      system: params.context.system,
      path: params.context.path,
    } : {}),
    ...(sanitizeOpsText(params.referrer, 500) ? { referrer: sanitizeOpsText(params.referrer, 500) } : {}),
    ...(sanitizeOpsText(params.userAgent, 600) ? { userAgent: sanitizeOpsText(params.userAgent, 600) } : {}),
  };
}

function normalizeErrorPayload(input: OpsTelemetryTrackOptions["error"] | undefined, fallbackMessage: string, fallbackSeverity: OpsEventSeverity): OpsTelemetryErrorPayload {
  const statusCode = normalizeStatusCode(input?.statusCode);
  return {
    message: sanitizeOpsText(input?.message ?? fallbackMessage, 1_000) ?? fallbackMessage,
    ...(sanitizeOpsText(input?.name, 240) ? { name: sanitizeOpsText(input?.name, 240) } : {}),
    ...(sanitizeOpsText(input?.code, 120) ? { code: sanitizeOpsText(input?.code, 120) } : {}),
    ...(statusCode ? { statusCode } : {}),
    source: input?.source ?? "frontend",
    severity: input?.severity ?? fallbackSeverity,
    ...(sanitizeOpsStack(input?.stack) ? { stack: sanitizeOpsStack(input?.stack) } : {}),
    ...(sanitizeOpsText(input?.signature, 180) ? { signature: sanitizeOpsText(input?.signature, 180) } : {}),
    metadata: sanitizeOpsMetadata(input?.metadata),
  };
}

function extractErrorInfo(error: unknown) {
  if (error instanceof Error) {
    return {
      message: error.message,
      name: error.name,
      stack: error.stack,
      code: (error as Error & { code?: unknown }).code,
      statusCode: (error as Error & { status?: unknown; statusCode?: unknown }).statusCode
        ?? (error as Error & { status?: unknown }).status,
    };
  }

  if (error && typeof error === "object") {
    const record = error as Record<string, unknown>;
    return {
      message: typeof record.message === "string" ? record.message : "Unhandled rejection",
      name: typeof record.name === "string" ? record.name : undefined,
      stack: typeof record.stack === "string" ? record.stack : undefined,
      code: record.code,
      statusCode: record.statusCode ?? record.status,
    };
  }

  return {
    message: typeof error === "string" ? error : "Unhandled rejection",
  };
}

export class OpsTelemetryClient {
  private readonly transport: OpsTelemetryTransport;
  private started = false;
  private disabled = false;
  private sessionId: string | null = null;
  private context: OpsTelemetryRouteContext | null = null;
  private state: OpsTelemetryWriteSessionState = "active";
  private lastActivityAt = Date.now();
  private queue: OpsTelemetryEventPayload[] = [];
  private flushing = false;
  private heartbeatTimer: number | null = null;
  private flushTimer: number | null = null;
  private idleTimer: number | null = null;
  private cleanupListeners: Array<() => void> = [];
  private errorDedupe = new Map<string, number>();
  private lastRouteKey: string | null = null;

  constructor(transport: Partial<OpsTelemetryTransport> = {}) {
    this.transport = {
      ...defaultTransport,
      ...transport,
    };
  }

  start(routeContext: OpsTelemetryRouteContext) {
    if (this.disabled) return;

    this.sessionId = this.sessionId ?? getOrCreateSessionId();
    this.started = true;
    this.lastActivityAt = Date.now();
    this.state = "active";
    this.installListeners();
    this.installTimers();
    this.setRouteContext(routeContext);
    void this.sendHeartbeat();
  }

  stop() {
    if (!this.started && !this.sessionId) return;

    const sessionId = this.sessionId;
    this.started = false;
    this.clearTimers();
    this.removeListeners();
    this.lastRouteKey = null;

    if (!sessionId) return;
    this.flush({ useBeacon: true });
    const endedAt = nowIso();
    if (!this.transport.sendBeacon?.("/api/ops/presence/end", { sessionId, endedAt })) {
      void this.transport.end({ sessionId, endedAt }).catch((error) => {
        if (isTerminalTelemetryAuthError(error)) {
          this.disabled = true;
        }
      });
    }
  }

  setRouteContext(routeContext: OpsTelemetryRouteContext) {
    const nextContext = normalizeRouteContext(routeContext);
    const previousContext = this.context;
    this.context = nextContext;
    if (!this.started || this.disabled) return;

    const routeKey = `${nextContext.system}|${nextContext.path}`;
    if (!this.lastRouteKey) {
      this.lastRouteKey = routeKey;
      this.enqueue(this.buildEvent("page_view", {
        system: nextContext.system,
        path: nextContext.path,
        routePattern: nextContext.routePattern,
        pageTitle: nextContext.pageTitle,
      }));
      return;
    }

    if (routeKey !== this.lastRouteKey) {
      this.lastRouteKey = routeKey;
      this.enqueue(this.buildEvent("route_change", {
        system: nextContext.system,
        path: nextContext.path,
        routePattern: nextContext.routePattern,
        pageTitle: nextContext.pageTitle,
        metadata: {
          previousPath: previousContext?.path ?? null,
          previousSystem: previousContext?.system ?? null,
        },
      }));
      void this.sendHeartbeat();
    }
  }

  track(type: OpsTelemetryEventType, options: OpsTelemetryTrackOptions = {}) {
    if (!this.started || this.disabled) return;
    this.enqueue(this.buildEvent(type, options));
  }

  captureApiFailure(failure: ApiFailureTelemetry) {
    if (!this.started || this.disabled) return;

    const endpoint = sanitizeOpsPath(failure.endpoint);
    if (!endpoint || endpoint.startsWith("/api/auth/") || endpoint.startsWith("/api/ops/")) {
      return;
    }

    const statusCode = normalizeStatusCode(failure.statusCode);
    const severity = severityForApiFailure(statusCode);
    this.track("api_error", {
      endpoint,
      method: failure.method,
      statusCode,
      durationMs: failure.durationMs,
      success: false,
      source: failure.source ?? "frontend",
      severity,
      metadata: {
        endpoint,
        method: failure.method,
      },
      error: {
        message: failure.message,
        statusCode,
        source: failure.source ?? "frontend",
        severity,
        metadata: {
          endpoint,
          method: failure.method,
        },
      },
    });
  }

  flush(options: { useBeacon?: boolean } = {}) {
    if (this.disabled || !this.sessionId || !this.queue.length) return;

    const batch = this.queue.splice(0, OPS_TELEMETRY_BATCH_SIZE);
    const payload: OpsTelemetryIngestPayload = {
      session: buildSessionPayload({
        sessionId: this.sessionId,
        context: this.context,
        state: this.state,
      }),
      events: batch,
    };

    if (options.useBeacon && this.transport.sendBeacon?.("/api/ops/ingest", payload)) {
      return;
    }

    if (this.flushing) {
      this.queue.unshift(...batch);
      this.trimQueue();
      return;
    }

    this.flushing = true;
    void this.transport.ingest(payload)
      .catch((error) => {
        if (isTerminalTelemetryAuthError(error)) {
          this.disabled = true;
          this.queue = [];
          return;
        }
        this.queue.unshift(...batch);
        this.trimQueue();
      })
      .finally(() => {
        this.flushing = false;
      });
  }

  resetForTests() {
    this.started = false;
    this.disabled = false;
    this.sessionId = null;
    this.context = null;
    this.state = "active";
    this.lastActivityAt = Date.now();
    this.queue = [];
    this.flushing = false;
    this.errorDedupe.clear();
    this.lastRouteKey = null;
    this.clearTimers();
    this.removeListeners();
  }

  getQueuedEventCountForTests() {
    return this.queue.length;
  }

  private buildEvent(type: OpsTelemetryEventType, options: OpsTelemetryTrackOptions): OpsTelemetryEventPayload {
    const context = this.context;
    const severity = options.severity ?? severityForEvent(type);
    const statusCode = normalizeStatusCode(options.statusCode);
    const event: OpsTelemetryEventPayload = {
      type,
      occurredAt: nowIso(),
      system: options.system ?? context?.system ?? "unknown",
      source: options.source ?? "frontend",
      severity,
      metadata: sanitizeOpsMetadata(options.metadata),
    };

    const path = sanitizeOpsPath(options.path ?? context?.path);
    if (path) event.path = path;
    const routePattern = sanitizeOpsText(options.routePattern ?? context?.routePattern, 240);
    if (routePattern) event.routePattern = routePattern;
    const pageTitle = sanitizeOpsText(options.pageTitle ?? context?.pageTitle, 180);
    if (pageTitle) event.pageTitle = pageTitle;
    const endpoint = sanitizeOpsPath(options.endpoint);
    if (endpoint) event.endpoint = endpoint;
    const method = normalizeMethod(options.method);
    if (method) event.method = method;
    if (statusCode) event.statusCode = statusCode;
    const durationMs = normalizeDurationMs(options.durationMs);
    if (durationMs !== undefined) event.durationMs = durationMs;
    if (typeof options.success === "boolean") event.success = options.success;
    if (options.error) {
      event.error = normalizeErrorPayload(options.error, "Telemetry error", severity);
    }

    return event;
  }

  private enqueue(event: OpsTelemetryEventPayload) {
    this.queue.push(event);
    this.trimQueue();
  }

  private trimQueue() {
    if (this.queue.length > OPS_TELEMETRY_QUEUE_CAP) {
      this.queue.splice(0, this.queue.length - OPS_TELEMETRY_QUEUE_CAP);
    }
  }

  private installTimers() {
    if (this.heartbeatTimer == null) {
      this.heartbeatTimer = window.setInterval(() => {
        void this.sendHeartbeat();
      }, OPS_TELEMETRY_HEARTBEAT_MS);
    }
    if (this.flushTimer == null) {
      this.flushTimer = window.setInterval(() => {
        this.flush();
      }, OPS_TELEMETRY_FLUSH_MS);
    }
    if (this.idleTimer == null) {
      this.idleTimer = window.setInterval(() => {
        this.checkIdle();
      }, IDLE_CHECK_MS);
    }
  }

  private clearTimers() {
    if (this.heartbeatTimer != null) {
      window.clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    if (this.flushTimer != null) {
      window.clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
    if (this.idleTimer != null) {
      window.clearInterval(this.idleTimer);
      this.idleTimer = null;
    }
  }

  private installListeners() {
    if (this.cleanupListeners.length) return;
    const win = getWindow();
    if (!win) return;

    const onActivity = () => this.recordActivity();
    const onError = (event: ErrorEvent) => this.captureRuntimeError("js_error", event.error ?? event.message, {
      message: event.message,
      source: event.filename,
      line: event.lineno,
      column: event.colno,
    });
    const onUnhandledRejection = (event: PromiseRejectionEvent) => this.captureRuntimeError("unhandled_rejection", event.reason);
    const doc = getDocument();
    const onVisibilityChange = () => {
      const doc = getDocument();
      if (doc?.visibilityState === "visible") {
        this.recordActivity();
      } else {
        this.flush({ useBeacon: true });
        void this.sendHeartbeat("idle");
      }
    };
    const onPageExit = () => {
      this.flush({ useBeacon: true });
      this.stop();
    };

    for (const eventName of ["pointerdown", "keydown", "touchstart", "scroll"] as const) {
      win.addEventListener(eventName, onActivity, { passive: true });
      this.cleanupListeners.push(() => win.removeEventListener(eventName, onActivity));
    }
    win.addEventListener("error", onError);
    win.addEventListener("unhandledrejection", onUnhandledRejection);
    doc?.addEventListener("visibilitychange", onVisibilityChange);
    win.addEventListener("pagehide", onPageExit);
    win.addEventListener("beforeunload", onPageExit);
    this.cleanupListeners.push(
      () => win.removeEventListener("error", onError),
      () => win.removeEventListener("unhandledrejection", onUnhandledRejection),
      () => doc?.removeEventListener("visibilitychange", onVisibilityChange),
      () => win.removeEventListener("pagehide", onPageExit),
      () => win.removeEventListener("beforeunload", onPageExit),
    );
  }

  private removeListeners() {
    for (const cleanup of this.cleanupListeners.splice(0)) {
      cleanup();
    }
  }

  private recordActivity() {
    this.lastActivityAt = Date.now();
    if (this.state === "idle") {
      this.state = "active";
      this.enqueue(this.buildEvent("user_active", {
        metadata: { state: "active" },
      }));
      void this.sendHeartbeat("active");
    }
  }

  private checkIdle() {
    if (!this.started || this.disabled || this.state === "idle") return;
    if (Date.now() - this.lastActivityAt < OPS_TELEMETRY_IDLE_AFTER_MS) return;

    this.state = "idle";
    this.enqueue(this.buildEvent("user_idle", {
      metadata: { state: "idle" },
    }));
    void this.sendHeartbeat("idle");
  }

  private captureRuntimeError(type: "js_error" | "unhandled_rejection", error: unknown, eventMetadata: Record<string, unknown> = {}) {
    if (!this.started || this.disabled) return;
    const info = extractErrorInfo(error);
    const stack = sanitizeOpsStack(info.stack);
    const message = sanitizeOpsText(info.message, 1_000) ?? "Runtime error";
    const topStackLine = stack?.split("\n").find((line) => line.trim()) ?? "";
    const signature = `${type}|${message}|${this.context?.path ?? ""}|${topStackLine}`;
    const now = Date.now();
    const lastSeenAt = this.errorDedupe.get(signature);
    if (lastSeenAt && now - lastSeenAt < ERROR_DEDUPE_MS) {
      return;
    }
    this.errorDedupe.set(signature, now);

    this.enqueue(this.buildEvent(type, {
      severity: "error",
      metadata: eventMetadata,
      error: {
        message,
        name: info.name,
        code: info.code,
        statusCode: info.statusCode,
        source: "frontend",
        severity: "error",
        stack,
        signature,
        metadata: eventMetadata,
      },
    }));
  }

  private async sendHeartbeat(stateOverride?: OpsTelemetryWriteSessionState) {
    if (!this.started || this.disabled || !this.sessionId) return;
    const state = stateOverride ?? this.state;
    const doc = getDocument();
    const payload = buildSessionPayload({
      sessionId: this.sessionId,
      context: this.context,
      state,
      referrer: doc?.referrer,
      userAgent: getWindow()?.navigator.userAgent,
    });

    try {
      const response = await this.transport.heartbeat(payload);
      if (response.sessionId && UUID_PATTERN.test(response.sessionId)) {
        this.sessionId = response.sessionId;
      }
    } catch (error) {
      if (isTerminalTelemetryAuthError(error)) {
        this.disabled = true;
        this.queue = [];
      }
    }
  }
}

export const opsTelemetry = new OpsTelemetryClient();
