import CheckCircleRoundedIcon from "@mui/icons-material/CheckCircleRounded";
import ExpandLessRoundedIcon from "@mui/icons-material/ExpandLessRounded";
import ExpandMoreRoundedIcon from "@mui/icons-material/ExpandMoreRounded";
import StopCircleRoundedIcon from "@mui/icons-material/StopCircleRounded";
import {
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Stack,
  Typography,
} from "@mui/material";
import type { SxProps, Theme } from "@mui/material/styles";
import type { ReactNode } from "react";
import type { ScanoTaskCounters, ScanoTaskDetail } from "../../../api/types";
import { formatCairoFullDateTime, getScanoTaskStatusMeta } from "../../../pages/scano/ui/scanoShared";
import { ProductCounterCard } from "./RunnerSummaryCards";

export function RunnerTaskSummaryCard(props: {
  actionLoading: boolean;
  counters: ScanoTaskCounters;
  myConfirmedLabel: string;
  onEndTask: () => void;
  onStartTask: () => void;
  task: ScanoTaskDetail;
  taskAssigneeNames: string;
  taskSummaryExpanded: boolean;
  taskSummarySubtitle: string | null;
  taskSummaryTitle: string;
  taskTotalLabel: string;
  setTaskSummaryExpanded: (next: boolean | ((current: boolean) => boolean)) => void;
}) {
  const statusMeta = getScanoTaskStatusMeta(props.task.status);
  const showStartAction = props.task.permissions.canStart;

  return (
    <Card
      sx={{
        borderRadius: 2.2,
        bgcolor: "rgba(255,255,255,0.82)",
        border: "1px solid rgba(226,232,240,0.95)",
        boxShadow: "0 10px 22px rgba(148,163,184,0.1)",
      }}
    >
      <CardContent sx={{ p: { xs: 1.2, sm: 1.5 } }}>
        <Stack spacing={1.2}>
          <Stack
            direction={{ xs: "column", md: "row" }}
            justifyContent="space-between"
            spacing={1.2}
            alignItems={{ xs: "stretch", md: "center" }}
          >
            <Stack spacing={0.45} sx={{ minWidth: 0 }}>
              <Typography
                sx={{
                  fontSize: { xs: 20, sm: 22 },
                  fontWeight: 950,
                  color: "#16324f",
                  letterSpacing: "-0.03em",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {props.taskSummaryTitle}
              </Typography>
              {props.taskSummarySubtitle ? (
                <Typography
                  variant="body2"
                  sx={{
                    color: "#6b85a0",
                    fontWeight: 700,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {props.taskSummarySubtitle}
                </Typography>
              ) : null}
            </Stack>

            <Stack direction="row" spacing={0.8} flexWrap="wrap" useFlexGap alignItems="center">
              <SummaryChip label={props.myConfirmedLabel} sx={{ bgcolor: "#eff6ff", color: "#5f87b0", border: "1px solid rgba(191,219,254,0.98)" }} />
              <SummaryChip label={props.taskTotalLabel} sx={{ bgcolor: "#f0fdf4", color: "#5b8f74", border: "1px solid rgba(187,247,208,0.98)" }} />
              <Chip size="small" label={statusMeta.label} sx={{ fontWeight: 800, ...statusMeta.sx }} />
            </Stack>
          </Stack>

          <Button
            variant="text"
            color="inherit"
            onClick={() => props.setTaskSummaryExpanded((current) => !current)}
            endIcon={props.taskSummaryExpanded ? <ExpandLessRoundedIcon /> : <ExpandMoreRoundedIcon />}
            aria-expanded={props.taskSummaryExpanded}
            sx={{
              alignSelf: "flex-start",
              px: 0,
              minWidth: 0,
              color: "#6984a0",
              fontWeight: 800,
            }}
          >
            {props.taskSummaryExpanded ? "Hide Task Details" : "Show Task Details"}
          </Button>

          {props.taskSummaryExpanded ? (
            <Stack spacing={1.3}>
              <Stack direction={{ xs: "column", sm: "row" }} spacing={1}>
                <ProductCounterCard label="Products" total={props.counters.scannedProductsCount ?? 0} />
                <ProductCounterCard label="Vendor" total={props.counters.vendorCount ?? 0} edited={props.counters.vendorEditedCount} />
                <ProductCounterCard label="Chain" total={props.counters.chainCount ?? 0} edited={props.counters.chainEditedCount} />
                <ProductCounterCard label="Master" total={props.counters.masterCount ?? 0} />
                <ProductCounterCard label="Manual" total={props.counters.manualCount ?? 0} />
              </Stack>

              <Stack direction={{ xs: "column", sm: "row" }} spacing={1.1}>
                <DetailInfoCard label="Scheduled At" value={formatCairoFullDateTime(props.task.scheduledAt)} />
                <DetailInfoCard label="Assigned Scanners" value={props.taskAssigneeNames || "-"} />
              </Stack>

              <Stack direction={{ xs: "column", sm: "row" }} spacing={1}>
                {showStartAction ? (
                  <Button
                    variant="contained"
                    color="success"
                    startIcon={props.actionLoading ? <CircularProgress size={16} color="inherit" /> : <CheckCircleRoundedIcon />}
                    onClick={props.onStartTask}
                    disabled={props.actionLoading}
                  >
                    Start Task
                  </Button>
                ) : null}

                {props.task.viewerState.canEnd ? (
                  <Button
                    variant="contained"
                    color="error"
                    startIcon={props.actionLoading ? <CircularProgress size={16} color="inherit" /> : <StopCircleRoundedIcon />}
                    onClick={props.onEndTask}
                    disabled={props.actionLoading}
                  >
                    End Task
                  </Button>
                ) : null}
              </Stack>
            </Stack>
          ) : null}
        </Stack>
      </CardContent>
    </Card>
  );
}

function SummaryChip(props: {
  label: string;
  sx: SxProps<Theme>;
}) {
  return <Chip size="small" label={props.label} sx={{ fontWeight: 900, ...props.sx }} />;
}

function DetailInfoCard(props: {
  label: string;
  value: ReactNode;
}) {
  return (
    <Card variant="outlined" sx={{ borderRadius: 2, flex: "1 1 0" }}>
      <CardContent sx={{ p: 1.3 }}>
        <Typography variant="caption" sx={{ color: "text.secondary" }}>
          {props.label}
        </Typography>
        <Typography sx={{ fontWeight: 800 }}>
          {props.value}
        </Typography>
      </CardContent>
    </Card>
  );
}
