import AdminPanelSettingsRoundedIcon from "@mui/icons-material/AdminPanelSettingsRounded";
import AutoGraphRoundedIcon from "@mui/icons-material/AutoGraphRounded";
import CheckCircleRoundedIcon from "@mui/icons-material/CheckCircleRounded";
import ErrorOutlineRoundedIcon from "@mui/icons-material/ErrorOutlineRounded";
import GroupRoundedIcon from "@mui/icons-material/GroupRounded";
import MonitorHeartRoundedIcon from "@mui/icons-material/MonitorHeartRounded";
import RefreshRoundedIcon from "@mui/icons-material/RefreshRounded";
import SecurityRoundedIcon from "@mui/icons-material/SecurityRounded";
import SpeedRoundedIcon from "@mui/icons-material/SpeedRounded";
import TimelineRoundedIcon from "@mui/icons-material/TimelineRounded";
import TrendingDownRoundedIcon from "@mui/icons-material/TrendingDownRounded";
import TrendingFlatRoundedIcon from "@mui/icons-material/TrendingFlatRounded";
import TrendingUpRoundedIcon from "@mui/icons-material/TrendingUpRounded";
import WarningAmberRoundedIcon from "@mui/icons-material/WarningAmberRounded";
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Container,
  Divider,
  FormControl,
  InputLabel,
  LinearProgress,
  MenuItem,
  Select,
  Skeleton,
  Stack,
  Switch,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from "@mui/material";
import type { SelectChangeEvent } from "@mui/material/Select";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { api, describeApiError } from "../../../../../api/client";
import { TopBar } from "../../../../../app/shell/TopBar";
import type {
  OpsErrorItem,
  OpsEventItem,
  OpsEventSeverity,
  OpsKpi,
  OpsSessionItem,
  OpsSessionState,
  OpsSummaryResponse,
  OpsSystemId,
  OpsTelemetryEventType,
} from "../../../api/types";
import { formatOpsDateTime, formatOpsNumber, formatOpsRate, formatOpsRelativeTime, healthStatusColor, healthStatusLabel, stateLabel, systemLabel } from "../lib/opsFormat";
import { OpsErrorCharts, OpsTrafficCharts } from "./OpsDashboardCharts";
import { OpsErrorIntelligence, OpsLiveSessionsTable, OpsRecentEventsTable, OpsSearchControl } from "./OpsDashboardTables";
import { OpsQualityPanel } from "./OpsQualityPanel";
import { OpsTokenManagementPanel } from "./OpsTokenManagementPanel";

const AUTO_REFRESH_MS = 30_000;
const DATA_PAGE_SIZE = 100;

const timeWindowOptions = [
  { label: "15m", value: 15 },
  { label: "1h", value: 60 },
  { label: "4h", value: 240 },
  { label: "24h", value: 1440 },
];

const systemOptions: Array<{ label: string; value: "all" | OpsSystemId }> = [
  { label: "All systems", value: "all" },
  { label: "UPuse", value: "upuse" },
  { label: "Scano", value: "scano" },
  { label: "Ops Center", value: "ops" },
  { label: "Unknown", value: "unknown" },
];

const stateOptions: Array<{ label: string; value: "all" | OpsSessionState }> = [
  { label: "All states", value: "all" },
  { label: "Active", value: "active" },
  { label: "Idle", value: "idle" },
  { label: "Offline", value: "offline" },
];

const severityOptions: Array<{ label: string; value: "all" | OpsEventSeverity }> = [
  { label: "All severities", value: "all" },
  { label: "Info", value: "info" },
  { label: "Warning", value: "warning" },
  { label: "Error", value: "error" },
  { label: "Critical", value: "critical" },
];

function findKpi(summary: OpsSummaryResponse, key: string, label: string): OpsKpi {
  return summary.kpis.find((kpi) => kpi.key === key) ?? {
    key,
    label,
    value: 0,
    previousValue: 0,
    delta: 0,
    direction: "flat",
    status: "neutral",
  };
}

