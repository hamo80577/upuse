import type { OrdersMetrics } from "../../types/models.js";
import { isPastPickup } from "../../utils/time.js";

export interface OrderClassificationInput {
  status?: unknown;
  isCompleted?: boolean | number | null;
  pickupAt?: string | null;
  isUnassigned?: boolean | number | null;
  shopperId?: number | null;
  shopper?: unknown;
}

export interface OrderClassification {
  isInPreparation: boolean;
  isReadyToPickup: boolean;
  isLate: boolean;
  isActive: boolean;
  isUnassigned: boolean;
}

function isTruthyFlag(value: boolean | number | null | undefined) {
  return value === true || value === 1;
}

function hasAssignedShopper(input: Pick<OrderClassificationInput, "shopper" | "shopperId">) {
  if (typeof input.shopperId === "number" && Number.isFinite(input.shopperId)) {
    return true;
  }
  if (typeof input.shopper !== "undefined") {
    return input.shopper != null;
  }
  return false;
}

export function isReadyToPickupStatus(status: unknown) {
  return typeof status === "string" && status === "READY_FOR_PICKUP";
}

export function classifyOrderState(input: OrderClassificationInput, nowIso: string): OrderClassification {
  const isReadyToPickup = isReadyToPickupStatus(input.status);
  const isInPreparation = !isTruthyFlag(input.isCompleted);
  const rawUnassigned =
    typeof input.isUnassigned !== "undefined" && input.isUnassigned != null
      ? isTruthyFlag(input.isUnassigned)
      : input.status === "UNASSIGNED" || !hasAssignedShopper(input);
  const isUnassigned = isInPreparation && !isReadyToPickup && rawUnassigned;
  const isLate =
    isInPreparation &&
    !isReadyToPickup &&
    typeof input.pickupAt === "string" &&
    input.pickupAt.length > 0 &&
    isPastPickup(nowIso, input.pickupAt);

  return {
    isInPreparation,
    isReadyToPickup,
    isLate,
    isActive: isInPreparation || isReadyToPickup,
    isUnassigned,
  };
}

export function isPreparingQueueOrder(classification: Pick<OrderClassification, "isInPreparation" | "isReadyToPickup" | "isUnassigned">) {
  return classification.isInPreparation && !classification.isReadyToPickup && !classification.isUnassigned;
}

export function derivePreparingNow(metrics: Pick<OrdersMetrics, "activeNow" | "readyNow" | "preparingNow">) {
  if (typeof metrics.preparingNow === "number" && Number.isFinite(metrics.preparingNow)) {
    return Math.max(0, Math.round(metrics.preparingNow));
  }

  return Math.max(0, metrics.activeNow - (metrics.readyNow ?? 0));
}
