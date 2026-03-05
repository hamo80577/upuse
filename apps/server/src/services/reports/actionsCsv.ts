import { DateTime } from "luxon";
import { csvCell } from "./csvSanitizer.js";
import { toCairoLabel } from "./range.js";

export interface ActionEventRow {
  branchName: string;
  chainName: string;
  ordersVendorId: number;
  availabilityVendorId: string;
  ts: string;
  reason: string | null;
  note: string | null;
  closedUntil: string | null;
  reopenedAt: string | null;
  reopenMode: string | null;
  totalToday: number;
  cancelledToday: number;
  doneToday: number;
  activeNow: number;
  lateNow: number;
  unassignedNow: number;
}

export function buildActionEventsCsvContent(params: {
  rows: ActionEventRow[];
  fileSuffix: string;
}) {
  const header = [
    "Branch Name",
    "Chain Name",
    "Orders Vendor ID",
    "Availability Vendor ID",
    "Closed At",
    "Closed At (Cairo)",
    "Close Reason",
    "Total Orders",
    "Cancelled",
    "Done",
    "Active",
    "Late",
    "Unassigned",
    "Closed Until",
    "Closed Until (Cairo)",
    "Reopened At",
    "Reopened At (Cairo)",
    "Reopen Mode",
    "Close Duration Minutes",
    "Notes",
  ];

  const csvRows = params.rows.map((row) => {
    const closedAtCairo = toCairoLabel(row.ts);
    const closedUntilCairo = toCairoLabel(row.closedUntil);
    const reopenedAtCairo = toCairoLabel(row.reopenedAt);
    const durationMinutes = row.reopenedAt
      ? Math.max(
          0,
          Math.round(
            DateTime.fromISO(row.reopenedAt, { zone: "utc" })
              .diff(DateTime.fromISO(row.ts, { zone: "utc" }), "minutes")
              .minutes,
          ),
        )
      : "";

    return [
      row.branchName,
      row.chainName,
      row.ordersVendorId,
      row.availabilityVendorId,
      row.ts,
      closedAtCairo,
      row.reason ?? "",
      row.totalToday,
      row.cancelledToday,
      row.doneToday,
      row.activeNow,
      row.lateNow,
      row.unassignedNow,
      row.closedUntil ?? "",
      closedUntilCairo,
      row.reopenedAt ?? "",
      reopenedAtCairo,
      row.reopenMode ?? "",
      durationMinutes,
      row.note ?? "",
    ];
  });

  const fileName = `upuse-monitor-report-${params.fileSuffix}.csv`;
  const csv = [header, ...csvRows].map((row) => row.map(csvCell).join(",")).join("\r\n");
  return { fileName, csv };
}
