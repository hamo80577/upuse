import type { ServerSystemDependencies } from "../../../core/systems/types.js";
import type { Server as HttpServer } from "node:http";
import { attachDashboardWebSocketServer } from "./dashboard.js";
import { attachPerformanceWebSocketServer } from "./performance.js";

export function registerUpuseWebSockets(deps: ServerSystemDependencies & { server: HttpServer }) {
  attachDashboardWebSocketServer({
    server: deps.server,
    engine: deps.engine,
    securityConfig: deps.securityConfig,
  });

  attachPerformanceWebSocketServer({
    server: deps.server,
    engine: deps.engine,
    securityConfig: deps.securityConfig,
  });
}
