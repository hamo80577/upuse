import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OpsErrorItem, OpsEventItem, OpsPageResponse, OpsSessionItem, OpsSummaryResponse } from "../../../api/types";

const {
  mockOpsSummary,
  mockOpsSessions,
  mockOpsEvents,
  mockOpsErrors,
} = vi.hoisted(() => ({
  mockOpsSummary: vi.fn(),
  mockOpsSessions: vi.fn(),
  mockOpsEvents: vi.fn(),
  mockOpsErrors: vi.fn(),
}));

vi.mock("../../../../../api/client", () => ({
  api: {
    opsSummary: mockOpsSummary,
    opsSessions: mockOpsSessions,
    opsEvents: mockOpsEvents,
    opsErrors: mockOpsErrors,
  },
  describeApiError: (error: unknown, fallback = "Request failed") =>
    error instanceof Error ? error.message : fallback,
}));

vi.mock("../../../../../app/shell/TopBar", () => ({
  TopBar: () => <div>TopBar</div>,
}));

vi.mock("echarts-for-react/lib/core", () => ({
  default: (props: { "data-testid"?: string }) => (
    <div data-testid={props["data-testid"] ?? "ops-chart"}>chart</div>
  ),
}));

import { OpsOverviewPage } from "./OpsOverviewPage";

const TEST_TIMEOUT_MS = 15_000;

const baseSummary: OpsSummaryResponse = {
  ok: true,
  generatedAt: "2026-04-16T10:00:00.000Z",
  freshness: {
    sessionsLastSeenAt: "2026-04-16T09:59:30.000Z",
    eventsLastSeenAt: "2026-04-16T09:59:40.000Z",
    errorsLastSeenAt: "2026-04-16T09:58:00.000Z",
  },
  windows: {
    current: {
      startUtcIso: "2026-04-16T09:00:00.000Z",
      endUtcIso: "2026-04-16T10:00:00.000Z",
    },
    previous: {
      startUtcIso: "2026-04-16T08:00:00.000Z",
      endUtcIso: "2026-04-16T09:00:00.000Z",
    },
    today: {
      startUtcIso: "2026-04-15T22:00:00.000Z",
      endUtcIso: "2026-04-16T21:59:59.999Z",
    },
    timezone: "Africa/Cairo",
  },
  counts: {
    onlineUsers: 2,
    activeUsers: 1,
    idleUsers: 1,
    sessionsToday: 4,
    pageViewsToday: 12,
    errorCountToday: 1,
    apiRequestCount: 8,
    apiFailureCount: 1,
  },
  kpis: [
    { key: "sessions", label: "Sessions", value: 2, previousValue: 1, delta: 1, direction: "up", status: "good" },
    { key: "page_views", label: "Page views", value: 7, previousValue: 4, delta: 3, direction: "up", status: "good" },
    { key: "api_requests", label: "API requests", value: 8, previousValue: 5, delta: 3, direction: "up", status: "good" },
    { key: "errors", label: "Errors", value: 1, previousValue: 0, delta: 1, direction: "up", status: "warning" },
  ],
  statusBuckets: {
    sessionsByState: [
      { key: "active", count: 1 },
      { key: "idle", count: 1 },
    ],
    sessionsBySystem: [
      { key: "upuse", count: 1 },
      { key: "scano", count: 1 },
    ],
    apiStatus: [
      { key: "2xx", count: 7 },
      { key: "5xx", count: 1 },
    ],
  },
  errorBuckets: {
    bySeverity: [
      { key: "error", count: 1 },
    ],
    bySource: [
      { key: "frontend", count: 1 },
    ],
    top: [
      {
        signature: "api:/api/orders:500",
        message: "Orders API failed",
        severity: "error",
        count: 1,
        lastSeenAt: "2026-04-16T09:58:00.000Z",
      },
    ],
  },
  topPages: [
    { path: "/dashboard", views: 5, uniqueSessions: 2 },
    { path: "/scano/assign-task", views: 2, uniqueSessions: 1 },
  ],
  topEventTypes: [
    { type: "page_view", count: 5 },
    { type: "api_error", count: 1 },
  ],
  health: {
    dashboard: {
      ready: true,
      monitorDegraded: false,
      readiness: {
        state: "ready",
        message: "Monitor ready",
      },
    },
    performance: {
      status: "warning",
      lastOpenedAt: "2026-04-16T09:55:00.000Z",
      errorCount: 1,
      apiFailureCount: 1,
    },
  },
};

