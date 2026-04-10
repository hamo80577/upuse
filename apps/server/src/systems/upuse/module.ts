import type { ServerSystemModule } from "../../core/systems/types.js";
import { registerUpuseRoutes } from "./routes/registerRoutes.js";
import { registerUpuseWebSockets } from "./websocket/index.js";

export const upuseSystemModule: ServerSystemModule = {
  id: "upuse",
  registerRoutes: registerUpuseRoutes,
  registerWebSockets: registerUpuseWebSockets,
};
