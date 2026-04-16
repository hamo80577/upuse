import type { ServerSystemDependencies } from "../../../core/systems/types.js";
import { requireOpsAccess } from "../policies/access.js";

export function registerOpsRoutes({ app }: ServerSystemDependencies) {
  app.get("/api/ops/health", requireOpsAccess(), (_req, res) => {
    res.json({
      ok: true,
      system: "ops",
      status: "ready",
    });
  });
}
