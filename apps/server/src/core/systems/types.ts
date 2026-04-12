import type { Express } from "express";
import type { Server as HttpServer } from "node:http";
import type { Database } from "better-sqlite3";
import type { SecurityConfig } from "../../config/security.js";
import type { MonitorEngine } from "../../monitor/engine/MonitorEngine.js";
import type { AppUser } from "../../types/models.js";
import type {
  SystemUserAccessAssignmentResolver,
  SystemUserAccessSynchronizer,
  SystemUserProjection,
} from "./auth/types.js";

export interface ServerSystemDependencies {
  app: Express;
  engine: MonitorEngine;
  securityConfig: SecurityConfig;
}

export interface ServerSystemRuntimeDependencies {
  engine: MonitorEngine;
  securityConfig: SecurityConfig;
}

export interface ServerSystemDbModule {
  buildSchemaSql?: () => string;
  runLegacyRepairs?: (db: Database) => void;
  applyMigrations?: (db: Database) => void;
  seedDefaults?: (deps: { db: Database; cryptoBox: unknown; env: NodeJS.ProcessEnv }) => void;
}

export interface ServerSystemAuthModule {
  canAccessUser?: (user: AppUser | null | undefined) => boolean;
  userAccessAssignmentResolvers?: SystemUserAccessAssignmentResolver[];
  userAccessSynchronizers?: SystemUserAccessSynchronizer[];
  userProjections?: SystemUserProjection[];
}

export interface ServerSystemModule {
  id: string;
  auth?: ServerSystemAuthModule;
  db?: ServerSystemDbModule;
  start?: (deps: ServerSystemRuntimeDependencies) => void;
  registerRoutes: (deps: ServerSystemDependencies) => void;
  registerWebSockets?: (deps: ServerSystemDependencies & { server: HttpServer }) => void;
}
