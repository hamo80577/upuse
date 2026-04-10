import cors from "cors";
import express from "express";
import helmet from "helmet";
import morgan from "morgan";
import { getServerSystems } from "../../core/systems/registry/index.js";
import type { ServerSystemDependencies } from "../../core/systems/types.js";
import { createSessionAuthMiddleware } from "../../http/auth.js";
import { registerSharedRoutes } from "../../shared/http/registerSharedRoutes.js";
import { createApiNoStoreMiddleware } from "../middleware/cacheControl.js";
import { createCorsOptions } from "../middleware/cors.js";
import { createContentSecurityPolicyDirectives, createCspNonceMiddleware } from "../middleware/csp.js";
import { createTrustedOriginMiddleware } from "../middleware/trustedOrigin.js";
import { registerApiErrorHandler } from "../error-handling/registerApiErrorHandler.js";
import { registerProductionAssets } from "./registerProductionAssets.js";

export function createApp(deps: Omit<ServerSystemDependencies, "app">) {
  const app = express();
  const systems = getServerSystems();

  app.disable("x-powered-by");
  app.set("trust proxy", deps.securityConfig.trustProxy);
  app.use(cors(createCorsOptions()));
  app.use(createCspNonceMiddleware());
  app.use(helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: createContentSecurityPolicyDirectives(),
    },
  }));
  app.use(createApiNoStoreMiddleware());
  app.use(createTrustedOriginMiddleware());
  app.use(express.json({ limit: "1mb" }));
  app.use(morgan("tiny"));
  app.use(createSessionAuthMiddleware());

  registerSharedRoutes(app, deps.engine);

  const systemDeps: ServerSystemDependencies = {
    ...deps,
    app,
  };
  for (const system of systems) {
    system.registerRoutes(systemDeps);
  }

  app.use("/api", (_req, res) => {
    res.status(404).json({
      ok: false,
      message: "Not found",
    });
  });

  registerProductionAssets(app);
  registerApiErrorHandler(app);

  return app;
}
