import CloseRoundedIcon from "@mui/icons-material/CloseRounded";
import ExpandMoreRoundedIcon from "@mui/icons-material/ExpandMoreRounded";
import RefreshRoundedIcon from "@mui/icons-material/RefreshRounded";
import WarningAmberRoundedIcon from "@mui/icons-material/WarningAmberRounded";
import {
  Alert,
  Box,
  Chip,
  Collapse,
  Dialog,
  DialogContent,
  DialogTitle,
  IconButton,
  LinearProgress,
  Skeleton,
  Stack,
  Tab,
  Tabs,
  Typography,
  useMediaQuery,
  useTheme,
} from "@mui/material";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import type {
  BranchLiveOrder,
  PerformanceCancelledOrderItem,
  PerformanceEntityBranchCard,
  PerformanceVendorDetailResponse,
} from "../../../api/types";
import { BranchOrdersSection } from "../../../widgets/branch-detail/ui/BranchOrdersSection";
import { BranchPickersPanel } from "../../../widgets/branch-detail/ui/BranchPickersPanel";

type DetailTab = "overview" | "cancellations" | "pickers";
type FlowSectionKey = "onHoldOrders" | "unassignedOrders" | "inPrepOrders" | "readyToPickupOrders";

function metric(value: number) {
  return value.toLocaleString("en-US");
}

function formatPercent(value: number) {
  return `${value.toFixed(value >= 10 ? 1 : 2)}%`;
}

