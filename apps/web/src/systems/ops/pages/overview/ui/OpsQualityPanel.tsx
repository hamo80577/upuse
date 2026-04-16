import CheckCircleRoundedIcon from "@mui/icons-material/CheckCircleRounded";
import ErrorOutlineRoundedIcon from "@mui/icons-material/ErrorOutlineRounded";
import MonitorHeartRoundedIcon from "@mui/icons-material/MonitorHeartRounded";
import SpeedRoundedIcon from "@mui/icons-material/SpeedRounded";
import TimelineRoundedIcon from "@mui/icons-material/TimelineRounded";
import TrendingDownRoundedIcon from "@mui/icons-material/TrendingDownRounded";
import TrendingFlatRoundedIcon from "@mui/icons-material/TrendingFlatRounded";
import TrendingUpRoundedIcon from "@mui/icons-material/TrendingUpRounded";
import WarningAmberRoundedIcon from "@mui/icons-material/WarningAmberRounded";
import { Alert, Box, Chip, LinearProgress, Stack, Typography } from "@mui/material";
import type { ReactNode } from "react";
import type { OpsHealthStatus, OpsQualityAlert, OpsQualityFactor, OpsSummaryResponse } from "../../../api/types";
import {
  formatOpsDateTime,
  formatOpsNumber,
  formatOpsRate,
  healthStatusColor,
  healthStatusLabel,
} from "../lib/opsFormat";

function trendIcon(direction: "up" | "down" | "flat") {
  if (direction === "up") return <TrendingUpRoundedIcon fontSize="small" />;
  if (direction === "down") return <TrendingDownRoundedIcon fontSize="small" />;
  return <TrendingFlatRoundedIcon fontSize="small" />;
}

function severityIcon(severity: OpsQualityAlert["severity"]) {
  if (severity === "critical") return <ErrorOutlineRoundedIcon fontSize="small" />;
  if (severity === "warning") return <WarningAmberRoundedIcon fontSize="small" />;
  return <CheckCircleRoundedIcon fontSize="small" />;
}

function StatusChip(props: { status: OpsHealthStatus }) {
  const color = healthStatusColor(props.status);
  return (
    <Chip
      label={healthStatusLabel(props.status)}
      size="small"
      sx={{
        borderRadius: "8px",
        color,
        bgcolor: `${color}14`,
        fontWeight: 950,
      }}
    />
  );
}

function Panel(props: { title: string; subtitle: string; children: ReactNode; action?: ReactNode }) {
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
      <Stack direction={{ xs: "column", sm: "row" }} spacing={1} justifyContent="space-between" alignItems={{ xs: "flex-start", sm: "center" }} sx={{ mb: 1.3 }}>
        <Box>
          <Typography sx={{ color: "#102033", fontWeight: 950 }}>{props.title}</Typography>
          <Typography variant="body2" sx={{ color: "#64748b", mt: 0.35 }}>{props.subtitle}</Typography>
        </Box>
        {props.action}
      </Stack>
      {props.children}
    </Box>
  );
}

function formatFactorValue(factor: OpsQualityFactor) {
  if (factor.value == null) return "No data";
  if (factor.unit === "%") return `${formatOpsRate(factor.value)}%`;
  if (factor.unit === "ms") return `${formatOpsNumber(factor.value)}ms`;
  if (factor.unit === "minutes") return `${formatOpsRate(factor.value)}m`;
  return `${formatOpsNumber(factor.value)} ${factor.unit}`;
}

function QualityFactorRow(props: { factor: OpsQualityFactor }) {
  const color = healthStatusColor(props.factor.status);
  return (
    <Box
      sx={{
        p: 1,
        borderRadius: "8px",
        border: "1px solid rgba(148,163,184,0.14)",
        bgcolor: props.factor.status === "healthy" ? "#ffffff" : `${color}08`,
      }}
    >
      <Stack spacing={0.8}>
        <Stack direction="row" spacing={1} justifyContent="space-between" alignItems="center">
          <Box sx={{ minWidth: 0 }}>
            <Typography sx={{ color: "#102033", fontWeight: 900 }}>{props.factor.label}</Typography>
            <Typography variant="caption" sx={{ color: "#64748b" }}>{props.factor.detail}</Typography>
          </Box>
          <Stack alignItems="flex-end" spacing={0.35}>
            <Typography sx={{ color, fontWeight: 950 }}>{formatFactorValue(props.factor)}</Typography>
            <Typography variant="caption" sx={{ color: "#64748b", fontWeight: 900 }}>
              -{formatOpsNumber(props.factor.penalty)}
            </Typography>
          </Stack>
        </Stack>
        <LinearProgress
          variant="determinate"
          value={Math.min(100, props.factor.penalty * 4)}
          sx={{
            height: 7,
            borderRadius: "8px",
            bgcolor: "rgba(226,232,240,0.9)",
            "& .MuiLinearProgress-bar": {
              bgcolor: color,
              borderRadius: "8px",
            },
          }}
        />
      </Stack>
    </Box>
  );
}

