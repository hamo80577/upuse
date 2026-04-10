import type {
  CreateScanoTaskPayload,
  ResolveScanoTaskScanPayload,
  SaveScanoTaskProductPayload,
  ScanoBranchOption,
  ScanoCatalogPage,
  ScanoChainOption,
  ScanoMasterProductDetail,
  ScanoMasterProductListItem,
  ScanoMasterProductMapping,
  ScanoMasterProductPreviewResponse,
  ScanoMasterProductsResponse,
  ScanoRunnerAssignmentResponse,
  ScanoRunnerBootstrapResponse,
  ScanoRunnerExternalSearchResponse,
  ScanoRunnerHydratePayload,
  ScanoRunnerSearchPayload,
  ScanoSettingsMasked,
  ScanoSettingsTestResponse,
  ScanoTaskDetail,
  ScanoTaskExport,
  ScanoTaskId,
  ScanoTaskListItem,
  ScanoTaskProduct,
  ScanoTaskProductListSourceFilter,
  ScanoTaskProductsPageResponse,
  ScanoTaskScanItem,
  ScanoTaskScanResolveResponse,
  ScanoTaskScansPageResponse,
  ScanoTaskSummaryPatch,
  ScanoTasksResponse,
  ScanoTeamResponse,
  UpdateScanoTaskAssigneesPayload,
  UpdateScanoTaskPayload,
} from "../../../api/types";
import { requestCsvDownload, requestJson } from "../../../shared/api/httpClient";

