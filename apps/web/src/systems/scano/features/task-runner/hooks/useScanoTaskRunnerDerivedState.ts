import { useMemo } from "react";
import type {
  ScanoRunnerBootstrapResponse,
  ScanoTaskDetail,
  ScanoTaskProduct,
  ScanoTaskProductsPageResponse,
} from "../../../api/types";

export function useScanoTaskRunnerDerivedState(params: {
  task: ScanoTaskDetail | null;
  runnerBootstrap: ScanoRunnerBootstrapResponse | null;
  productsPage: ScanoTaskProductsPageResponse;
  userId?: number | null;
  cameraOpen: boolean;
  cameraLoading: boolean;
  resolvingScan: boolean;
  runnerBootstrapLoading: boolean;
  runnerBootstrapError: string;
}) {
  const confirmedProductsByBarcode = useMemo(() => {
    const result = new Map<string, ScanoTaskProduct>();
    for (const product of params.runnerBootstrap?.confirmedProducts ?? []) {
      for (const barcode of product.barcodes) {
        result.set(barcode.trim().toLowerCase(), product);
      }
    }
    return result;
  }, [params.runnerBootstrap]);

  const latestConfirmedProduct = params.runnerBootstrap?.confirmedProducts[0] ?? params.productsPage.items[0] ?? null;
  const myConfirmedCount = useMemo(() => {
    if (!params.userId) return 0;
    return (params.runnerBootstrap?.confirmedProducts ?? []).filter((product) => product.createdBy.linkedUserId === params.userId).length;
  }, [params.runnerBootstrap, params.userId]);

  const showStartAction = params.task?.permissions.canStart ?? false;
  const showSearchCard = Boolean(params.task?.viewerState.canEnter && params.task.status === "in_progress" && !params.task.viewerState.hasEnded);
  const searchDisabled = params.resolvingScan
    || showStartAction
    || !params.task?.viewerState.canEnter
    || params.runnerBootstrapLoading
    || !!params.runnerBootstrapError
    || !params.runnerBootstrap;
  const cameraPreviewVisible = params.cameraOpen || params.cameraLoading;
  const cameraActionDisabled = params.resolvingScan
    || params.runnerBootstrapLoading
    || !!params.runnerBootstrapError
    || !params.runnerBootstrap;
  const cameraToggleLabel = params.cameraLoading
    ? "Opening Camera..."
    : params.cameraOpen
      ? "Stop Camera"
      : "Open Camera Scanner";
  const taskSummaryTitle = params.task?.branchName || params.task?.chainName || "";
  const taskSummarySubtitle = params.task?.branchName && params.task.branchName !== params.task.chainName
    ? params.task.chainName
    : null;
  const taskTotalLabel = `Task Total: ${params.task?.counters?.scannedProductsCount ?? 0}`;
  const myConfirmedLabel = `My Confirmed: ${myConfirmedCount}`;

  return {
    cameraActionDisabled,
    cameraPreviewVisible,
    cameraToggleLabel,
    confirmedProductsByBarcode,
    latestConfirmedProduct,
    myConfirmedCount,
    myConfirmedLabel,
    searchDisabled,
    showSearchCard,
    showStartAction,
    taskSummarySubtitle,
    taskSummaryTitle,
    taskTotalLabel,
  };
}
