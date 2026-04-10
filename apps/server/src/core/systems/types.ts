import type { Express } from "express";
import type { Server as HttpServer } from "node:http";
import type { SecurityConfig } from "../../config/security.js";
import type { MonitorEngine } from "../../services/monitorEngine.js";

export interface ServerSystemDependencies {
  app: Express;
  engine: MonitorEngine;
  securityConfig: SecurityConfig;
}

export interface ServerSystemModule {
  id: string;
  registerRoutes: (deps: ServerSystemDependencies) => void;
  registerWebSockets?: (deps: ServerSystemDependencies & { server: HttpServer }) => void;
}
