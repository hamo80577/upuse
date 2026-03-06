import type {
  BranchDetailSnapshot,
  BranchMappingItem,
  DashboardSnapshot,
  LookupVendorNameResponse,
  SettingsMasked,
  SettingsTokenTestResponse,
} from "../../api/types";
import { clearStoredAdminKey, getStoredAdminKey, setStoredAdminKey } from "./adminKeyStorage";
import { describeApiError, requestCsvDownload, requestJson, requestJsonEventStream } from "./httpClient";

export const api = {
  health: () => requestJson<{ ok: boolean }>("/api/health", undefined, { timeoutMs: 10_000 }),
  dashboard: () => requestJson<DashboardSnapshot>("/api/dashboard", undefined, { timeoutMs: 20_000 }),
  streamDashboard: (options: {
    signal?: AbortSignal;
    onOpen?: () => void;
    onSnapshot: (snapshot: DashboardSnapshot) => void;
    onPing?: (payload: { at: string }) => void;
  }) =>
    requestJsonEventStream("/api/stream", {
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
    requestJson<{ ok: boolean; running: boolean; message?: string; snapshot: DashboardSnapshot }>("/api/monitor/refresh-orders", {
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
  branchDetail: (branchId: number, init?: RequestInit) => requestJson<BranchDetailSnapshot>(`/api/branches/${branchId}/detail`, init, { timeoutMs: 70_000 }),
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
  testTokens: () => requestJson<SettingsTokenTestResponse>("/api/settings/test", { method: "POST" }),

  listBranches: () => requestJson<{ items: BranchMappingItem[] }>("/api/branches"),
  addBranch: (payload: any) => requestJson<{ ok: boolean; id: number }>("/api/branches", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }),
  updateBranch: (id: number, payload: any) =>
    requestJson<{ ok: boolean; item: BranchMappingItem }>(`/api/branches/${id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }),
  deleteBranch: (id: number) => requestJson<{ ok: boolean }>(`/api/branches/${id}`, { method: "DELETE" }),

  lookupVendorName: (ordersVendorId: number, globalEntityId?: string) => {
    const query = new URLSearchParams({ ordersVendorId: String(ordersVendorId) });
    if (globalEntityId?.trim()) {
      query.set("globalEntityId", globalEntityId.trim());
    }
    return requestJson<LookupVendorNameResponse>(`/api/branches/lookup-vendor-name?${query.toString()}`);
  },

  parseMapping: (text: string) =>
    requestJson<{ ok: boolean; ordersVendorId: number | null; availabilityVendorId: string | null }>(`/api/branches/parse-mapping`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    }),
};

export { clearStoredAdminKey, describeApiError, getStoredAdminKey, setStoredAdminKey };
