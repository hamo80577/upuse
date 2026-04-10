import { useCallback, useEffect, useState } from "react";
import { api, describeApiError } from "../../../api/client";
import type { ScanoTaskProduct, ScanoTaskProductListSourceFilter, ScanoTaskProductsPageResponse, ScanoTaskScansPageResponse } from "../../../api/types";
import { EMPTY_PRODUCTS_PAGE, EMPTY_SCANS_PAGE, PRODUCTS_PAGE_SIZE } from "../constants";
import { matchesScanoTaskProductFilter } from "../../../pages/scano/ui/scanoShared";
import type { ToastState } from "../types";

export function useScanoTaskRunnerPages(params: {
  taskId: string;
  productQuery: string;
  productSourceFilter: ScanoTaskProductListSourceFilter;
  onToast: (toast: ToastState) => void;
}) {
  const {
    onToast,
    productQuery,
    productSourceFilter,
    taskId,
  } = params;
  const [productsPage, setProductsPage] = useState<ScanoTaskProductsPageResponse>(EMPTY_PRODUCTS_PAGE);
  const [productsLoading, setProductsLoading] = useState(false);
  const [scanHistoryOpen, setScanHistoryOpen] = useState(false);
  const [scanHistoryLoading, setScanHistoryLoading] = useState(false);
  const [scanHistoryLoaded, setScanHistoryLoaded] = useState(false);
  const [scansPage, setScansPage] = useState<ScanoTaskScansPageResponse>(EMPTY_SCANS_PAGE);

  const loadProductsPage = useCallback(async (page = 1, signal?: AbortSignal) => {
    if (!taskId) return;
    try {
      setProductsLoading(true);
      const response = await api.listScanoTaskProducts(taskId, {
        page,
        pageSize: PRODUCTS_PAGE_SIZE,
        query: productQuery,
        source: productSourceFilter,
        signal,
      });
      if (signal?.aborted) return;
      setProductsPage(response);
    } catch (error) {
      if (signal?.aborted) return;
      onToast({ type: "error", msg: describeApiError(error, "Failed to load confirmed products") });
    } finally {
      if (!signal?.aborted) {
        setProductsLoading(false);
      }
    }
  }, [onToast, productQuery, productSourceFilter, taskId]);

  const loadScanHistory = useCallback(async (page = 1, signal?: AbortSignal) => {
    if (!taskId) return;
    try {
      setScanHistoryLoading(true);
      const response = await api.listScanoTaskScans(taskId, {
        page,
        pageSize: PRODUCTS_PAGE_SIZE,
        signal,
      });
      if (signal?.aborted) return;
      setScansPage(response);
      setScanHistoryLoaded(true);
    } catch (error) {
      if (signal?.aborted) return;
      onToast({ type: "error", msg: describeApiError(error, "Failed to load scan history") });
    } finally {
      if (!signal?.aborted) {
        setScanHistoryLoading(false);
      }
    }
  }, [onToast, taskId]);

  useEffect(() => {
    const controller = new AbortController();
    void loadProductsPage(1, controller.signal);
    return () => controller.abort();
  }, [loadProductsPage]);

  useEffect(() => {
    if (!scanHistoryOpen || scanHistoryLoaded) return;
    const controller = new AbortController();
    void loadScanHistory(1, controller.signal);
    return () => controller.abort();
  }, [loadScanHistory, scanHistoryLoaded, scanHistoryOpen]);

  function closeScanHistory(resetLoaded = false) {
    setScanHistoryOpen(false);
    if (resetLoaded) {
      setScanHistoryLoaded(false);
      setScansPage(EMPTY_SCANS_PAGE);
    }
  }

  function updateProductsPageWithSavedItem(item: ScanoTaskProduct) {
    setProductsPage((current) => {
      const exists = current.items.some((entry) => entry.id === item.id);
      const matchesFilter = matchesScanoTaskProductFilter(item, productQuery, productSourceFilter);

      if (!matchesFilter) {
        if (!exists) return current;
        const nextItems = current.items.filter((entry) => entry.id !== item.id);
        const nextTotal = Math.max(0, current.total - 1);
        return {
          ...current,
          items: nextItems,
          total: nextTotal,
          totalPages: Math.max(1, Math.ceil(nextTotal / current.pageSize)),
        };
      }

      if (current.page !== 1 && !exists) {
        return current;
      }

      const nextItems = [item, ...current.items.filter((entry) => entry.id !== item.id)]
        .slice(0, current.pageSize);
      const nextTotal = exists ? current.total : current.total + 1;

      return {
        ...current,
        items: nextItems,
        total: nextTotal,
        totalPages: Math.max(1, Math.ceil(nextTotal / current.pageSize)),
      };
    });
  }

  return {
    closeScanHistory,
    loadProductsPage,
    loadScanHistory,
    productsLoading,
    productsPage,
    scanHistoryLoaded,
    scanHistoryLoading,
    scanHistoryOpen,
    scansPage,
    setScanHistoryOpen,
    updateProductsPageWithSavedItem,
  };
}