function latestIso(values: Array<string | null | undefined>) {
  return values
    .filter((value): value is string => !!value)
    .sort((left, right) => Date.parse(right) - Date.parse(left))[0] ?? null;
}

function trendColor(kpi: OpsKpi) {
  if (kpi.status === "good") return "#15803d";
  if (kpi.status === "warning") return "#dc2626";
  return "#64748b";
}

function trendIcon(kpi: OpsKpi) {
  if (kpi.direction === "up") return <TrendingUpRoundedIcon fontSize="small" />;
  if (kpi.direction === "down") return <TrendingDownRoundedIcon fontSize="small" />;
  return <TrendingFlatRoundedIcon fontSize="small" />;
}

function TrendBadge(props: { kpi: OpsKpi }) {
  const color = trendColor(props.kpi);
  const delta = props.kpi.delta > 0 ? `+${formatOpsNumber(props.kpi.delta)}` : formatOpsNumber(props.kpi.delta);
  return (
    <Chip
      icon={trendIcon(props.kpi)}
      label={`${delta} vs previous`}
      size="small"
      sx={{
        width: "fit-content",
        borderRadius: "8px",
        color,
        bgcolor: `${color}14`,
        fontWeight: 900,
        "& .MuiChip-icon": { color },
      }}
    />
  );
}

function KpiTile(props: {
  title: string;
  value: string;
  detail: string;
  accent: string;
  icon: ReactNode;
  kpi?: OpsKpi;
}) {
  return (
    <Card
      sx={{
        minWidth: 0,
        height: "100%",
        borderRadius: "8px",
        border: "1px solid rgba(148,163,184,0.18)",
        boxShadow: "0 16px 34px rgba(15,23,42,0.055)",
      }}
    >
      <CardContent sx={{ p: 2 }}>
        <Stack spacing={1.35} sx={{ minHeight: 142 }}>
          <Stack direction="row" spacing={1} justifyContent="space-between" alignItems="flex-start">
            <Typography variant="body2" sx={{ color: "#64748b", fontWeight: 900 }}>
              {props.title}
            </Typography>
            <Box
              sx={{
                width: 34,
                height: 34,
                borderRadius: "8px",
                display: "grid",
                placeItems: "center",
                color: props.accent,
                bgcolor: `${props.accent}14`,
              }}
            >
              {props.icon}
            </Box>
          </Stack>
          <Typography sx={{ color: "#102033", fontSize: 30, lineHeight: 1, fontWeight: 950 }}>
            {props.value}
          </Typography>
          <Typography variant="body2" sx={{ color: "#64748b", lineHeight: 1.55, minHeight: 42 }}>
            {props.detail}
          </Typography>
          {props.kpi ? <TrendBadge kpi={props.kpi} /> : null}
        </Stack>
      </CardContent>
    </Card>
  );
}

function FilterSelect(props: {
  label: string;
  value: string;
  options: Array<{ label: string; value: string }>;
  onChange: (value: string) => void;
}) {
  return (
    <FormControl size="small" sx={{ minWidth: { xs: "100%", sm: 170 } }}>
      <InputLabel>{props.label}</InputLabel>
      <Select
        label={props.label}
        value={props.value}
        onChange={(event: SelectChangeEvent<string>) => props.onChange(event.target.value)}
        sx={{ borderRadius: "8px", bgcolor: "#fff" }}
      >
        {props.options.map((option) => (
          <MenuItem key={option.value} value={option.value}>
            {option.label}
          </MenuItem>
        ))}
      </Select>
    </FormControl>
  );
}

