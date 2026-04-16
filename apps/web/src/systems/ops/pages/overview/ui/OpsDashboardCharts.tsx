import { Box, Stack, Typography } from "@mui/material";
import type { EChartsOption } from "echarts";
import { BarChart, LineChart, PieChart } from "echarts/charts";
import { GridComponent, LegendComponent, TooltipComponent } from "echarts/components";
import * as echarts from "echarts/core";
import { CanvasRenderer } from "echarts/renderers";
import ReactEChartsCore from "echarts-for-react/lib/core";
import type { OpsBucket, OpsEventItem, OpsSummaryResponse } from "../../../api/types";
import { formatOpsNumber, severityColor, severityLabel, systemColor, systemLabel } from "../lib/opsFormat";

echarts.use([
  BarChart,
  LineChart,
  PieChart,
  GridComponent,
  LegendComponent,
  TooltipComponent,
  CanvasRenderer,
]);

const chartText = "#334155";
const chartMuted = "#94a3b8";
const gridLine = "rgba(148,163,184,0.2)";

function ChartSurface(props: {
  title: string;
  subtitle: string;
  empty?: boolean;
  height?: number;
  option: EChartsOption;
  testId: string;
}) {
  return (
    <Box
      sx={{
        minWidth: 0,
        p: { xs: 1.5, md: 1.8 },
        borderRadius: "8px",
        border: "1px solid rgba(148,163,184,0.18)",
        bgcolor: "#ffffff",
        boxShadow: "0 16px 34px rgba(15,23,42,0.045)",
      }}
    >
      <Stack spacing={0.35} sx={{ mb: 1 }}>
        <Typography sx={{ color: "#0f172a", fontWeight: 950 }}>{props.title}</Typography>
        <Typography variant="body2" sx={{ color: "#64748b" }}>{props.subtitle}</Typography>
      </Stack>
      {props.empty ? (
        <Box
          sx={{
            height: props.height ?? 260,
            display: "grid",
            placeItems: "center",
            borderRadius: "8px",
            bgcolor: "rgba(248,250,252,0.86)",
            color: "#64748b",
            fontWeight: 800,
          }}
        >
          No telemetry in this window
        </Box>
      ) : (
        <ReactEChartsCore
          data-testid={props.testId}
          echarts={echarts}
          option={props.option}
          notMerge
          lazyUpdate
          style={{ height: props.height ?? 260, width: "100%" }}
        />
      )}
    </Box>
  );
}

function axisBase() {
  return {
    axisLine: { lineStyle: { color: gridLine } },
    axisTick: { show: false },
    axisLabel: { color: chartMuted, fontWeight: 700 },
    splitLine: { lineStyle: { color: gridLine } },
  };
}

export function buildEventTrend(events: OpsEventItem[], summary: OpsSummaryResponse) {
  const start = Date.parse(summary.windows.current.startUtcIso);
  const end = Date.parse(summary.windows.current.endUtcIso);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return [];

  const bucketCount = 8;
  const bucketMs = (end - start) / bucketCount;
  const buckets = Array.from({ length: bucketCount }, (_, index) => {
    const bucketStart = start + (bucketMs * index);
    return {
      label: new Date(bucketStart).toLocaleTimeString("en-GB", {
        timeZone: "Africa/Cairo",
        hour: "2-digit",
        minute: "2-digit",
      }),
      pageViews: 0,
      events: 0,
      errors: 0,
    };
  });

  for (const event of events) {
    const occurredAt = Date.parse(event.occurredAt);
    if (!Number.isFinite(occurredAt) || occurredAt < start || occurredAt >= end) continue;
    const index = Math.max(0, Math.min(bucketCount - 1, Math.floor((occurredAt - start) / bucketMs)));
    buckets[index]!.events += 1;
    if (event.eventType === "page_view") {
      buckets[index]!.pageViews += 1;
    }
    if (event.eventType === "api_error" || event.eventType === "js_error" || event.eventType === "unhandled_rejection") {
      buckets[index]!.errors += 1;
    }
  }

  return buckets;
}

function topPagesOption(summary: OpsSummaryResponse): EChartsOption {
  const pages = summary.topPages.slice(0, 8);
  return {
    color: ["#2563eb"],
    tooltip: { trigger: "axis" },
    grid: { left: 6, right: 14, top: 16, bottom: 8, containLabel: true },
    xAxis: { type: "value", ...axisBase() },
    yAxis: {
      type: "category",
      data: pages.map((page) => page.path),
      ...axisBase(),
      axisLabel: {
        color: chartText,
        fontWeight: 800,
        width: 120,
        overflow: "truncate",
      },
    },
    series: [{
      name: "Views",
      type: "bar",
      data: pages.map((page) => page.views),
      barWidth: 14,
      itemStyle: { borderRadius: [0, 6, 6, 0] },
    }],
  };
}

function bucketPieOption(params: {
  title: string;
  buckets: OpsBucket[];
  colorForKey: (key: string) => string;
  labelForKey: (key: string) => string;
}): EChartsOption {
  return {
    color: params.buckets.map((bucket) => params.colorForKey(bucket.key)),
    tooltip: { trigger: "item" },
    legend: {
      bottom: 0,
      textStyle: { color: chartText, fontWeight: 800 },
    },
    series: [{
      name: params.title,
      type: "pie",
      radius: ["48%", "72%"],
      center: ["50%", "43%"],
      avoidLabelOverlap: true,
      label: {
        formatter: (value: { name?: string; value?: unknown }) => `${value.name ?? "Unknown"}: ${formatOpsNumber(Number(value.value ?? 0))}`,
        color: chartText,
        fontWeight: 800,
      },
      data: params.buckets.map((bucket) => ({
        name: params.labelForKey(bucket.key),
        value: bucket.count,
        itemStyle: { color: params.colorForKey(bucket.key) },
      })),
    }],
  };
}

