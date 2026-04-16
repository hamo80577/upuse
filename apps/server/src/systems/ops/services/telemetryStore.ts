import { createHash, randomUUID } from "node:crypto";
import { DateTime } from "luxon";
import { db } from "../../../config/db.js";
import type { MonitorEngine } from "../../../monitor/engine/MonitorEngine.js";
import { buildHealthPayload } from "../../../routes/health.js";
import type { AppUser } from "../../../types/models.js";
import { TZ, cairoDayWindowUtc, nowUtcIso } from "../../../utils/time.js";
import {
  OPS_EVENT_SEVERITIES,
  OPS_EVENT_SOURCES,
  OPS_EVENT_TYPES,
  OPS_SESSION_STATES,
  OPS_SYSTEM_IDS,
  type OpsErrorItem,
  type OpsEventItem,
  type OpsEventSeverity,
  type OpsEventSource,
  type OpsEventType,
  type OpsMetadata,
  type OpsMetadataValue,
  type OpsPaginationMeta,
  type OpsSessionInput,
  type OpsSessionItem,
  type OpsSessionState,
  type OpsSystemId,
  type OpsTelemetryErrorInput,
  type OpsTelemetryEventInput,
} from "../types/telemetry.js";

const MAX_METADATA_KEYS = 20;
const MAX_METADATA_STRING_LENGTH = 500;
const MAX_QUERY_LENGTH = 120;
const MAX_TEXT_LENGTH = 240;
const MAX_LONG_TEXT_LENGTH = 1_000;
const ACTIVE_USER_WINDOW_MINUTES = 5;
const ONLINE_SESSION_WINDOW_MINUTES = 15;
const FRESH_TELEMETRY_MINUTES = 10;
const STALE_TELEMETRY_MINUTES = 30;
const SLOW_API_WARNING_MS = 1_500;
const SLOW_API_CRITICAL_MS = 4_000;

type DbValue = string | number | null;
type CountRow = { count: number | null };
type OpsHealthStatus = "healthy" | "degraded" | "critical";

