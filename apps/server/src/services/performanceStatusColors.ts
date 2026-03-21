import type { MonitorEngine } from "./monitorEngine.js";

export function buildPerformanceStatusColorMap(engine: MonitorEngine) {
  return new Map(engine.getSnapshot().branches.map((branch) => [branch.branchId, branch.statusColor]));
}
