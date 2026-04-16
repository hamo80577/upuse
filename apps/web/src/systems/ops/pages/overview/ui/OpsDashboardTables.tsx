import CloseRoundedIcon from "@mui/icons-material/CloseRounded";
import SearchRoundedIcon from "@mui/icons-material/SearchRounded";
import {
  Box,
  Chip,
  Dialog,
  DialogContent,
  DialogTitle,
  IconButton,
  InputAdornment,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from "@mui/material";
import { useMemo, useState, type ReactNode } from "react";
import type { OpsErrorItem, OpsEventItem, OpsSessionItem, OpsSessionState, OpsSystemId } from "../../../api/types";
import {
  formatOpsDateTime,
  formatOpsDuration,
  formatOpsNumber,
  formatOpsRelativeTime,
  severityColor,
  severityLabel,
  stateColor,
  stateLabel,
  systemColor,
  systemLabel,
} from "../lib/opsFormat";

type SessionSortKey = "lastSeen" | "duration" | "state" | "system";

function SoftChip(props: { label: string; color: string; variant?: "filled" | "outlined" }) {
  return (
    <Chip
      label={props.label}
      size="small"
      variant={props.variant}
      sx={{
        height: 24,
        borderRadius: "8px",
        color: props.color,
        bgcolor: props.variant === "outlined" ? "transparent" : `${props.color}14`,
        borderColor: `${props.color}33`,
        fontWeight: 900,
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
      <Stack direction={{ xs: "column", md: "row" }} spacing={1} alignItems={{ xs: "stretch", md: "flex-start" }} justifyContent="space-between" sx={{ mb: 1.2 }}>
        <Box>
          <Typography sx={{ color: "#0f172a", fontWeight: 950 }}>{props.title}</Typography>
          <Typography variant="body2" sx={{ color: "#64748b", mt: 0.35 }}>{props.subtitle}</Typography>
        </Box>
        {props.action}
      </Stack>
      {props.children}
    </Box>
  );
}

function tableWrapSx() {
  return {
    overflowX: "auto",
    borderRadius: "8px",
    border: "1px solid rgba(148,163,184,0.14)",
  };
}

function textMatchesSession(session: OpsSessionItem, query: string) {
  if (!query) return true;
  const haystack = [
    session.userName,
    session.userEmail,
    session.currentPath,
    session.currentSystem,
    session.state,
  ].join(" ").toLowerCase();
  return haystack.includes(query);
}

function sessionDurationMs(session: OpsSessionItem, now: number) {
  const start = Date.parse(session.firstSeenAt);
  const end = session.endedAt ? Date.parse(session.endedAt) : now;
  return Number.isFinite(start) && Number.isFinite(end) ? Math.max(0, end - start) : 0;
}

export function OpsLiveSessionsTable(props: {
  sessions: OpsSessionItem[];
  systemFilter: "all" | OpsSystemId;
  stateFilter: "all" | OpsSessionState;
  query: string;
  now: number;
}) {
  const [sortKey, setSortKey] = useState<SessionSortKey>("lastSeen");
  const [selectedSession, setSelectedSession] = useState<OpsSessionItem | null>(null);
  const normalizedQuery = props.query.trim().toLowerCase();
  const visibleSessions = useMemo(() => {
    const items = props.sessions
      .filter((session) => props.systemFilter === "all" || session.currentSystem === props.systemFilter)
      .filter((session) => props.stateFilter === "all" || session.state === props.stateFilter)
      .filter((session) => textMatchesSession(session, normalizedQuery));

    return items.sort((left, right) => {
      if (sortKey === "duration") return sessionDurationMs(right, props.now) - sessionDurationMs(left, props.now);
      if (sortKey === "state") return left.state.localeCompare(right.state);
      if (sortKey === "system") return left.currentSystem.localeCompare(right.currentSystem);
      return Date.parse(right.lastSeenAt) - Date.parse(left.lastSeenAt);
    });
  }, [normalizedQuery, props.now, props.sessions, props.stateFilter, props.systemFilter, sortKey]);

  return (
    <>
      <Panel
        title="Live User Activity"
        subtitle="Active and recently seen authenticated sessions."
        action={(
          <Stack direction="row" spacing={0.7} alignItems="center">
            {(["lastSeen", "duration", "state", "system"] as SessionSortKey[]).map((key) => (
              <Chip
                key={key}
                size="small"
                label={key === "lastSeen" ? "Last seen" : key}
                onClick={() => setSortKey(key)}
                color={sortKey === key ? "primary" : "default"}
                variant={sortKey === key ? "filled" : "outlined"}
                sx={{ borderRadius: "8px", textTransform: "capitalize" }}
              />
            ))}
          </Stack>
        )}
      >
        <Box sx={tableWrapSx()}>
          <Table size="small" sx={{ minWidth: 780 }}>
            <TableHead>
              <TableRow sx={{ bgcolor: "rgba(248,250,252,0.95)" }}>
                <TableCell>User</TableCell>
                <TableCell>System</TableCell>
                <TableCell>Current Page</TableCell>
                <TableCell>Duration</TableCell>
                <TableCell>Last Activity</TableCell>
                <TableCell>State</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {visibleSessions.map((session) => (
                <TableRow
                  key={session.id}
                  hover
                  onClick={() => setSelectedSession(session)}
                  sx={{ cursor: "pointer", "& td": { borderColor: "rgba(148,163,184,0.12)" } }}
                >
                  <TableCell>
                    <Typography sx={{ fontWeight: 900, color: "#0f172a" }}>{session.userName ?? "Unknown user"}</Typography>
                    <Typography variant="caption" sx={{ color: "#64748b" }}>{session.userEmail ?? "No email"}</Typography>
                  </TableCell>
                  <TableCell>
                    <SoftChip label={systemLabel(session.currentSystem)} color={systemColor(session.currentSystem)} />
                  </TableCell>
                  <TableCell sx={{ maxWidth: 260 }}>
                    <Typography noWrap sx={{ color: "#0f172a", fontWeight: 800 }}>{session.currentPath ?? "No page"}</Typography>
                  </TableCell>
                  <TableCell>{formatOpsDuration(session.firstSeenAt, session.endedAt, props.now)}</TableCell>
                  <TableCell>{formatOpsRelativeTime(session.lastActiveAt ?? session.lastSeenAt, props.now)}</TableCell>
                  <TableCell>
                    <SoftChip label={stateLabel(session.state)} color={stateColor(session.state)} />
                  </TableCell>
                </TableRow>
              ))}
              {!visibleSessions.length ? (
                <TableRow>
                  <TableCell colSpan={6} align="center" sx={{ py: 4, color: "#64748b", fontWeight: 800 }}>
                    No sessions match the current filters.
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
        </Box>
      </Panel>

      <Dialog open={!!selectedSession} onClose={() => setSelectedSession(null)} fullWidth maxWidth="sm">
        <DialogTitle sx={{ pr: 6 }}>
          Session Details
          <IconButton
            aria-label="Close session details"
            onClick={() => setSelectedSession(null)}
            sx={{ position: "absolute", right: 12, top: 12 }}
          >
            <CloseRoundedIcon />
          </IconButton>
        </DialogTitle>
        <DialogContent dividers>
          {selectedSession ? (
            <Stack spacing={1.2}>
              {[
                ["User", `${selectedSession.userName ?? "Unknown"} (${selectedSession.userEmail ?? "No email"})`],
                ["System", systemLabel(selectedSession.currentSystem)],
                ["Current Page", selectedSession.currentPath ?? "No page"],
                ["State", stateLabel(selectedSession.state)],
                ["First Seen", formatOpsDateTime(selectedSession.firstSeenAt)],
                ["Last Seen", formatOpsDateTime(selectedSession.lastSeenAt)],
                ["Duration", formatOpsDuration(selectedSession.firstSeenAt, selectedSession.endedAt, props.now)],
                ["Browser", selectedSession.browserSummary ?? "Unknown"],
                ["Device", selectedSession.deviceSummary ?? "Unknown"],
              ].map(([label, value]) => (
                <Stack key={label} direction="row" spacing={2} justifyContent="space-between">
                  <Typography sx={{ color: "#64748b", fontWeight: 800 }}>{label}</Typography>
                  <Typography sx={{ color: "#0f172a", fontWeight: 900, textAlign: "right" }}>{value}</Typography>
                </Stack>
              ))}
            </Stack>
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}

function eventMatches(event: OpsEventItem, query: string) {
  if (!query) return true;
  return [
    event.eventType,
    event.system,
    event.path,
    event.endpoint,
    event.pageTitle,
    event.method,
  ].join(" ").toLowerCase().includes(query);
}

export function OpsRecentEventsTable(props: {
  events: OpsEventItem[];
  systemFilter: "all" | OpsSystemId;
  eventTypeFilter: "all" | string;
  severityFilter: "all" | string;
  query: string;
  now: number;
}) {
  const normalizedQuery = props.query.trim().toLowerCase();
  const visibleEvents = props.events
    .filter((event) => props.systemFilter === "all" || event.system === props.systemFilter)
    .filter((event) => props.eventTypeFilter === "all" || event.eventType === props.eventTypeFilter)
    .filter((event) => props.severityFilter === "all" || event.severity === props.severityFilter)
    .filter((event) => eventMatches(event, normalizedQuery))
    .slice(0, 12);

  return (
    <Panel title="Recent Event Feed" subtitle="Latest route, product, API, and runtime events.">
      <Stack spacing={0.85}>
        {visibleEvents.map((event) => (
          <Box
            key={event.id}
            sx={{
              display: "grid",
              gridTemplateColumns: { xs: "1fr", md: "160px minmax(0, 1fr) 120px 110px" },
              gap: 1,
              alignItems: "center",
              p: 1,
              borderRadius: "8px",
              border: "1px solid rgba(148,163,184,0.14)",
              bgcolor: "#fff",
            }}
          >
            <SoftChip label={event.eventType.replace(/_/g, " ")} color={severityColor(event.severity)} />
            <Box sx={{ minWidth: 0 }}>
              <Typography noWrap sx={{ color: "#0f172a", fontWeight: 900 }}>
                {event.path ?? event.endpoint ?? event.pageTitle ?? "Event"}
              </Typography>
              <Typography variant="caption" sx={{ color: "#64748b" }}>
                {event.method ? `${event.method} ` : ""}{event.statusCode ? `HTTP ${event.statusCode}` : event.category}
              </Typography>
            </Box>
            <SoftChip label={systemLabel(event.system)} color={systemColor(event.system)} variant="outlined" />
            <Typography variant="body2" sx={{ color: "#64748b", fontWeight: 800 }}>
              {formatOpsRelativeTime(event.occurredAt, props.now)}
            </Typography>
          </Box>
        ))}
        {!visibleEvents.length ? (
          <Box sx={{ py: 4, textAlign: "center", color: "#64748b", fontWeight: 800 }}>
            No events match the current filters.
          </Box>
        ) : null}
      </Stack>
    </Panel>
  );
}

export function OpsErrorIntelligence(props: { errors: OpsErrorItem[]; severityFilter: "all" | string; query: string; now: number }) {
  const normalizedQuery = props.query.trim().toLowerCase();
  const visibleErrors = props.errors
    .filter((error) => props.severityFilter === "all" || error.severity === props.severityFilter)
    .filter((error) => {
      if (!normalizedQuery) return true;
      return [error.message, error.code, error.path, error.routePattern, error.source].join(" ").toLowerCase().includes(normalizedQuery);
    })
    .slice(0, 8);

  return (
    <Panel title="Error Intelligence" subtitle="Aggregated normalized frontend and API failures.">
      {visibleErrors.length ? (
        <Stack spacing={0.85}>
          {visibleErrors.map((error) => (
            <Box
              key={error.id}
              sx={{
                p: 1.1,
                borderRadius: "8px",
                border: "1px solid rgba(148,163,184,0.14)",
                bgcolor: "#fff",
              }}
            >
              <Stack direction={{ xs: "column", md: "row" }} spacing={1} alignItems={{ xs: "flex-start", md: "center" }} justifyContent="space-between">
                <Box sx={{ minWidth: 0 }}>
                  <Stack direction="row" spacing={0.8} alignItems="center" sx={{ mb: 0.5, flexWrap: "wrap" }}>
                    <SoftChip label={severityLabel(error.severity)} color={severityColor(error.severity)} />
                    <SoftChip label={systemLabel(error.system)} color={systemColor(error.system)} variant="outlined" />
                    <Typography variant="caption" sx={{ color: "#64748b", fontWeight: 900 }}>
                      {formatOpsNumber(error.count)} seen
                    </Typography>
                  </Stack>
                  <Typography sx={{ color: "#0f172a", fontWeight: 900 }}>{error.message}</Typography>
                  <Typography variant="caption" sx={{ color: "#64748b" }}>
                    {error.path ?? error.routePattern ?? error.code ?? "No context"} · {formatOpsRelativeTime(error.lastSeenAt, props.now)}
                  </Typography>
                </Box>
                {error.statusCode ? <SoftChip label={`HTTP ${error.statusCode}`} color={severityColor(error.severity)} /> : null}
              </Stack>
            </Box>
          ))}
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
          No matching errors in this window.
        </Box>
      )}
    </Panel>
  );
}

export function OpsSearchControl(props: { value: string; onChange: (value: string) => void }) {
  return (
    <TextField
      size="small"
      value={props.value}
      onChange={(event) => props.onChange(event.target.value)}
      placeholder="Search users, pages, events"
      InputProps={{
        startAdornment: (
          <InputAdornment position="start">
            <SearchRoundedIcon fontSize="small" />
          </InputAdornment>
        ),
      }}
      sx={{
        width: { xs: "100%", md: 320 },
        "& .MuiOutlinedInput-root": {
          borderRadius: "8px",
          bgcolor: "#fff",
        },
      }}
    />
  );
}
