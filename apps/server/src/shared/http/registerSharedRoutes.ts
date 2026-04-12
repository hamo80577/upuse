import type { Express } from "express";
import {
  createUserRoute,
  deleteUserRoute,
  listUsersRoute,
  loginRoute,
  logoutRoute,
  meRoute,
  updateUserRoute,
} from "../../routes/auth.js";
import { health, readiness } from "../../routes/health.js";
import { requireAuthenticatedApi } from "./auth/sessionAuth.js";
import { requireAdminRole } from "../../systems/upuse/policies/access.js";
import type { MonitorEngine } from "../../monitor/engine/MonitorEngine.js";

export function registerSharedRoutes(app: Express, engine: MonitorEngine) {
  app.get("/api/health", health(engine));
  app.get("/api/ready", readiness(engine));
  app.post("/api/auth/login", loginRoute);
  app.use(requireAuthenticatedApi());
  app.get("/api/auth/me", meRoute);
  app.post("/api/auth/logout", logoutRoute());
  app.get("/api/auth/users", requireAdminRole(), listUsersRoute);
  app.post("/api/auth/users", requireAdminRole(), createUserRoute);
  app.patch("/api/auth/users/:id", requireAdminRole(), updateUserRoute);
  app.delete("/api/auth/users/:id", requireAdminRole(), deleteUserRoute);
}