interface OpsSessionRow {
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

interface OpsEventRow {
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
  success: number | null;
  source: OpsEventSource;
  severity: OpsEventSeverity;
  occurredAt: string;
  createdAt: string;
  metadataJson: string;
}

interface OpsErrorRow {
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
  sampleMetadataJson: string;
  createdAt: string;
  updatedAt: string;
}

interface NormalizedSessionInput {
  sessionId: string;
  system: OpsSystemId;
  path: string | null;
  state: Exclude<OpsSessionState, "offline">;
  referrer: string | null;
  source: string | null;
  userAgentSummary: string | null;
  browserSummary: string | null;
  deviceSummary: string | null;
  occurredAt: string;
}

interface NormalizedEventInput {
  type: OpsEventType;
  category: string;
  occurredAt: string;
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
  metadata: OpsMetadata;
  error: OpsTelemetryErrorInput | null;
}

interface OpsQualityFactor {
  key: string;
  label: string;
  status: OpsHealthStatus;
  penalty: number;
  value: number | null;
  unit: string;
  detail: string;
  threshold: number | null;
}

interface OpsQualityAlert {
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

export interface OpsSessionListFilters {
  page?: number;
  pageSize?: number;
  system?: OpsSystemId;
  state?: OpsSessionState;
  sessionId?: string;
  from?: string;
  to?: string;
  query?: string;
}

export interface OpsEventListFilters {
  page?: number;
  pageSize?: number;
  system?: OpsSystemId;
  type?: OpsEventType;
  source?: OpsEventSource;
  severity?: OpsEventSeverity;
  sessionId?: string;
  from?: string;
  to?: string;
  query?: string;
}

export interface OpsErrorListFilters {
  page?: number;
  pageSize?: number;
  system?: OpsSystemId;
  source?: OpsEventSource;
  severity?: OpsEventSeverity;
  sessionId?: string;
  from?: string;
  to?: string;
  query?: string;
}

function nowIso() {
  return nowUtcIso();
}

function normalizeIso(value: string | undefined, fallback = nowIso()) {
  if (!value) return fallback;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? fallback : new Date(ms).toISOString();
}

function truncate(value: string, maxLength: number) {
  return value.length > maxLength ? value.slice(0, maxLength) : value;
}

function redactSensitiveText(value: string) {
  return value
    .replace(/(authorization\s*[:=]\s*bearer\s+)[^\s,;&]+/gi, "$1[redacted]")
    .replace(/((?:token|password|secret|api[_-]?key|cookie)\s*[:=]\s*)[^\s,;&]+/gi, "$1[redacted]")
    .replace(/([?&](?:token|password|secret|api[_-]?key|cookie)=)[^&\s]+/gi, "$1[redacted]");
}

function trimText(value: string | undefined, maxLength = MAX_TEXT_LENGTH) {
  const normalized = value?.trim();
  return normalized ? truncate(redactSensitiveText(normalized), maxLength) : null;
}

function isSensitiveMetadataKey(key: string) {
  return /token|password|secret|authorization|cookie|api[_-]?key|apikey/i.test(key);
}

function sanitizeMetadataValue(value: OpsMetadataValue): OpsMetadataValue | undefined {
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  return truncate(redactSensitiveText(value.trim()), MAX_METADATA_STRING_LENGTH);
}

export function sanitizeOpsMetadata(input: OpsMetadata | undefined): OpsMetadata {
  if (!input) return {};
  const sanitized: OpsMetadata = {};
  for (const [key, value] of Object.entries(input).slice(0, MAX_METADATA_KEYS)) {
    const normalizedKey = key.trim();
    if (!normalizedKey || normalizedKey.length > 80 || isSensitiveMetadataKey(normalizedKey)) continue;
    const sanitizedValue = sanitizeMetadataValue(value);
    if (sanitizedValue !== undefined) {
      sanitized[normalizedKey] = sanitizedValue;
    }
  }
  return sanitized;
}

function parseMetadataJson(value: string | null | undefined): OpsMetadata {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const metadata: OpsMetadata = {};
    for (const [key, item] of Object.entries(parsed)) {
      if (typeof item === "string" || typeof item === "number" || typeof item === "boolean" || item === null) {
        metadata[key] = item;
      }
    }
    return metadata;
  } catch {
    return {};
  }
}

function hashValue(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function isOpsSystemId(value: string | undefined): value is OpsSystemId {
  return OPS_SYSTEM_IDS.includes(value as OpsSystemId);
}

function isOpsEventSource(value: string | undefined): value is OpsEventSource {
  return OPS_EVENT_SOURCES.includes(value as OpsEventSource);
}

function isOpsEventSeverity(value: string | undefined): value is OpsEventSeverity {
  return OPS_EVENT_SEVERITIES.includes(value as OpsEventSeverity);
}

function isOpsEventType(value: string | undefined): value is OpsEventType {
  return OPS_EVENT_TYPES.includes(value as OpsEventType);
}

function inferSystemFromPath(path: string | null | undefined): OpsSystemId {
  if (!path) return "unknown";
  if (path === "/ops" || path.startsWith("/ops/")) return "ops";
  if (path === "/scano" || path.startsWith("/scano/")) return "scano";
  return "upuse";
}

function normalizeSystem(system: OpsSystemId | undefined, path: string | null | undefined, fallback: OpsSystemId = "unknown") {
  if (system && isOpsSystemId(system)) return system;
  const inferred = inferSystemFromPath(path);
  return inferred === "unknown" ? fallback : inferred;
}

function normalizeSource(source: OpsEventSource | undefined, fallback: OpsEventSource = "frontend") {
  return source && isOpsEventSource(source) ? source : fallback;
}

function deriveEventCategory(type: OpsEventType) {
  if (type === "api_request" || type === "api_error") return "api";
  if (type === "js_error" || type === "unhandled_rejection") return "error";
  if (type === "heartbeat" || type === "user_active" || type === "user_idle") return "presence";
  if (type === "token_test_started" || type === "token_test_finished") return "token";
  return "navigation";
}

function normalizeStatusCode(value: number | undefined) {
  if (typeof value !== "number" || !Number.isInteger(value)) return null;
  return value >= 100 && value <= 599 ? value : null;
}

function normalizeDuration(value: number | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.max(0, Math.min(Math.trunc(value), 3_600_000));
}

function normalizeSeverity(severity: OpsEventSeverity | undefined, event: Pick<OpsTelemetryEventInput, "type" | "statusCode" | "success">) {
  if (severity && isOpsEventSeverity(severity)) return severity;
  if (event.type === "js_error" || event.type === "unhandled_rejection" || event.type === "api_error") return "error";
  if (typeof event.statusCode === "number" && event.statusCode >= 500) return "error";
  if (typeof event.statusCode === "number" && event.statusCode >= 400) return "warning";
  if (event.success === false) return "warning";
  return "info";
}

function summarizeBrowser(userAgent: string | undefined) {
  const value = userAgent?.toLowerCase() ?? "";
  if (!value) return null;
  if (value.includes("edg/")) return "Edge";
  if (value.includes("chrome/")) return "Chrome";
  if (value.includes("firefox/")) return "Firefox";
  if (value.includes("safari/")) return "Safari";
  return "Other";
}

function summarizeDevice(userAgent: string | undefined) {
  const value = userAgent?.toLowerCase() ?? "";
  if (!value) return null;
  if (value.includes("mobile") || value.includes("android") || value.includes("iphone")) return "Mobile";
  if (value.includes("ipad") || value.includes("tablet")) return "Tablet";
  return "Desktop";
}

function normalizeSessionInput(input: OpsSessionInput | undefined, existing: OpsSessionRow | null, fallbackEvent?: OpsTelemetryEventInput): NormalizedSessionInput {
  const path = trimText(input?.path ?? fallbackEvent?.path);
  const fallbackSystem = existing?.currentSystem ?? normalizeSystem(fallbackEvent?.system, fallbackEvent?.path ?? null);
  const state = input?.state === "idle" ? "idle" : "active";
  return {
    sessionId: input?.sessionId ?? existing?.id ?? randomUUID(),
    system: normalizeSystem(input?.system, path, fallbackSystem),
    path,
    state,
    referrer: trimText(input?.referrer, 500),
    source: trimText(input?.source, 120),
    userAgentSummary: trimText(input?.userAgent, 360),
    browserSummary: summarizeBrowser(input?.userAgent),
    deviceSummary: summarizeDevice(input?.userAgent),
    occurredAt: normalizeIso(input?.occurredAt ?? fallbackEvent?.occurredAt),
  };
}

function normalizeEventInput(input: OpsTelemetryEventInput): NormalizedEventInput {
  const path = trimText(input.path);
  const type = isOpsEventType(input.type) ? input.type : "page_view";
  const statusCode = normalizeStatusCode(input.statusCode);
  return {
    type,
    category: deriveEventCategory(type),
    occurredAt: normalizeIso(input.occurredAt),
    system: normalizeSystem(input.system, path),
    path,
    routePattern: trimText(input.routePattern),
    pageTitle: trimText(input.pageTitle, 180),
    endpoint: trimText(input.endpoint),
    method: trimText(input.method, 16)?.toUpperCase() ?? null,
    statusCode,
    durationMs: normalizeDuration(input.durationMs),
    success: typeof input.success === "boolean" ? input.success : null,
    source: normalizeSource(input.source),
    severity: normalizeSeverity(input.severity, {
      type,
      statusCode: statusCode ?? undefined,
      success: input.success,
    }),
    metadata: sanitizeOpsMetadata(input.metadata),
    error: input.error ?? null,
  };
}

function mapSession(row: OpsSessionRow): OpsSessionItem {
  return {
    id: row.id,
    userId: row.userId,
    userEmail: row.userEmail,
    userName: row.userName,
    currentSystem: row.currentSystem,
    currentPath: row.currentPath,
    referrer: row.referrer,
    source: row.source,
    firstSeenAt: row.firstSeenAt,
    lastSeenAt: row.lastSeenAt,
    lastActiveAt: row.lastActiveAt,
    endedAt: row.endedAt,
    state: row.state,
    userAgentSummary: row.userAgentSummary,
    browserSummary: row.browserSummary,
    deviceSummary: row.deviceSummary,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function mapEvent(row: OpsEventRow): OpsEventItem {
  return {
    id: row.id,
    sessionId: row.sessionId,
    userId: row.userId,
    eventType: row.eventType,
    category: row.category,
    system: row.system,
    path: row.path,
    routePattern: row.routePattern,
    pageTitle: row.pageTitle,
    endpoint: row.endpoint,
    method: row.method,
    statusCode: row.statusCode,
    durationMs: row.durationMs,
    success: row.success === null ? null : row.success === 1,
    source: row.source,
    severity: row.severity,
    occurredAt: row.occurredAt,
    createdAt: row.createdAt,
    metadata: parseMetadataJson(row.metadataJson),
  };
}

function mapError(row: OpsErrorRow): OpsErrorItem {
  return {
    id: row.id,
    signature: row.signature,
    source: row.source,
    severity: row.severity,
    system: row.system,
    path: row.path,
    routePattern: row.routePattern,
    message: row.message,
    code: row.code,
    statusCode: row.statusCode,
    stackFingerprint: row.stackFingerprint,
    firstSeenAt: row.firstSeenAt,
    lastSeenAt: row.lastSeenAt,
    count: row.count,
    lastEventId: row.lastEventId,
    lastSessionId: row.lastSessionId,
    lastUserId: row.lastUserId,
    sampleMetadata: parseMetadataJson(row.sampleMetadataJson),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function getSessionRow(sessionId: string) {
  return db.prepare<[string], OpsSessionRow>("SELECT * FROM ops_sessions WHERE id = ? LIMIT 1").get(sessionId) ?? null;
}

function isSessionOwnedByUser(session: OpsSessionRow, user: AppUser) {
  return session.userId === user.id;
}

function createUniqueSessionId() {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const sessionId = randomUUID();
    if (!getSessionRow(sessionId)) return sessionId;
  }

  throw new Error("Failed to allocate a unique Ops session id.");
}

function shouldRecordHeartbeat(existing: OpsSessionRow | null, normalized: NormalizedSessionInput) {
  if (!existing) return true;
  return existing.currentSystem !== normalized.system
    || existing.currentPath !== normalized.path
    || existing.state !== normalized.state;
}

function insertEventRow(params: {
  sessionId: string | null;
  user: AppUser;
  event: NormalizedEventInput;
  createdAt: string;
}) {
  const result = db.prepare(`
    INSERT INTO ops_events (
      sessionId, userId, eventType, category, system, path, routePattern, pageTitle,
      endpoint, method, statusCode, durationMs, success, source, severity,
      occurredAt, createdAt, metadataJson
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    params.sessionId,
    params.user.id,
    params.event.type,
    params.event.category,
    params.event.system,
    params.event.path,
    params.event.routePattern,
    params.event.pageTitle,
    params.event.endpoint,
    params.event.method,
    params.event.statusCode,
    params.event.durationMs,
    params.event.success === null ? null : params.event.success ? 1 : 0,
    params.event.source,
    params.event.severity,
    params.event.occurredAt,
    params.createdAt,
    JSON.stringify(params.event.metadata),
  );
  return Number(result.lastInsertRowid);
}

function recordHeartbeatEvent(params: {
  sessionId: string;
  user: AppUser;
  normalized: NormalizedSessionInput;
  createdAt: string;
}) {
  insertEventRow({
    sessionId: params.sessionId,
    user: params.user,
    createdAt: params.createdAt,
    event: {
      type: "heartbeat",
      category: "presence",
      occurredAt: params.normalized.occurredAt,
      system: params.normalized.system,
      path: params.normalized.path,
      routePattern: null,
      pageTitle: null,
      endpoint: null,
      method: null,
      statusCode: null,
      durationMs: null,
      success: true,
      source: "frontend",
      severity: "info",
      metadata: { state: params.normalized.state },
      error: null,
    },
  });
}

export function upsertOpsSession(input: OpsSessionInput | undefined, user: AppUser, fallbackEvent?: OpsTelemetryEventInput) {
  const seedSessionId = input?.sessionId;
  const existing = seedSessionId ? getSessionRow(seedSessionId) : null;
  const ownedExisting = existing && isSessionOwnedByUser(existing, user) ? existing : null;
  const safeInput = existing && !ownedExisting
    ? { ...input, sessionId: createUniqueSessionId() }
    : input;
  const normalized = normalizeSessionInput(safeInput, ownedExisting, fallbackEvent);
  const nextExisting = ownedExisting ?? getSessionRow(normalized.sessionId);
  const changedForHeartbeat = shouldRecordHeartbeat(nextExisting, normalized);
  const timestamp = nowIso();
  const lastActiveAt = normalized.state === "active" ? normalized.occurredAt : nextExisting?.lastActiveAt ?? null;

  if (nextExisting) {
    db.prepare(`
      UPDATE ops_sessions
      SET userId = ?, userEmail = ?, userName = ?, currentSystem = ?, currentPath = ?,
        referrer = COALESCE(?, referrer), source = COALESCE(?, source), lastSeenAt = ?,
        lastActiveAt = ?, endedAt = NULL, state = ?, userAgentSummary = COALESCE(?, userAgentSummary),
        browserSummary = COALESCE(?, browserSummary), deviceSummary = COALESCE(?, deviceSummary), updatedAt = ?
      WHERE id = ?
    `).run(
      user.id,
      user.email,
      user.name,
      normalized.system,
      normalized.path,
      normalized.referrer,
      normalized.source,
      normalized.occurredAt,
      lastActiveAt,
      normalized.state,
      normalized.userAgentSummary,
      normalized.browserSummary,
      normalized.deviceSummary,
      timestamp,
      normalized.sessionId,
    );
  } else {
    db.prepare(`
      INSERT INTO ops_sessions (
        id, userId, userEmail, userName, currentSystem, currentPath, referrer, source,
        firstSeenAt, lastSeenAt, lastActiveAt, endedAt, state, userAgentSummary,
        browserSummary, deviceSummary, createdAt, updatedAt
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?)
    `).run(
      normalized.sessionId,
      user.id,
      user.email,
      user.name,
      normalized.system,
      normalized.path,
      normalized.referrer,
      normalized.source,
      normalized.occurredAt,
      normalized.occurredAt,
      lastActiveAt,
      normalized.state,
      normalized.userAgentSummary,
      normalized.browserSummary,
      normalized.deviceSummary,
      timestamp,
      timestamp,
    );
  }

  if (changedForHeartbeat) {
    recordHeartbeatEvent({ sessionId: normalized.sessionId, user, normalized, createdAt: timestamp });
  }

  const row = getSessionRow(normalized.sessionId);
  if (!row) throw new Error("Ops session was not persisted.");
  return {
    sessionId: normalized.sessionId,
    session: mapSession(row),
  };
}

export function endOpsSession(sessionId: string, user: AppUser, endedAt?: string) {
  const existing = getSessionRow(sessionId);
  if (!existing || !isSessionOwnedByUser(existing, user)) {
    return {
      ok: true as const,
      sessionId,
      ended: false,
    };
  }

  const timestamp = normalizeIso(endedAt);
  db.prepare(`
    UPDATE ops_sessions
    SET state = 'offline', endedAt = ?, lastSeenAt = ?, updatedAt = ?
    WHERE id = ?
  `).run(timestamp, timestamp, nowIso(), sessionId);
  return {
    ok: true as const,
    sessionId,
    ended: true,
  };
}

function normalizeTelemetryError(params: {
  event: NormalizedEventInput;
  eventId: number;
  sessionId: string | null;
  user: AppUser;
  input: OpsTelemetryErrorInput | null;
}) {
  const fallbackMessage = params.event.type === "api_error"
    ? `API request failed${params.event.statusCode ? ` with status ${params.event.statusCode}` : ""}`
    : "Telemetry error";
  const message = trimText(params.input?.message ?? fallbackMessage, MAX_LONG_TEXT_LENGTH) ?? fallbackMessage;
  const code = trimText(params.input?.code, 120);
  const source = normalizeSource(params.input?.source, params.event.source);
  const severity = params.input?.severity && isOpsEventSeverity(params.input.severity)
    ? params.input.severity
    : params.event.severity === "info"
      ? "error"
      : params.event.severity;
  const statusCode = normalizeStatusCode(params.input?.statusCode ?? params.event.statusCode ?? undefined);
  const stackFingerprint = params.input?.stack ? hashValue(redactSensitiveText(params.input.stack)).slice(0, 32) : null;
  const metadata = { ...params.event.metadata, ...sanitizeOpsMetadata(params.input?.metadata) };
  const providedSignature = trimText(params.input?.signature, 180);
  const signature = providedSignature ?? hashValue([
    source,
    severity,
    params.event.system,
    params.event.path ?? "",
    params.event.routePattern ?? "",
    code ?? "",
    statusCode ?? "",
    message,
    stackFingerprint ?? "",
  ].join("|")).slice(0, 40);

  return {
    signature,
    source,
    severity,
    system: params.event.system,
    path: params.event.path,
    routePattern: params.event.routePattern,
    message,
    code,
    statusCode,
    stackFingerprint,
    firstSeenAt: params.event.occurredAt,
    lastSeenAt: params.event.occurredAt,
    lastEventId: params.eventId,
    lastSessionId: params.sessionId,
    lastUserId: params.user.id,
    sampleMetadataJson: JSON.stringify(metadata),
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
}

function upsertOpsError(params: {
  event: NormalizedEventInput;
  eventId: number;
  sessionId: string | null;
  user: AppUser;
}) {
  const isErrorType = params.event.type === "api_error" || params.event.type === "js_error" || params.event.type === "unhandled_rejection";
  if (!params.event.error && !isErrorType) return null;
  const normalized = normalizeTelemetryError({ ...params, input: params.event.error });

  db.prepare(`
    INSERT INTO ops_errors (
      signature, source, severity, system, path, routePattern, message, code, statusCode,
      stackFingerprint, firstSeenAt, lastSeenAt, count, lastEventId, lastSessionId,
      lastUserId, sampleMetadataJson, createdAt, updatedAt
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(signature) DO UPDATE SET
      source = excluded.source,
      severity = excluded.severity,
      system = excluded.system,
      path = excluded.path,
      routePattern = excluded.routePattern,
      message = excluded.message,
      code = excluded.code,
      statusCode = excluded.statusCode,
      stackFingerprint = COALESCE(excluded.stackFingerprint, ops_errors.stackFingerprint),
      lastSeenAt = excluded.lastSeenAt,
      count = ops_errors.count + 1,
      lastEventId = excluded.lastEventId,
      lastSessionId = excluded.lastSessionId,
      lastUserId = excluded.lastUserId,
      sampleMetadataJson = excluded.sampleMetadataJson,
      updatedAt = excluded.updatedAt
  `).run(
    normalized.signature,
    normalized.source,
    normalized.severity,
    normalized.system,
    normalized.path,
    normalized.routePattern,
    normalized.message,
    normalized.code,
    normalized.statusCode,
    normalized.stackFingerprint,
    normalized.firstSeenAt,
    normalized.lastSeenAt,
    normalized.lastEventId,
    normalized.lastSessionId,
    normalized.lastUserId,
    normalized.sampleMetadataJson,
    normalized.createdAt,
    normalized.updatedAt,
  );

  return normalized.signature;
}

export function ingestOpsTelemetry(params: {
  session?: OpsSessionInput;
  events: OpsTelemetryEventInput[];
  user: AppUser;
}) {
  const run = db.transaction(() => {
    const sessionResult = upsertOpsSession(params.session, params.user, params.events[0]);
    let acceptedErrors = 0;
    for (const rawEvent of params.events) {
      const event = normalizeEventInput(rawEvent);
      const eventId = insertEventRow({
        sessionId: sessionResult.sessionId,
        user: params.user,
        event,
        createdAt: nowIso(),
      });
      const signature = upsertOpsError({ event, eventId, sessionId: sessionResult.sessionId, user: params.user });
      if (signature) acceptedErrors += 1;
    }
    return {
      ok: true as const,
      sessionId: sessionResult.sessionId,
      accepted: {
        events: params.events.length,
        errors: acceptedErrors,
      },
    };
  });
  return run();
}

function normalizePagination(page?: number, pageSize?: number) {
  const safePage = Number.isFinite(page) && (page ?? 0) > 0 ? Math.trunc(page ?? 1) : 1;
  const safePageSize = Number.isFinite(pageSize) && (pageSize ?? 0) > 0
    ? Math.min(Math.trunc(pageSize ?? 25), 100)
    : 25;
  return {
    page: safePage,
    pageSize: safePageSize,
    offset: (safePage - 1) * safePageSize,
  };
}

function buildPaginationMeta(page: number, pageSize: number, total: number): OpsPaginationMeta {
  return {
    page,
    pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

function escapeLikePattern(value: string) {
  return value.replace(/[\\%_]/g, "\\$&");
}

function normalizedQuery(value: string | undefined) {
  const query = value?.trim();
  return query ? truncate(query, MAX_QUERY_LENGTH) : "";
}

function appendDateFilters(filters: string[], values: DbValue[], column: string, from?: string, to?: string) {
  if (from) {
    filters.push(`datetime(${column}) >= datetime(?)`);
    values.push(normalizeIso(from));
  }
  if (to) {
    filters.push(`datetime(${column}) <= datetime(?)`);
    values.push(normalizeIso(to));
  }
}

function queryRows<TRow>(sql: string, values: DbValue[]) {
  return db.prepare(sql).all(...values) as TRow[];
}

function queryOne<TRow>(sql: string, values: DbValue[]) {
  return db.prepare(sql).get(...values) as TRow | undefined;
}

function countRows(sql: string, values: DbValue[]) {
  const row = queryOne<CountRow>(sql, values);
  return row?.count ?? 0;
}

export function listOpsSessions(filters: OpsSessionListFilters = {}) {
  const pagination = normalizePagination(filters.page, filters.pageSize);
  const clauses = ["1 = 1"];
  const values: DbValue[] = [];

  if (filters.sessionId) {
    clauses.push("id = ?");
    values.push(filters.sessionId);
  }
  if (filters.system) {
    clauses.push("currentSystem = ?");
    values.push(filters.system);
  }
  if (filters.state) {
    clauses.push("state = ?");
    values.push(filters.state);
  }
  appendDateFilters(clauses, values, "lastSeenAt", filters.from, filters.to);

  const query = normalizedQuery(filters.query);
  if (query) {
    const pattern = `%${escapeLikePattern(query)}%`;
    clauses.push(`(
      COALESCE(userEmail, '') LIKE ? ESCAPE '\\' COLLATE NOCASE
      OR COALESCE(userName, '') LIKE ? ESCAPE '\\' COLLATE NOCASE
      OR COALESCE(currentPath, '') LIKE ? ESCAPE '\\' COLLATE NOCASE
      OR COALESCE(source, '') LIKE ? ESCAPE '\\' COLLATE NOCASE
    )`);
    values.push(pattern, pattern, pattern, pattern);
  }

  const whereClause = clauses.join(" AND ");
  const total = countRows(`SELECT COUNT(*) AS count FROM ops_sessions WHERE ${whereClause}`, values);
  const rows = queryRows<OpsSessionRow>(`
    SELECT *
    FROM ops_sessions
    WHERE ${whereClause}
    ORDER BY datetime(lastSeenAt) DESC, id DESC
    LIMIT ? OFFSET ?
  `, [...values, pagination.pageSize, pagination.offset]);

  return {
    items: rows.map(mapSession),
    meta: buildPaginationMeta(pagination.page, pagination.pageSize, total),
  };
}

export function listOpsEvents(filters: OpsEventListFilters = {}) {
  const pagination = normalizePagination(filters.page, filters.pageSize);
  const clauses = ["1 = 1"];
  const values: DbValue[] = [];

  if (filters.sessionId) {
    clauses.push("sessionId = ?");
    values.push(filters.sessionId);
  }
  if (filters.system) {
    clauses.push("system = ?");
    values.push(filters.system);
  }
  if (filters.type) {
    clauses.push("eventType = ?");
    values.push(filters.type);
  }
  if (filters.source) {
    clauses.push("source = ?");
    values.push(filters.source);
  }
  if (filters.severity) {
    clauses.push("severity = ?");
    values.push(filters.severity);
  }
  appendDateFilters(clauses, values, "occurredAt", filters.from, filters.to);

  const query = normalizedQuery(filters.query);
  if (query) {
    const pattern = `%${escapeLikePattern(query)}%`;
    clauses.push(`(
      COALESCE(path, '') LIKE ? ESCAPE '\\' COLLATE NOCASE
      OR COALESCE(endpoint, '') LIKE ? ESCAPE '\\' COLLATE NOCASE
      OR COALESCE(pageTitle, '') LIKE ? ESCAPE '\\' COLLATE NOCASE
      OR metadataJson LIKE ? ESCAPE '\\' COLLATE NOCASE
    )`);
    values.push(pattern, pattern, pattern, pattern);
  }

  const whereClause = clauses.join(" AND ");
  const total = countRows(`SELECT COUNT(*) AS count FROM ops_events WHERE ${whereClause}`, values);
  const rows = queryRows<OpsEventRow>(`
    SELECT *
    FROM ops_events
    WHERE ${whereClause}
    ORDER BY datetime(occurredAt) DESC, id DESC
    LIMIT ? OFFSET ?
  `, [...values, pagination.pageSize, pagination.offset]);

  return {
    items: rows.map(mapEvent),
    meta: buildPaginationMeta(pagination.page, pagination.pageSize, total),
  };
}

export function listOpsErrors(filters: OpsErrorListFilters = {}) {
  const pagination = normalizePagination(filters.page, filters.pageSize);
  const clauses = ["1 = 1"];
  const values: DbValue[] = [];

  if (filters.sessionId) {
    clauses.push("lastSessionId = ?");
    values.push(filters.sessionId);
  }
  if (filters.system) {
    clauses.push("system = ?");
    values.push(filters.system);
  }
  if (filters.source) {
    clauses.push("source = ?");
    values.push(filters.source);
  }
  if (filters.severity) {
    clauses.push("severity = ?");
    values.push(filters.severity);
  }
  appendDateFilters(clauses, values, "lastSeenAt", filters.from, filters.to);

  const query = normalizedQuery(filters.query);
  if (query) {
    const pattern = `%${escapeLikePattern(query)}%`;
    clauses.push(`(
      signature LIKE ? ESCAPE '\\' COLLATE NOCASE
      OR message LIKE ? ESCAPE '\\' COLLATE NOCASE
      OR COALESCE(code, '') LIKE ? ESCAPE '\\' COLLATE NOCASE
      OR COALESCE(path, '') LIKE ? ESCAPE '\\' COLLATE NOCASE
      OR sampleMetadataJson LIKE ? ESCAPE '\\' COLLATE NOCASE
    )`);
    values.push(pattern, pattern, pattern, pattern, pattern);
  }

  const whereClause = clauses.join(" AND ");
  const total = countRows(`SELECT COUNT(*) AS count FROM ops_errors WHERE ${whereClause}`, values);
  const rows = queryRows<OpsErrorRow>(`
    SELECT *
    FROM ops_errors
    WHERE ${whereClause}
    ORDER BY datetime(lastSeenAt) DESC, id DESC
    LIMIT ? OFFSET ?
  `, [...values, pagination.pageSize, pagination.offset]);

  return {
    items: rows.map(mapError),
    meta: buildPaginationMeta(pagination.page, pagination.pageSize, total),
  };
}

function countEventsBetween(startIso: string, endIso: string, extraClause = "1 = 1", values: DbValue[] = []) {
  return countRows(`
    SELECT COUNT(*) AS count
    FROM ops_events
    WHERE occurredAt >= ?
      AND occurredAt < ?
      AND ${extraClause}
  `, [startIso, endIso, ...values]);
}

function countSessionsBetween(startIso: string, endIso: string) {
  return countRows(`
    SELECT COUNT(*) AS count
    FROM ops_sessions
    WHERE firstSeenAt >= ?
      AND firstSeenAt < ?
  `, [startIso, endIso]);
}

function countOnlineUsers(startIso: string) {
  return countRows(`
    SELECT COUNT(DISTINCT COALESCE(userId, id)) AS count
    FROM ops_sessions
    WHERE state <> 'offline'
      AND lastSeenAt >= ?
  `, [startIso]);
}

function countActiveUsers(startIso: string) {
  return countRows(`
    SELECT COUNT(DISTINCT COALESCE(userId, id)) AS count
    FROM ops_sessions
    WHERE state = 'active'
      AND COALESCE(lastActiveAt, lastSeenAt) >= ?
  `, [startIso]);
}

function makeKpi(params: { key: string; label: string; value: number; previousValue: number; inverse?: boolean }) {
  const delta = params.value - params.previousValue;
  const direction = delta > 0 ? "up" : delta < 0 ? "down" : "flat";
  const improved = params.inverse ? delta < 0 : delta > 0;
  const worsened = params.inverse ? delta > 0 : false;
  return {
    key: params.key,
    label: params.label,
    value: params.value,
    previousValue: params.previousValue,
    delta,
    direction,
    status: worsened ? "warning" : improved ? "good" : "neutral",
  };
}

function maxTimestamp(table: "ops_sessions" | "ops_events" | "ops_errors", column: "lastSeenAt" | "occurredAt") {
  const row = queryOne<{ value: string | null }>(`SELECT MAX(${column}) AS value FROM ${table}`, []);
  return row?.value ?? null;
}

function groupedRows(sql: string, values: DbValue[]) {
  return queryRows<{ key: string | null; count: number | null }>(sql, values)
    .map((row) => ({
      key: row.key ?? "unknown",
      count: row.count ?? 0,
    }));
}

function percentage(numerator: number, denominator: number) {
  if (!denominator) return 0;
  return numerator / denominator;
}

function clampScore(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function statusFromScore(score: number, hasCriticalFactor = false): OpsHealthStatus {
  if (hasCriticalFactor || score < 70) return "critical";
  if (score < 90) return "degraded";
  return "healthy";
}

function statusFromPenalty(penalty: number): OpsHealthStatus {
  if (penalty >= 15) return "critical";
  if (penalty > 0) return "degraded";
  return "healthy";
}

function minutesSince(iso: string | null, nowIsoValue: string) {
  if (!iso) return null;
  const parsed = Date.parse(iso);
  const now = Date.parse(nowIsoValue);
  if (!Number.isFinite(parsed) || !Number.isFinite(now)) return null;
  return Math.max(0, (now - parsed) / 60_000);
}

function countWindowEvents(window: { startUtcIso: string; endUtcIso: string }, extraClause = "1 = 1", values: DbValue[] = []) {
  return countEventsBetween(window.startUtcIso, window.endUtcIso, extraClause, values);
}

function percentileApiLatencyMs(window: { startUtcIso: string; endUtcIso: string }, extraClause = "1 = 1", values: DbValue[] = []) {
  const rows = queryRows<{ durationMs: number | null }>(`
    SELECT durationMs
    FROM ops_events
    WHERE eventType IN ('api_request', 'api_error')
      AND durationMs IS NOT NULL
      AND occurredAt >= ?
      AND occurredAt < ?
      AND ${extraClause}
    ORDER BY durationMs ASC
  `, [window.startUtcIso, window.endUtcIso, ...values]);
  if (!rows.length) return null;
  const index = Math.max(0, Math.ceil(rows.length * 0.95) - 1);
  return rows[index]?.durationMs ?? null;
}

function scopedActivityClause(scope: "dashboard" | "performance") {
  if (scope === "dashboard") {
    return `(
      COALESCE(path, '') = '/'
      OR COALESCE(path, '') LIKE '/dashboard%'
      OR COALESCE(routePattern, '') = '/'
      OR COALESCE(routePattern, '') LIKE '/dashboard%'
      OR COALESCE(endpoint, '') LIKE '/api/dashboard%'
      OR COALESCE(endpoint, '') LIKE '/api/ws/dashboard%'
      OR COALESCE(pageTitle, '') LIKE '%Dashboard%'
    )`;
  }

  return `(
    COALESCE(path, '') LIKE '/performance%'
    OR COALESCE(routePattern, '') LIKE '/performance%'
    OR COALESCE(endpoint, '') LIKE '/api/performance%'
    OR COALESCE(endpoint, '') LIKE '/api/ws/performance%'
    OR COALESCE(pageTitle, '') LIKE '%Performance%'
  )`;
}

function latestIsoValue(values: Array<string | null>) {
  let latest: string | null = null;
  let latestMs = Number.NEGATIVE_INFINITY;
  for (const value of values) {
    if (!value) continue;
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed) && parsed > latestMs) {
      latest = value;
      latestMs = parsed;
    }
  }
  return latest;
}

function buildCurrentPreviousWindows(windowMinutes: number) {
  const end = DateTime.utc();
  const start = end.minus({ minutes: windowMinutes });
  const previousStart = start.minus({ minutes: windowMinutes });
  return {
    current: {
      startUtcIso: start.toISO({ suppressMilliseconds: false })!,
      endUtcIso: end.toISO({ suppressMilliseconds: false })!,
    },
    previous: {
      startUtcIso: previousStart.toISO({ suppressMilliseconds: false })!,
      endUtcIso: start.toISO({ suppressMilliseconds: false })!,
    },
  };
}

function performanceHealth(window: { startUtcIso: string; endUtcIso: string }) {
  const lastOpened = queryOne<{ lastOpenedAt: string | null }>(`
    SELECT MAX(occurredAt) AS lastOpenedAt
    FROM ops_events
    WHERE eventType = 'performance_opened'
      OR COALESCE(path, '') LIKE '/performance%'
  `, [])?.lastOpenedAt ?? null;
  const errorCount = countEventsBetween(
    window.startUtcIso,
    window.endUtcIso,
    `eventType IN ('api_error', 'js_error', 'unhandled_rejection')
      AND (COALESCE(path, '') LIKE ? OR COALESCE(endpoint, '') LIKE ? OR COALESCE(pageTitle, '') LIKE ?)`,
    ["%performance%", "%performance%", "%performance%"],
  );
  const apiFailureCount = countEventsBetween(
    window.startUtcIso,
    window.endUtcIso,
    "eventType IN ('api_request', 'api_error') AND (success = 0 OR statusCode >= 500) AND (COALESCE(path, '') LIKE ? OR COALESCE(endpoint, '') LIKE ?)",
    ["%performance%", "%performance%"],
  );
  const websocketFailureCount = countEventsBetween(
    window.startUtcIso,
    window.endUtcIso,
    "eventType = 'api_error' AND source = 'websocket' AND COALESCE(endpoint, '') LIKE ?",
    ["/api/ws/performance%"],
  );
  const p95LatencyMs = percentileApiLatencyMs(window, scopedActivityClause("performance"));
  const status =
    errorCount >= 10 || apiFailureCount >= 5 || websocketFailureCount >= 4 || (p95LatencyMs ?? 0) >= SLOW_API_CRITICAL_MS
      ? "critical"
      : errorCount > 0 || apiFailureCount > 0 || websocketFailureCount > 0 || (p95LatencyMs ?? 0) >= SLOW_API_WARNING_MS
        ? "warning"
        : "good";

  return {
    status,
    lastOpenedAt: lastOpened,
    errorCount,
    apiFailureCount,
    websocketFailureCount,
    p95LatencyMs,
  };
}

function makeQualityFactor(params: Omit<OpsQualityFactor, "status" | "penalty"> & { penalty: number }): OpsQualityFactor {
  const penalty = Math.max(0, Math.round(params.penalty));
  return {
    ...params,
    penalty,
    status: statusFromPenalty(penalty),
  };
}

function makeAlert(params: Omit<OpsQualityAlert, "id" | "createdAt"> & { createdAt: string }): OpsQualityAlert {
  const normalizedMetric = params.metric.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase();
  return {
    id: `${params.subsystem}-${normalizedMetric}-${params.severity}`,
    ...params,
  };
}

function scoreDirection(delta: number) {
  if (delta > 0) return "up";
  if (delta < 0) return "down";
  return "flat";
}

function apiFailurePenalty(failureRate: number, failureCount: number) {
  if (!failureCount) return 0;
  if (failureRate >= 0.15 || failureCount >= 20) return 25;
  if (failureRate >= 0.05 || failureCount >= 5) return 15;
  return Math.max(5, Math.round(failureRate * 100));
}

function runtimeErrorPenalty(errorRate: number, errorCount: number) {
  if (!errorCount) return 0;
  if (errorRate >= 0.15 || errorCount >= 10) return 20;
  if (errorRate >= 0.05 || errorCount >= 4) return 12;
  return Math.max(6, errorCount * 3);
}

function latencyPenalty(p95LatencyMs: number | null) {
  if (p95LatencyMs == null) return 0;
  if (p95LatencyMs >= SLOW_API_CRITICAL_MS) return 18;
  if (p95LatencyMs >= SLOW_API_WARNING_MS) return 10;
  if (p95LatencyMs >= 800) return 4;
  return 0;
}

function telemetryFreshnessPenalty(ageMinutes: number | null) {
  if (ageMinutes == null) return 5;
  if (ageMinutes >= STALE_TELEMETRY_MINUTES) return 20;
  if (ageMinutes >= FRESH_TELEMETRY_MINUTES) return 10;
  return 0;
}

function buildOpsQualityModel(params: {
  generatedAt: string;
  windows: ReturnType<typeof buildCurrentPreviousWindows>;
  dashboardHealth: ReturnType<typeof buildHealthPayload>;
  performanceHealth: ReturnType<typeof performanceHealth>;
  engineAvailable: boolean;
  counts: {
    currentApiRequests: number;
    previousApiRequests: number;
    currentPageViews: number;
    previousPageViews: number;
    currentErrors: number;
    previousErrors: number;
    apiFailureCount: number;
    previousApiFailureCount: number;
    currentSessions: number;
  };
  freshness: {
    sessionsLastSeenAt: string | null;
    eventsLastSeenAt: string | null;
    errorsLastSeenAt: string | null;
  };
}) {
  const runtimeErrors = countWindowEvents(
    params.windows.current,
    "eventType IN ('js_error', 'unhandled_rejection')",
  );
  const previousRuntimeErrors = countWindowEvents(
    params.windows.previous,
    "eventType IN ('js_error', 'unhandled_rejection')",
  );
  const websocketFailures = countWindowEvents(
    params.windows.current,
    "eventType = 'api_error' AND source = 'websocket'",
  );
  const tokenTestFailures = countWindowEvents(
    params.windows.current,
    "eventType = 'token_test_finished' AND (success = 0 OR severity IN ('warning', 'error', 'critical'))",
  );
  const p95LatencyMs = percentileApiLatencyMs(params.windows.current);
  const dashboardFailures = countWindowEvents(
    params.windows.current,
    `eventType IN ('api_error', 'js_error', 'unhandled_rejection') AND ${scopedActivityClause("dashboard")}`,
  );
  const dashboardWebsocketFailures = countWindowEvents(
    params.windows.current,
    "eventType = 'api_error' AND source = 'websocket' AND COALESCE(endpoint, '') LIKE ?",
    ["/api/ws/dashboard%"],
  );
  const dashboardP95LatencyMs = percentileApiLatencyMs(params.windows.current, scopedActivityClause("dashboard"));
  const performanceFailures = countWindowEvents(
    params.windows.current,
    `eventType IN ('api_error', 'js_error', 'unhandled_rejection') AND ${scopedActivityClause("performance")}`,
  );
  const performanceP95LatencyMs = params.performanceHealth.p95LatencyMs;
  const latestTelemetryAt = latestIsoValue([
    params.freshness.sessionsLastSeenAt,
    params.freshness.eventsLastSeenAt,
    params.freshness.errorsLastSeenAt,
  ]);
  const telemetryAgeMinutes = minutesSince(latestTelemetryAt, params.generatedAt);
  const apiFailureRate = percentage(params.counts.apiFailureCount, params.counts.currentApiRequests);
  const previousApiFailureRate = percentage(params.counts.previousApiFailureCount, params.counts.previousApiRequests);
  const runtimeErrorRate = percentage(runtimeErrors, Math.max(params.counts.currentPageViews, params.counts.currentSessions, 1));
  const previousRuntimeErrorRate = percentage(previousRuntimeErrors, Math.max(params.counts.previousPageViews, 1));

  const ordersSync = params.dashboardHealth.ordersSync;
  const staleBranchCount = ordersSync?.staleBranchCount ?? 0;
  const monitorDegraded = params.dashboardHealth.ready === false
    || params.dashboardHealth.monitorDegraded === true
    || ordersSync?.state === "degraded";
  const monitorPenalty = !params.engineAvailable
    ? 0
    : monitorDegraded
      ? 25
      : params.dashboardHealth.monitorRunning === false
        ? 8
        : staleBranchCount > 0
          ? Math.min(15, 4 + staleBranchCount * 2)
          : 0;

  const factors = [
    makeQualityFactor({
      key: "api_failure_rate",
      label: "API failure rate",
      value: Number((apiFailureRate * 100).toFixed(2)),
      unit: "%",
      threshold: 5,
      penalty: apiFailurePenalty(apiFailureRate, params.counts.apiFailureCount),
      detail: `${params.counts.apiFailureCount} failed API events from ${params.counts.currentApiRequests} request events.`,
    }),
    makeQualityFactor({
      key: "runtime_error_rate",
      label: "Frontend runtime errors",
      value: runtimeErrors,
      unit: "events",
      threshold: 1,
      penalty: runtimeErrorPenalty(runtimeErrorRate, runtimeErrors),
      detail: `${runtimeErrors} JavaScript or unhandled rejection events in the selected window.`,
    }),
    makeQualityFactor({
      key: "p95_api_latency",
      label: "p95 API latency",
      value: p95LatencyMs,
      unit: "ms",
      threshold: SLOW_API_WARNING_MS,
      penalty: latencyPenalty(p95LatencyMs),
      detail: p95LatencyMs == null ? "No API duration telemetry in this window." : `p95 API duration is ${p95LatencyMs}ms.`,
    }),
    makeQualityFactor({
      key: "websocket_instability",
      label: "Live stream stability",
      value: websocketFailures,
      unit: "failures",
      threshold: 1,
      penalty: Math.min(20, websocketFailures * 5),
      detail: `${websocketFailures} live WebSocket failure events reported by the shared HTTP client.`,
    }),
    makeQualityFactor({
      key: "telemetry_freshness",
      label: "Telemetry freshness",
      value: telemetryAgeMinutes == null ? null : Number(telemetryAgeMinutes.toFixed(1)),
      unit: "minutes",
      threshold: FRESH_TELEMETRY_MINUTES,
      penalty: telemetryFreshnessPenalty(telemetryAgeMinutes),
      detail: latestTelemetryAt ? `Latest Ops signal at ${latestTelemetryAt}.` : "No Ops telemetry signal has been stored yet.",
    }),
    makeQualityFactor({
      key: "monitor_health",
      label: "Dashboard monitor health",
      value: staleBranchCount,
      unit: "stale branches",
      threshold: 1,
      penalty: monitorPenalty,
      detail: params.dashboardHealth.readiness?.message ?? "Monitor health is unavailable.",
    }),
    makeQualityFactor({
      key: "dashboard_surface",
      label: "UPuse Dashboard surface",
      value: dashboardFailures,
      unit: "failures",
      threshold: 1,
      penalty: Math.min(18, dashboardFailures * 5 + dashboardWebsocketFailures * 4 + latencyPenalty(dashboardP95LatencyMs)),
      detail: `${dashboardFailures} dashboard-scoped failures, ${dashboardWebsocketFailures} live stream failures.`,
    }),
    makeQualityFactor({
      key: "performance_surface",
      label: "UPuse Performance surface",
      value: performanceFailures,
      unit: "failures",
      threshold: 1,
      penalty: Math.min(20, performanceFailures * 5 + params.performanceHealth.websocketFailureCount * 4 + latencyPenalty(performanceP95LatencyMs)),
      detail: `${performanceFailures} performance-scoped failures, ${params.performanceHealth.websocketFailureCount} live stream failures.`,
    }),
    makeQualityFactor({
      key: "token_test_failures",
      label: "Token test failures",
      value: tokenTestFailures,
      unit: "failures",
      threshold: 1,
      penalty: Math.min(16, tokenTestFailures * 4),
      detail: `${tokenTestFailures} token test failures reported by Settings telemetry.`,
    }),
  ];

  const totalPenalty = factors.reduce((total, factor) => total + factor.penalty, 0);
  const previousPenalty =
    apiFailurePenalty(previousApiFailureRate, params.counts.previousApiFailureCount)
    + runtimeErrorPenalty(previousRuntimeErrorRate, previousRuntimeErrors)
    + monitorPenalty;
  const score = clampScore(100 - totalPenalty);
  const previousScore = clampScore(100 - previousPenalty);
  const delta = score - previousScore;
  const hasCriticalFactor = factors.some((factor) => factor.status === "critical");
  const status = statusFromScore(score, hasCriticalFactor);

  const alerts: OpsQualityAlert[] = [];
  const addAlert = (alert: Omit<OpsQualityAlert, "id" | "createdAt">) => {
    alerts.push(makeAlert({ ...alert, createdAt: params.generatedAt }));
  };

  if (params.counts.apiFailureCount > 0 && apiFailureRate >= 0.05) {
    addAlert({
      severity: apiFailureRate >= 0.15 ? "critical" : "warning",
      subsystem: "api",
      title: "API failure rate is elevated",
      message: `${params.counts.apiFailureCount} API failures in the selected window.`,
      metric: "api_failure_rate",
      value: Number((apiFailureRate * 100).toFixed(2)),
      threshold: 5,
    });
  }
  if (params.counts.currentErrors >= Math.max(3, params.counts.previousErrors * 2 + 2)) {
    addAlert({
      severity: params.counts.currentErrors >= 10 ? "critical" : "warning",
      subsystem: "overall",
      title: "Error spike detected",
      message: `${params.counts.currentErrors} error events vs ${params.counts.previousErrors} in the previous window.`,
      metric: "error_spike",
      value: params.counts.currentErrors,
      threshold: params.counts.previousErrors * 2 + 2,
    });
  }
  if (runtimeErrors > 0) {
    addAlert({
      severity: runtimeErrors >= 10 ? "critical" : "warning",
      subsystem: "frontend",
      title: "Frontend runtime errors detected",
      message: `${runtimeErrors} JavaScript error or unhandled rejection events were captured.`,
      metric: "runtime_errors",
      value: runtimeErrors,
      threshold: 1,
    });
  }
  if ((p95LatencyMs ?? 0) >= SLOW_API_WARNING_MS) {
    addAlert({
      severity: (p95LatencyMs ?? 0) >= SLOW_API_CRITICAL_MS ? "critical" : "warning",
      subsystem: "api",
      title: "API latency is elevated",
      message: `p95 API duration is ${p95LatencyMs}ms.`,
      metric: "p95_api_latency_ms",
      value: p95LatencyMs,
      threshold: SLOW_API_WARNING_MS,
    });
  }
  if (websocketFailures > 0) {
    addAlert({
      severity: websocketFailures >= 4 ? "critical" : "warning",
      subsystem: "overall",
      title: "Live stream instability detected",
      message: `${websocketFailures} WebSocket failure events were reported.`,
      metric: "websocket_failures",
      value: websocketFailures,
      threshold: 1,
    });
  }
  if (telemetryAgeMinutes == null || telemetryAgeMinutes >= FRESH_TELEMETRY_MINUTES) {
    addAlert({
      severity: telemetryAgeMinutes != null && telemetryAgeMinutes >= STALE_TELEMETRY_MINUTES ? "critical" : "warning",
      subsystem: "telemetry",
      title: telemetryAgeMinutes == null ? "Ops telemetry has not started" : "Ops telemetry is stale",
      message: telemetryAgeMinutes == null
        ? "No telemetry signal is available for freshness checks."
        : `Latest telemetry signal is ${telemetryAgeMinutes.toFixed(1)} minutes old.`,
      metric: "telemetry_age_minutes",
      value: telemetryAgeMinutes == null ? null : Number(telemetryAgeMinutes.toFixed(1)),
      threshold: FRESH_TELEMETRY_MINUTES,
    });
  }
  if (monitorDegraded || (params.engineAvailable && params.dashboardHealth.monitorRunning === false) || staleBranchCount > 0) {
    addAlert({
      severity: monitorDegraded ? "critical" : "warning",
      subsystem: "monitor",
      title: monitorDegraded ? "Dashboard monitor degraded" : params.dashboardHealth.monitorRunning === false ? "Dashboard monitor is stopped" : "Dashboard data is partially stale",
      message: params.dashboardHealth.readiness?.message ?? `${staleBranchCount} stale branches reported by orders sync.`,
      metric: "dashboard_monitor_health",
      value: staleBranchCount,
      threshold: 1,
    });
  }
  if (params.performanceHealth.status !== "good") {
    addAlert({
      severity: params.performanceHealth.status === "critical" ? "critical" : "warning",
      subsystem: "performance",
      title: "Performance surface needs attention",
      message: `${params.performanceHealth.errorCount} errors, ${params.performanceHealth.apiFailureCount} API failures, ${params.performanceHealth.websocketFailureCount} WebSocket failures.`,
      metric: "performance_failures",
      value: params.performanceHealth.errorCount + params.performanceHealth.apiFailureCount + params.performanceHealth.websocketFailureCount,
      threshold: 1,
    });
  }
  if (dashboardFailures > 0 || dashboardWebsocketFailures > 0) {
    addAlert({
      severity: dashboardFailures >= 5 || dashboardWebsocketFailures >= 3 ? "critical" : "warning",
      subsystem: "dashboard",
      title: "Dashboard surface needs attention",
      message: `${dashboardFailures} dashboard-scoped failures and ${dashboardWebsocketFailures} dashboard stream failures.`,
      metric: "dashboard_failures",
      value: dashboardFailures + dashboardWebsocketFailures,
      threshold: 1,
    });
  }
  if (tokenTestFailures > 0) {
    addAlert({
      severity: tokenTestFailures >= 4 ? "critical" : "warning",
      subsystem: "token",
      title: "Token test failures detected",
      message: `${tokenTestFailures} Settings token test failures were reported.`,
      metric: "token_test_failures",
      value: tokenTestFailures,
      threshold: 1,
    });
  }

  const dashboardScore = clampScore(100 - monitorPenalty - Math.min(18, dashboardFailures * 5 + dashboardWebsocketFailures * 4 + latencyPenalty(dashboardP95LatencyMs)));
  const performanceScore = clampScore(100 - Math.min(20, performanceFailures * 5 + params.performanceHealth.websocketFailureCount * 4 + latencyPenalty(performanceP95LatencyMs)));
  const telemetryScore = clampScore(100 - telemetryFreshnessPenalty(telemetryAgeMinutes) - Math.min(20, websocketFailures * 5));
  const dashboardStatus = monitorDegraded || dashboardFailures >= 5 || dashboardWebsocketFailures >= 3
    ? "critical"
    : monitorPenalty > 0 || dashboardFailures > 0 || dashboardWebsocketFailures > 0 || latencyPenalty(dashboardP95LatencyMs) > 0
      ? "degraded"
      : statusFromScore(dashboardScore);
  const performanceStatus = params.performanceHealth.status === "critical"
    ? "critical"
    : performanceFailures > 0 || params.performanceHealth.websocketFailureCount > 0 || latencyPenalty(performanceP95LatencyMs) > 0
      ? "degraded"
      : statusFromScore(performanceScore);
  const telemetryStatus = telemetryAgeMinutes != null && telemetryAgeMinutes >= STALE_TELEMETRY_MINUTES
    ? "critical"
    : telemetryFreshnessPenalty(telemetryAgeMinutes) > 0 || websocketFailures > 0
      ? "degraded"
      : statusFromScore(telemetryScore);

  return {
    quality: {
      score,
      status,
      factors,
      trend: {
        previousScore,
        delta,
        direction: scoreDirection(delta),
      },
      metrics: {
        apiFailureRate,
        runtimeErrorRate,
        p95LatencyMs,
        websocketFailures,
        telemetryAgeMinutes,
        tokenTestFailures,
      },
    },
    alerts,
    subsystems: {
      dashboard: {
        label: "UPuse Dashboard",
        status: dashboardStatus,
        score: dashboardScore,
        monitorRunning: params.dashboardHealth.monitorRunning,
        monitorDegraded: params.dashboardHealth.monitorDegraded,
        ordersSyncState: ordersSync?.state ?? "unknown",
        staleBranchCount,
        failures: dashboardFailures,
        websocketFailures: dashboardWebsocketFailures,
        p95LatencyMs: dashboardP95LatencyMs,
        lastHealthyAt: params.dashboardHealth.lastSnapshotAt ?? null,
        message: params.dashboardHealth.readiness?.message ?? "Dashboard health is unavailable.",
      },
      performance: {
        label: "UPuse Performance",
        status: performanceStatus,
        score: performanceScore,
        failures: performanceFailures,
        apiFailureCount: params.performanceHealth.apiFailureCount,
        websocketFailures: params.performanceHealth.websocketFailureCount,
        p95LatencyMs: performanceP95LatencyMs,
        lastOpenedAt: params.performanceHealth.lastOpenedAt,
        message: params.performanceHealth.status === "good" ? "Performance telemetry is healthy." : "Performance telemetry has recent failure pressure.",
      },
      telemetry: {
        label: "Ops Telemetry",
        status: telemetryStatus,
        score: telemetryScore,
        lastSignalAt: latestTelemetryAt,
        ageMinutes: telemetryAgeMinutes == null ? null : Number(telemetryAgeMinutes.toFixed(1)),
        websocketFailures,
        message: latestTelemetryAt ? "Ops telemetry freshness is being tracked." : "Ops telemetry has not stored a signal yet.",
      },
    },
  };
}

export function getOpsSummary(params: { windowMinutes?: number; engine?: MonitorEngine } = {}) {
  const windowMinutes = Math.min(Math.max(Math.trunc(params.windowMinutes ?? 60), 1), 1440);
  const generatedAt = nowIso();
  const windows = buildCurrentPreviousWindows(windowMinutes);
  const today = cairoDayWindowUtc(DateTime.utc());
  const activeStartIso = DateTime.utc().minus({ minutes: ACTIVE_USER_WINDOW_MINUTES }).toISO({ suppressMilliseconds: false })!;
  const onlineStartIso = DateTime.utc().minus({ minutes: ONLINE_SESSION_WINDOW_MINUTES }).toISO({ suppressMilliseconds: false })!;

  const currentPageViews = countEventsBetween(windows.current.startUtcIso, windows.current.endUtcIso, "eventType = 'page_view'");
  const previousPageViews = countEventsBetween(windows.previous.startUtcIso, windows.previous.endUtcIso, "eventType = 'page_view'");
  const currentApiRequests = countEventsBetween(windows.current.startUtcIso, windows.current.endUtcIso, "eventType IN ('api_request', 'api_error')");
  const previousApiRequests = countEventsBetween(windows.previous.startUtcIso, windows.previous.endUtcIso, "eventType IN ('api_request', 'api_error')");
  const currentErrors = countEventsBetween(windows.current.startUtcIso, windows.current.endUtcIso, "eventType IN ('api_error', 'js_error', 'unhandled_rejection')");
  const previousErrors = countEventsBetween(windows.previous.startUtcIso, windows.previous.endUtcIso, "eventType IN ('api_error', 'js_error', 'unhandled_rejection')");
  const currentSessions = countSessionsBetween(windows.current.startUtcIso, windows.current.endUtcIso);
  const previousSessions = countSessionsBetween(windows.previous.startUtcIso, windows.previous.endUtcIso);
  const apiFailureCount = countEventsBetween(windows.current.startUtcIso, windows.current.endUtcIso, "eventType IN ('api_request', 'api_error') AND (success = 0 OR statusCode >= 400)");
  const previousApiFailureCount = countEventsBetween(windows.previous.startUtcIso, windows.previous.endUtcIso, "eventType IN ('api_request', 'api_error') AND (success = 0 OR statusCode >= 400)");
  const onlineUsers = countOnlineUsers(onlineStartIso);
  const activeUsers = countActiveUsers(activeStartIso);
  const idleUsers = countRows(`
    SELECT COUNT(DISTINCT COALESCE(userId, id)) AS count
    FROM ops_sessions
    WHERE state = 'idle'
      AND lastSeenAt >= ?
  `, [onlineStartIso]);

  const topPages = queryRows<{ path: string | null; views: number | null; uniqueSessions: number | null }>(`
    SELECT COALESCE(path, 'unknown') AS path, COUNT(*) AS views, COUNT(DISTINCT sessionId) AS uniqueSessions
    FROM ops_events
    WHERE eventType = 'page_view'
      AND occurredAt >= ?
      AND occurredAt < ?
    GROUP BY COALESCE(path, 'unknown')
    ORDER BY views DESC, path ASC
    LIMIT 10
  `, [windows.current.startUtcIso, windows.current.endUtcIso]).map((row) => ({
    path: row.path ?? "unknown",
    views: row.views ?? 0,
    uniqueSessions: row.uniqueSessions ?? 0,
  }));

  const topEventTypes = queryRows<{ type: OpsEventType; count: number | null }>(`
    SELECT eventType AS type, COUNT(*) AS count
    FROM ops_events
    WHERE occurredAt >= ?
      AND occurredAt < ?
    GROUP BY eventType
    ORDER BY count DESC, eventType ASC
    LIMIT 10
  `, [windows.current.startUtcIso, windows.current.endUtcIso]).map((row) => ({
    type: row.type,
    count: row.count ?? 0,
  }));

  const topErrors = queryRows<{ signature: string; message: string; severity: OpsEventSeverity; count: number; lastSeenAt: string }>(`
    SELECT signature, message, severity, count, lastSeenAt
    FROM ops_errors
    WHERE lastSeenAt >= ?
      AND lastSeenAt < ?
    ORDER BY count DESC, datetime(lastSeenAt) DESC
    LIMIT 10
  `, [windows.current.startUtcIso, windows.current.endUtcIso]);

  const freshness = {
    sessionsLastSeenAt: maxTimestamp("ops_sessions", "lastSeenAt"),
    eventsLastSeenAt: maxTimestamp("ops_events", "occurredAt"),
    errorsLastSeenAt: maxTimestamp("ops_errors", "lastSeenAt"),
  };
  const dashboardHealth = buildHealthPayload(params.engine);
  const currentPerformanceHealth = performanceHealth(windows.current);
  const qualityModel = buildOpsQualityModel({
    generatedAt,
    windows,
    dashboardHealth,
    performanceHealth: currentPerformanceHealth,
    engineAvailable: Boolean(params.engine),
    counts: {
      currentApiRequests,
      previousApiRequests,
      currentPageViews,
      previousPageViews,
      currentErrors,
      previousErrors,
      apiFailureCount,
      previousApiFailureCount,
      currentSessions,
    },
    freshness,
  });

  return {
    ok: true as const,
    generatedAt,
    freshness,
    windows: {
      current: windows.current,
      previous: windows.previous,
      today: {
        startUtcIso: today.startUtcIso,
        endUtcIso: today.endUtcIso,
      },
      timezone: TZ,
    },
    counts: {
      onlineUsers,
      activeUsers,
      idleUsers,
      sessionsToday: countSessionsBetween(today.startUtcIso, today.endUtcIso),
      pageViewsToday: countEventsBetween(today.startUtcIso, today.endUtcIso, "eventType = 'page_view'"),
      errorCountToday: countEventsBetween(today.startUtcIso, today.endUtcIso, "eventType IN ('api_error', 'js_error', 'unhandled_rejection')"),
      apiRequestCount: currentApiRequests,
      apiFailureCount,
    },
    kpis: [
      makeKpi({ key: "sessions", label: "Sessions", value: currentSessions, previousValue: previousSessions }),
      makeKpi({ key: "page_views", label: "Page views", value: currentPageViews, previousValue: previousPageViews }),
      makeKpi({ key: "api_requests", label: "API requests", value: currentApiRequests, previousValue: previousApiRequests }),
      makeKpi({ key: "errors", label: "Errors", value: currentErrors, previousValue: previousErrors, inverse: true }),
    ],
    statusBuckets: {
      sessionsByState: groupedRows(`
        SELECT state AS key, COUNT(*) AS count
        FROM ops_sessions
        WHERE lastSeenAt >= ?
        GROUP BY state
        ORDER BY count DESC
      `, [windows.current.startUtcIso]),
      sessionsBySystem: groupedRows(`
        SELECT currentSystem AS key, COUNT(*) AS count
        FROM ops_sessions
        WHERE lastSeenAt >= ?
        GROUP BY currentSystem
        ORDER BY count DESC
      `, [windows.current.startUtcIso]),
      apiStatus: groupedRows(`
        SELECT CASE
          WHEN statusCode BETWEEN 200 AND 299 THEN '2xx'
          WHEN statusCode BETWEEN 300 AND 399 THEN '3xx'
          WHEN statusCode BETWEEN 400 AND 499 THEN '4xx'
          WHEN statusCode >= 500 THEN '5xx'
          ELSE 'unknown'
        END AS key, COUNT(*) AS count
        FROM ops_events
        WHERE eventType IN ('api_request', 'api_error')
          AND occurredAt >= ?
          AND occurredAt < ?
        GROUP BY key
        ORDER BY key ASC
      `, [windows.current.startUtcIso, windows.current.endUtcIso]),
    },
    errorBuckets: {
      bySeverity: groupedRows(`
        SELECT severity AS key, SUM(count) AS count
        FROM ops_errors
        WHERE lastSeenAt >= ?
          AND lastSeenAt < ?
        GROUP BY severity
        ORDER BY count DESC
      `, [windows.current.startUtcIso, windows.current.endUtcIso]),
      bySource: groupedRows(`
        SELECT source AS key, SUM(count) AS count
        FROM ops_errors
        WHERE lastSeenAt >= ?
          AND lastSeenAt < ?
        GROUP BY source
        ORDER BY count DESC
      `, [windows.current.startUtcIso, windows.current.endUtcIso]),
      top: topErrors,
    },
    topPages,
    topEventTypes,
    health: {
      dashboard: dashboardHealth,
      performance: currentPerformanceHealth,
    },
    quality: qualityModel.quality,
    alerts: qualityModel.alerts,
    subsystems: qualityModel.subsystems,
  };
}
