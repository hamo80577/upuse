import type { BranchLiveOrder, OrdersMetrics } from "../../types/models.js";
import { classifyOrderState } from "./classification.js";

export interface CanonicalMetricsRowInput {
  orderId: string;
  externalId: string;
  status: string;
  isCompleted: boolean | number | null | undefined;
  isCancelled?: boolean | number | null | undefined;
  isActiveNow?: boolean | number | null | undefined;
  pickupAt?: string | null | undefined;
  isUnassigned?: boolean | number | null | undefined;
  shopperId?: number | null | undefined;
  customerFirstName?: string | null | undefined;
  shopperFirstName?: string | null | undefined;
  placedAt?: string | null | undefined;
}

export interface CanonicalOrderMetrics {
  isCancelled: boolean;
  isOnHold: boolean;
  isUnassigned: boolean;
  isReadyToPickup: boolean;
  isInPrep: boolean;
  isActive: boolean;
  isLate: boolean;
}

function isTruthyFlag(value: boolean | number | null | undefined) {
  return value === true || value === 1;
}

export function createEmptyCanonicalOrdersMetrics(): OrdersMetrics {
  return {
    totalToday: 0,
    cancelledToday: 0,
    doneToday: 0,
    activeNow: 0,
    preparingNow: 0,
    lateNow: 0,
    unassignedNow: 0,
    readyNow: 0,
  };
}

export function classifyCanonicalOrderMetrics(input: CanonicalMetricsRowInput, nowIso: string): CanonicalOrderMetrics {
  const base = classifyOrderState({
    status: input.status,
    isCompleted: input.isCompleted,
    isActiveNow: input.isActiveNow,
    pickupAt: input.pickupAt,
    isUnassigned: input.isUnassigned,
    shopperId: input.shopperId,
  }, nowIso);
  const isCancelled = isTruthyFlag(input.isCancelled) || input.status === "CANCELLED";
  const isOnHold = !isCancelled && input.status === "ON_HOLD";
  const isUnassigned = !isCancelled && input.status === "UNASSIGNED";
  const isReadyToPickup = !isCancelled && base.isReadyToPickup;
  const isInPrep =
    !isCancelled &&
    !isOnHold &&
    !isReadyToPickup &&
    !isUnassigned &&
    base.isInPreparation;
  const isActive = isInPrep || isReadyToPickup;
  const isLate = isInPrep && base.isLate;

  return {
    isCancelled,
    isOnHold,
    isUnassigned,
    isReadyToPickup,
    isInPrep,
    isActive,
    isLate,
  };
}

export function accumulateCanonicalOrdersMetrics(
  current: OrdersMetrics,
  input: CanonicalMetricsRowInput,
  metrics: CanonicalOrderMetrics,
) {
  current.totalToday += 1;
  if (metrics.isCancelled) current.cancelledToday += 1;
  if (isTruthyFlag(input.isCompleted)) current.doneToday += 1;
  if (metrics.isActive) current.activeNow += 1;
  if (metrics.isInPrep) current.preparingNow = (current.preparingNow ?? 0) + 1;
  if (metrics.isLate) current.lateNow += 1;
  if (metrics.isUnassigned) current.unassignedNow += 1;
  if (metrics.isReadyToPickup) current.readyNow = (current.readyNow ?? 0) + 1;
  return current;
}

export function toCanonicalLiveOrder(
  row: CanonicalMetricsRowInput,
  metrics: CanonicalOrderMetrics,
): BranchLiveOrder {
  return {
    id: row.orderId,
    externalId: row.externalId,
    status: row.status,
    placedAt: row.placedAt ?? undefined,
    pickupAt: row.pickupAt ?? undefined,
    customerFirstName: row.customerFirstName ?? undefined,
    shopperId: row.shopperId ?? undefined,
    shopperFirstName: row.shopperFirstName ?? undefined,
    isUnassigned: metrics.isUnassigned,
    isLate: metrics.isLate,
  };
}