function SectionTitle(props: { title: string; subtitle: string; action?: ReactNode }) {
  return (
    <Stack direction={{ xs: "column", md: "row" }} spacing={1.5} justifyContent="space-between" alignItems={{ xs: "flex-start", md: "center" }}>
      <Box>
        <Typography variant="h5" sx={{ color: "#102033", fontWeight: 950, letterSpacing: 0 }}>
          {props.title}
        </Typography>
        <Typography variant="body2" sx={{ color: "#64748b", mt: 0.45 }}>
          {props.subtitle}
        </Typography>
      </Box>
      {props.action}
    </Stack>
  );
}

function DashboardSkeleton() {
  return (
    <Stack spacing={2}>
      <Skeleton variant="rounded" height={170} sx={{ borderRadius: "8px" }} />
      <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", md: "repeat(3, minmax(0, 1fr))" }, gap: 1.5 }}>
        {[0, 1, 2].map((item) => (
          <Skeleton key={item} variant="rounded" height={150} sx={{ borderRadius: "8px" }} />
        ))}
      </Box>
      <Skeleton variant="rounded" height={320} sx={{ borderRadius: "8px" }} />
    </Stack>
  );
}

function HealthPanel(props: { summary: OpsSummaryResponse; now: number }) {
  const lastIngestAt = latestIso([
    props.summary.freshness.sessionsLastSeenAt,
    props.summary.freshness.eventsLastSeenAt,
    props.summary.freshness.errorsLastSeenAt,
  ]);
  const dashboardWarning = props.summary.health.dashboard.ready === false || props.summary.health.dashboard.monitorDegraded === true;
  const performanceWarning = props.summary.health.performance.status !== "good";
  const freshnessLabel = lastIngestAt ? formatOpsRelativeTime(lastIngestAt, props.now) : "No telemetry yet";
  const generatedAt = formatOpsDateTime(props.summary.generatedAt);

  const items = [
    {
      label: "Telemetry Freshness",
      value: freshnessLabel,
      detail: lastIngestAt ? `Latest signal ${formatOpsDateTime(lastIngestAt)}` : "Waiting for authenticated user telemetry.",
      color: lastIngestAt ? "#0f766e" : "#64748b",
      icon: <TimelineRoundedIcon fontSize="small" />,
    },
    {
      label: "Dashboard Health",
      value: dashboardWarning ? "Needs attention" : "Healthy",
      detail: props.summary.health.dashboard.readiness?.message ?? `Generated ${generatedAt}`,
      color: dashboardWarning ? "#ca8a04" : "#15803d",
      icon: dashboardWarning ? <WarningAmberRoundedIcon fontSize="small" /> : <CheckCircleRoundedIcon fontSize="small" />,
    },
    {
      label: "Performance Surface",
      value: performanceWarning ? "Warning" : "Healthy",
      detail: `${formatOpsNumber(props.summary.health.performance.errorCount)} errors, ${formatOpsNumber(props.summary.health.performance.apiFailureCount)} API failures`,
      color: performanceWarning ? "#ca8a04" : "#15803d",
      icon: <SpeedRoundedIcon fontSize="small" />,
    },
    {
      label: "Access Boundary",
      value: "Primary admin",
      detail: "Read access remains locked to the primary admin.",
      color: "#1d4ed8",
      icon: <SecurityRoundedIcon fontSize="small" />,
    },
  ];

  return (
    <Box
      sx={{
        display: "grid",
        gridTemplateColumns: { xs: "1fr", md: "repeat(2, minmax(0, 1fr))", xl: "repeat(4, minmax(0, 1fr))" },
        gap: 1.5,
      }}
    >
      {items.map((item) => (
        <Box
          key={item.label}
          sx={{
            minWidth: 0,
            p: 1.8,
            borderRadius: "8px",
            border: "1px solid rgba(148,163,184,0.18)",
            bgcolor: "#ffffff",
            boxShadow: "0 16px 34px rgba(15,23,42,0.045)",
          }}
        >
          <Stack spacing={1.1}>
            <Stack direction="row" spacing={1} alignItems="center" justifyContent="space-between">
              <Typography variant="body2" sx={{ color: "#64748b", fontWeight: 900 }}>
                {item.label}
              </Typography>
              <Box
                sx={{
                  width: 32,
                  height: 32,
                  borderRadius: "8px",
                  display: "grid",
                  placeItems: "center",
                  color: item.color,
                  bgcolor: `${item.color}14`,
                }}
              >
                {item.icon}
              </Box>
            </Stack>
            <Typography sx={{ color: "#102033", fontWeight: 950, fontSize: 22 }}>
              {item.value}
            </Typography>
            <Typography variant="body2" sx={{ color: "#64748b", lineHeight: 1.55 }}>
              {item.detail}
            </Typography>
          </Stack>
        </Box>
      ))}
    </Box>
  );
}

