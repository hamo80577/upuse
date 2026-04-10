import { Box, Button, Chip, CircularProgress, Divider, Skeleton, Stack, Typography } from "@mui/material";
import { fmtInt } from "../../../utils/format";
import { describeLogMessage } from "../lib/logMessageMapper";
import { fmtPlacedAt } from "../lib/time";

export interface BranchLogDay {
  dayKey: string;
  dayLabel: string;
  items: Array<{ ts: string; level: string; message: string }>;
}

export function BranchLogPanel(props: {
  logDays: BranchLogDay[];
  logLoading: boolean;
  logLoadingMore: boolean;
  hasMoreLogs: boolean;
  logError: string | null;
  clearingLog: boolean;
  canClear?: boolean;
  onLoadMore: () => void;
  onClear: () => void;
}) {
  const loadedLogCount = props.logDays.reduce((sum, group) => sum + group.items.length, 0);
  const canClear = props.canClear ?? true;

  return (
    <Box
      sx={{
        borderRadius: 2.5,
        border: "1px solid rgba(148,163,184,0.14)",
        overflow: "hidden",
        bgcolor: "rgba(255,255,255,0.94)",
        boxShadow: "0 12px 28px rgba(15,23,42,0.04)",
      }}
    >
      <Box sx={{ px: 1.35, py: 1.1, bgcolor: "rgba(248,250,252,0.86)" }}>
        <Stack direction="row" spacing={1} alignItems="center" justifyContent="space-between">
          <Box>
            <Typography variant="caption" sx={{ color: "text.secondary", fontWeight: 800 }}>
              Activity Feed
            </Typography>
            <Typography variant="caption" sx={{ display: { xs: "none", sm: "block" }, color: "text.secondary" }}>
              {loadedLogCount ? `${fmtInt(loadedLogCount)} loaded entries` : "No saved entries"}
            </Typography>
          </Box>

          <Button
            size="small"
            color="error"
            variant="text"
            disabled={!canClear || !loadedLogCount || props.clearingLog}
            onClick={props.onClear}
            sx={{ minWidth: 0, fontWeight: 800 }}
          >
            {!canClear ? "No Access" : props.clearingLog ? "Clearing..." : "Clear Log"}
          </Button>
        </Stack>
      </Box>
      <Divider />
      <Stack spacing={0} sx={{ maxHeight: { xs: "none", sm: 240 }, overflowY: { xs: "visible", sm: "auto" } }}>
        {props.logLoading && !loadedLogCount ? (
          <Stack spacing={0.8} sx={{ px: 1.35, py: 1.2 }}>
            <Skeleton animation="wave" variant="rounded" height={20} />
            <Skeleton animation="wave" variant="rounded" height={20} />
            <Skeleton animation="wave" variant="rounded" height={20} />
            <Stack alignItems="center" sx={{ pt: 0.5 }}>
              <CircularProgress size={18} />
            </Stack>
          </Stack>
        ) : props.logError ? (
          <Box sx={{ px: 1.35, py: 1.2 }}>
            <Typography variant="caption" sx={{ color: "#b91c1c" }}>
              {props.logError}
            </Typography>
          </Box>
        ) : loadedLogCount ? (
          <>
            {props.logDays.map((group) => (
              <Box key={group.dayKey}>
                <Box
                  sx={{
                    px: 1.35,
                    py: 0.75,
                    borderBottom: "1px solid rgba(148,163,184,0.10)",
                    bgcolor: "rgba(248,250,252,0.58)",
                  }}
                >
                  <Typography variant="caption" sx={{ color: "#475569", fontWeight: 900 }}>
                    {group.dayLabel}
                  </Typography>
                </Box>

                {group.items.map((item, index) => {
                  const entry = describeLogMessage(item.message);
                  const isLastItem = index === group.items.length - 1;
                  const isLastGroup = group.dayKey === props.logDays[props.logDays.length - 1]?.dayKey;

                  return (
                    <Box
                      key={`${group.dayKey}-${item.ts}-${index}`}
                      sx={{
                        position: "relative",
                        px: 1.35,
                        py: 0.95,
                        pl: 2.5,
                        ...(!isLastItem || !isLastGroup
                          ? { borderBottom: "1px solid rgba(148,163,184,0.10)" }
                          : {}),
                      }}
                    >
                      <Box
                        sx={{
                          position: "absolute",
                          left: 1.2,
                          top: 1.2,
                          bottom: !isLastItem || !isLastGroup ? -1 : 1.2,
                          width: 1,
                          bgcolor: "rgba(148,163,184,0.18)",
                        }}
                      />
                      <Box
                        sx={{
                          position: "absolute",
                          left: 0.88,
                          top: 1.1,
                          width: 8,
                          height: 8,
                          borderRadius: "50%",
                          bgcolor:
                            item.level === "ERROR"
                              ? "#dc2626"
                              : item.level === "WARN"
                                ? "#f59e0b"
                                : "#94a3b8",
                          boxShadow: "0 0 0 4px rgba(148,163,184,0.10)",
                        }}
                      />
                      <Stack direction="row" gap={1} alignItems="flex-start">
                        <Typography variant="caption" sx={{ color: "text.secondary", minWidth: 44, pt: 0.15 }}>
                          {fmtPlacedAt(item.ts)}
                        </Typography>
                        <Chip
                          size="small"
                          label={item.level}
                          sx={{
                            fontWeight: 900,
                            height: 22,
                            bgcolor:
                              item.level === "ERROR"
                                ? "rgba(254,242,242,0.92)"
                                : item.level === "WARN"
                                  ? "rgba(255,247,237,0.94)"
                                  : "rgba(241,245,249,0.94)",
                            color:
                              item.level === "ERROR"
                                ? "#b91c1c"
                                : item.level === "WARN"
                                  ? "#b45309"
                                  : "#0f172a",
                          }}
                        />
                        <Box sx={{ minWidth: 0, flex: 1 }}>
                          <Typography variant="caption" sx={{ display: "block", color: "#0f172a", fontWeight: 800, lineHeight: 1.35 }}>
                            {entry.title}
                          </Typography>
                          {entry.detail ? (
                            <Typography variant="caption" sx={{ display: "block", color: "text.secondary", lineHeight: 1.45, mt: 0.15 }}>
                              {entry.detail}
                            </Typography>
                          ) : null}
                        </Box>
                      </Stack>
                    </Box>
                  );
                })}
              </Box>
            ))}

            {props.hasMoreLogs ? (
              <Box sx={{ px: 1.35, py: 1 }}>
                <Button
                  size="small"
                  variant="text"
                  onClick={props.onLoadMore}
                  disabled={props.logLoadingMore}
                  sx={{ fontWeight: 800, px: 0 }}
                >
                  {props.logLoadingMore ? "Loading..." : "Load More"}
                </Button>
              </Box>
            ) : null}
          </>
        ) : (
          <Box sx={{ px: 1.35, py: 1.2 }}>
            <Typography variant="caption" sx={{ color: "text.secondary" }}>
              No log entries yet.
            </Typography>
          </Box>
        )}
      </Stack>
    </Box>
  );
}
