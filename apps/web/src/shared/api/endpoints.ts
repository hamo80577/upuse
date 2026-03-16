import type {
  AuthMeResponse,
  AuthUsersResponse,
  HealthStatusResponse,
  LoginResponse,
  AppUserRole,
  BranchDetailResult,
  BranchMappingItem,
  BranchPickersSummary,
  DashboardSnapshot,
  LocalVendorCatalogItem,
  SettingsMasked,
  SettingsTokenTestSnapshot,
  SettingsTokenTestStartResponse,
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
  createUser: (payload: { email: string; password: string; name: string; role: AppUserRole }) =>
    requestJson<{ ok: boolean; user: AuthUsersResponse["items"][number] }>("/api/auth/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }),
  updateUser: (id: number, payload: { email: string; password?: string; name: string; role: AppUserRole }) =>
    requestJson<{ ok: boolean; user: AuthUsersResponse["items"][number] }>(`/api/auth/users/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }),
  deleteUser: (id: number) =>
    requestJson<{ ok: boolean }>(`/api/auth/users/${id}`, {
      method: "DELETE",
    }),
  dashboard: () => requestJson<DashboardSnapshot>("/api/dashboard", undefined, { timeoutMs: 20_000 }),
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
    payload: { lateThresholdOverride: number | null; unassignedThresholdOverride: number | null },
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
