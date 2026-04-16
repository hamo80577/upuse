import type { ServerSystemModule } from "../../core/systems/types.js";
import { applyOpsSchemaMigrations } from "./db/migrations.js";
import { buildOpsSchemaSql } from "./db/schema.js";
import { hasOpsAccess } from "./policies/access.js";
import { registerOpsRoutes } from "./routes/registerRoutes.js";

export const opsSystemModule: ServerSystemModule = {
  id: "ops",
  auth: {
    canAccessUser: hasOpsAccess,
  },
  db: {
    buildSchemaSql: buildOpsSchemaSql,
    applyMigrations: applyOpsSchemaMigrations,
  },
  registerRoutes: registerOpsRoutes,
};