function QualityScorePanel(props: { summary: OpsSummaryResponse }) {
  const quality = props.summary.quality;
  const color = healthStatusColor(quality.status);
  const deltaLabel = quality.trend.delta > 0
    ? `+${formatOpsNumber(quality.trend.delta)}`
    : formatOpsNumber(quality.trend.delta);
  const topFactors = [...quality.factors]
    .sort((left, right) => right.penalty - left.penalty || left.label.localeCompare(right.label))
    .slice(0, 5);

  return (
    <Panel
      title="Quality Score"
      subtitle="Explainable score from real API, runtime, stream, freshness, monitor, and surface health signals."
      action={<StatusChip status={quality.status} />}
    >
      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: { xs: "1fr", lg: "260px minmax(0, 1fr)" },
          gap: 1.5,
          alignItems: "stretch",
        }}
      >
        <Box
          sx={{
            minHeight: 248,
            borderRadius: "8px",
            border: "1px solid rgba(148,163,184,0.14)",
            display: "grid",
            placeItems: "center",
            bgcolor: "#f8fafc",
          }}
        >
          <Stack spacing={1.2} alignItems="center">
            <Box
              sx={{
                width: 148,
                height: 148,
                borderRadius: "50%",
                display: "grid",
                placeItems: "center",
                background: `conic-gradient(${color} ${quality.score * 3.6}deg, rgba(226,232,240,0.95) 0deg)`,
              }}
            >
              <Box
                sx={{
                  width: 112,
                  height: 112,
                  borderRadius: "50%",
                  bgcolor: "#ffffff",
                  display: "grid",
                  placeItems: "center",
                  boxShadow: "inset 0 0 0 1px rgba(148,163,184,0.18)",
                }}
              >
                <Typography sx={{ color: "#102033", fontSize: 40, fontWeight: 950, lineHeight: 1 }}>
                  {formatOpsNumber(quality.score)}
                </Typography>
              </Box>
            </Box>
            <Chip
              icon={trendIcon(quality.trend.direction)}
              label={`${deltaLabel} vs previous score`}
              sx={{
                borderRadius: "8px",
                color,
                bgcolor: `${color}14`,
                fontWeight: 900,
                "& .MuiChip-icon": { color },
              }}
            />
          </Stack>
        </Box>

        <Stack spacing={0.85}>
          {topFactors.map((factor) => (
            <QualityFactorRow key={factor.key} factor={factor} />
          ))}
        </Stack>
      </Box>
    </Panel>
  );
}

function AlertsPanel(props: { alerts: OpsQualityAlert[] }) {
  const visibleAlerts = props.alerts.slice(0, 6);
  return (
    <Panel
      title="Active Alerts"
      subtitle="Admin-facing anomalies generated from the selected Ops window."
      action={<Chip label={`${formatOpsNumber(props.alerts.length)} active`} sx={{ borderRadius: "8px", fontWeight: 900 }} />}
    >
      {visibleAlerts.length ? (
        <Stack spacing={0.85}>
          {visibleAlerts.map((alert) => {
            const color = alert.severity === "critical" ? "#dc2626" : alert.severity === "warning" ? "#ca8a04" : "#2563eb";
            return (
              <Alert
                key={alert.id}
                severity={alert.severity === "critical" ? "error" : alert.severity}
                icon={severityIcon(alert.severity)}
                sx={{
                  borderRadius: "8px",
                  border: `1px solid ${color}24`,
                  bgcolor: `${color}0d`,
                  "& .MuiAlert-icon": { color },
                }}
              >
                <Stack spacing={0.35}>
                  <Stack direction="row" spacing={0.8} alignItems="center" sx={{ flexWrap: "wrap" }}>
                    <Typography sx={{ color: "#102033", fontWeight: 950 }}>{alert.title}</Typography>
                    <Chip
                      label={alert.subsystem}
                      size="small"
                      sx={{ height: 22, borderRadius: "8px", color, bgcolor: `${color}14`, fontWeight: 900 }}
                    />
                  </Stack>
                  <Typography variant="body2" sx={{ color: "#475569" }}>{alert.message}</Typography>
                </Stack>
              </Alert>
            );
          })}
        </Stack>
      ) : (
        <Box
          sx={{
            py: 4,
            textAlign: "center",
            borderRadius: "8px",
            bgcolor: "rgba(240,253,244,0.78)",
            color: "#166534",
            fontWeight: 900,
          }}
        >
          No active quality alerts in this window.
        </Box>
      )}
    </Panel>
  );
}