const baseSessions: OpsSessionItem[] = [
  {
    id: "session-upuse",
    userId: 10,
    userEmail: "ali@example.test",
    userName: "Ali User",
    currentSystem: "upuse",
    currentPath: "/dashboard",
    referrer: null,
    source: "web",
    firstSeenAt: "2026-04-16T09:20:00.000Z",
    lastSeenAt: "2026-04-16T09:59:30.000Z",
    lastActiveAt: "2026-04-16T09:59:20.000Z",
    endedAt: null,
    state: "active",
    userAgentSummary: "Chrome on Windows",
    browserSummary: "Chrome",
    deviceSummary: "Desktop",
    createdAt: "2026-04-16T09:20:00.000Z",
    updatedAt: "2026-04-16T09:59:30.000Z",
  },
  {
    id: "session-scano",
    userId: 11,
    userEmail: "nada@example.test",
    userName: "Nada Scanner",
    currentSystem: "scano",
    currentPath: "/scano/assign-task",
    referrer: null,
    source: "web",
    firstSeenAt: "2026-04-16T09:10:00.000Z",
    lastSeenAt: "2026-04-16T09:58:30.000Z",
    lastActiveAt: "2026-04-16T09:45:00.000Z",
    endedAt: null,
    state: "idle",
    userAgentSummary: "Edge on Windows",
    browserSummary: "Edge",
    deviceSummary: "Desktop",
    createdAt: "2026-04-16T09:10:00.000Z",
    updatedAt: "2026-04-16T09:58:30.000Z",
  },
];

const baseEvents: OpsEventItem[] = [
  {
    id: 1,
    sessionId: "session-upuse",
    userId: 10,
    eventType: "page_view",
    category: "navigation",
    system: "upuse",
    path: "/dashboard",
    routePattern: "/dashboard",
    pageTitle: "Dashboard",
    endpoint: null,
    method: null,
    statusCode: null,
    durationMs: null,
    success: true,
    source: "frontend",
    severity: "info",
    occurredAt: "2026-04-16T09:45:00.000Z",
    createdAt: "2026-04-16T09:45:00.000Z",
    metadata: {},
  },
  {
    id: 2,
    sessionId: "session-scano",
    userId: 11,
    eventType: "api_error",
    category: "api",
    system: "scano",
    path: "/scano/assign-task",
    routePattern: "/scano/assign-task",
    pageTitle: "Assign Task",
    endpoint: "/api/scano/tasks",
    method: "GET",
    statusCode: 500,
    durationMs: 120,
    success: false,
    source: "frontend",
    severity: "error",
    occurredAt: "2026-04-16T09:58:00.000Z",
    createdAt: "2026-04-16T09:58:00.000Z",
    metadata: {},
  },
];

const baseErrors: OpsErrorItem[] = [
  {
    id: 1,
    signature: "api:/api/scano/tasks:500",
    source: "frontend",
    severity: "error",
    system: "scano",
    path: "/scano/assign-task",
    routePattern: "/scano/assign-task",
    message: "Scano tasks request failed",
    code: "HTTP_500",
    statusCode: 500,
    stackFingerprint: null,
    firstSeenAt: "2026-04-16T09:58:00.000Z",
    lastSeenAt: "2026-04-16T09:58:00.000Z",
    count: 1,
    lastEventId: 2,
    lastSessionId: "session-scano",
    lastUserId: 11,
    sampleMetadata: {},
    createdAt: "2026-04-16T09:58:00.000Z",
    updatedAt: "2026-04-16T09:58:00.000Z",
  },
];

function pageResponse<TItem>(items: TItem[]): OpsPageResponse<TItem> {
  return {
    items,
    meta: {
      page: 1,
      pageSize: 100,
      total: items.length,
      totalPages: 1,
    },
  };
}

function mockDashboardData(params: {
  summary?: OpsSummaryResponse;
  sessions?: OpsSessionItem[];
  events?: OpsEventItem[];
  errors?: OpsErrorItem[];
} = {}) {
  mockOpsSummary.mockResolvedValue(params.summary ?? baseSummary);
  mockOpsSessions.mockResolvedValue(pageResponse(params.sessions ?? baseSessions));
  mockOpsEvents.mockResolvedValue(pageResponse(params.events ?? baseEvents));
  mockOpsErrors.mockResolvedValue(pageResponse(params.errors ?? baseErrors));
}

