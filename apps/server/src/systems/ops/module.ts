import type { ServerSystemModule } from "../../core/systems/types.js";
import { hasOpsAccess } from "./policies/access.js";
import { registerOpsRoutes } from "./routes/registerRoutes.js";

export const opsSystemModule: ServerSystemModule = {
  id: "ops",
  auth: {
    canAccessUser: hasOpsAccess,
  },
  registerRoutes: registerOpsRoutes,
};