export const scanoApi = {
  listScanoChains: (query: string, options?: { signal?: AbortSignal }) => {
    const params = new URLSearchParams();
    if (query.trim()) {
      params.set("query", query.trim());
    }

    const suffix = params.size ? `?${params.toString()}` : "";
    return requestJson<ScanoCatalogPage<ScanoChainOption>>(`/api/scano/chains${suffix}`, {
      signal: options?.signal,
    }, { timeoutMs: 20_000 });
  },
  listScanoBranches: (chainId: number, query?: string, options?: { signal?: AbortSignal }) => {
    const params = new URLSearchParams({
      chainId: String(chainId),
    });
    if (query?.trim()) {
      params.set("query", query.trim());
    }

    return requestJson<ScanoCatalogPage<ScanoBranchOption>>(`/api/scano/branches?${params.toString()}`, {
      signal: options?.signal,
    }, { timeoutMs: 20_000 });
  },
  listScanoTasks: (filters?: { from?: string; to?: string; signal?: AbortSignal }) => {
    const params = new URLSearchParams();
    if (filters?.from) {
      params.set("from", filters.from);
    }
    if (filters?.to) {
      params.set("to", filters.to);
    }

    const suffix = params.size ? `?${params.toString()}` : "";
    return requestJson<ScanoTasksResponse>(`/api/scano/tasks${suffix}`, {
      signal: filters?.signal,
    }, { timeoutMs: 20_000 });
  },
  listScanoMasterProducts: (options?: { signal?: AbortSignal }) =>
    requestJson<ScanoMasterProductsResponse>("/api/scano/master-products", {
      signal: options?.signal,
    }, { timeoutMs: 20_000 }),
  previewScanoMasterProducts: (file: File, options?: { signal?: AbortSignal }) => {
    const formData = new FormData();
    formData.set("file", file);
    return requestJson<ScanoMasterProductPreviewResponse>("/api/scano/master-products/preview", {
      method: "POST",
      body: formData,
      signal: options?.signal,
    }, { timeoutMs: 30_000 });
  },
  createScanoMasterProduct: (payload: {
    chainId: number;
    chainName: string;
    mapping: ScanoMasterProductMapping;
    file: File;
  }, options?: { signal?: AbortSignal }) => {
    const formData = new FormData();
    formData.set("chainId", String(payload.chainId));
    formData.set("chainName", payload.chainName);
    formData.set("mappingJson", JSON.stringify(payload.mapping));
    formData.set("file", payload.file);
    return requestJson<{ ok: true; item: ScanoMasterProductListItem }>("/api/scano/master-products", {
      method: "POST",
      body: formData,
      signal: options?.signal,
    }, { timeoutMs: 30_000 });
  },
  getScanoMasterProduct: (chainId: number, options?: { signal?: AbortSignal }) =>
    requestJson<{ item: ScanoMasterProductDetail }>(`/api/scano/master-products/${chainId}`, {
      signal: options?.signal,
    }, { timeoutMs: 20_000 }),
  resumeScanoMasterProductEnrichment: (chainId: number, options?: { signal?: AbortSignal }) =>
    requestJson<{ ok: true; item: ScanoMasterProductListItem }>(`/api/scano/master-products/${chainId}/resume`, {
      method: "POST",
      signal: options?.signal,
    }, { timeoutMs: 20_000 }),
  updateScanoMasterProduct: (chainId: number, payload: {
    chainId: number;
    chainName: string;
    mapping: ScanoMasterProductMapping;
    file: File;
  }, options?: { signal?: AbortSignal }) => {
    const formData = new FormData();
    formData.set("chainId", String(payload.chainId));
    formData.set("chainName", payload.chainName);
    formData.set("mappingJson", JSON.stringify(payload.mapping));
    formData.set("file", payload.file);
    return requestJson<{ ok: true; item: ScanoMasterProductListItem }>(`/api/scano/master-products/${chainId}`, {
      method: "PUT",
      body: formData,
      signal: options?.signal,
    }, { timeoutMs: 30_000 });
  },
  deleteScanoMasterProduct: (chainId: number, options?: { signal?: AbortSignal }) =>
    requestJson<{ ok: true }>(`/api/scano/master-products/${chainId}`, {
      method: "DELETE",
      signal: options?.signal,
    }, { timeoutMs: 20_000 }),
  getScanoTask: (id: ScanoTaskId, options?: { signal?: AbortSignal }) =>
    requestJson<{ item: ScanoTaskDetail }>(`/api/scano/tasks/${id}`, {
      signal: options?.signal,
    }, { timeoutMs: 20_000 }),
  getScanoRunnerBootstrap: (id: ScanoTaskId, options?: { signal?: AbortSignal }) =>
    requestJson<{ ok: true; item: ScanoRunnerBootstrapResponse }>(`/api/scano/tasks/${id}/runner/bootstrap`, {
      signal: options?.signal,
    }, { timeoutMs: 20_000 }),
  searchScanoRunnerExternalProducts: (id: ScanoTaskId, payload: ScanoRunnerSearchPayload, options?: { signal?: AbortSignal }) =>
    requestJson<{ ok: true } & ScanoRunnerExternalSearchResponse>(`/api/scano/tasks/${id}/runner/search`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: options?.signal,
    }, { timeoutMs: 20_000 }),
  hydrateScanoRunnerExternalProduct: (id: ScanoTaskId, payload: ScanoRunnerHydratePayload, options?: { signal?: AbortSignal }) =>
    requestJson<{ ok: true; item: ScanoRunnerAssignmentResponse }>(`/api/scano/tasks/${id}/runner/hydrate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: options?.signal,
    }, { timeoutMs: 20_000 }),
  listScanoTaskProducts: (
    id: ScanoTaskId,
    params?: { page?: number; pageSize?: number; query?: string; source?: ScanoTaskProductListSourceFilter; signal?: AbortSignal },
  ) => {
    const searchParams = new URLSearchParams();
    if (params?.page) searchParams.set("page", String(params.page));
    if (params?.pageSize) searchParams.set("pageSize", String(params.pageSize));
    if (params?.query?.trim()) searchParams.set("query", params.query.trim());
    if (params?.source && params.source !== "all") searchParams.set("source", params.source);
    const suffix = searchParams.size ? `?${searchParams.toString()}` : "";
    return requestJson<ScanoTaskProductsPageResponse>(`/api/scano/tasks/${id}/products${suffix}`, {
      signal: params?.signal,
    }, { timeoutMs: 20_000 });
  },
  listScanoTaskScans: (
    id: ScanoTaskId,
    params?: { page?: number; pageSize?: number; signal?: AbortSignal },
  ) => {
    const searchParams = new URLSearchParams();
    if (params?.page) searchParams.set("page", String(params.page));
    if (params?.pageSize) searchParams.set("pageSize", String(params.pageSize));
    const suffix = searchParams.size ? `?${searchParams.toString()}` : "";
    return requestJson<ScanoTaskScansPageResponse>(`/api/scano/tasks/${id}/scans${suffix}`, {
      signal: params?.signal,
    }, { timeoutMs: 20_000 });
  },
  createScanoTask: (payload: CreateScanoTaskPayload) =>
    requestJson<{ ok: true; item: ScanoTaskListItem }>("/api/scano/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }, { timeoutMs: 20_000 }),
  updateScanoTask: (id: ScanoTaskId, payload: UpdateScanoTaskPayload) =>
    requestJson<{ ok: true; item: ScanoTaskListItem }>(`/api/scano/tasks/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }, { timeoutMs: 20_000 }),
  deleteScanoTask: (id: ScanoTaskId) =>
    requestJson<{ ok: true; item: { id: ScanoTaskId } }>(`/api/scano/tasks/${id}`, {
      method: "DELETE",
    }, { timeoutMs: 20_000 }),
  startScanoTask: (id: ScanoTaskId) =>
    requestJson<{ ok: true; item: ScanoTaskListItem }>(`/api/scano/tasks/${id}/start`, {
      method: "POST",
    }, { timeoutMs: 20_000 }),
  endScanoTask: (id: ScanoTaskId) =>
    requestJson<{ ok: true; item: ScanoTaskListItem }>(`/api/scano/tasks/${id}/end`, {
      method: "POST",
    }, { timeoutMs: 20_000 }),
  resumeScanoTask: (id: ScanoTaskId) =>
    requestJson<{ ok: true; item: ScanoTaskListItem }>(`/api/scano/tasks/${id}/resume`, {
      method: "POST",
    }, { timeoutMs: 20_000 }),
  completeScanoTask: (id: ScanoTaskId) =>
    requestJson<{ ok: true; item: ScanoTaskListItem }>(`/api/scano/tasks/${id}/complete`, {
      method: "POST",
    }, { timeoutMs: 20_000 }),
  updateScanoTaskAssignees: (id: ScanoTaskId, payload: UpdateScanoTaskAssigneesPayload) =>
    requestJson<{ ok: true; item: ScanoTaskListItem }>(`/api/scano/tasks/${id}/assignees`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }, { timeoutMs: 20_000 }),
  resolveScanoTaskScan: (id: ScanoTaskId, payload: ResolveScanoTaskScanPayload) =>
    requestJson<{ ok: true } & ScanoTaskScanResolveResponse>(`/api/scano/tasks/${id}/scans/resolve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }, { timeoutMs: 20_000 }),
  createScanoTaskProduct: (
    id: ScanoTaskId,
    payload: SaveScanoTaskProductPayload,
    images: File[] = [],
  ) => {
    const formData = new FormData();
    formData.set("payloadJson", JSON.stringify(payload));
    for (const image of images) {
      formData.append("images", image);
    }
    return requestJson<{ ok: true; item: ScanoTaskProduct; rawScan: ScanoTaskScanItem; taskSummary: ScanoTaskSummaryPatch }>(`/api/scano/tasks/${id}/products`, {
      method: "POST",
      body: formData,
    }, { timeoutMs: 30_000 });
  },
  updateScanoTaskProduct: (
    id: ScanoTaskId,
    productId: string,
    payload: SaveScanoTaskProductPayload,
    images: File[] = [],
  ) => {
    const formData = new FormData();
    formData.set("payloadJson", JSON.stringify(payload));
    for (const image of images) {
      formData.append("images", image);
    }
    return requestJson<{ ok: true; item: ScanoTaskProduct; taskSummary: ScanoTaskSummaryPatch }>(`/api/scano/tasks/${id}/products/${productId}`, {
      method: "PATCH",
      body: formData,
    }, { timeoutMs: 30_000 });
  },
  getScanoTaskProduct: (id: ScanoTaskId, productId: string, options?: { signal?: AbortSignal }) =>
    requestJson<{ ok?: true; item: ScanoTaskProduct }>(`/api/scano/tasks/${id}/products/${productId}`, {
      signal: options?.signal,
    }, { timeoutMs: 20_000 }),
  createScanoTaskExport: (id: ScanoTaskId) =>
    requestJson<{ ok: true; item: ScanoTaskExport; task: ScanoTaskDetail }>(`/api/scano/tasks/${id}/exports`, {
      method: "POST",
    }, { timeoutMs: 60_000 }),
  downloadScanoTaskExport: (id: ScanoTaskId, exportId: string) =>
    requestCsvDownload(`/api/scano/tasks/${id}/exports/${exportId}/download`, { timeoutMs: 60_000 }),
  confirmScanoTaskExportDownload: (id: ScanoTaskId, exportId: string) =>
    requestJson<{ ok: true; item: ScanoTaskExport; task: ScanoTaskDetail }>(`/api/scano/tasks/${id}/exports/${exportId}/confirm-download`, {
      method: "POST",
    }, { timeoutMs: 30_000 }),
  listScanoTeam: (options?: { signal?: AbortSignal }) =>
    requestJson<ScanoTeamResponse>("/api/scano/team", {
      signal: options?.signal,
    }, { timeoutMs: 20_000 }),
  getScanoSettings: (options?: { signal?: AbortSignal }) =>
    requestJson<ScanoSettingsMasked>("/api/scano/settings", {
      signal: options?.signal,
    }, { timeoutMs: 20_000 }),
  putScanoSettings: (payload: { catalogBaseUrl?: string; catalogToken?: string }, options?: { signal?: AbortSignal }) =>
    requestJson<{ ok: true; settings: ScanoSettingsMasked }>("/api/scano/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: options?.signal,
    }, { timeoutMs: 20_000 }),
  testScanoSettings: (payload: { catalogBaseUrl?: string; catalogToken?: string }, options?: { signal?: AbortSignal }) =>
    requestJson<ScanoSettingsTestResponse>("/api/scano/settings/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: options?.signal,
    }, { timeoutMs: 20_000 }),
};
