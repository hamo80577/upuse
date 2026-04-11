import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import type { NavigateFunction } from "react-router-dom";
import { api, describeApiError } from "../../../api/client";
import type { ScanoRunnerBootstrapResponse, ScanoTaskDetail } from "../../../api/types";
import type { EndDialogState, ToastState } from "../types";

export function useScanoTaskRunnerLifecycle(params: {
  task: ScanoTaskDetail | null;
  loadTask: (signal?: AbortSignal) => Promise<void>;
  navigate: NavigateFunction;
  onToast: (toast: ToastState) => void;
  setEndDialogState: Dispatch<SetStateAction<EndDialogState>>;
  setRunnerBootstrap: Dispatch<SetStateAction<ScanoRunnerBootstrapResponse | null>>;
  setTask: Dispatch<SetStateAction<ScanoTaskDetail | null>>;
  stopCamera: () => void;
}) {
  const [actionLoading, setActionLoading] = useState(false);
  const endSuccessTimerRef = useRef<number | null>(null);

  useEffect(() => () => {
    if (endSuccessTimerRef.current) {
      window.clearTimeout(endSuccessTimerRef.current);
    }
  }, []);

  async function handleStart() {
    if (!params.task) return;
    try {
      setActionLoading(true);
      await api.startScanoTask(params.task.id);
      await params.loadTask();
    } catch (error) {
      params.onToast({ type: "error", msg: describeApiError(error, "Failed to start task") });
    } finally {
      setActionLoading(false);
    }
  }

  async function confirmEndTask() {
    if (!params.task) return;

    try {
      setActionLoading(true);
      const response = await api.endScanoTask(params.task.id);
      params.stopCamera();
      params.setTask((current) => current ? { ...current, ...response.item } : current);
      params.setRunnerBootstrap(null);
      params.setEndDialogState("success");
      endSuccessTimerRef.current = window.setTimeout(() => {
        params.navigate(`/scano/tasks/${params.task?.id}`);
      }, 900);
    } catch (error) {
      params.setEndDialogState("closed");
      params.onToast({ type: "error", msg: describeApiError(error, "Failed to end task") });
    } finally {
      setActionLoading(false);
    }
  }

  return {
    actionLoading,
    confirmEndTask,
    handleStart,
  };
}
