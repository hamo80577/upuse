import type { ServerSystemModule } from "../../core/systems/types.js";
import { registerUpuseRoutes } from "./routes/registerRoutes.js";
import { canAccessUpuseSystem, upuseUserAccessAssignmentResolver } from "./services/userAccess.js";
import { registerUpuseWebSockets } from "./websocket/index.js";

export const upuseSystemModule: ServerSystemModule = {
  id: "upuse",
  auth: {
    canAccessUser: canAccessUpuseSystem,
    userAccessAssignmentResolvers: [upuseUserAccessAssignmentResolver],
  },
  start: () => {
    void import("./services/orders-mirror/index.js").then((module) => {
      module.startOrdersMirrorRuntime();
    });
  },
  registerRoutes: registerUpuseRoutes,
  registerWebSockets: registerUpuseWebSockets,
};