function SubsystemCard(props: {
  icon: ReactNode;
  title: string;
  status: OpsHealthStatus;
  score: number;
  message: string;
  details: string[];
}) {
  const color = healthStatusColor(props.status);
  return (
    <Box
      sx={{
        minWidth: 0,
        p: 1.6,
        borderRadius: "8px",
        border: `1px solid ${color}22`,
        bgcolor: "#ffffff",
        boxShadow: "0 16px 34px rgba(15,23,42,0.045)",
      }}
    >
      <Stack spacing={1.1}>
        <Stack direction="row" spacing={1} justifyContent="space-between" alignItems="flex-start">
          <Stack direction="row" spacing={1} alignItems="center" sx={{ minWidth: 0 }}>
            <Box
              sx={{
                width: 34,
                height: 34,
                borderRadius: "8px",
                display: "grid",
                placeItems: "center",
                color,
                bgcolor: `${color}14`,
              }}
            >
              {props.icon}
            </Box>
            <Box sx={{ minWidth: 0 }}>
              <Typography sx={{ color: "#102033", fontWeight: 950 }}>{props.title}</Typography>
              <Typography variant="caption" sx={{ color: "#64748b" }}>{props.message}</Typography>
            </Box>
          </Stack>
          <StatusChip status={props.status} />
        </Stack>
        <Stack direction="row" spacing={1} alignItems="baseline">
          <Typography sx={{ color, fontSize: 32, lineHeight: 1, fontWeight: 950 }}>
            {formatOpsNumber(props.score)}
          </Typography>
          <Typography sx={{ color: "#64748b", fontWeight: 900 }}>score</Typography>
        </Stack>
        <Stack spacing={0.5}>
          {props.details.map((detail) => (
            <Typography key={detail} variant="body2" sx={{ color: "#475569", fontWeight: 750 }}>
              {detail}
            </Typography>
          ))}
        </Stack>
      </Stack>
    </Box>
  );
}

function SubsystemsPanel(props: { summary: OpsSummaryResponse }) {
  const { dashboard, performance, telemetry } = props.summary.subsystems;
  return (
    <Box
      sx={{
        display: "grid",
        gridTemplateColumns: { xs: "1fr", lg: "repeat(3, minmax(0, 1fr))" },
        gap: 1.5,
      }}
    >
      <SubsystemCard
        icon={<MonitorHeartRoundedIcon fontSize="small" />}
        title={dashboard.label}
        status={dashboard.status}
        score={dashboard.score}
        message={dashboard.message}
        details={[
          `Monitor ${dashboard.monitorRunning ? "running" : "stopped"} · ${dashboard.ordersSyncState}`,
          `${formatOpsNumber(dashboard.failures)} failures · ${formatOpsNumber(dashboard.websocketFailures)} stream failures`,
          dashboard.lastHealthyAt ? `Last healthy ${formatOpsDateTime(dashboard.lastHealthyAt)}` : "No healthy timestamp",
        ]}
      />
      <SubsystemCard
        icon={<SpeedRoundedIcon fontSize="small" />}
        title={performance.label}
        status={performance.status}
        score={performance.score}
        message={performance.message}
        details={[
          `${formatOpsNumber(performance.failures)} failures · ${formatOpsNumber(performance.websocketFailures)} stream failures`,
          performance.p95LatencyMs == null ? "No performance API latency sample" : `p95 latency ${formatOpsNumber(performance.p95LatencyMs)}ms`,
          performance.lastOpenedAt ? `Last opened ${formatOpsDateTime(performance.lastOpenedAt)}` : "No recent performance open event",
        ]}
      />
      <SubsystemCard
        icon={<TimelineRoundedIcon fontSize="small" />}
        title={telemetry.label}
        status={telemetry.status}
        score={telemetry.score}
        message={telemetry.message}
        details={[
          telemetry.ageMinutes == null ? "No freshness age yet" : `Signal age ${formatOpsRate(telemetry.ageMinutes)}m`,
          `${formatOpsNumber(telemetry.websocketFailures)} total stream failures`,
          telemetry.lastSignalAt ? `Last signal ${formatOpsDateTime(telemetry.lastSignalAt)}` : "No stored signal",
        ]}
      />
    </Box>
  );
}

export function OpsQualityPanel(props: { summary: OpsSummaryResponse }) {
  return (
    <Stack spacing={1.5}>
      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: { xs: "1fr", xl: "1.2fr 0.8fr" },
          gap: 1.5,
        }}
      >
        <QualityScorePanel summary={props.summary} />
        <AlertsPanel alerts={props.summary.alerts} />
      </Box>
      <SubsystemsPanel summary={props.summary} />
    </Stack>
  );
}