function statusColor(key: string) {
  if (key === "2xx") return "#16a34a";
  if (key === "3xx") return "#2563eb";
  if (key === "4xx") return "#ca8a04";
  if (key === "5xx") return "#dc2626";
  return "#64748b";
}

function eventTrendOption(trend: ReturnType<typeof buildEventTrend>): EChartsOption {
  return {
    color: ["#2563eb", "#0f766e", "#dc2626"],
    tooltip: { trigger: "axis" },
    legend: {
      top: 0,
      right: 8,
      textStyle: { color: chartText, fontWeight: 800 },
    },
    grid: { left: 10, right: 18, top: 42, bottom: 8, containLabel: true },
    xAxis: {
      type: "category",
      data: trend.map((bucket) => bucket.label),
      ...axisBase(),
    },
    yAxis: { type: "value", ...axisBase() },
    series: [
      {
        name: "Events",
        type: "line",
        smooth: true,
        symbolSize: 7,
        data: trend.map((bucket) => bucket.events),
        areaStyle: { opacity: 0.08 },
      },
      {
        name: "Page views",
        type: "line",
        smooth: true,
        symbolSize: 7,
        data: trend.map((bucket) => bucket.pageViews),
      },
      {
        name: "Errors",
        type: "line",
        smooth: true,
        symbolSize: 7,
        data: trend.map((bucket) => bucket.errors),
      },
    ],
  };
}

function eventTypesOption(summary: OpsSummaryResponse): EChartsOption {
  const eventTypes = summary.topEventTypes.slice(0, 8);
  return {
    color: ["#0f766e"],
    tooltip: { trigger: "axis" },
    grid: { left: 8, right: 14, top: 16, bottom: 8, containLabel: true },
    xAxis: {
      type: "category",
      data: eventTypes.map((item) => item.type.replace(/_/g, " ")),
      ...axisBase(),
      axisLabel: { color: chartText, fontWeight: 800, rotate: 25 },
    },
    yAxis: { type: "value", ...axisBase() },
    series: [{
      name: "Events",
      type: "bar",
      data: eventTypes.map((item) => item.count),
      barWidth: 18,
      itemStyle: { borderRadius: [6, 6, 0, 0] },
    }],
  };
}

export function OpsTrafficCharts(props: { summary: OpsSummaryResponse; events: OpsEventItem[] }) {
  const trend = buildEventTrend(props.events, props.summary);
  const sessionsBySystem = props.summary.statusBuckets.sessionsBySystem;
  return (
    <Box
      sx={{
        display: "grid",
        gridTemplateColumns: { xs: "1fr", lg: "1.25fr 0.75fr" },
        gap: 1.5,
      }}
    >
      <ChartSurface
        title="Route Traffic Trend"
        subtitle="Events, page views, and error pressure in the selected window."
        option={eventTrendOption(trend)}
        empty={!trend.some((bucket) => bucket.events > 0)}
        testId="ops-event-trend-chart"
      />
      <ChartSurface
        title="Sessions By System"
        subtitle="Current session distribution across workspaces."
        option={bucketPieOption({
          title: "Sessions",
          buckets: sessionsBySystem,
          colorForKey: systemColor,
          labelForKey: systemLabel,
        })}
        empty={!sessionsBySystem.length}
        testId="ops-system-distribution-chart"
      />
      <ChartSurface
        title="Top Pages"
        subtitle="Most-viewed routes in the selected telemetry window."
        option={topPagesOption(props.summary)}
        empty={!props.summary.topPages.length}
        testId="ops-top-pages-chart"
      />
      <ChartSurface
        title="Top Event Types"
        subtitle="High-signal product and platform events."
        option={eventTypesOption(props.summary)}
        empty={!props.summary.topEventTypes.length}
        testId="ops-event-types-chart"
      />
    </Box>
  );
}

export function OpsErrorCharts(props: { summary: OpsSummaryResponse }) {
  const severityBuckets = props.summary.errorBuckets.bySeverity;
  const apiStatusBuckets = props.summary.statusBuckets.apiStatus;
  return (
    <Box
      sx={{
        display: "grid",
        gridTemplateColumns: { xs: "1fr", md: "1fr 1fr" },
        gap: 1.5,
      }}
    >
      <ChartSurface
        title="Error Severity"
        subtitle="Aggregated normalized errors by severity."
        option={bucketPieOption({
          title: "Errors",
          buckets: severityBuckets,
          colorForKey: severityColor,
          labelForKey: severityLabel,
        })}
        empty={!severityBuckets.length}
        testId="ops-error-severity-chart"
      />
      <ChartSurface
        title="API Status Buckets"
        subtitle="Request status distribution for recent API telemetry."
        option={bucketPieOption({
          title: "Status",
          buckets: apiStatusBuckets,
          colorForKey: statusColor,
          labelForKey: (key) => key.toUpperCase(),
        })}
        empty={!apiStatusBuckets.length}
        testId="ops-api-status-chart"
      />
    </Box>
  );
}
