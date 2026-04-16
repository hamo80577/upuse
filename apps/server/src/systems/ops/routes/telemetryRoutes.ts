import type { NextFunction, Request, Response } from "express";
import type { MonitorEngine } from "../../../monitor/engine/MonitorEngine.js";
import type { AppUser } from "../../../types/models.js";
import {
  OPS_EVENT_SEVERITIES,
  OPS_EVENT_SOURCES,
  OPS_EVENT_TYPES,
  OPS_SESSION_STATES,
  OPS_SYSTEM_IDS,
} from "../types/telemetry.js";
import {
  endOpsSession,
  getOpsSummary,
  ingestOpsTelemetry,
  listOpsErrors,
  listOpsEvents,
  listOpsSessions,
  upsertOpsSession,
} from "../services/telemetryStore.js";
import { z } from "zod";

const IsoDateTimeSchema = z.string().trim().refine((value) => !Number.isNaN(Date.parse(value)), {
  message: "Invalid ISO date-time value.",
});
const UuidSchema = z.string().trim().uuid();
const BoundedTextSchema = z.string().trim().min(1).max(240);
const OptionalTextSchema = z.string().trim().min(1).max(240).optional();
const MetadataValueSchema = z.union([
  z.string().max(500),
  z.number().finite(),
  z.boolean(),
  z.null(),
]);
const MetadataSchema = z.record(MetadataValueSchema)
  .refine((value) => Object.keys(value).length <= 20, {
    message: "Metadata cannot contain more than 20 keys.",
  });

const OpsSystemSchema = z.enum(OPS_SYSTEM_IDS);
const OpsSessionStateSchema = z.enum(["active", "idle"]);
const OpsListSessionStateSchema = z.enum(OPS_SESSION_STATES);
const OpsEventTypeSchema = z.enum(OPS_EVENT_TYPES);
const OpsEventSourceSchema = z.enum(OPS_EVENT_SOURCES);
const OpsEventSeveritySchema = z.enum(OPS_EVENT_SEVERITIES);

const HeartbeatBodySchema = z.object({
  sessionId: UuidSchema.optional(),
  system: OpsSystemSchema.optional(),
  path: BoundedTextSchema.optional(),
  state: OpsSessionStateSchema.optional(),
  referrer: z.string().trim().min(1).max(500).optional(),
  source: z.string().trim().min(1).max(120).optional(),
  userAgent: z.string().trim().min(1).max(600).optional(),
  occurredAt: IsoDateTimeSchema.optional(),
}).strict();

const EndBodySchema = z.object({
  sessionId: UuidSchema,
  endedAt: IsoDateTimeSchema.optional(),
}).strict();

const TelemetryErrorSchema = z.object({
  message: z.string().trim().min(1).max(1000),
  name: OptionalTextSchema,
  code: z.string().trim().min(1).max(120).optional(),
  statusCode: z.number().int().min(100).max(599).optional(),
  source: OpsEventSourceSchema.optional(),
  severity: OpsEventSeveritySchema.optional(),
  stack: z.string().max(8000).optional(),
  signature: z.string().trim().min(1).max(180).optional(),
  metadata: MetadataSchema.optional(),
}).strict();

const TelemetryEventSchema = z.object({
  type: OpsEventTypeSchema,
  occurredAt: IsoDateTimeSchema.optional(),
  system: OpsSystemSchema.optional(),
  path: BoundedTextSchema.optional(),
  routePattern: OptionalTextSchema,
  pageTitle: z.string().trim().min(1).max(180).optional(),
  endpoint: OptionalTextSchema,
  method: z.string().trim().min(1).max(16).optional(),
  statusCode: z.number().int().min(100).max(599).optional(),
  durationMs: z.number().int().min(0).max(3_600_000).optional(),
  success: z.boolean().optional(),
  source: OpsEventSourceSchema.optional(),
  severity: OpsEventSeveritySchema.optional(),
  metadata: MetadataSchema.optional(),
  error: TelemetryErrorSchema.optional(),
}).strict();

const IngestBodySchema = z.object({
  session: HeartbeatBodySchema.optional(),
  events: z.array(TelemetryEventSchema).min(1).max(25),
}).strict();

const PaginationQuerySchema = z.object({
  page: z.coerce.number().int().positive().optional().default(1),
  pageSize: z.coerce.number().int().positive().max(100).optional().default(25),
  from: IsoDateTimeSchema.optional(),
  to: IsoDateTimeSchema.optional(),
  query: z.string().trim().max(120).optional(),
}).strict();

const SessionsQuerySchema = PaginationQuerySchema.extend({
  system: OpsSystemSchema.optional(),
  state: OpsListSessionStateSchema.optional(),
  sessionId: UuidSchema.optional(),
}).strict();

const EventsQuerySchema = PaginationQuerySchema.extend({
  system: OpsSystemSchema.optional(),
  type: OpsEventTypeSchema.optional(),
  source: OpsEventSourceSchema.optional(),
  severity: OpsEventSeveritySchema.optional(),
  sessionId: UuidSchema.optional(),
}).strict();

const ErrorsQuerySchema = PaginationQuerySchema.extend({
  system: OpsSystemSchema.optional(),
  source: OpsEventSourceSchema.optional(),
  severity: OpsEventSeveritySchema.optional(),
  sessionId: UuidSchema.optional(),
}).strict();

const SummaryQuerySchema = z.object({
  windowMinutes: z.coerce.number().int().positive().max(1440).optional().default(60),
}).strict();

function getAuthenticatedUser(req: Request): AppUser {
  if (!req.authUser) {
    throw Object.assign(new Error("Unauthorized"), {
      status: 401,
      code: "SESSION_UNAUTHORIZED",
      errorOrigin: "session" as const,
    });
  }
  return req.authUser;
}

export function createOpsHeartbeatRoute() {
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = HeartbeatBodySchema.parse(req.body ?? {});
      const result = upsertOpsSession(body, getAuthenticatedUser(req));
      res.json({
        ok: true,
        sessionId: result.sessionId,
        session: result.session,
      });
    } catch (error) {
      next(error);
    }
  };
}

export function createOpsEndRoute() {
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = EndBodySchema.parse(req.body ?? {});
      res.json(endOpsSession(body.sessionId, getAuthenticatedUser(req), body.endedAt));
    } catch (error) {
      next(error);
    }
  };
}

export function createOpsIngestRoute() {
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = IngestBodySchema.parse(req.body ?? {});
      res.json(ingestOpsTelemetry({
        session: body.session,
        events: body.events,
        user: getAuthenticatedUser(req),
      }));
    } catch (error) {
      next(error);
    }
  };
}

export function createOpsSummaryRoute(engine?: MonitorEngine) {
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      const query = SummaryQuerySchema.parse(req.query);
      res.json(getOpsSummary({
        windowMinutes: query.windowMinutes,
        engine,
      }));
    } catch (error) {
      next(error);
    }
  };
}

export function createOpsSessionsRoute() {
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      const query = SessionsQuerySchema.parse(req.query);
      res.json(listOpsSessions(query));
    } catch (error) {
      next(error);
    }
  };
}

export function createOpsEventsRoute() {
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      const query = EventsQuerySchema.parse(req.query);
      res.json(listOpsEvents(query));
    } catch (error) {
      next(error);
    }
  };
}

export function createOpsErrorsRoute() {
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      const query = ErrorsQuerySchema.parse(req.query);
      res.json(listOpsErrors(query));
    } catch (error) {
      next(error);
    }
  };
}
