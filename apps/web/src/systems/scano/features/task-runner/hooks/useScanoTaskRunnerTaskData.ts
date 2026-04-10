import { useCallback, useEffect, useRef, useState } from "react";
import type { NavigateFunction } from "react-router-dom";
import { api, describeApiError } from "../../../api/client";
import type { ScanoRunnerBootstrapResponse, ScanoTaskDetail } from "../../../api/types";

export function useScanoTaskRunnerTaskData(params: {
  taskId: string;
  fallbackPath: string;
  navigate: NavigateFunction;
}) {
  const { fallbackPath, navigate, taskId } = params;
  const [task, setTask] = useState<ScanoTaskDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [pageError, setPageError] = useState("");
  const [runnerBootstrap, setRunnerBootstrap] = useState<ScanoRunnerBootstrapResponse | null>(null);
  const [runnerBootstrapLoading, setRunnerBootstrapLoading] = useState(false);
  const [runnerBootstrapError, setRunnerBootstrapError] = useState("");
  const hydratedRunnerTaskIdRef = useRef<string | null>(null);

  const loadTask = useCallback(async (signal?: AbortSignal) => {
    if (!taskId) {
      navigate(fallbackPath, { replace: true });
      return;
    }

    try {
      setLoading(true);
      setPageError("");
      const response = await api.getScanoTask(taskId, { signal });
      if (signal?.aborted) return;
      setTask(response.item);
    } catch (error) {
      if (signal?.aborted) return;
      const message = describeApiError(error, "Failed to load task runner");
      if (message.trim().toLowerCase() === "forbidden") {
        navigate(fallbackPath, { replace: true });
        return;
      }
      setPageError(message);
    } finally {
      if (!signal?.aborted) {
        setLoading(false);
      }
    }
  }, [fallbackPath, navigate, taskId]);

  const loadRunnerBootstrap = useCallback(async (signal?: AbortSignal) => {
    if (!taskId) return null;
    try {
      setRunnerBootstrapLoading(true);
      setRunnerBootstrapError("");
      const response = await api.getScanoRunnerBootstrap(taskId, { signal });
      if (signal?.aborted) return null;
      setRunnerBootstrap(response.item);
      return response.item;
    } catch (error) {
      if (signal?.aborted) return null;
      setRunnerBootstrap(null);
      setRunnerBootstrapError(describeApiError(error, "Failed to prepare fast barcode lookup"));
      return null;
    } finally {
      if (!signal?.aborted) {
        setRunnerBootstrapLoading(false);
      }
    }
  }, [taskId]);

  useEffect(() => {
    const controller = new AbortController();
    void loadTask(controller.signal);
    return () => controller.abort();
  }, [loadTask]);

  const canUseRunnerBootstrap = !!task && task.status === "in_progress" && task.viewerState.canEnter;

  useEffect(() => {
    if (!canUseRunnerBootstrap) {
      hydratedRunnerTaskIdRef.current = null;
      setRunnerBootstrap(null);
      setRunnerBootstrapError("");
      setRunnerBootstrapLoading(false);
      return;
    }

    if (hydratedRunnerTaskIdRef.current === taskId) {
      return;
    }

    hydratedRunnerTaskIdRef.current = taskId;

    const controller = new AbortController();
    void loadRunnerBootstrap(controller.signal).then((response) => {
      if (!response) {
        hydratedRunnerTaskIdRef.current = null;
      }
    });
    return () => controller.abort();
  }, [canUseRunnerBootstrap, loadRunnerBootstrap, taskId]);

  return {
    loadRunnerBootstrap,
    loadTask,
    loading,
    pageError,
    runnerBootstrap,
    runnerBootstrapError,
    runnerBootstrapLoading,
    setRunnerBootstrap,
    setTask,
    task,
  };
}