function formatDateTime(value: string | null) {
  if (!value) return "--";
  try {
    return new Date(value).toLocaleString("en-GB", {
      timeZone: "Africa/Cairo",
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return value;
  }
}

function resolveDialogTitle(subject: PerformanceEntityBranchCard | null, detail: PerformanceVendorDetailResponse | null) {
  return detail?.vendor.vendorName ?? subject?.name ?? "Branch detail";
}

function resolveDialogSubtitle(subject: PerformanceEntityBranchCard | null, detail: PerformanceVendorDetailResponse | null) {
  const vendorId = detail?.vendor.vendorId ?? subject?.vendorId ?? null;
  const mappedBranch = detail?.mappedBranch;
  const parts = vendorId != null ? [`Vendor ID ${vendorId}`] : [];

  if (mappedBranch?.chainName?.trim()) {
    parts.push(mappedBranch.chainName.trim());
  }

  if (mappedBranch?.availabilityVendorId?.trim()) {
    parts.push(`Availability ID ${mappedBranch.availabilityVendorId}`);
  }

  return parts.join(" • ");
}

function DetailMetricTile(props: { label: string; value: string; secondaryValue?: string; tone?: "default" | "danger" | "warning" | "info" }) {
  const palette =
    props.tone === "danger"
      ? { bg: "rgba(254,242,242,0.98)", text: "#b91c1c", border: "rgba(239,68,68,0.14)" }
      : props.tone === "warning"
        ? { bg: "rgba(255,247,237,0.98)", text: "#c2410c", border: "rgba(249,115,22,0.14)" }
        : props.tone === "info"
          ? { bg: "rgba(239,246,255,0.98)", text: "#075985", border: "rgba(14,165,233,0.14)" }
          : { bg: "rgba(248,250,252,0.98)", text: "#0f172a", border: "rgba(148,163,184,0.14)" };

  return (
    <Box
      sx={{
        p: 1.15,
        borderRadius: 2.4,
        border: `1px solid ${palette.border}`,
        bgcolor: palette.bg,
        minHeight: 84,
        display: "flex",
        flexDirection: "column",
      }}
    >
      <Typography
        variant="caption"
        sx={{
          display: "block",
          color: "#64748b",
          fontWeight: 800,
          letterSpacing: 0.18,
          lineHeight: 1.1,
        }}
      >
        {props.label}
      </Typography>
      <Box sx={{ mt: 0.55, display: "flex", alignItems: "baseline", gap: 0.45, flexWrap: "wrap" }}>
        <Typography sx={{ fontSize: { xs: 20, md: 22 }, lineHeight: 1.02, fontWeight: 900, color: palette.text }}>
          {props.value}
        </Typography>
        {props.secondaryValue ? (
          <Typography sx={{ fontSize: { xs: 11, md: 12 }, lineHeight: 1, fontWeight: 800, color: palette.text, opacity: 0.8 }}>
            {props.secondaryValue}
          </Typography>
        ) : null}
      </Box>
    </Box>
  );
}

function OverviewSection(props: {
  title: string;
  accentColor: string;
  background: string;
  gridTemplateColumns: Partial<Record<"xs" | "sm" | "md" | "lg" | "xl", string>>;
  children: ReactNode;
}) {
  return (
    <Box
      sx={{
        p: { xs: 1.05, sm: 1.15 },
        borderRadius: 2.8,
        border: "1px solid rgba(148,163,184,0.14)",
        bgcolor: props.background,
      }}
    >
      <Stack direction="row" spacing={0.8} alignItems="center" sx={{ mb: 0.8 }}>
        <Typography
          sx={{
            fontSize: 11.5,
            fontWeight: 900,
            letterSpacing: 0.24,
            textTransform: "uppercase",
            color: props.accentColor,
            whiteSpace: "nowrap",
          }}
        >
          {props.title}
        </Typography>
        <Box sx={{ flex: 1, height: 1, bgcolor: "rgba(148,163,184,0.18)" }} />
      </Stack>

      <Box
        sx={{
          display: "grid",
          gap: 0.8,
          gridTemplateColumns: props.gridTemplateColumns,
        }}
      >
        {props.children}
      </Box>
    </Box>
  );
}

function FlowOrdersSection(props: {
  title: string;
  count: number;
  items: BranchLiveOrder[];
  open: boolean;
  onToggle: () => void;
  emptyText: string;
  tone: "warning" | "info";
  timeDisplayMode: "duration" | "none";
}) {
  const palette = props.tone === "warning"
    ? {
        bg: "linear-gradient(180deg, rgba(255,247,237,0.86) 0%, rgba(255,255,255,0.98) 100%)",
        border: "rgba(249,115,22,0.16)",
        text: "#c2410c",
        chip: "rgba(249,115,22,0.14)",
      }
    : {
        bg: "linear-gradient(180deg, rgba(239,246,255,0.82) 0%, rgba(255,255,255,0.98) 100%)",
        border: "rgba(14,165,233,0.16)",
        text: "#075985",
        chip: "rgba(14,165,233,0.14)",
      };

  return (
    <Box
      sx={{
        borderRadius: 2.8,
        border: `1px solid ${palette.border}`,
        bgcolor: "rgba(255,255,255,0.96)",
        overflow: "hidden",
      }}
    >
      <Box
        component="button"
        type="button"
        onClick={props.onToggle}
        aria-expanded={props.open}
        aria-label={`Toggle ${props.title} orders`}
        sx={{
          width: "100%",
          px: 1.3,
          py: 1.05,
          border: 0,
          textAlign: "left",
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 1,
          bgcolor: palette.bg,
          transition: "background-color 180ms ease",
        }}
      >
        <Stack direction="row" spacing={1} alignItems="center" sx={{ minWidth: 0 }}>
          <Typography sx={{ fontSize: 15, fontWeight: 900, color: "#0f172a" }}>
            {props.title}
          </Typography>
          <Chip
            size="small"
            label={metric(props.count)}
            sx={{
              height: 24,
              bgcolor: palette.chip,
              color: palette.text,
              fontWeight: 900,
            }}
          />
        </Stack>
        <Box
          sx={{
            width: 34,
            height: 34,
            display: "grid",
            placeItems: "center",
            borderRadius: "50%",
            border: "1px solid rgba(148,163,184,0.12)",
            bgcolor: "rgba(255,255,255,0.92)",
            color: "#64748b",
            transform: props.open ? "rotate(180deg)" : "rotate(0deg)",
            transition: "transform 220ms ease",
          }}
        >
          <ExpandMoreRoundedIcon fontSize="small" />
        </Box>
      </Box>

      <Collapse in={props.open} timeout={240} unmountOnExit>
        <Box sx={{ p: 1.05, bgcolor: "rgba(255,255,255,0.96)" }}>
          <BranchOrdersSection
            title={props.title}
            subtitle={props.emptyText}
            items={props.items}
            emptyText={props.emptyText}
            nowMs={Date.now()}
            hideHeader
            timeDisplayMode={props.timeDisplayMode}
          />
        </Box>
      </Collapse>
    </Box>
  );
}

function buildCancellationSections(orders: PerformanceCancelledOrderItem[]) {
  const groups = {
    VENDOR: [] as PerformanceCancelledOrderItem[],
    TRANSPORT: [] as PerformanceCancelledOrderItem[],
    CUSTOMER: [] as PerformanceCancelledOrderItem[],
    OTHER_UNKNOWN: [] as PerformanceCancelledOrderItem[],
  };

  for (const order of orders) {
    if (order.cancellationOwner === "VENDOR") {
      groups.VENDOR.push(order);
      continue;
    }
    if (order.cancellationOwner === "TRANSPORT") {
      groups.TRANSPORT.push(order);
      continue;
    }
    if (order.cancellationOwner === "CUSTOMER") {
      groups.CUSTOMER.push(order);
      continue;
    }
    groups.OTHER_UNKNOWN.push(order);
  }

  return [
    { key: "VENDOR", title: "Vendor", orders: groups.VENDOR, tone: "danger" as const },
    { key: "TRANSPORT", title: "Transport", orders: groups.TRANSPORT, tone: "warning" as const },
    { key: "CUSTOMER", title: "Customer", orders: groups.CUSTOMER, tone: "info" as const },
    { key: "OTHER_UNKNOWN", title: "Other / Unknown", orders: groups.OTHER_UNKNOWN, tone: "default" as const },
  ];
}

function CancellationRow(props: { order: PerformanceCancelledOrderItem }) {
  return (
    <Box
      sx={{
        p: 1.15,
        borderRadius: 2.1,
        border: "1px solid rgba(148,163,184,0.14)",
        bgcolor: "rgba(255,255,255,0.96)",
      }}
    >
      <Stack spacing={0.9}>
        <Stack direction={{ xs: "column", md: "row" }} justifyContent="space-between" spacing={0.8}>
          <Box sx={{ minWidth: 0 }}>
            <Typography sx={{ fontSize: 15, fontWeight: 900, color: "#0f172a" }}>
              #{props.order.externalId || props.order.orderId}
            </Typography>
          </Box>
          <Typography sx={{ color: "#475569", fontSize: 13, fontWeight: 700, whiteSpace: "nowrap" }}>
            {formatDateTime(props.order.cancellationCreatedAt)}
          </Typography>
        </Stack>

        <Stack direction="row" spacing={0.8} useFlexGap flexWrap="wrap">
          <Chip
            size="small"
            label={`Reason: ${props.order.cancellationReason || "--"}`}
            sx={{ bgcolor: "rgba(248,250,252,0.98)", fontWeight: 700 }}
          />
          <Chip
            size="small"
            label={props.order.cancellationOwner || "UNKNOWN"}
            sx={{
              bgcolor: props.order.cancellationOwner === "VENDOR"
                ? "rgba(239,68,68,0.14)"
                : props.order.cancellationOwner === "TRANSPORT"
                  ? "rgba(249,115,22,0.14)"
                  : props.order.cancellationOwner === "CUSTOMER"
                    ? "rgba(14,165,233,0.14)"
                    : "rgba(148,163,184,0.14)",
              fontWeight: 800,
            }}
          />
        </Stack>

        {props.order.cancellationOwnerLookupError ? (
          <Alert
            severity="warning"
            icon={<WarningAmberRoundedIcon fontSize="inherit" />}
            sx={{ py: 0.15, "& .MuiAlert-message": { fontSize: 12.5 } }}
          >
            {props.order.cancellationOwnerLookupError}
          </Alert>
        ) : null}
      </Stack>
    </Box>
  );
}

function CancellationsTab(props: { orders: PerformanceCancelledOrderItem[] }) {
  const sections = useMemo(() => buildCancellationSections(props.orders), [props.orders]);
  const [openSections, setOpenSections] = useState<string[]>([]);

  useEffect(() => {
    setOpenSections([]);
  }, [props.orders]);

  function toggleSection(key: string) {
    setOpenSections((current) =>
      current.includes(key)
        ? current.filter((item) => item !== key)
        : [...current, key],
    );
  }

  return (
    <Box
      sx={{
        display: "grid",
        gap: 1.2,
        gridTemplateColumns: {
          xs: "1fr",
          lg: "repeat(2, minmax(0, 1fr))",
        },
        alignItems: "start",
      }}
    >
      {sections.map((section) => (
        <Box
          key={section.key}
          sx={{
            p: { xs: 1.15, sm: 1.35 },
            borderRadius: 2.6,
            border: "1px solid rgba(148,163,184,0.16)",
            bgcolor: "rgba(255,255,255,0.94)",
          }}
        >
          <Box
            component="button"
            type="button"
            onClick={() => toggleSection(section.key)}
            aria-expanded={openSections.includes(section.key)}
            aria-label={`Toggle ${section.title} cancellations`}
            sx={{
              width: "100%",
              p: 0,
              border: 0,
              textAlign: "left",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 1,
              bgcolor: "transparent",
            }}
          >
            <Stack direction="row" spacing={1} alignItems="center" sx={{ minWidth: 0 }}>
              <Typography sx={{ fontSize: 16, fontWeight: 900, color: "#0f172a" }}>
                {section.title}
              </Typography>
              <Chip
                size="small"
                label={metric(section.orders.length)}
                sx={{
                  bgcolor: section.tone === "danger"
                    ? "rgba(239,68,68,0.14)"
                    : section.tone === "warning"
                      ? "rgba(249,115,22,0.14)"
                      : section.tone === "info"
                        ? "rgba(14,165,233,0.14)"
                        : "rgba(148,163,184,0.14)",
                  fontWeight: 900,
                }}
              />
            </Stack>
            <Box
              sx={{
                width: 34,
                height: 34,
                display: "grid",
                placeItems: "center",
                borderRadius: "50%",
                border: "1px solid rgba(148,163,184,0.12)",
                bgcolor: "rgba(248,250,252,0.92)",
                color: "#64748b",
                transform: openSections.includes(section.key) ? "rotate(180deg)" : "rotate(0deg)",
                transition: "transform 220ms ease",
              }}
            >
              <ExpandMoreRoundedIcon fontSize="small" />
            </Box>
          </Box>

          <Collapse in={openSections.includes(section.key)} timeout={240} unmountOnExit>
            {section.orders.length ? (
              <Stack spacing={0.95} sx={{ mt: 1.15 }}>
                {section.orders.map((order) => (
                  <CancellationRow key={order.orderId} order={order} />
                ))}
              </Stack>
            ) : (
              <Typography variant="body2" sx={{ mt: 1.05, color: "#64748b" }}>
                No cancelled orders in this owner group for the current Cairo day.
              </Typography>
            )}
          </Collapse>
        </Box>
      ))}
    </Box>
  );
}

function LoadingBody() {
  return (
    <Stack spacing={1.1}>
      <Skeleton variant="rounded" height={102} />
      <Skeleton variant="rounded" height={52} />
      <Skeleton variant="rounded" height={230} />
    </Stack>
  );
}

export function PerformanceBranchDialog(props: {
  open: boolean;
  subject: PerformanceEntityBranchCard | null;
  detail: PerformanceVendorDetailResponse | null;
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  onClose: () => void;
  onRefresh: () => void;
}) {
  const theme = useTheme();
  const fullScreen = useMediaQuery(theme.breakpoints.down("sm"));
  const [tab, setTab] = useState<DetailTab>("overview");
  const [openFlowSections, setOpenFlowSections] = useState<FlowSectionKey[]>([]);

  useEffect(() => {
    if (!props.open) {
      setTab("overview");
      setOpenFlowSections([]);
    }
  }, [props.open]);

  useEffect(() => {
    if (props.open) {
      setTab("overview");
      setOpenFlowSections([]);
    }
  }, [props.detail?.vendor.vendorId, props.open]);

  const detail = props.detail;
  const mappedBranch = detail?.mappedBranch;
  const summary = detail?.summary;
  const flowSections = useMemo(
    () =>
      detail
        ? [
            {
              key: "onHoldOrders" as const,
              title: "On Hold",
              count: detail.summary.onHoldOrders,
              items: detail.onHoldOrders,
              emptyText: "No on-hold orders in the current Cairo day.",
              tone: "warning" as const,
              timeDisplayMode: "duration" as const,
            },
            {
              key: "unassignedOrders" as const,
              title: "Unassigned",
              count: detail.summary.unassignedOrders,
              items: detail.unassignedOrders,
              emptyText: "No unassigned orders in the current Cairo day.",
              tone: "warning" as const,
              timeDisplayMode: "duration" as const,
            },
            {
              key: "inPrepOrders" as const,
              title: "In Prep",
              count: detail.summary.inPrepOrders,
              items: detail.inPrepOrders,
              emptyText: "No in-prep orders in the current Cairo day.",
              tone: "info" as const,
              timeDisplayMode: "duration" as const,
            },
            {
              key: "readyToPickupOrders" as const,
              title: "Ready to Pickup",
              count: detail.summary.readyToPickupOrders,
              items: detail.readyToPickupOrders,
              emptyText: "No ready-to-pickup orders in the current Cairo day.",
              tone: "info" as const,
              timeDisplayMode: "none" as const,
            },
          ]
        : [],
    [detail],
  );

  function toggleFlowSection(section: FlowSectionKey) {
    setOpenFlowSections((current) =>
      current.includes(section)
        ? current.filter((item) => item !== section)
        : [...current, section],
    );
  }

  return (
    <Dialog
      open={props.open}
      onClose={props.onClose}
      fullWidth
      fullScreen={fullScreen}
      maxWidth="lg"
      PaperProps={{
        sx: {
          borderRadius: { xs: 0, sm: 3 },
          overflow: "hidden",
          minHeight: { xs: "100%", sm: 620 },
        },
      }}
    >
      {(props.loading || props.refreshing) ? <LinearProgress /> : null}

      <DialogTitle sx={{ px: { xs: 1.35, sm: 2 }, py: { xs: 1.1, sm: 1.45 } }}>
        <Stack direction="row" alignItems="flex-start" justifyContent="space-between" spacing={1.2}>
          <Box sx={{ minWidth: 0 }}>
            <Typography sx={{ fontSize: { xs: 22, sm: 28 }, lineHeight: 1.08, fontWeight: 900, color: "#0f172a" }}>
              {resolveDialogTitle(props.subject, detail)}
            </Typography>
            <Typography variant="body2" sx={{ mt: 0.35, color: "#64748b" }}>
              {resolveDialogSubtitle(props.subject, detail)}
            </Typography>
            {mappedBranch ? (
              <Typography variant="body2" sx={{ mt: 0.2, color: "#475569", fontWeight: 700 }}>
                Mapped branch: {mappedBranch.name}
              </Typography>
            ) : null}
          </Box>

          <Stack direction="row" spacing={0.4}>
            <IconButton onClick={props.onRefresh} disabled={props.loading || props.refreshing} aria-label="Refresh detail">
              <RefreshRoundedIcon />
            </IconButton>
            <IconButton onClick={props.onClose} aria-label="Close detail">
              <CloseRoundedIcon />
            </IconButton>
          </Stack>
        </Stack>
      </DialogTitle>

      <DialogContent
        sx={{
          px: { xs: 1.2, sm: 2 },
          pb: { xs: 1.5, sm: 2 },
          display: "flex",
          flexDirection: "column",
          minHeight: 0,
        }}
      >
        {props.loading && !detail ? (
          <LoadingBody />
        ) : props.error && !detail ? (
          <Alert severity="error" variant="outlined">{props.error}</Alert>
        ) : detail && summary ? (
          <Stack spacing={1.2} sx={{ minHeight: 0 }}>
            <Tabs
              value={tab}
              onChange={(_event, value: DetailTab) => setTab(value)}
              variant="scrollable"
              allowScrollButtonsMobile
              sx={{
                minHeight: 42,
                "& .MuiTab-root": {
                  minHeight: 42,
                  textTransform: "none",
                  fontWeight: 800,
                },
              }}
            >
              <Tab value="overview" label="Overview" />
              <Tab value="cancellations" label="Cancellations" />
              <Tab value="pickers" label="Pickers" />
            </Tabs>

            {tab === "overview" ? (
              <Stack spacing={1.15}>
                {detail.ownerCoverage.warning ? (
                  <Alert severity="warning" variant="outlined">
                    {detail.ownerCoverage.warning}
                  </Alert>
                ) : null}

                <Box
                  sx={{
                    display: "grid",
                    gap: 0.95,
                    gridTemplateColumns: {
                      xs: "1fr",
                      lg: "minmax(240px, 0.92fr) minmax(420px, 1.4fr)",
                    },
                  }}
                >
                  <OverviewSection
                    title="Summary"
                    accentColor="#0369a1"
                    background="linear-gradient(180deg, rgba(239,246,255,0.88) 0%, rgba(255,255,255,0.96) 100%)"
                    gridTemplateColumns={{
                      xs: "repeat(2, minmax(0, 1fr))",
                    }}
                  >
                    <DetailMetricTile label="Total Orders" value={metric(summary.totalOrders)} />
                    <DetailMetricTile label="Total Cancels" value={metric(summary.totalCancelledOrders)} tone="warning" />
                  </OverviewSection>

                  <OverviewSection
                    title="Cancellation"
                    accentColor="#b91c1c"
                    background="linear-gradient(180deg, rgba(254,242,242,0.85) 0%, rgba(255,255,255,0.96) 100%)"
                    gridTemplateColumns={{
                      xs: "repeat(2, minmax(0, 1fr))",
                      md: "repeat(4, minmax(0, 1fr))",
                    }}
                  >
                    <DetailMetricTile label="Total Cancels" value={metric(summary.totalCancelledOrders)} tone="warning" />
                    <DetailMetricTile
                      label="VFR"
                      value={metric(summary.vendorOwnerCancelledCount)}
                      secondaryValue={formatPercent(summary.vfr)}
                      tone="danger"
                    />
                    <DetailMetricTile
                      label="LFR"
                      value={summary.lfrApplicable ? metric(summary.transportOwnerCancelledCount) : "TMP"}
                      secondaryValue={summary.lfrApplicable ? formatPercent(summary.lfr) : undefined}
                      tone={summary.lfrApplicable ? "danger" : "default"}
                    />
                    <DetailMetricTile
                      label="V+L FR"
                      value={metric(summary.vendorOwnerCancelledCount + summary.transportOwnerCancelledCount)}
                      secondaryValue={formatPercent(summary.vlfr)}
                      tone="danger"
                    />
                  </OverviewSection>
                </Box>

                <Stack spacing={1.05}>
                  <Stack direction="row" spacing={0.8} alignItems="center">
                    <Typography
                      sx={{
                        fontSize: 11.5,
                        fontWeight: 900,
                        letterSpacing: 0.24,
                        textTransform: "uppercase",
                        color: "#075985",
                        whiteSpace: "nowrap",
                      }}
                    >
                      Flow
                    </Typography>
                    <Box sx={{ flex: 1, height: 1, bgcolor: "rgba(148,163,184,0.18)" }} />
                  </Stack>

                  <Box
                    sx={{
                      display: "grid",
                      gap: 1,
                      gridTemplateColumns: {
                        xs: "1fr",
                        lg: "repeat(2, minmax(0, 1fr))",
                      },
                      alignItems: "start",
                    }}
                  >
                    {flowSections.map((section) => (
                      <FlowOrdersSection
                        key={section.key}
                        title={section.title}
                        count={section.count}
                        items={section.items}
                        open={openFlowSections.includes(section.key)}
                        onToggle={() => toggleFlowSection(section.key)}
                        emptyText={section.emptyText}
                        tone={section.tone}
                        timeDisplayMode={section.timeDisplayMode}
                      />
                    ))}
                  </Box>
                </Stack>
              </Stack>
            ) : null}

            {tab === "cancellations" ? (
              detail.cancelledOrders.length ? (
                <CancellationsTab orders={detail.cancelledOrders} />
              ) : (
                <Alert severity="info" variant="outlined">
                  No cancelled orders were found for this branch in the current Cairo day.
                </Alert>
              )
            ) : null}

            {tab === "pickers" ? (
              <BranchPickersPanel
                pickers={detail.pickers}
                recentActiveAvailable
                loading={props.loading || props.refreshing}
                emptyText="No picker activity was found for this branch in the current Cairo day."
              />
            ) : null}

            {props.error && detail ? (
              <Alert severity="error" variant="outlined">
                {props.error}
              </Alert>
            ) : null}
          </Stack>
        ) : (
          <Typography sx={{ color: "#64748b" }}>
            Select a branch to inspect its full daily performance details.
          </Typography>
        )}
      </DialogContent>
    </Dialog>
  );
}