function EmptySummaryCallout() {
  return (
    <Alert
      severity="info"
      sx={{
        borderRadius: "8px",
        border: "1px solid rgba(29,78,216,0.18)",
        bgcolor: "#eff6ff",
        color: "#1e3a8a",
        "& .MuiAlert-icon": { color: "#2563eb" },
      }}
    >
      No Ops telemetry has landed for the selected window yet.
    </Alert>
  );
}

type OpsDashboardPageKey = "overview" | "activity" | "events" | "tokens";

const opsPageMeta: Record<OpsDashboardPageKey, { label: string; subtitle: string }> = {
  overview: {
    label: "Overview",
    subtitle: "Health, quality, alerts, freshness, and KPI posture for the selected telemetry window.",
  },
  activity: {
    label: "Activity",
    subtitle: "Traffic charts and live authenticated session activity across UPuse, Scano, and Ops Center.",
  },
  events: {
    label: "Events And Errors",
    subtitle: "Route changes, product milestones, API failures, runtime events, and normalized error groups.",
  },
  tokens: {
    label: "Tokens",
    subtitle: "Masked integration-token state, replacement saves, and protected token tests.",
  },
};

function OpsDashboardPage(props: { page: OpsDashboardPageKey }) {
  const needsDashboardData = props.page !== "tokens";
  const currentPage = opsPageMeta[props.page];
  const [windowMinutes, setWindowMinutes] = useState(60);
  const [summary, setSummary] = useState<OpsSummaryResponse | null>(null);
  const [sessions, setSessions] = useState<OpsSessionItem[]>([]);
  const [events, setEvents] = useState<OpsEventItem[]>([]);
  const [errors, setErrors] = useState<OpsErrorItem[]>([]);
  const [loading, setLoading] = useState(needsDashboardData);
  const [refreshing, setRefreshing] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [lastLoadedAt, setLastLoadedAt] = useState<Date | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [systemFilter, setSystemFilter] = useState<"all" | OpsSystemId>("all");
  const [stateFilter, setStateFilter] = useState<"all" | OpsSessionState>("all");
  const [severityFilter, setSeverityFilter] = useState<"all" | OpsEventSeverity>("all");
  const [eventTypeFilter, setEventTypeFilter] = useState<"all" | OpsTelemetryEventType>("all");
  const [query, setQuery] = useState("");
  const [now, setNow] = useState(() => Date.now());
  const requestIdRef = useRef(0);

  const loadDashboard = useCallback(async (options: { background?: boolean } = {}) => {
    if (!needsDashboardData) {
      setLoading(false);
      setRefreshing(false);
      return;
    }

    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;

    if (options.background) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }
    setErrorMessage(null);

    try {
      const nextSummary = await api.opsSummary({ windowMinutes });
      const [nextSessions, nextEvents, nextErrors] = await Promise.all([
        api.opsSessions({
          page: 1,
          pageSize: DATA_PAGE_SIZE,
          from: nextSummary.windows.current.startUtcIso,
          to: nextSummary.windows.current.endUtcIso,
        }),
        api.opsEvents({
          page: 1,
          pageSize: DATA_PAGE_SIZE,
          from: nextSummary.windows.current.startUtcIso,
          to: nextSummary.windows.current.endUtcIso,
        }),
        api.opsErrors({
          page: 1,
          pageSize: DATA_PAGE_SIZE,
          from: nextSummary.windows.current.startUtcIso,
          to: nextSummary.windows.current.endUtcIso,
        }),
      ]);

      if (requestIdRef.current !== requestId) return;

      setSummary(nextSummary);
      setSessions(nextSessions.items);
      setEvents(nextEvents.items);
      setErrors(nextErrors.items);
      setLastLoadedAt(new Date());
      setNow(Date.now());
    } catch (error) {
      if (requestIdRef.current !== requestId) return;
      setErrorMessage(describeApiError(error, "Unable to load Ops Center."));
    } finally {
      if (requestIdRef.current === requestId) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [needsDashboardData, windowMinutes]);

  useEffect(() => {
    if (!needsDashboardData) {
      requestIdRef.current += 1;
      setLoading(false);
      setRefreshing(false);
      setErrorMessage(null);
      return;
    }

    void loadDashboard();
  }, [loadDashboard, needsDashboardData]);

  useEffect(() => {
    const intervalId = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(intervalId);
  }, []);

  useEffect(() => {
    if (!needsDashboardData || !autoRefresh) return undefined;
    const intervalId = window.setInterval(() => {
      void loadDashboard({ background: true });
    }, AUTO_REFRESH_MS);
    return () => window.clearInterval(intervalId);
  }, [autoRefresh, loadDashboard, needsDashboardData]);

  const eventTypeOptions = useMemo<Array<{ label: string; value: "all" | OpsTelemetryEventType }>>(() => {
    const eventTypes = new Set(events.map((event) => event.eventType));
    if (eventTypeFilter !== "all") {
      eventTypes.add(eventTypeFilter);
    }
    const types = Array.from(eventTypes).sort();
    return [
      { label: "All event types", value: "all" },
      ...types.map((type) => ({
        label: type.replace(/_/g, " "),
        value: type,
      })),
    ];
  }, [eventTypeFilter, events]);

  const overview = useMemo(() => {
    if (!summary) return null;
    const sessionKpi = findKpi(summary, "sessions", "Sessions");
    const pageViewKpi = findKpi(summary, "page_views", "Page views");
    const apiRequestKpi = findKpi(summary, "api_requests", "API requests");
    const errorKpi = findKpi(summary, "errors", "Errors");
    const failureRate = summary.counts.apiRequestCount > 0
      ? summary.counts.apiFailureCount / summary.counts.apiRequestCount
      : 0;
    return {
      sessionKpi,
      pageViewKpi,
      apiRequestKpi,
      errorKpi,
      failureRate,
    };
  }, [summary]);

  const hasTelemetry = !!summary && (
    summary.counts.sessionsToday > 0
    || summary.counts.pageViewsToday > 0
    || summary.counts.apiRequestCount > 0
    || events.length > 0
    || sessions.length > 0
    || errors.length > 0
  );

  const kpiGrid = summary && overview ? (
    <Box
      sx={{
        display: "grid",
        gridTemplateColumns: { xs: "1fr", sm: "repeat(2, minmax(0, 1fr))", xl: "repeat(6, minmax(0, 1fr))" },
        gap: 1.5,
      }}
    >
      <KpiTile
        title="Online Users"
        value={formatOpsNumber(summary.counts.onlineUsers)}
        detail={`${formatOpsNumber(summary.counts.activeUsers)} active, ${formatOpsNumber(summary.counts.idleUsers)} idle`}
        accent="#0f766e"
        icon={<GroupRoundedIcon fontSize="small" />}
      />
      <KpiTile
        title="Sessions"
        value={formatOpsNumber(overview.sessionKpi.value)}
        detail={`${formatOpsNumber(summary.counts.sessionsToday)} sessions today`}
        accent="#2563eb"
        icon={<TimelineRoundedIcon fontSize="small" />}
        kpi={overview.sessionKpi}
      />
      <KpiTile
        title="Page Views"
        value={formatOpsNumber(overview.pageViewKpi.value)}
        detail={`${formatOpsNumber(summary.counts.pageViewsToday)} page views today`}
        accent="#7c3aed"
        icon={<AutoGraphRoundedIcon fontSize="small" />}
        kpi={overview.pageViewKpi}
      />
      <KpiTile
        title="API Requests"
        value={formatOpsNumber(overview.apiRequestKpi.value)}
        detail={`${formatOpsRate(overview.failureRate * 100)}% failure rate in this window`}
        accent="#0891b2"
        icon={<SpeedRoundedIcon fontSize="small" />}
        kpi={overview.apiRequestKpi}
      />
      <KpiTile
        title="Errors"
        value={formatOpsNumber(overview.errorKpi.value)}
        detail={`${formatOpsNumber(summary.counts.errorCountToday)} errors today`}
        accent="#dc2626"
        icon={<ErrorOutlineRoundedIcon fontSize="small" />}
        kpi={overview.errorKpi}
      />
      <KpiTile
        title="Overall Health"
        value={healthStatusLabel(summary.quality.status)}
        detail={`${formatOpsNumber(summary.quality.score)} score from ${formatOpsNumber(summary.quality.factors.length)} signals`}
        accent={healthStatusColor(summary.quality.status)}
        icon={<MonitorHeartRoundedIcon fontSize="small" />}
      />
    </Box>
  ) : null;

  const filterPanel = (
    <Box
      sx={{
        p: { xs: 1.4, md: 1.8 },
        borderRadius: "8px",
        border: "1px solid rgba(148,163,184,0.18)",
        bgcolor: "#ffffff",
        boxShadow: "0 16px 34px rgba(15,23,42,0.045)",
      }}
    >
      <Stack direction={{ xs: "column", lg: "row" }} spacing={1.3} justifyContent="space-between" alignItems={{ xs: "stretch", lg: "center" }}>
        <OpsSearchControl value={query} onChange={setQuery} />
        <Stack direction={{ xs: "column", sm: "row" }} spacing={1} alignItems={{ xs: "stretch", sm: "center" }} sx={{ flexWrap: "wrap" }}>
          <FilterSelect
            label="System"
            value={systemFilter}
            options={systemOptions}
            onChange={(value) => setSystemFilter(value as "all" | OpsSystemId)}
          />
          <FilterSelect
            label="Session state"
            value={stateFilter}
            options={stateOptions}
            onChange={(value) => setStateFilter(value as "all" | OpsSessionState)}
          />
          <FilterSelect
            label="Severity"
            value={severityFilter}
            options={severityOptions}
            onChange={(value) => setSeverityFilter(value as "all" | OpsEventSeverity)}
          />
          <FilterSelect
            label="Event type"
            value={eventTypeFilter}
            options={eventTypeOptions}
            onChange={(value) => setEventTypeFilter(value as "all" | OpsTelemetryEventType)}
          />
        </Stack>
      </Stack>
    </Box>
  );

  return (
    <Box sx={{ minHeight: "100vh", bgcolor: "#f4f7f8" }} data-testid="ops-dashboard-page">
      <TopBar />

      {needsDashboardData && refreshing ? <LinearProgress color="primary" /> : null}

      <Container maxWidth="xl" sx={{ py: { xs: 2.5, md: 4 } }}>
        <Stack spacing={3}>
          <Box
            sx={{
              p: { xs: 2, md: 2.8 },
              borderRadius: "8px",
              border: "1px solid rgba(148,163,184,0.18)",
              bgcolor: "#ffffff",
              boxShadow: "0 18px 40px rgba(15,23,42,0.06)",
            }}
          >
            <Stack direction={{ xs: "column", lg: "row" }} spacing={2.2} justifyContent="space-between" alignItems={{ xs: "flex-start", lg: "center" }}>
              <Box sx={{ maxWidth: 760 }}>
                <Stack direction="row" spacing={1} sx={{ mb: 1.4, flexWrap: "wrap" }}>
                  <Chip
                    icon={<AdminPanelSettingsRoundedIcon />}
                    label="Primary admin only"
                    sx={{
                      height: 32,
                      borderRadius: "8px",
                      bgcolor: "rgba(15,118,110,0.1)",
                      color: "#0f766e",
                      fontWeight: 900,
                      "& .MuiChip-icon": { color: "#0f766e" },
                    }}
                  />
                  <Chip
                    icon={needsDashboardData && autoRefresh ? <CheckCircleRoundedIcon /> : <WarningAmberRoundedIcon />}
                    label={needsDashboardData ? (autoRefresh ? "Live refresh" : "Refresh paused") : currentPage.label}
                    sx={{
                      height: 32,
                      borderRadius: "8px",
                      bgcolor: needsDashboardData && autoRefresh ? "rgba(21,128,61,0.1)" : "rgba(202,138,4,0.12)",
                      color: needsDashboardData && autoRefresh ? "#15803d" : "#a16207",
                      fontWeight: 900,
                      "& .MuiChip-icon": { color: "inherit" },
                    }}
                  />
                </Stack>
                <Typography
                  variant="h3"
                  sx={{
                    fontWeight: 950,
                    color: "#102033",
                    letterSpacing: 0,
                    lineHeight: 1.04,
                    fontSize: { xs: 34, md: 48 },
                  }}
                >
                  Ops Center
                </Typography>
                <Typography variant="body1" sx={{ color: "#4b6475", mt: 1.1, lineHeight: 1.8, maxWidth: 760 }}>
                  {currentPage.subtitle}
                </Typography>
              </Box>

              {needsDashboardData ? (
                <Stack spacing={1.2} sx={{ width: { xs: "100%", lg: "auto" }, alignItems: { xs: "stretch", sm: "flex-end" } }}>
                  <ToggleButtonGroup
                    exclusive
                    value={windowMinutes}
                    onChange={(_event, value: number | null) => {
                      if (value) setWindowMinutes(value);
                    }}
                    size="small"
                    aria-label="Ops telemetry time range"
                    sx={{
                      bgcolor: "#fff",
                      "& .MuiToggleButton-root": {
                        borderRadius: "8px",
                        fontWeight: 900,
                        px: 1.6,
                      },
                    }}
                  >
                    {timeWindowOptions.map((option) => (
                      <ToggleButton key={option.value} value={option.value}>
                        {option.label}
                      </ToggleButton>
                    ))}
                  </ToggleButtonGroup>
                  <Stack direction="row" spacing={1} alignItems="center" justifyContent="flex-end">
                    <Typography variant="body2" sx={{ color: "#64748b", fontWeight: 800 }}>
                      Auto-refresh
                    </Typography>
                    <Switch
                      checked={autoRefresh}
                      onChange={(event) => setAutoRefresh(event.target.checked)}
                      inputProps={{ "aria-label": "Toggle Ops auto refresh" }}
                    />
                    <Button
                      variant="contained"
                      startIcon={refreshing ? <CircularProgress color="inherit" size={16} /> : <RefreshRoundedIcon />}
                      onClick={() => void loadDashboard({ background: !!summary })}
                      disabled={loading || refreshing}
                      sx={{ borderRadius: "8px", fontWeight: 900 }}
                    >
                      Refresh
                    </Button>
                  </Stack>
                  <Typography variant="caption" sx={{ color: "#64748b", fontWeight: 800, textAlign: { xs: "left", sm: "right" } }}>
                    {lastLoadedAt ? `Updated ${formatOpsRelativeTime(lastLoadedAt.toISOString(), now)}` : "Waiting for first refresh"}
                  </Typography>
                </Stack>
              ) : null}
            </Stack>
          </Box>

          {needsDashboardData && errorMessage ? (
            <Alert
              severity="error"
              action={(
                <Button color="inherit" size="small" onClick={() => void loadDashboard({ background: false })}>
                  Retry
                </Button>
              )}
              sx={{ borderRadius: "8px" }}
            >
              {errorMessage}
            </Alert>
          ) : null}

          {props.page === "tokens" ? (
            <OpsTokenManagementPanel />
          ) : loading && !summary ? (
            <DashboardSkeleton />
          ) : summary && overview ? (
            <>
              {props.page === "overview" ? kpiGrid : null}

              {!hasTelemetry ? <EmptySummaryCallout /> : null}

              {props.page === "overview" ? (
                <>
                  <SectionTitle
                    title="Quality And Alerts"
                    subtitle="Current health judgement, penalties, active anomalies, and monitored subsystem trust."
                    action={(
                      <Chip
                        label={`${formatOpsNumber(summary.quality.score)} quality score`}
                        sx={{
                          borderRadius: "8px",
                          fontWeight: 900,
                          bgcolor: `${healthStatusColor(summary.quality.status)}14`,
                          color: healthStatusColor(summary.quality.status),
                        }}
                      />
                    )}
                  />
                  <OpsQualityPanel summary={summary} />

                  <Divider sx={{ borderColor: "rgba(148,163,184,0.18)" }} />

                  <SectionTitle
                    title="Health And Freshness"
                    subtitle="Readiness, telemetry recency, and admin access posture."
                  />
                  <HealthPanel summary={summary} now={now} />
                </>
              ) : null}

              {props.page === "activity" ? (
                <>
                  {filterPanel}

                  <SectionTitle
                    title="Traffic Overview"
                    subtitle={`${systemFilter === "all" ? "All systems" : systemLabel(systemFilter)} telemetry for the selected window.`}
                    action={(
                      <Chip
                        label={`${timeWindowOptions.find((option) => option.value === windowMinutes)?.label ?? "1h"} window`}
                        sx={{ borderRadius: "8px", fontWeight: 900, bgcolor: "#ecfeff", color: "#155e75" }}
                      />
                    )}
                  />
                  <OpsTrafficCharts summary={summary} events={events} />

                  <Divider sx={{ borderColor: "rgba(148,163,184,0.18)" }} />

                  <SectionTitle
                    title="Live User Activity"
                    subtitle={`${stateFilter === "all" ? "All session states" : stateLabel(stateFilter)} across authenticated telemetry sessions.`}
                  />
                  <OpsLiveSessionsTable
                    sessions={sessions}
                    systemFilter={systemFilter}
                    stateFilter={stateFilter}
                    query={query}
                    now={now}
                  />
                </>
              ) : null}

              {props.page === "events" ? (
                <>
                  {filterPanel}

                  <SectionTitle
                    title="Event Intelligence"
                    subtitle="Route changes, product milestones, API failures, and runtime events."
                  />
                  <OpsRecentEventsTable
                    events={events}
                    systemFilter={systemFilter}
                    eventTypeFilter={eventTypeFilter}
                    severityFilter={severityFilter}
                    query={query}
                    now={now}
                  />

                  <Divider sx={{ borderColor: "rgba(148,163,184,0.18)" }} />

                  <SectionTitle
                    title="Error Intelligence"
                    subtitle="Normalized failures grouped by severity, status, source, and signature."
                  />
                  <OpsErrorCharts summary={summary} />
                  <OpsErrorIntelligence errors={errors} severityFilter={severityFilter} query={query} now={now} />
                </>
              ) : null}
            </>
          ) : null}
        </Stack>
      </Container>
    </Box>
  );
}

export function OpsOverviewPage() {
  return <OpsDashboardPage page="overview" />;
}

export function OpsActivityPage() {
  return <OpsDashboardPage page="activity" />;
}

export function OpsEventsPage() {
  return <OpsDashboardPage page="events" />;
}

export function OpsTokensPage() {
  return <OpsDashboardPage page="tokens" />;
}
