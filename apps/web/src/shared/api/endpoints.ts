import type {
  AuthMeResponse,
  AuthUsersResponse,
  UpuseUserAccessPayload,
  CreateScanoTaskPayload,
  HealthStatusResponse,
  LoginResponse,
  AppUserRole,
  BranchDetailResult,
  PerformanceBranchFilter,
  PerformanceBranchDetailResponse,
  PerformanceDeliveryTypeFilter,
  PerformancePreferencesResponse,
  PerformancePreferencesState,
  PerformanceSavedGroup,
  PerformanceSavedView,
  PerformanceLiveMessage,
  PerformanceLiveUpdate,
  PerformanceSummaryResponse,
  PerformanceTrendResolutionMinutes,
  PerformanceTrendResponse,
  PerformanceVendorDetailResponse,
  BranchMappingItem,
  BranchPickersSummary,
  DashboardSnapshot,
  LocalVendorCatalogItem,
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
  ScanoTaskProductListSourceFilter,
  ScanoTaskProduct,
  ScanoTaskProductsPageResponse,
  ScanoTaskScanItem,
  ScanoTaskScansPageResponse,
  ScanoTaskSummaryPatch,
  ScanoTaskCounters,
  ScanoTaskScanResolveResponse,
  ScanoTasksResponse,
  ScanoTeamResponse,
  ResolveScanoTaskScanPayload,
  SaveScanoTaskProductPayload,
  SettingsMasked,
  SettingsTokenTestSnapshot,
  SettingsTokenTestStartResponse,
  UpdateScanoTaskPayload,
  UpdateScanoTaskAssigneesPayload,
} from "../../api/types";
import { AUTH_FORBIDDEN_EVENT, AUTH_UNAUTHORIZED_EVENT, describeApiError, requestCsvDownload, requestJson, requestJsonWebSocket } from "./httpClient";

type LegacyBranchMappingItem = Omit<BranchMappingItem, "chainName" | "catalogState"> & {
  chainName?: string | null;
  catalogState?: BranchMappingItem["catalogState"];
  globalEntityId?: string;
};

type LegacyBranchCatalogItem = LocalVendorCatalogItem & {
  globalEntityId?: string;
  availabilityState?: string;
  changeable?: boolean;
  presentInSource?: boolean;
  resolveStatus?: string;
  lastSeenAt?: string | null;
  resolvedAt?: string | null;
  lastError?: string | null;
};

type StaticVendorCatalogItem = Pick<LocalVendorCatalogItem, "availabilityVendorId" | "ordersVendorId" | "name">;

function isEndpointMissing(error: unknown) {
  const message = describeApiError(error, "").trim().toLowerCase();
  return message === "not found" || message === "http 404" || message.includes("404");
}

function shouldTryLegacyBranchAdd(error: unknown) {
  const message = describeApiError(error, "").trim().toLowerCase();
  if (!message) return false;

  return !message.includes("already exists")
    && !message.includes("unauthorized")
    && !message.includes("sign in again");
}

function normalizeBranchItem(item: BranchMappingItem | LegacyBranchMappingItem): BranchMappingItem {
  const name = typeof item.name === "string" ? item.name : null;
  const ordersVendorId = typeof item.ordersVendorId === "number" && Number.isFinite(item.ordersVendorId)
    ? item.ordersVendorId
    : null;
  const catalogState = item.catalogState === "available" || item.catalogState === "missing"
    ? item.catalogState
    : (name && ordersVendorId ? "available" : "missing");

  return {
    ...item,
    name,
    chainName: typeof item.chainName === "string" ? item.chainName : "",
    ordersVendorId,
    catalogState,
    capacityRuleEnabledOverride:
      typeof item.capacityRuleEnabledOverride === "boolean"
        ? item.capacityRuleEnabledOverride
        : item.capacityRuleEnabledOverride == null
          ? null
          : Boolean(item.capacityRuleEnabledOverride),
    capacityPerHourEnabledOverride:
      typeof item.capacityPerHourEnabledOverride === "boolean"
        ? item.capacityPerHourEnabledOverride
        : item.capacityPerHourEnabledOverride == null
          ? null
          : Boolean(item.capacityPerHourEnabledOverride),
    readyThresholdOverride:
      typeof item.readyThresholdOverride === "number" && Number.isFinite(item.readyThresholdOverride)
        ? Math.max(0, Math.round(item.readyThresholdOverride))
        : null,
    lateReopenThresholdOverride:
      typeof item.lateReopenThresholdOverride === "number" && Number.isFinite(item.lateReopenThresholdOverride)
        ? Math.max(0, Math.round(item.lateReopenThresholdOverride))
        : null,
    unassignedReopenThresholdOverride:
      typeof item.unassignedReopenThresholdOverride === "number" && Number.isFinite(item.unassignedReopenThresholdOverride)
        ? Math.max(0, Math.round(item.unassignedReopenThresholdOverride))
        : null,
    readyReopenThresholdOverride:
      typeof item.readyReopenThresholdOverride === "number" && Number.isFinite(item.readyReopenThresholdOverride)
        ? Math.max(0, Math.round(item.readyReopenThresholdOverride))
        : null,
    capacityPerHourLimitOverride:
      typeof item.capacityPerHourLimitOverride === "number" && Number.isFinite(item.capacityPerHourLimitOverride)
        ? Math.max(1, Math.round(item.capacityPerHourLimitOverride))
        : null,
  };
}

