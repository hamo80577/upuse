import type { ScanoTaskDetail, ScanoTaskSummaryPatch } from "../../../api/types";

export function buildTaskSummaryFromResolveResponse(taskItem: {
  status: ScanoTaskSummaryPatch["status"];
  progress: ScanoTaskSummaryPatch["progress"];
  counters?: ScanoTaskSummaryPatch["counters"];
  viewerState: ScanoTaskSummaryPatch["viewerState"];
  permissions: ScanoTaskSummaryPatch["permissions"];
  latestExport?: ScanoTaskSummaryPatch["latestExport"];
}, counters?: ScanoTaskSummaryPatch["counters"]): ScanoTaskSummaryPatch {
  return {
    status: taskItem.status,
    progress: taskItem.progress,
    counters: counters ?? taskItem.counters,
    viewerState: taskItem.viewerState,
    permissions: taskItem.permissions,
    latestExport: taskItem.latestExport ?? null,
  };
}

export function mergeTaskSummaryIntoDetail(nextTask: ScanoTaskDetail | null, summary?: ScanoTaskSummaryPatch) {
  if (!nextTask || !summary) return nextTask;
  return {
    ...nextTask,
    ...summary,
  };
}
