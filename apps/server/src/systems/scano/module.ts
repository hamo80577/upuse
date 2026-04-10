import type { ServerSystemModule } from "../../core/systems/types.js";
import { registerScanoRoutes } from "./routes/registerRoutes.js";

export const scanoSystemModule: ServerSystemModule = {
  id: "scano",
  registerRoutes: registerScanoRoutes,
};