function normalizeBranchItemsResponse(response: { items: Array<BranchMappingItem | LegacyBranchMappingItem> }) {
  return {
    items: response.items.map(normalizeBranchItem),
  };
}

export const api = {
  health: () => requestJson<HealthStatusResponse>("/api/health", undefined, { timeoutMs: 10_000 }),
  readiness: () => requestJson<HealthStatusResponse>("/api/ready", undefined, { timeoutMs: 10_000 }),
  login: (payload: { email: string; password: string }) =>
    requestJson<LoginResponse>("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }),
  me: () => requestJson<AuthMeResponse>("/api/auth/me"),
  logout: () => requestJson<{ ok: boolean }>("/api/auth/logout", { method: "POST" }),
  listUsers: () => requestJson<AuthUsersResponse>("/api/auth/users"),
  createUser: (payload: UpuseUserAccessPayload & { password: string }) =>
    requestJson<{ ok: boolean; user: AuthUsersResponse["items"][number] }>("/api/auth/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }),
  updateUser: (id: number, payload: UpuseUserAccessPayload) =>
    requestJson<{ ok: boolean; user: AuthUsersResponse["items"][number] }>(`/api/auth/users/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }),
  deleteUser: (id: number) =>
    requestJson<{ ok: boolean }>(`/api/auth/users/${id}`, {
      method: "DELETE",
    }),
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
  dashboard: () => requestJson<DashboardSnapshot>("/api/dashboard", undefined, { timeoutMs: 20_000 }),
  performanceSummary: (options?: { signal?: AbortSignal }) =>
    requestJson<PerformanceSummaryResponse>("/api/performance", { signal: options?.signal }, { timeoutMs: 20_000 }),
  performanceTrend: (
    payload: {
      resolutionMinutes: PerformanceTrendResolutionMinutes;
      startMinute: number;
      endMinute: number;
      vendorIds?: number[];
      searchQuery?: string;
      selectedDeliveryTypes?: PerformanceDeliveryTypeFilter[];
      selectedBranchFilters?: PerformanceBranchFilter[];
    },
    options?: { signal?: AbortSignal },
  ) =>
    requestJson<PerformanceTrendResponse>("/api/performance/trends", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: options?.signal,
    }, { timeoutMs: 20_000 }),
  performanceBranchDetail: (branchId: number, options?: { signal?: AbortSignal }) =>
    requestJson<PerformanceBranchDetailResponse>(`/api/performance/branches/${branchId}`, { signal: options?.signal }, { timeoutMs: 20_000 }),
  performanceVendorDetail: (vendorId: number, options?: { signal?: AbortSignal }) =>
    requestJson<PerformanceVendorDetailResponse>(`/api/performance/vendors/${vendorId}`, { signal: options?.signal }, { timeoutMs: 20_000 }),
  performancePreferences: (options?: { signal?: AbortSignal }) =>
    requestJson<PerformancePreferencesResponse>("/api/performance/preferences", { signal: options?.signal }, { timeoutMs: 20_000 }),
  savePerformanceCurrentPreferences: (payload: PerformancePreferencesState, options?: { signal?: AbortSignal }) =>
    requestJson<{ ok: true; current: PerformancePreferencesState }>("/api/performance/preferences/current", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: options?.signal,
    }, { timeoutMs: 20_000 }),
  createPerformanceGroup: (payload: { name: string; vendorIds: number[] }, options?: { signal?: AbortSignal }) =>
    requestJson<{ ok: true; group: PerformanceSavedGroup }>("/api/performance/preferences/groups", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: options?.signal,
    }, { timeoutMs: 20_000 }),
  updatePerformanceGroup: (id: number, payload: { name?: string; vendorIds?: number[] }, options?: { signal?: AbortSignal }) =>
    requestJson<{ ok: true; group: PerformanceSavedGroup }>(`/api/performance/preferences/groups/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: options?.signal,
    }, { timeoutMs: 20_000 }),
  deletePerformanceGroup: (id: number, options?: { signal?: AbortSignal }) =>
    requestJson<{ ok: true }>(`/api/performance/preferences/groups/${id}`, {
      method: "DELETE",
      signal: options?.signal,
    }, { timeoutMs: 20_000 }),
  createPerformanceView: (payload: { name: string; state: PerformanceSavedView["state"] }, options?: { signal?: AbortSignal }) =>
    requestJson<{ ok: true; view: PerformanceSavedView }>("/api/performance/preferences/views", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: options?.signal,
    }, { timeoutMs: 20_000 }),
  updatePerformanceView: (id: number, payload: { name?: string; state?: PerformanceSavedView["state"] }, options?: { signal?: AbortSignal }) =>
    requestJson<{ ok: true; view: PerformanceSavedView }>(`/api/performance/preferences/views/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: options?.signal,
    }, { timeoutMs: 20_000 }),
  deletePerformanceView: (id: number, options?: { signal?: AbortSignal }) =>
    requestJson<{ ok: true }>(`/api/performance/preferences/views/${id}`, {
      method: "DELETE",
      signal: options?.signal,
    }, { timeoutMs: 20_000 }),
  streamPerformance: (options: {
    signal?: AbortSignal;
    onOpen?: () => void;
    onSummary: (summary: PerformanceSummaryResponse) => void;
    onSync?: (update: PerformanceLiveUpdate) => void;
    onPing?: (payload: { at: string }) => void;
  }) =>
    requestJsonWebSocket("/api/ws/performance", {
      signal: options.signal,
      onOpen: options.onOpen,
      onMessage: (eventName, data) => {
        if (eventName === "summary") {
          options.onSummary((data as PerformanceLiveMessage["data"]) as PerformanceSummaryResponse);
          return;
        }
        if (eventName === "sync") {
          options.onSync?.(data as PerformanceLiveUpdate);
          return;
        }
        if (eventName === "ping") {
          options.onPing?.(data as { at: string });
        }
      },
    }),
  streamDashboard: (options: {
    signal?: AbortSignal;
    onOpen?: () => void;
    onSnapshot: (snapshot: DashboardSnapshot) => void;
    onPing?: (payload: { at: string }) => void;
  }) =>
    requestJsonWebSocket("/api/ws/dashboard", {
      signal: options.signal,
      onOpen: options.onOpen,
      onMessage: (eventName, data) => {
        if (eventName === "snapshot") {
          options.onSnapshot(data as DashboardSnapshot);
          return;
        }
        if (eventName === "ping") {
          options.onPing?.(data as { at: string });
        }
      },
    }),
  monitorStatus: () => requestJson<DashboardSnapshot["monitoring"]>("/api/monitor/status", undefined, { timeoutMs: 20_000 }),
  monitorRefreshOrders: () =>
    requestJson<{ ok: boolean; running: boolean; inProgress?: boolean; message?: string; snapshot: DashboardSnapshot }>("/api/monitor/refresh-orders", {
      method: "POST",
    }, {
      timeoutMs: 70_000,
    }),
  logs: (branchId: number, beforeDay?: string, init?: RequestInit) => {
    const query = new URLSearchParams({ branchId: String(branchId) });
    if (beforeDay) {
      query.set("beforeDay", beforeDay);
    }
    return requestJson<{
      dayKey: string | null;
      dayLabel: string | null;
      items: Array<{ ts: string; level: string; message: string }>;
      hasMore: boolean;
    }>(`/api/logs?${query.toString()}`, init);
  },
  clearLogs: (branchId: number) => requestJson<{ ok: boolean }>(`/api/logs?branchId=${branchId}`, { method: "DELETE" }),
  branchDetail: (branchId: number, options?: { signal?: AbortSignal; includePickerItems?: boolean }) => {
    const query = new URLSearchParams();
    if (options?.includePickerItems === false) {
      query.set("includePickerItems", "0");
    }
    const suffix = query.size ? `?${query.toString()}` : "";
    return requestJson<BranchDetailResult>(`/api/branches/${branchId}/detail${suffix}`, { signal: options?.signal }, { timeoutMs: 70_000 });
  },
  branchPickers: (branchId: number, init?: RequestInit) =>
    requestJson<BranchPickersSummary>(`/api/branches/${branchId}/pickers`, init, { timeoutMs: 70_000 }),
  downloadMonitorReport: (params: { preset: "today" | "yesterday" | "last7" | "last30" | "day"; day?: string }) => {
    const query = new URLSearchParams({ preset: params.preset });
    if (params.preset === "day" && params.day) {
      query.set("day", params.day);
    }
    return requestCsvDownload(`/api/reports/monitor-actions.csv?${query.toString()}`, { timeoutMs: 60_000 });
  },

  monitorStart: () => requestJson<{ ok: boolean; running: boolean; snapshot?: DashboardSnapshot }>("/api/monitor/start", { method: "POST" }, { timeoutMs: 70_000 }),
  monitorStop: () => requestJson<{ ok: boolean; running: boolean; snapshot?: DashboardSnapshot }>("/api/monitor/stop", { method: "POST" }, { timeoutMs: 20_000 }),

  getSettings: () => requestJson<SettingsMasked>("/api/settings"),
  putSettings: (payload: any) => requestJson<{ ok: boolean }>("/api/settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }),
  startTokenTest: () => requestJson<SettingsTokenTestStartResponse>("/api/settings/test", { method: "POST" }),
  getTokenTest: (jobId: string) => requestJson<SettingsTokenTestSnapshot>(`/api/settings/test/${encodeURIComponent(jobId)}`),

  listBranches: async () =>
    normalizeBranchItemsResponse(await requestJson<{ items: Array<BranchMappingItem | LegacyBranchMappingItem> }>("/api/branches")),
  listBranchSource: async () => {
    try {
      return await requestJson<{ items: LocalVendorCatalogItem[] }>("/api/branches/source");
    } catch (error) {
      if (!isEndpointMissing(error)) throw error;

      try {
        const staticResponse = await requestJson<StaticVendorCatalogItem[]>("/vendor-catalog.json");
        return {
          items: staticResponse.map((item) => ({
            availabilityVendorId: item.availabilityVendorId,
            ordersVendorId: item.ordersVendorId,
            name: item.name,
            alreadyAdded: false,
            branchId: null,
            chainName: null,
            enabled: null,
          })),
        };
      } catch (staticError) {
        if (!isEndpointMissing(staticError)) throw staticError;

        const legacyResponse = await requestJson<{ items: LegacyBranchCatalogItem[] }>("/api/branches/catalog");
        return {
          items: legacyResponse.items.map((item) => ({
            availabilityVendorId: item.availabilityVendorId,
            ordersVendorId: item.ordersVendorId,
            name: item.name,
            alreadyAdded: item.alreadyAdded,
            branchId: item.branchId,
            chainName: item.chainName,
            enabled: item.enabled,
          })),
        };
      }
    }
  },
  addBranch: async (payload: {
    availabilityVendorId: string;
    chainName: string;
    name?: string;
    ordersVendorId?: number;
  }) => {
    const narrowPayload = {
      availabilityVendorId: payload.availabilityVendorId,
      chainName: payload.chainName,
    };

    const submitNarrowPayload = () => requestJson<{ ok: boolean; id: number }>("/api/branches", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(narrowPayload),
    });

    try {
      return await submitNarrowPayload();
    } catch (firstError) {
      if (!shouldTryLegacyBranchAdd(firstError)) {
        throw firstError;
      }

      try {
        await requestJson<{ items?: unknown[]; syncState?: string }>("/api/branches/catalog/refresh", {
          method: "POST",
        });
        return await submitNarrowPayload();
      } catch {}

      if (!payload.name || typeof payload.ordersVendorId !== "number") {
        throw firstError;
      }

      try {
        return await requestJson<{ ok: boolean; id: number }>("/api/branches", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: payload.name,
            chainName: payload.chainName,
            ordersVendorId: payload.ordersVendorId,
            availabilityVendorId: payload.availabilityVendorId,
            enabled: true,
          }),
        });
      } catch {
        throw firstError;
      }
    }
  },
  setBranchThresholdOverrides: (
    id: number,
    payload: {
      lateThresholdOverride: number | null;
      lateReopenThresholdOverride: number | null;
      unassignedThresholdOverride: number | null;
      unassignedReopenThresholdOverride: number | null;
      readyThresholdOverride: number | null;
      readyReopenThresholdOverride: number | null;
      capacityRuleEnabledOverride: boolean | null;
      capacityPerHourEnabledOverride: boolean | null;
      capacityPerHourLimitOverride: number | null;
    },
  ) =>
    requestJson<{ ok: boolean; item: BranchMappingItem | LegacyBranchMappingItem }>(`/api/branches/${id}/threshold-overrides`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }).then((response) => ({
      ...response,
      item: normalizeBranchItem(response.item),
    })),
  setBranchMonitoring: (id: number, enabled: boolean) =>
    requestJson<{ ok: boolean; item: BranchMappingItem | LegacyBranchMappingItem }>(`/api/branches/${id}/monitoring`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled }),
    }).then((response) => ({
      ...response,
      item: normalizeBranchItem(response.item),
    })),
  deleteBranch: (id: number) => requestJson<{ ok: boolean }>(`/api/branches/${id}`, { method: "DELETE" }),
};

export {
  AUTH_FORBIDDEN_EVENT,
  AUTH_UNAUTHORIZED_EVENT,
  describeApiError,
};
