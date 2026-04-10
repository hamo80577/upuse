import AccessTimeRoundedIcon from "@mui/icons-material/AccessTimeRounded";
import CloseRoundedIcon from "@mui/icons-material/CloseRounded";
import EditRoundedIcon from "@mui/icons-material/EditRounded";
import InsightsRoundedIcon from "@mui/icons-material/InsightsRounded";
import KeyboardArrowRightRoundedIcon from "@mui/icons-material/KeyboardArrowRightRounded";
import LocalShippingRoundedIcon from "@mui/icons-material/LocalShippingRounded";
import SearchRoundedIcon from "@mui/icons-material/SearchRounded";
import ShoppingBagRoundedIcon from "@mui/icons-material/ShoppingBagRounded";
import StorefrontRoundedIcon from "@mui/icons-material/StorefrontRounded";
import TrendingUpRoundedIcon from "@mui/icons-material/TrendingUpRounded";
import WarningAmberRoundedIcon from "@mui/icons-material/WarningAmberRounded";
import Autocomplete, { createFilterOptions } from "@mui/material/Autocomplete";
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  FormControlLabel,
  IconButton,
  InputAdornment,
  Popper,
  Popover,
  Radio,
  RadioGroup,
  Skeleton,
  Slider,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import type { EChartsOption } from "echarts";
import { LineChart } from "echarts/charts";
import { AxisPointerComponent, GridComponent, LegendComponent, MarkLineComponent, TooltipComponent } from "echarts/components";
import * as echarts from "echarts/core";
import { CanvasRenderer } from "echarts/renderers";
import ReactEChartsCore from "echarts-for-react/lib/core";
import { useEffect, useMemo, useRef, useState } from "react";
import { useReducedMotion } from "motion/react";
import type {
  PerformanceTrendBucket,
  PerformanceTrendResolutionMinutes,
  PerformanceTrendResponse,
} from "../../../api/types";
import { fmtCairoDateTime } from "../../../shared/lib/time/cairo";

echarts.use([
  LineChart,
  GridComponent,
  LegendComponent,
  TooltipComponent,
  AxisPointerComponent,
  MarkLineComponent,
  CanvasRenderer,
]);

const metric = (value: number) => value.toLocaleString("en-US");
const percent = (value: number) => `${value.toFixed(value >= 10 ? 1 : 2)}%`;

type TimeOption = {
  minute: number;
  label: string;
  compactLabel: string;
  searchLabel: string;
};

