import {
  Alert,
  Box,
  Chip,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from "@mui/material";
import type {
  OpsUsageHistoryDaySummary,
  OpsUsageHistoryResponse,
  OpsUsageHistoryUserReport,
  OpsUsageSatisfactionStatus,
} from "../../../api/types";
import {
  formatOpsDurationMs,
  formatOpsNumber,
  systemColor,
  systemLabel,
} from "../lib/opsFormat";

function satisfactionColor(status: OpsUsageSatisfactionStatus) {
  switch (status) {
    case "positive":
      return "#15803d";
    case "friction":
      return "#dc2626";
    default:
      return "#a16207";
  }
}

function satisfactionLabel(status: OpsUsageSatisfactionStatus) {
  switch (status) {
    case "positive":
      return "Positive";
    case "friction":
      return "Friction";
    default:
      return "Mixed";
  }
}

function surfaceSx() {
  return {
    minWidth: 0,
    p: { xs: 1.5, md: 1.8 },
    borderRadius: "8px",
    border: "1px solid rgba(148,163,184,0.18)",
    bgcolor: "#ffffff",
    boxShadow: "0 16px 34px rgba(15,23,42,0.045)",
  };
}

function compactTableWrapSx() {
  return {
    overflowX: "auto",
    borderRadius: "8px",
    border: "1px solid rgba(148,163,184,0.14)",
  };
}

function MetricCard(props: { label: string; value: string; detail: string; color?: string }) {
  return (
    <Box
      sx={{
        p: 1.2,
        borderRadius: "8px",
        border: "1px solid rgba(148,163,184,0.16)",
        bgcolor: "#fff",
      }}
    >
      <Typography variant="body2" sx={{ color: "#64748b", fontWeight: 900 }}>
        {props.label}
      </Typography>
      <Typography sx={{ color: props.color ?? "#0f172a", fontWeight: 950, fontSize: 22, mt: 0.6 }}>
        {props.value}
      </Typography>
      <Typography variant="body2" sx={{ color: "#64748b", lineHeight: 1.55, mt: 0.45 }}>
        {props.detail}
      </Typography>
    </Box>
  );
}

function UserNameCell(props: { user: OpsUsageHistoryUserReport }) {
  return (
    <TableCell>
      <Typography sx={{ fontWeight: 900, color: "#0f172a" }}>
        {props.user.userName ?? "Unknown user"}
      </Typography>
      <Typography variant="caption" sx={{ color: "#64748b" }}>
        {props.user.userEmail ?? "No email"}
      </Typography>
    </TableCell>
  );
}

function DayRow(props: {
  day: OpsUsageHistoryDaySummary;
  selected: boolean;
  onSelect: (dayKey: string) => void;
}) {
  const tone = satisfactionColor(props.day.satisfaction.status);
  return (
    <TableRow
      hover
      onClick={() => props.onSelect(props.day.dayKey)}
      sx={{
        cursor: "pointer",
        bgcolor: props.selected ? "rgba(37,99,235,0.06)" : undefined,
        "& td": { borderColor: "rgba(148,163,184,0.12)" },
      }}
    >
      <TableCell>
        <Typography sx={{ fontWeight: 900, color: "#0f172a" }}>{props.day.label}</Typography>
        <Typography variant="caption" sx={{ color: "#64748b" }}>{props.day.dayKey}</Typography>
      </TableCell>
      <TableCell>{formatOpsNumber(props.day.uniqueUsers)}</TableCell>
      <TableCell>{formatOpsNumber(props.day.sessionCount)}</TableCell>
      <TableCell>{formatOpsDurationMs(props.day.averageSessionDurationMs)}</TableCell>
      <TableCell sx={{ maxWidth: 220 }}>
        <Typography noWrap sx={{ color: "#0f172a", fontWeight: 800 }}>
          {props.day.topPage ?? "No page data"}
        </Typography>
        <Typography variant="caption" sx={{ color: "#64748b" }}>
          {formatOpsNumber(props.day.topPageViews)} views
        </Typography>
      </TableCell>
      <TableCell>
        <Chip
          label={`${satisfactionLabel(props.day.satisfaction.status)} ${props.day.satisfaction.score}`}
          size="small"
          sx={{
            borderRadius: "8px",
            fontWeight: 900,
            color: tone,
            bgcolor: `${tone}14`,
          }}
        />
      </TableCell>
    </TableRow>
  );
}

export function OpsDailyUsageHistoryPanel(props: {
  history: OpsUsageHistoryResponse | null;
  loading: boolean;
  errorMessage: string | null;
  onSelectDay: (dayKey: string) => void;
}) {
  if (props.loading && !props.history) {
    return (
      <Box sx={surfaceSx()}>
        <Typography sx={{ color: "#0f172a", fontWeight: 950, mb: 0.8 }}>Daily Usage History</Typography>
        <Typography variant="body2" sx={{ color: "#64748b" }}>
          Loading day-by-day usage history...
        </Typography>
      </Box>
    );
  }

  if (props.errorMessage) {
    return (
      <Alert severity="warning" sx={{ borderRadius: "8px" }}>
        {props.errorMessage}
      </Alert>
    );
  }

  if (!props.history || (!props.history.days.length && !props.loading)) {
    return (
      <Alert severity="info" sx={{ borderRadius: "8px" }}>
        No daily user history is available yet.
      </Alert>
    );
  }

  const selectedDay = props.history?.selectedDay;

  return (
    <Stack spacing={1.5}>
      <Alert
        severity="info"
        sx={{
          borderRadius: "8px",
          border: "1px solid rgba(14,116,144,0.16)",
          bgcolor: "#ecfeff",
          color: "#155e75",
          "& .MuiAlert-icon": { color: "#0891b2" },
        }}
      >
        Satisfaction is an inferred signal from session time, navigation depth, and visible error pressure.
      </Alert>

      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: { xs: "1fr", xl: "minmax(0, 1.2fr) minmax(320px, 0.8fr)" },
          gap: 1.5,
        }}
      >
        <Box sx={surfaceSx()}>
          <Stack spacing={1.1} sx={{ mb: 1.2 }}>
            <Typography sx={{ color: "#0f172a", fontWeight: 950 }}>Daily Usage History</Typography>
            <Typography variant="body2" sx={{ color: "#64748b" }}>
              Day-by-day traffic, unique users, time on site, top page, and inferred sentiment.
            </Typography>
          </Stack>
          <Box sx={compactTableWrapSx()}>
            <Table size="small" sx={{ minWidth: 760 }}>
              <TableHead>
                <TableRow sx={{ bgcolor: "rgba(248,250,252,0.95)" }}>
                  <TableCell>Day</TableCell>
                  <TableCell>Users</TableCell>
                  <TableCell>Sessions</TableCell>
                  <TableCell>Avg Time</TableCell>
                  <TableCell>Top Page</TableCell>
                  <TableCell>Satisfaction</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {props.history.days.map((day) => (
                  <DayRow
                    key={day.dayKey}
                    day={day}
                    selected={day.dayKey === props.history?.selectedDayKey}
                    onSelect={props.onSelectDay}
                  />
                ))}
              </TableBody>
            </Table>
          </Box>
        </Box>

        <Box sx={surfaceSx()}>
          <Stack spacing={1.2}>
            <Box>
              <Typography sx={{ color: "#0f172a", fontWeight: 950 }}>
                {selectedDay ? `${selectedDay.label} Report` : "Day Report"}
              </Typography>
              <Typography variant="body2" sx={{ color: "#64748b", mt: 0.35 }}>
                {selectedDay ? selectedDay.satisfaction.note : "Select a day to inspect user behavior."}
              </Typography>
            </Box>

            {selectedDay ? (
              <>
                <Box
                  sx={{
                    display: "grid",
                    gridTemplateColumns: { xs: "1fr 1fr", lg: "repeat(2, minmax(0, 1fr))" },
                    gap: 1,
                  }}
                >
                  <MetricCard
                    label="Different Users"
                    value={formatOpsNumber(selectedDay.uniqueUsers)}
                    detail={`${formatOpsNumber(selectedDay.sessionCount)} sessions in this day`}
                  />
                  <MetricCard
                    label="Time On Site"
                    value={formatOpsDurationMs(selectedDay.totalDurationMs)}
                    detail={`${formatOpsDurationMs(selectedDay.averageSessionDurationMs)} average session`}
                  />
                  <MetricCard
                    label="Most Opened Page"
                    value={selectedDay.topPage ?? "No page data"}
                    detail={`${formatOpsNumber(selectedDay.topPageViews)} page views`}
                  />
                  <MetricCard
                    label="Satisfaction Signal"
                    value={`${satisfactionLabel(selectedDay.satisfaction.status)} ${selectedDay.satisfaction.score}`}
                    detail={`${formatOpsNumber(selectedDay.satisfaction.positiveUsers)} positive, ${formatOpsNumber(selectedDay.satisfaction.frictionUsers)} friction`}
                    color={satisfactionColor(selectedDay.satisfaction.status)}
                  />
                </Box>
                <Box
                  sx={{
                    p: 1.2,
                    borderRadius: "8px",
                    border: "1px solid rgba(148,163,184,0.16)",
                    bgcolor: "#fff",
                  }}
                >
                  <Typography variant="body2" sx={{ color: "#64748b", fontWeight: 900 }}>
                    Report note
                  </Typography>
                  <Typography sx={{ color: "#0f172a", fontWeight: 800, mt: 0.6 }}>
                    {selectedDay.satisfaction.note}
                  </Typography>
                </Box>
              </>
            ) : null}
          </Stack>
        </Box>
      </Box>

      <Box sx={surfaceSx()}>
        <Stack spacing={1.1} sx={{ mb: 1.2 }}>
          <Typography sx={{ color: "#0f172a", fontWeight: 950 }}>User Behavior Report</Typography>
          <Typography variant="body2" sx={{ color: "#64748b" }}>
            Per-user site time, top page, page views, visible error count, and inferred satisfaction.
          </Typography>
        </Stack>
        <Box sx={compactTableWrapSx()}>
          <Table size="small" sx={{ minWidth: 980 }}>
            <TableHead>
              <TableRow sx={{ bgcolor: "rgba(248,250,252,0.95)" }}>
                <TableCell>User</TableCell>
                <TableCell>Workspaces</TableCell>
                <TableCell>Sessions</TableCell>
                <TableCell>Time On Site</TableCell>
                <TableCell>Top Page</TableCell>
                <TableCell>Views</TableCell>
                <TableCell>Errors</TableCell>
                <TableCell>Satisfaction</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {selectedDay?.users.length ? (
                selectedDay.users.map((user) => {
                  const tone = satisfactionColor(user.satisfaction.status);
                  return (
                    <TableRow key={`${user.userId ?? user.userEmail ?? user.userName ?? "unknown"}-${user.topPage ?? "none"}`} sx={{ "& td": { borderColor: "rgba(148,163,184,0.12)" } }}>
                      <UserNameCell user={user} />
                      <TableCell>
                        <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
                          {user.systems.length ? user.systems.map((system) => (
                            <Chip
                              key={`${user.userId ?? user.userEmail ?? user.userName ?? "unknown"}-${system}`}
                              label={systemLabel(system)}
                              size="small"
                              sx={{
                                height: 24,
                                borderRadius: "8px",
                                fontWeight: 900,
                                color: systemColor(system),
                                bgcolor: `${systemColor(system)}14`,
                              }}
                            />
                          )) : <Typography variant="body2" sx={{ color: "#64748b" }}>No workspace data</Typography>}
                        </Stack>
                      </TableCell>
                      <TableCell>{formatOpsNumber(user.sessionCount)}</TableCell>
                      <TableCell>
                        <Typography sx={{ fontWeight: 800, color: "#0f172a" }}>
                          {formatOpsDurationMs(user.totalDurationMs)}
                        </Typography>
                        <Typography variant="caption" sx={{ color: "#64748b" }}>
                          Avg {formatOpsDurationMs(user.averageSessionDurationMs)}
                        </Typography>
                      </TableCell>
                      <TableCell sx={{ maxWidth: 240 }}>
                        <Typography noWrap sx={{ fontWeight: 800, color: "#0f172a" }}>
                          {user.topPage ?? "No page data"}
                        </Typography>
                        <Typography variant="caption" sx={{ color: "#64748b" }}>
                          {formatOpsNumber(user.topPageViews)} views
                        </Typography>
                      </TableCell>
                      <TableCell>{formatOpsNumber(user.pageViews)}</TableCell>
                      <TableCell>{formatOpsNumber(user.errorCount)}</TableCell>
                      <TableCell sx={{ maxWidth: 220 }}>
                        <Chip
                          label={`${satisfactionLabel(user.satisfaction.status)} ${user.satisfaction.score}`}
                          size="small"
                          sx={{
                            borderRadius: "8px",
                            fontWeight: 900,
                            color: tone,
                            bgcolor: `${tone}14`,
                            mb: 0.5,
                          }}
                        />
                        <Typography variant="caption" sx={{ color: "#64748b", display: "block", lineHeight: 1.5 }}>
                          {user.satisfaction.note}
                        </Typography>
                      </TableCell>
                    </TableRow>
                  );
                })
              ) : (
                <TableRow>
                  <TableCell colSpan={8} align="center" sx={{ py: 4, color: "#64748b", fontWeight: 800 }}>
                    No user behavior has been captured for the selected day.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </Box>
      </Box>
    </Stack>
  );
}