describe("OpsOverviewPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDashboardData();
  });

  it("loads Ops read APIs and renders KPI, chart, table, and health sections", async () => {
    render(<OpsOverviewPage />);

    expect(screen.getByText("TopBar")).toBeInTheDocument();

    await waitFor(() => {
      expect(mockOpsSummary).toHaveBeenCalledWith({ windowMinutes: 60 });
    });

    expect(mockOpsSessions).toHaveBeenCalledWith(expect.objectContaining({
      pageSize: 100,
      from: baseSummary.windows.current.startUtcIso,
      to: baseSummary.windows.current.endUtcIso,
    }));
    expect(screen.getByRole("heading", { name: "Ops Center" })).toBeInTheDocument();
    expect(screen.getByText("Online Users")).toBeInTheDocument();
    expect(screen.getByText("API Requests")).toBeInTheDocument();
    expect(screen.getByText("13% failure rate in this window")).toBeInTheDocument();
    expect(screen.getByTestId("ops-event-trend-chart")).toBeInTheDocument();
    expect(screen.getByTestId("ops-system-distribution-chart")).toBeInTheDocument();
    expect(screen.getByTestId("ops-top-pages-chart")).toBeInTheDocument();
    expect(screen.getByTestId("ops-event-types-chart")).toBeInTheDocument();
    expect(screen.getByTestId("ops-error-severity-chart")).toBeInTheDocument();
    expect(screen.getByTestId("ops-api-status-chart")).toBeInTheDocument();
    expect(screen.getByText("Ali User")).toBeInTheDocument();
    expect(screen.getByText("Scano tasks request failed")).toBeInTheDocument();
    expect(screen.getByText("Health And Freshness")).toBeInTheDocument();
  }, TEST_TIMEOUT_MS);

  it("filters dashboard tables and opens a session drill-down", async () => {
    render(<OpsOverviewPage />);

    await waitFor(() => {
      expect(screen.getByText("Ali User")).toBeInTheDocument();
    });

    fireEvent.change(screen.getByPlaceholderText("Search users, pages, events"), {
      target: { value: "nada" },
    });

    expect(screen.queryByText("Ali User")).not.toBeInTheDocument();
    expect(screen.getByText("Nada Scanner")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Nada Scanner"));

    const dialog = await screen.findByRole("dialog", { name: "Session Details" });
    expect(within(dialog).getByText("Edge")).toBeInTheDocument();
    expect(within(dialog).getByText("/scano/assign-task")).toBeInTheDocument();
  }, TEST_TIMEOUT_MS);

  it("reloads the summary when the time range changes and supports manual refresh", async () => {
    render(<OpsOverviewPage />);

    await waitFor(() => {
      expect(mockOpsSummary).toHaveBeenCalledTimes(1);
    });

    fireEvent.click(screen.getByRole("button", { name: "4h" }));

    await waitFor(() => {
      expect(mockOpsSummary).toHaveBeenLastCalledWith({ windowMinutes: 240 });
    });

    const callsAfterWindowChange = mockOpsSummary.mock.calls.length;
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));

    await waitFor(() => {
      expect(mockOpsSummary.mock.calls.length).toBeGreaterThan(callsAfterWindowChange);
    });
  }, TEST_TIMEOUT_MS);

  it("shows an empty telemetry state without fake dashboard data", async () => {
    mockDashboardData({
      summary: {
        ...baseSummary,
        counts: {
          ...baseSummary.counts,
          onlineUsers: 0,
          activeUsers: 0,
          idleUsers: 0,
          sessionsToday: 0,
          pageViewsToday: 0,
          errorCountToday: 0,
          apiRequestCount: 0,
          apiFailureCount: 0,
        },
        kpis: baseSummary.kpis.map((kpi) => ({
          ...kpi,
          value: 0,
          previousValue: 0,
          delta: 0,
          direction: "flat",
          status: "neutral",
        })),
        statusBuckets: {
          sessionsByState: [],
          sessionsBySystem: [],
          apiStatus: [],
        },
        errorBuckets: {
          bySeverity: [],
          bySource: [],
          top: [],
        },
        topPages: [],
        topEventTypes: [],
      },
      sessions: [],
      events: [],
      errors: [],
    });

    render(<OpsOverviewPage />);

    expect(await screen.findByText("No Ops telemetry has landed for the selected window yet.")).toBeInTheDocument();
    expect(screen.getAllByText("No telemetry in this window").length).toBeGreaterThan(0);
    expect(screen.getByText("No sessions match the current filters.")).toBeInTheDocument();
    expect(screen.getByText("No events match the current filters.")).toBeInTheDocument();
  }, TEST_TIMEOUT_MS);

  it("renders a read API failure state and recovers on retry", async () => {
    mockOpsSummary.mockRejectedValueOnce(new Error("Forbidden"));

    render(<OpsOverviewPage />);

    expect(await screen.findByText("Forbidden")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));

    await waitFor(() => {
      expect(screen.getByText("Ali User")).toBeInTheDocument();
    });
  }, TEST_TIMEOUT_MS);
});
