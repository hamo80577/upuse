import type { CloseReason, OrdersMetrics } from "../../types/models.js";
import { derivePreparingNow } from "../../services/orders/classification.js";

export type OrdersPressureSummary = {
  preparingNow: number;
  preparingPickersNow: number;
  recentActivePickers: number;
  recentActiveAvailable: boolean;
};

export function normalizeRecentActivePickers(value: number) {
  return Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0;
}

export function capacityLimit(recentActivePickers: number) {
  return normalizeRecentActivePickers(recentActivePickers) * 3;
}

export function resolveCapacityLoad(metrics: OrdersMetrics) {
  return derivePreparingNow(metrics);
}

export function closeReasonLogTag(reason: CloseReason, metrics: OrdersMetrics, recentActivePickers: number) {
  if (reason === "LATE") return `Late=${metrics.lateNow}`;
  if (reason === "UNASSIGNED") return `Unassigned=${metrics.unassignedNow}`;
  if (reason === "READY_TO_PICKUP") return `Ready To Pickup=${metrics.readyNow ?? 0}`;
  if (reason === "CAPACITY_HOUR") {
    return "Capacity / Hour limit reached";
  }

  const pickers = normalizeRecentActivePickers(recentActivePickers);
  return `Capacity inPrep=${resolveCapacityLoad(metrics)} cap=${capacityLimit(pickers)} recentActivePickers=${pickers}`;
}

export function currentPreparation(
  preparation?: Partial<OrdersPressureSummary> & { lastHourPickers?: number },
  recentActiveAvailableFallback = false,
): OrdersPressureSummary {
  return {
    preparingNow: preparation?.preparingNow ?? 0,
    preparingPickersNow: preparation?.preparingPickersNow ?? 0,
    recentActivePickers: normalizeRecentActivePickers(
      preparation?.recentActivePickers ?? preparation?.lastHourPickers ?? 0,
    ),
    recentActiveAvailable:
      preparation?.recentActiveAvailable ??
      (preparation?.recentActivePickers != null || preparation?.lastHourPickers != null
        ? true
        : recentActiveAvailableFallback),
  };
}
