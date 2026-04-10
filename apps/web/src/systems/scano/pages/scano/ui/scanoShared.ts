import type { ScanoTaskCounters, ScanoTaskListItem, ScanoTaskProduct, ScanoTaskProductListSourceFilter, ScanoTaskStatus } from "../../../api/types";

export const EMPTY_SCANO_COUNTERS: Required<Pick<ScanoTaskCounters, "scannedProductsCount" | "vendorCount" | "vendorEditedCount" | "chainCount" | "chainEditedCount" | "masterCount" | "manualCount">> = {
  scannedProductsCount: 0,
  vendorCount: 0,
  vendorEditedCount: 0,
  chainCount: 0,
  chainEditedCount: 0,
  masterCount: 0,
  manualCount: 0,
};

export function withScanoCounters(counters?: ScanoTaskCounters) {
  return {
    ...EMPTY_SCANO_COUNTERS,
    ...counters,
  };
}

export const CAIRO_TIMEZONE = "Africa/Cairo";

interface DateTimeParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

const cairoDateTimeFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: CAIRO_TIMEZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

function parseDateTimeLocalValue(value: string): DateTimeParts | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);

  if ([year, month, day, hour, minute].some((part) => !Number.isFinite(part))) {
    return null;
  }

  return { year, month, day, hour, minute };
}

function getCairoDateTimeParts(date: Date): DateTimeParts {
  const partMap = new Map<string, string>();
  for (const part of cairoDateTimeFormatter.formatToParts(date)) {
    if (part.type === "year" || part.type === "month" || part.type === "day" || part.type === "hour" || part.type === "minute") {
      partMap.set(part.type, part.value);
    }
  }

  return {
    year: Number(partMap.get("year") ?? "0"),
    month: Number(partMap.get("month") ?? "0"),
    day: Number(partMap.get("day") ?? "0"),
    hour: Number(partMap.get("hour") ?? "0"),
    minute: Number(partMap.get("minute") ?? "0"),
  };
}

function padDatePart(value: number) {
  return String(value).padStart(2, "0");
}

export function toDateTimeLocalValue(iso?: string) {
  if (!iso) return "";

  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";

  const parts = getCairoDateTimeParts(date);
  return `${parts.year}-${padDatePart(parts.month)}-${padDatePart(parts.day)}T${padDatePart(parts.hour)}:${padDatePart(parts.minute)}`;
}

function dateTimePartsToComparableValue(parts: DateTimeParts) {
  return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute);
}

export function toCairoIsoString(value: string) {
  const target = parseDateTimeLocalValue(value);
  if (!target) return null;

  let utcMillis = Date.UTC(target.year, target.month - 1, target.day, target.hour, target.minute);

  for (let iteration = 0; iteration < 4; iteration += 1) {
    const current = getCairoDateTimeParts(new Date(utcMillis));
    const diffMinutes = (dateTimePartsToComparableValue(target) - dateTimePartsToComparableValue(current)) / 60_000;

    if (!diffMinutes) {
      return new Date(utcMillis).toISOString();
    }

    utcMillis += diffMinutes * 60_000;
  }

  const finalParts = getCairoDateTimeParts(new Date(utcMillis));
  if (dateTimePartsToComparableValue(finalParts) !== dateTimePartsToComparableValue(target)) {
    return null;
  }

  return new Date(utcMillis).toISOString();
}

export function toCairoRangeStartIso(value: string) {
  return toCairoIsoString(`${value}T00:00`);
}

export function toCairoRangeEndIso(value: string) {
  return toCairoIsoString(`${value}T23:59`);
}

export function formatCairoDateTime(iso?: string) {
  if (!iso) return "--";
  try {
    return new Date(iso).toLocaleString("en-GB", {
      timeZone: CAIRO_TIMEZONE,
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    });
  } catch {
    return iso;
  }
}

export function formatCairoFullDateTime(iso?: string) {
  if (!iso) return "--";
  try {
    return new Date(iso).toLocaleString("en-GB", {
      timeZone: CAIRO_TIMEZONE,
      year: "numeric",
      month: "short",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    });
  } catch {
    return iso;
  }
}

export function sortTaskItems(items: ScanoTaskListItem[]) {
  return [...items].sort((left, right) => {
    const leftTime = Date.parse(left.scheduledAt);
    const rightTime = Date.parse(right.scheduledAt);
    if (leftTime !== rightTime) {
      return leftTime - rightTime;
    }
    return right.id.localeCompare(left.id);
  });
}

export function upsertTaskItem(items: ScanoTaskListItem[], nextItem: ScanoTaskListItem) {
  return sortTaskItems([
    ...items.filter((item) => item.id !== nextItem.id),
    nextItem,
  ]);
}

export function getScanoTaskStatusMeta(status: ScanoTaskStatus) {
  if (status === "completed") {
    return {
      label: "Completed",
      sx: {
        bgcolor: "rgba(236,253,245,0.98)",
        color: "#15803d",
        border: "1px solid rgba(34,197,94,0.2)",
      },
    };
  }

  if (status === "awaiting_review") {
    return {
      label: "Awaiting Review",
      sx: {
        bgcolor: "rgba(250,245,255,0.98)",
        color: "#7c3aed",
        border: "1px solid rgba(168,85,247,0.18)",
      },
    };
  }

  if (status === "in_progress") {
    return {
      label: "In Progress",
      sx: {
        bgcolor: "rgba(239,246,255,0.98)",
        color: "#1d4ed8",
        border: "1px solid rgba(59,130,246,0.22)",
      },
    };
  }

  return {
    label: "Pending",
    sx: {
      bgcolor: "rgba(255,247,237,0.98)",
      color: "#c2410c",
      border: "1px solid rgba(249,115,22,0.18)",
    },
  };
}

export function getScanoTaskProductSourceLabel(source: ScanoTaskProductListSourceFilter) {
  if (source === "vendor") return "Vendor";
  if (source === "chain") return "Chain";
  if (source === "master") return "Master";
  if (source === "manual") return "Manual";
  return "All";
}

export function matchesScanoTaskProductFilter(
  product: ScanoTaskProduct,
  query: string,
  sourceFilter: ScanoTaskProductListSourceFilter,
) {
  if (sourceFilter !== "all" && product.sourceType !== sourceFilter) {
    return false;
  }

  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) {
    return true;
  }

  return [
    product.barcode,
    product.sku,
    product.itemNameEn,
    product.itemNameAr ?? "",
    ...product.barcodes,
  ].some((value) => value.trim().toLowerCase().includes(normalizedQuery));
}