function minuteToTwentyFourClock(minute: number) {
  const normalizedMinute = Math.max(0, Math.min(1_440, minute));
  const hours = Math.floor(normalizedMinute / 60);
  const minutes = normalizedMinute % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function minuteToMeridiemLabel(minute: number) {
  if (minute === 1_440) {
    return "12:00 AM (next day)";
  }
  const normalizedMinute = Math.max(0, Math.min(1_425, minute));
  const hours = Math.floor(normalizedMinute / 60);
  const minutes = normalizedMinute % 60;
  const meridiem = hours >= 12 ? "PM" : "AM";
  const displayHour = hours % 12 || 12;
  return `${displayHour}:${String(minutes).padStart(2, "0")} ${meridiem}`;
}

function minuteToCompactMeridiemLabel(minute: number) {
  if (minute === 1_440) {
    return "12 AM+";
  }
  const normalizedMinute = Math.max(0, Math.min(1_425, minute));
  const hours = Math.floor(normalizedMinute / 60);
  const meridiem = hours >= 12 ? "PM" : "AM";
  const displayHour = hours % 12 || 12;
  return `${displayHour} ${meridiem}`;
}

function buildTimeOption(minute: number): TimeOption {
  const label = minuteToMeridiemLabel(minute);
  return {
    minute,
    label,
    compactLabel: minuteToCompactMeridiemLabel(minute),
    searchLabel: [
      label,
      minuteToTwentyFourClock(minute),
      minute === 0 ? "start of day midnight 12am" : "",
      minute === 1_440 ? "end of day next day midnight 12am 24:00" : "",
    ]
      .join(" ")
      .toLowerCase(),
  };
}

function minuteToMenuLabel(minute: number) {
  return minuteToMeridiemLabel(minute).replace(" (next day)", "+");
}

function formatRangeMenuSummary(startMinute: number, endMinute: number) {
  return `${minuteToMenuLabel(startMinute)} - ${minuteToMenuLabel(endMinute)}`;
}

function normalizeTrendRange(startMinute: number, endMinute: number) {
  let nextStart = Math.max(0, Math.min(1_425, Math.round(startMinute / 15) * 15));
  let nextEnd = Math.max(15, Math.min(1_440, Math.round(endMinute / 15) * 15));

  if (nextStart >= nextEnd) {
    if (nextEnd >= 1_440) {
      nextStart = 1_425;
      nextEnd = 1_440;
    } else {
      nextEnd = Math.min(1_440, nextStart + 15);
      if (nextStart >= nextEnd) {
        nextStart = Math.max(0, nextEnd - 15);
      }
    }
  }

  return [nextStart, nextEnd] as [number, number];
}

function findTimeOption(options: TimeOption[], minute: number) {
  return options.find((option) => option.minute === minute) ?? options[0]!;
}

const RESOLUTION_OPTIONS: Array<{ value: PerformanceTrendResolutionMinutes; label: string }> = [
  { value: 60, label: "60 minutes" },
  { value: 30, label: "30 minutes" },
  { value: 15, label: "15 minutes" },
];

const FROM_TIME_OPTIONS = Array.from({ length: 96 }, (_, index) => buildTimeOption(index * 15));
const TO_TIME_OPTIONS = Array.from({ length: 96 }, (_, index) => buildTimeOption((index + 1) * 15));
const TIME_OPTION_FILTER = createFilterOptions<TimeOption>({
  stringify: (option) => option.searchLabel,
  trim: true,
});
const SLIDER_MARKS = [0, 720, 1_440].map((value) => ({
  value,
  label: minuteToCompactMeridiemLabel(value),
}));

type TrendSnapshot = {
  mode: "range" | "bucket";
  heading: string;
  subheading: string;
  ordersCount: number;
  vendorCancelledCount: number;
  transportCancelledCount: number;
  vfr: number;
  lfr: number;
  vlfr: number;
};

function resolveTrendBucketIndex(event: unknown, buckets: PerformanceTrendBucket[]) {
  const candidate = event as {
    dataIndex?: number;
    name?: string;
    axesInfo?: Array<{ value?: number | string }>;
  } | null | undefined;

  if (typeof candidate?.dataIndex === "number" && Number.isInteger(candidate.dataIndex) && candidate.dataIndex >= 0 && candidate.dataIndex < buckets.length) {
    return candidate.dataIndex;
  }

  if (typeof candidate?.name === "string") {
    const bucketIndex = buckets.findIndex((bucket) => bucket.label === candidate.name);
    if (bucketIndex >= 0) {
      return bucketIndex;
    }
  }

  const axisValue = candidate?.axesInfo?.[0]?.value;
  if (typeof axisValue === "number" && Number.isInteger(axisValue) && axisValue >= 0 && axisValue < buckets.length) {
    return axisValue;
  }
  if (typeof axisValue === "string") {
    const bucketIndex = buckets.findIndex((bucket) => bucket.label === axisValue);
    return bucketIndex >= 0 ? bucketIndex : null;
  }

  return null;
}

function buildRangeSnapshot(trend: PerformanceTrendResponse): TrendSnapshot | null {
  if (!trend.buckets.length) return null;

  const totals = trend.buckets.reduce(
    (current, bucket) => {
      current.ordersCount += bucket.ordersCount;
      current.vendorCancelledCount += bucket.vendorCancelledCount;
      current.transportCancelledCount += bucket.transportCancelledCount;
      return current;
    },
    {
      ordersCount: 0,
      vendorCancelledCount: 0,
      transportCancelledCount: 0,
    },
  );

  const totalOrders = totals.ordersCount || 0;
  const vfr = totalOrders ? (totals.vendorCancelledCount / totalOrders) * 100 : 0;
  const lfr = totalOrders ? (totals.transportCancelledCount / totalOrders) * 100 : 0;

  return {
    mode: "range",
    heading: "All Candles",
    subheading: "",
    ordersCount: totals.ordersCount,
    vendorCancelledCount: totals.vendorCancelledCount,
    transportCancelledCount: totals.transportCancelledCount,
    vfr,
    lfr,
    vlfr: vfr + lfr,
  };
}

function buildBucketSnapshot(bucket: PerformanceTrendBucket): TrendSnapshot {
  return {
    mode: "bucket",
    heading: "Selected Candle",
    subheading:
      `${fmtCairoDateTime(bucket.bucketStartUtcIso, { hour: "2-digit", minute: "2-digit" })} to ${fmtCairoDateTime(bucket.bucketEndUtcIso, { hour: "2-digit", minute: "2-digit" })}`,
    ordersCount: bucket.ordersCount,
    vendorCancelledCount: bucket.vendorCancelledCount,
    transportCancelledCount: bucket.transportCancelledCount,
    vfr: bucket.vfr,
    lfr: bucket.lfr,
    vlfr: bucket.vlfr,
  };
}

function resolveSmartCountAxisMax(maxValue: number) {
  if (maxValue <= 1) return 3;
  if (maxValue <= 3) return 5;
  if (maxValue <= 5) return 8;
  if (maxValue <= 10) return 12;
  return Math.ceil(maxValue * 1.2);
}

function resolveSmartPercentAxisMax(maxValue: number) {
  if (maxValue <= 0) return 5;
  if (maxValue <= 2) return 4;
  if (maxValue <= 5) return 8;
  if (maxValue <= 10) return 12;
  return Math.ceil(maxValue * 1.15);
}

function buildChartOption(
  trend: PerformanceTrendResponse,
  prefersReducedMotion: boolean,
  selectedBucketStartUtcIso: string | null,
): EChartsOption {
  const selectedLabel = selectedBucketStartUtcIso != null
    ? trend.buckets.find((bucket) => bucket.bucketStartUtcIso === selectedBucketStartUtcIso)?.label ?? null
    : null;
  const maxVfrCount = trend.buckets.reduce((maxValue, bucket) => Math.max(maxValue, bucket.vendorCancelledCount), 0);
  const maxVfrRate = trend.buckets.reduce((maxValue, bucket) => Math.max(maxValue, bucket.vfr), 0);

  return {
    animation: !prefersReducedMotion,
    animationDuration: prefersReducedMotion ? 0 : 700,
    animationDurationUpdate: prefersReducedMotion ? 0 : 450,
    animationEasing: "quarticOut",
    animationEasingUpdate: "cubicOut",
    grid: {
      left: 14,
      right: 86,
      top: 48,
      bottom: 24,
      containLabel: true,
    },
    legend: {
      top: 4,
      left: 18,
      icon: "roundRect",
      itemWidth: 18,
      itemHeight: 10,
      itemGap: 14,
      textStyle: {
        color: "#334155",
        fontSize: 11,
        fontWeight: 700,
      },
      data: ["Orders", "VFR", "VFR %"],
    },
    tooltip: {
      trigger: "axis",
      axisPointer: {
        type: "cross",
        snap: true,
        crossStyle: {
          color: "rgba(51,65,85,0.32)",
        },
        label: {
          backgroundColor: "#0f172a",
          borderRadius: 10,
        },
      },
      backgroundColor: "rgba(15,23,42,0.94)",
      borderWidth: 0,
      padding: 12,
      textStyle: {
        color: "#f8fafc",
      },
      extraCssText: "border-radius: 16px; box-shadow: 0 18px 40px rgba(15,23,42,0.28);",
      formatter: (params) => {
        const points = Array.isArray(params) ? params : [params];
        const dataIndex = Number(points[0]?.dataIndex ?? 0);
        const bucket = trend.buckets[dataIndex];
        if (!bucket) return "";
        return [
          `<div style="font-weight:800; margin-bottom:6px;">${bucket.label}</div>`,
          `<div>Orders: <strong>${metric(bucket.ordersCount)}</strong></div>`,
          `<div>Vendor Cancels: <strong>${metric(bucket.vendorCancelledCount)}</strong></div>`,
          `<div>Transport Cancels: <strong>${metric(bucket.transportCancelledCount)}</strong></div>`,
          `<div>VFR %: <strong>${percent(bucket.vfr)}</strong></div>`,
          `<div>LFR: <strong>${percent(bucket.lfr)}</strong></div>`,
          `<div>V+L FR: <strong>${percent(bucket.vlfr)}</strong></div>`,
        ].join("");
      },
    },
    xAxis: {
      type: "category",
      boundaryGap: false,
      data: trend.buckets.map((bucket) => bucket.label),
      axisLine: {
        lineStyle: {
          color: "rgba(148,163,184,0.28)",
        },
      },
      axisTick: {
        show: false,
      },
      axisLabel: {
        color: "#64748b",
        formatter: (value: string) => (value === selectedLabel ? `{selected|${value}}` : value),
        fontSize: 11,
        margin: 12,
        rich: {
          selected: {
            color: "#0f172a",
            fontWeight: 900,
          },
        },
      },
      splitLine: {
        show: false,
      },
    },
    yAxis: [
      {
        type: "value",
        splitNumber: 4,
        axisLine: {
          show: false,
        },
        axisTick: {
          show: false,
        },
        axisLabel: {
          color: "#64748b",
          fontWeight: 700,
        },
        splitLine: {
          lineStyle: {
            color: "rgba(148,163,184,0.14)",
          },
        },
      },
      {
        type: "value",
        min: 0,
        max: resolveSmartCountAxisMax(maxVfrCount),
        minInterval: 1,
        splitNumber: 4,
        axisLine: {
          show: false,
        },
        axisTick: {
          show: false,
        },
        axisLabel: {
          color: "#f59e0b",
          fontWeight: 700,
        },
        splitLine: {
          show: false,
        },
      },
      {
        type: "value",
        min: 0,
        max: resolveSmartPercentAxisMax(maxVfrRate),
        splitNumber: 4,
        position: "right",
        offset: 44,
        axisLine: {
          show: false,
        },
        axisTick: {
          show: false,
        },
        axisLabel: {
          color: "#92400e",
          fontWeight: 800,
          formatter: (value: number) => `${value}%`,
        },
        splitLine: {
          show: false,
        },
      },
    ],
    series: [
      {
        name: "Orders",
        type: "line",
        smooth: true,
        showSymbol: false,
        symbolSize: 9,
        yAxisIndex: 0,
        data: trend.buckets.map((bucket) => bucket.ordersCount),
        lineStyle: {
          width: 3,
          color: "#0f766e",
          shadowBlur: 16,
          shadowColor: "rgba(15,118,110,0.18)",
        },
        itemStyle: {
          color: "#0f766e",
        },
        areaStyle: {
          color: {
            type: "linear",
            x: 0,
            y: 0,
            x2: 0,
            y2: 1,
            colorStops: [
              { offset: 0, color: "rgba(13,148,136,0.28)" },
              { offset: 1, color: "rgba(13,148,136,0.02)" },
            ],
          },
        },
        emphasis: {
          focus: "series",
        },
        markLine: selectedLabel
          ? {
              silent: true,
              animation: false,
              symbol: ["none", "none"],
              label: { show: false },
              lineStyle: {
                color: "rgba(15,23,42,0.26)",
                width: 1.5,
                type: "dashed",
              },
              data: [{ xAxis: selectedLabel }],
            }
          : undefined,
      },
      {
        name: "VFR",
        type: "line",
        smooth: true,
        showSymbol: false,
        symbolSize: 8,
        yAxisIndex: 1,
        data: trend.buckets.map((bucket) => bucket.vendorCancelledCount),
        lineStyle: {
          width: 3.2,
          color: "#f59e0b",
          shadowBlur: 18,
          shadowColor: "rgba(245,158,11,0.18)",
        },
        itemStyle: {
          color: "#f59e0b",
        },
        emphasis: {
          focus: "series",
        },
      },
      {
        name: "VFR %",
        type: "line",
        smooth: true,
        showSymbol: false,
        symbolSize: 7,
        yAxisIndex: 2,
        data: trend.buckets.map((bucket) => Number(bucket.vfr.toFixed(2))),
        lineStyle: {
          width: 2.5,
          type: "dashed",
          color: "#92400e",
          shadowBlur: 14,
          shadowColor: "rgba(146,64,14,0.12)",
        },
        itemStyle: {
          color: "#92400e",
        },
        emphasis: {
          focus: "series",
        },
      },
    ],
  };
}

export function PerformanceTrendPanel(props: {
  trend: PerformanceTrendResponse | null;
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  resolutionMinutes: PerformanceTrendResolutionMinutes;
  startMinute: number;
  endMinute: number;
  onResolutionChange: (value: PerformanceTrendResolutionMinutes) => void;
  onRangeChange: (startMinute: number, endMinute: number) => void;
  onInteract: () => void;
}) {
  const prefersReducedMotion = useReducedMotion();
  const editButtonRef = useRef<HTMLButtonElement | null>(null);
  const candlesButtonRef = useRef<HTMLButtonElement | null>(null);
  const rangeButtonRef = useRef<HTMLButtonElement | null>(null);
  const [menuAnchorEl, setMenuAnchorEl] = useState<HTMLElement | null>(null);
  const [activeSubmenu, setActiveSubmenu] = useState<"candles" | "range" | null>(null);
  const [selectedBucketStartUtcIso, setSelectedBucketStartUtcIso] = useState<string | null>(null);
  const [draftRange, setDraftRange] = useState<[number, number]>(() => normalizeTrendRange(props.startMinute, props.endMinute));
  const [fromSearchValue, setFromSearchValue] = useState("");
  const [toSearchValue, setToSearchValue] = useState("");

  const hasOrders = (props.trend?.buckets ?? []).some((bucket) => bucket.ordersCount > 0);
  const visibleRangeSnapshot = useMemo(
    () => (props.trend ? buildRangeSnapshot(props.trend) : null),
    [props.trend],
  );
  const selectedBucket = selectedBucketStartUtcIso != null
    ? props.trend?.buckets.find((bucket) => bucket.bucketStartUtcIso === selectedBucketStartUtcIso) ?? null
    : null;
  const activeSnapshot = useMemo(
    () => (selectedBucket ? buildBucketSnapshot(selectedBucket) : visibleRangeSnapshot),
    [selectedBucket, visibleRangeSnapshot],
  );

  useEffect(() => {
    if (!selectedBucketStartUtcIso) return;
    if (props.trend?.buckets.some((bucket) => bucket.bucketStartUtcIso === selectedBucketStartUtcIso)) {
      return;
    }
    setSelectedBucketStartUtcIso(null);
  }, [props.trend, selectedBucketStartUtcIso]);

  useEffect(() => {
    setDraftRange(normalizeTrendRange(props.startMinute, props.endMinute));
  }, [props.endMinute, props.startMinute]);

  const chartOption = useMemo(
    () => (props.trend ? buildChartOption(props.trend, Boolean(prefersReducedMotion), selectedBucketStartUtcIso) : undefined),
    [prefersReducedMotion, props.trend, selectedBucketStartUtcIso],
  );

  const chartEvents = useMemo(
    () => ({
      click: (event: unknown) => {
        if (!props.trend) return;
        const nextBucketIndex = resolveTrendBucketIndex(event, props.trend.buckets);
        if (nextBucketIndex == null) return;
        const nextBucket = props.trend.buckets[nextBucketIndex];
        if (!nextBucket) return;
        setSelectedBucketStartUtcIso((current) => (current === nextBucket.bucketStartUtcIso ? null : nextBucket.bucketStartUtcIso));
        props.onInteract();
      },
      globalout: () => {},
    }),
    [props.onInteract, props.trend],
  );

  const selectedFromOption = useMemo(
    () => findTimeOption(FROM_TIME_OPTIONS, draftRange[0]),
    [draftRange],
  );
  const selectedToOption = useMemo(
    () => findTimeOption(TO_TIME_OPTIONS, draftRange[1]),
    [draftRange],
  );
  const menuOpen = Boolean(menuAnchorEl);
  const candlesMenuOpen = menuOpen && activeSubmenu === "candles";
  const rangeMenuOpen = menuOpen && activeSubmenu === "range";
  const submenuPopperModifiers = useMemo(
    () => [
      {
        name: "offset",
        options: {
          offset: [0, 8],
        },
      },
      {
        name: "flip",
        options: {
          fallbackPlacements: ["bottom-start", "top-start"],
        },
      },
      {
        name: "preventOverflow",
        options: {
          altAxis: true,
          padding: 12,
          rootBoundary: "viewport",
          tether: true,
        },
      },
    ],
    [],
  );

  function commitRange(startMinute: number, endMinute: number) {
    const [nextStartMinute, nextEndMinute] = normalizeTrendRange(startMinute, endMinute);
    setDraftRange([nextStartMinute, nextEndMinute]);
    props.onInteract();
    props.onRangeChange(nextStartMinute, nextEndMinute);
  }

  function filterTimeOptions(options: TimeOption[], inputValue: string) {
    if (!inputValue.trim()) {
      return [];
    }
    return TIME_OPTION_FILTER(options, { inputValue, getOptionLabel: (option) => option.label });
  }

  function closeSubmenu() {
    setActiveSubmenu(null);
    setFromSearchValue("");
    setToSearchValue("");
  }

  function closeAllMenus() {
    setMenuAnchorEl(null);
    closeSubmenu();
  }

  function toggleSubmenu(nextSubmenu: "candles" | "range") {
    props.onInteract();
    if (activeSubmenu === nextSubmenu) {
      closeSubmenu();
      return;
    }
    setActiveSubmenu(nextSubmenu);
    setFromSearchValue("");
    setToSearchValue("");
  }

  return (
    <Box
      sx={{
        minHeight: { xs: 336, md: 352 },
        display: "flex",
        flexDirection: "column",
      }}
    >
      <Stack direction="row" justifyContent="flex-end" sx={{ mb: 0.65 }}>
        <IconButton
          ref={editButtonRef}
          size="small"
          aria-label={menuOpen ? "Close trend edit menu" : "Open trend edit menu"}
          aria-expanded={menuOpen}
          onClick={(event) => {
            props.onInteract();
            if (menuOpen) {
              closeAllMenus();
              return;
            }
            setMenuAnchorEl(event.currentTarget);
            closeSubmenu();
          }}
          onFocus={props.onInteract}
          sx={{
            width: 34,
            height: 34,
            borderRadius: 2.6,
            border: "1px solid rgba(148,163,184,0.16)",
            bgcolor: menuOpen ? "rgba(14,165,233,0.1)" : "rgba(248,250,252,0.92)",
            color: menuOpen ? "#0369a1" : "#475569",
            boxShadow: "0 6px 18px rgba(15,23,42,0.04)",
          }}
        >
          <EditRoundedIcon sx={{ fontSize: 18 }} />
        </IconButton>
      </Stack>

      <Popover
        open={menuOpen}
        anchorEl={menuAnchorEl}
        onClose={closeAllMenus}
        anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
        transformOrigin={{ vertical: "top", horizontal: "right" }}
        disableAutoFocus
        disableEnforceFocus
        disableRestoreFocus
        disableScrollLock
        marginThreshold={12}
        PaperProps={{
          sx: {
            mt: 0.55,
            width: 206,
            maxWidth: "calc(100vw - 24px)",
            overflow: "visible",
            position: "relative",
            borderRadius: 3,
            border: "1px solid rgba(148,163,184,0.12)",
            bgcolor: "rgba(255,255,255,0.98)",
            boxShadow: "0 22px 48px rgba(15,23,42,0.12)",
            backdropFilter: "blur(14px)",
          },
        }}
      >
        <Box sx={{ p: 0.45 }}>
          <Stack sx={{ width: 194, gap: 0.25 }}>
            <Box
              ref={candlesButtonRef}
              component="button"
              type="button"
              aria-label="Adjust trend candles"
              onClick={() => toggleSubmenu("candles")}
              sx={{
                appearance: "none",
                width: "100%",
                px: 0.75,
                py: 0.62,
                border: "none",
                borderRadius: 2.2,
                bgcolor: candlesMenuOpen ? "rgba(14,165,233,0.09)" : "transparent",
                cursor: "pointer",
                textAlign: "left",
                transition: "background-color 160ms ease",
                "&:hover": {
                  bgcolor: candlesMenuOpen ? "rgba(14,165,233,0.11)" : "rgba(248,250,252,0.92)",
                },
              }}
            >
              <Stack direction="row" spacing={0.8} alignItems="center" justifyContent="space-between">
                <Stack direction="row" spacing={0.75} alignItems="center" sx={{ minWidth: 0 }}>
                  <InsightsRoundedIcon sx={{ fontSize: 16, color: "#0284c7" }} />
                  <Box sx={{ minWidth: 0 }}>
                    <Typography sx={{ fontSize: 12, fontWeight: 900, color: "#0f172a", lineHeight: 1.15 }}>
                      Candles
                    </Typography>
                    <Typography sx={{ mt: 0.1, fontSize: 10.75, fontWeight: 700, color: "#64748b", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {props.resolutionMinutes}m
                    </Typography>
                  </Box>
                </Stack>
                <KeyboardArrowRightRoundedIcon sx={{ fontSize: 18, color: candlesMenuOpen ? "#0284c7" : "#94a3b8" }} />
              </Stack>
            </Box>

            <Box
              ref={rangeButtonRef}
              component="button"
              type="button"
              aria-label="Adjust trend range"
              onClick={() => toggleSubmenu("range")}
              sx={{
                appearance: "none",
                width: "100%",
                px: 0.75,
                py: 0.62,
                border: "none",
                borderRadius: 2.2,
                bgcolor: rangeMenuOpen ? "rgba(14,165,233,0.09)" : "transparent",
                cursor: "pointer",
                textAlign: "left",
                transition: "background-color 160ms ease",
                "&:hover": {
                  bgcolor: rangeMenuOpen ? "rgba(14,165,233,0.11)" : "rgba(248,250,252,0.92)",
                },
              }}
            >
              <Stack direction="row" spacing={0.8} alignItems="center" justifyContent="space-between">
                <Stack direction="row" spacing={0.75} alignItems="center" sx={{ minWidth: 0 }}>
                  <AccessTimeRoundedIcon sx={{ fontSize: 16, color: "#0284c7" }} />
                  <Box sx={{ minWidth: 0 }}>
                    <Typography sx={{ fontSize: 12, fontWeight: 900, color: "#0f172a", lineHeight: 1.15 }}>
                      Range
                    </Typography>
                    <Typography sx={{ mt: 0.1, fontSize: 10.75, fontWeight: 700, color: "#64748b", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {formatRangeMenuSummary(draftRange[0], draftRange[1])}
                    </Typography>
                  </Box>
                </Stack>
                <KeyboardArrowRightRoundedIcon sx={{ fontSize: 18, color: rangeMenuOpen ? "#0284c7" : "#94a3b8" }} />
              </Stack>
            </Box>
          </Stack>
        </Box>

        <Popper
          open={candlesMenuOpen}
          anchorEl={candlesButtonRef.current}
          placement="left-start"
          disablePortal
          data-testid="trend-candles-submenu"
          modifiers={submenuPopperModifiers}
          sx={{ zIndex: 1 }}
        >
          <Box
            sx={{
              width: 160,
              borderRadius: 2.8,
              border: "1px solid rgba(148,163,184,0.12)",
              bgcolor: "rgba(255,255,255,0.98)",
              boxShadow: "0 22px 48px rgba(15,23,42,0.12)",
            }}
          >
            <Box sx={{ p: 0.55 }}>
              <Typography sx={{ px: 0.25, pb: 0.35, fontSize: 10.5, fontWeight: 900, color: "#64748b", letterSpacing: "0.06em", textTransform: "uppercase" }}>
                Candles
              </Typography>
              <RadioGroup
                aria-label="Trend resolution"
                value={String(props.resolutionMinutes)}
                onChange={(event) => {
                  props.onInteract();
                  props.onResolutionChange(Number(event.target.value) as PerformanceTrendResolutionMinutes);
                }}
                sx={{ gap: 0.15 }}
              >
                {RESOLUTION_OPTIONS.map((option) => {
                  const active = props.resolutionMinutes === option.value;
                  return (
                    <Box
                      key={option.value}
                      sx={{
                        borderRadius: 2,
                        bgcolor: active ? "rgba(14,165,233,0.08)" : "transparent",
                      }}
                    >
                      <FormControlLabel
                        value={String(option.value)}
                        sx={{
                          m: 0,
                          width: "100%",
                          px: 0.25,
                          py: 0.08,
                          "& .MuiFormControlLabel-label": { flex: 1 },
                        }}
                        control={
                          <Radio
                            size="small"
                            sx={{
                              p: 0.48,
                              color: active ? "#0284c7" : "#94a3b8",
                            }}
                          />
                        }
                        label={
                          <Stack direction="row" spacing={0.55} alignItems="center">
                            <AccessTimeRoundedIcon sx={{ fontSize: 14, color: active ? "#0284c7" : "#94a3b8" }} />
                            <Typography sx={{ fontSize: 12, fontWeight: 900, color: "#0f172a" }}>
                              {option.value}m
                            </Typography>
                          </Stack>
                        }
                      />
                    </Box>
                  );
                })}
              </RadioGroup>
            </Box>
          </Box>
        </Popper>

        <Popper
          open={rangeMenuOpen}
          anchorEl={rangeButtonRef.current}
          placement="left-start"
          disablePortal
          data-testid="trend-range-submenu"
          modifiers={submenuPopperModifiers}
          sx={{ zIndex: 1 }}
        >
          <Box
            sx={{
              width: 272,
              borderRadius: 2.8,
              border: "1px solid rgba(148,163,184,0.12)",
              bgcolor: "rgba(255,255,255,0.98)",
              boxShadow: "0 22px 48px rgba(15,23,42,0.12)",
            }}
          >
            <Box sx={{ p: 0.7 }}>
              <Typography sx={{ fontSize: 10.5, fontWeight: 900, color: "#64748b", letterSpacing: "0.06em", textTransform: "uppercase" }}>
                Range
              </Typography>
              <Typography sx={{ mt: 0.2, fontSize: 11, fontWeight: 800, color: "#475569" }}>
                {formatRangeMenuSummary(draftRange[0], draftRange[1])}
              </Typography>

              <Stack spacing={0.55} sx={{ mt: 0.75 }}>
                <Autocomplete
                  disablePortal
                  size="small"
                  open={Boolean(fromSearchValue.trim())}
                  value={null}
                  inputValue={fromSearchValue}
                  options={FROM_TIME_OPTIONS}
                  getOptionLabel={(option) => option.label}
                  filterOptions={(options, state) => filterTimeOptions(options, state.inputValue)}
                  onInputChange={(_event, nextValue) => {
                    setFromSearchValue(nextValue);
                    props.onInteract();
                  }}
                  onChange={(_event, option) => {
                    if (!option) return;
                    const [nextStartMinute, nextEndMinute] = normalizeTrendRange(option.minute, draftRange[1]);
                    commitRange(nextStartMinute, nextEndMinute);
                    setFromSearchValue("");
                  }}
                  onFocus={props.onInteract}
                  noOptionsText="Type to search"
                  clearOnBlur={false}
                  forcePopupIcon={false}
                  renderOption={(optionProps, option) => (
                    <Box component="li" {...optionProps} key={option.minute} sx={{ fontSize: 12.5, fontWeight: 800 }}>
                      {option.label}
                    </Box>
                  )}
                  renderInput={(params) => (
                    <TextField
                      {...params}
                      label="From"
                      placeholder={selectedFromOption.label}
                      InputLabelProps={{ shrink: true }}
                      inputProps={{
                        ...params.inputProps,
                        "aria-label": "Trend from time",
                      }}
                      InputProps={{
                        ...params.InputProps,
                        startAdornment: (
                          <InputAdornment position="start">
                            <SearchRoundedIcon sx={{ fontSize: 15, color: "#64748b" }} />
                          </InputAdornment>
                        ),
                      }}
                    />
                  )}
                  sx={{ flex: 1 }}
                />
                <Autocomplete
                  disablePortal
                  size="small"
                  open={Boolean(toSearchValue.trim())}
                  value={null}
                  inputValue={toSearchValue}
                  options={TO_TIME_OPTIONS}
                  getOptionLabel={(option) => option.label}
                  filterOptions={(options, state) => filterTimeOptions(options, state.inputValue)}
                  onInputChange={(_event, nextValue) => {
                    setToSearchValue(nextValue);
                    props.onInteract();
                  }}
                  onChange={(_event, option) => {
                    if (!option) return;
                    const [nextStartMinute, nextEndMinute] = normalizeTrendRange(draftRange[0], option.minute);
                    commitRange(nextStartMinute, nextEndMinute);
                    setToSearchValue("");
                  }}
                  onFocus={props.onInteract}
                  noOptionsText="Type to search"
                  clearOnBlur={false}
                  forcePopupIcon={false}
                  renderOption={(optionProps, option) => (
                    <Box component="li" {...optionProps} key={option.minute} sx={{ fontSize: 12.5, fontWeight: 800 }}>
                      {option.label}
                    </Box>
                  )}
                  renderInput={(params) => (
                    <TextField
                      {...params}
                      label="To"
                      placeholder={selectedToOption.label}
                      InputLabelProps={{ shrink: true }}
                      inputProps={{
                        ...params.inputProps,
                        "aria-label": "Trend to time",
                      }}
                      InputProps={{
                        ...params.InputProps,
                        startAdornment: (
                          <InputAdornment position="start">
                            <SearchRoundedIcon sx={{ fontSize: 15, color: "#64748b" }} />
                          </InputAdornment>
                        ),
                      }}
                    />
                  )}
                  sx={{ flex: 1 }}
                />
              </Stack>

              <Box sx={{ px: 0.35, pt: 0.85 }}>
                <Slider
                  value={draftRange}
                  min={0}
                  max={1_440}
                  step={15}
                  disableSwap
                  marks={SLIDER_MARKS}
                  getAriaLabel={(index) => (index === 0 ? "Trend range start" : "Trend range end")}
                  onFocus={props.onInteract}
                  onChange={(_event, value) => {
                    if (!Array.isArray(value) || value.length !== 2) return;
                    const [nextStartMinute, nextEndMinute] = normalizeTrendRange(value[0] ?? draftRange[0], value[1] ?? draftRange[1]);
                    setDraftRange([nextStartMinute, nextEndMinute]);
                    props.onInteract();
                  }}
                  onChangeCommitted={(_event, value) => {
                    if (!Array.isArray(value) || value.length !== 2) return;
                    const [nextStartMinute, nextEndMinute] = normalizeTrendRange(value[0] ?? draftRange[0], value[1] ?? draftRange[1]);
                    commitRange(nextStartMinute, nextEndMinute);
                  }}
                  sx={{
                    color: "#0ea5e9",
                    "& .MuiSlider-rail": {
                      height: 3,
                      borderRadius: 999,
                      bgcolor: "rgba(148,163,184,0.18)",
                    },
                    "& .MuiSlider-track": {
                      height: 3,
                      border: "none",
                      borderRadius: 999,
                      background: "linear-gradient(90deg, #0ea5e9 0%, #38bdf8 100%)",
                    },
                    "& .MuiSlider-thumb": {
                      width: 10,
                      height: 10,
                      bgcolor: "#ffffff",
                      border: "2px solid #0ea5e9",
                      boxShadow: "0 0 0 4px rgba(14,165,233,0.12)",
                    },
                    "& .MuiSlider-mark": {
                      width: 4,
                      height: 4,
                      borderRadius: 999,
                      bgcolor: "rgba(148,163,184,0.32)",
                    },
                    "& .MuiSlider-markLabel": {
                      top: 22,
                      fontSize: 9,
                      fontWeight: 800,
                      color: "#94a3b8",
                    },
                  }}
                />
              </Box>
            </Box>
          </Box>
        </Popper>
      </Popover>

      <Box
        sx={{
          flex: 1,
          borderRadius: 3.2,
          border: "1px solid rgba(148,163,184,0.12)",
          bgcolor: "rgba(255,255,255,0.72)",
          boxShadow: "inset 0 1px 0 rgba(255,255,255,0.68)",
          px: { xs: 1, md: 1.2 },
          py: { xs: 1, md: 1.1 },
        }}
      >
        <Box sx={{ minHeight: 248, position: "relative" }}>
          {props.loading ? (
            <Stack spacing={1.1}>
              <Skeleton variant="rounded" height={206} animation="wave" />
              <Skeleton variant="rounded" height={84} animation="wave" />
            </Stack>
          ) : props.error ? (
            <Alert severity="warning" sx={{ borderRadius: 3 }}>
              {props.error}
            </Alert>
          ) : props.trend && chartOption ? (
            hasOrders ? (
              <>
                <ReactEChartsCore
                  echarts={echarts}
                  option={chartOption}
                  notMerge
                  lazyUpdate
                  style={{ height: 248, width: "100%", opacity: props.refreshing ? 0.92 : 1, transition: "opacity 180ms ease" }}
                  onEvents={chartEvents}
                  onMouseEnter={props.onInteract}
                />
                {props.refreshing ? (
                  <Stack
                    data-testid="trend-chart-refresh-indicator"
                    direction="row"
                    spacing={0.75}
                    alignItems="center"
                    sx={{
                      position: "absolute",
                      top: 10,
                      right: 12,
                      zIndex: 2,
                      px: 1,
                      py: 0.55,
                      borderRadius: 999,
                      border: "1px solid rgba(14,165,233,0.14)",
                      bgcolor: "rgba(255,255,255,0.84)",
                      boxShadow: "0 12px 28px rgba(15,23,42,0.08)",
                      backdropFilter: "blur(10px)",
                      pointerEvents: "none",
                    }}
                  >
                    <CircularProgress size={14} thickness={5} sx={{ color: "#0284c7" }} />
                    <Typography sx={{ fontSize: 11.5, fontWeight: 800, color: "#0369a1", lineHeight: 1 }}>
                      Updating trend...
                    </Typography>
                  </Stack>
                ) : null}
              </>
            ) : (
              <Box
                sx={{
                  height: 248,
                  borderRadius: 3,
                  border: "1px dashed rgba(148,163,184,0.2)",
                  display: "grid",
                  placeItems: "center",
                  bgcolor: "rgba(248,250,252,0.78)",
                  textAlign: "center",
                  px: 2,
                }}
              >
                <Box>
                  <Typography sx={{ fontSize: 16, fontWeight: 900, color: "#0f172a" }}>
                    No orders in this time window
                  </Typography>
                  <Typography sx={{ mt: 0.55, fontSize: 12.5, color: "#64748b", fontWeight: 700 }}>
                    Adjust the range or filters to inspect another slice of today.
                  </Typography>
                </Box>
              </Box>
            )
          ) : null}
        </Box>

        {activeSnapshot ? (
          <Box
            data-testid="trend-details-table"
            sx={{
              mt: 1.05,
              borderRadius: 3,
              border: "1px solid rgba(148,163,184,0.12)",
              bgcolor: "rgba(248,250,252,0.92)",
              overflow: "hidden",
            }}
          >
            {activeSnapshot.mode === "bucket" ? (
              <Stack
                direction={{ xs: "column", md: "row" }}
                spacing={1}
                alignItems={{ xs: "flex-start", md: "center" }}
                justifyContent="flex-end"
                sx={{
                  px: 1.15,
                  py: 0.95,
                  borderBottom: "1px solid rgba(148,163,184,0.12)",
                  bgcolor: "rgba(255,255,255,0.7)",
                }}
              >
                <Stack direction="row" spacing={1} alignItems="center">
                  {activeSnapshot.mode === "bucket" ? (
                    <Button
                    size="small"
                    variant="text"
                    startIcon={<CloseRoundedIcon sx={{ fontSize: 16 }} />}
                    onClick={() => setSelectedBucketStartUtcIso(null)}
                    sx={{ minWidth: 0, px: 0.8, fontWeight: 800 }}
                  >
                    Show all candles
                    </Button>
                  ) : null}
                </Stack>
              </Stack>
            ) : null}

            <Box sx={{ overflowX: "auto" }}>
              <Box
                sx={{
                  minWidth: 760,
                  display: "grid",
                  gridTemplateColumns: "minmax(220px, 1.8fr) repeat(6, minmax(86px, 1fr))",
                }}
              >
                {[
                  { label: "Scope", icon: <AccessTimeRoundedIcon sx={{ fontSize: 16 }} /> },
                  { label: "Orders", icon: <ShoppingBagRoundedIcon sx={{ fontSize: 16 }} /> },
                  { label: "Vendor", icon: <StorefrontRoundedIcon sx={{ fontSize: 16 }} /> },
                  { label: "Transport", icon: <LocalShippingRoundedIcon sx={{ fontSize: 16 }} /> },
                  { label: "VFR", icon: <WarningAmberRoundedIcon sx={{ fontSize: 16 }} /> },
                  { label: "LFR", icon: <TrendingUpRoundedIcon sx={{ fontSize: 16 }} /> },
                  { label: "V+L FR", icon: <TrendingUpRoundedIcon sx={{ fontSize: 16 }} /> },
                ].map((column) => (
                  <Box
                    key={column.label}
                    sx={{
                      px: 1.05,
                      py: 0.8,
                      borderBottom: "1px solid rgba(148,163,184,0.12)",
                      bgcolor: "rgba(241,245,249,0.72)",
                    }}
                  >
                    <Stack direction="row" spacing={0.55} alignItems="center" sx={{ color: "#475569" }}>
                      {column.icon}
                      <Typography sx={{ fontSize: 11.5, fontWeight: 900 }}>
                        {column.label}
                      </Typography>
                    </Stack>
                  </Box>
                ))}

                <Box sx={{ px: 1.05, py: 1 }}>
                  <Typography sx={{ fontSize: 13.5, fontWeight: 900, color: "#0f172a" }}>
                    {activeSnapshot.heading}
                  </Typography>
                  {activeSnapshot.subheading ? (
                    <Typography sx={{ mt: 0.2, fontSize: 11.5, color: "#64748b", fontWeight: 700 }}>
                      {activeSnapshot.subheading}
                    </Typography>
                  ) : null}
                </Box>
                {[
                  { primary: metric(activeSnapshot.ordersCount) },
                  { primary: metric(activeSnapshot.vendorCancelledCount) },
                  { primary: metric(activeSnapshot.transportCancelledCount) },
                  { primary: metric(activeSnapshot.vendorCancelledCount), secondary: percent(activeSnapshot.vfr) },
                  { primary: metric(activeSnapshot.transportCancelledCount), secondary: percent(activeSnapshot.lfr) },
                  {
                    primary: metric(activeSnapshot.vendorCancelledCount + activeSnapshot.transportCancelledCount),
                    secondary: percent(activeSnapshot.vlfr),
                  },
                ].map((value, index) => (
                  <Box key={`${activeSnapshot.heading}-${index}`} sx={{ px: 1.05, py: 1 }}>
                    <Typography sx={{ fontSize: 18, fontWeight: 900, color: "#0f172a", lineHeight: 1.1 }}>
                      {value.primary}
                    </Typography>
                    {value.secondary ? (
                      <Typography
                        sx={{
                          mt: 0.42,
                          fontSize: 12.5,
                          fontWeight: 900,
                          color: "#b45309",
                          lineHeight: 1,
                          letterSpacing: "-0.01em",
                        }}
                      >
                        {value.secondary}
                      </Typography>
                    ) : null}
                  </Box>
                ))}
              </Box>
            </Box>
          </Box>
        ) : null}
      </Box>
    </Box>
  );
}
