import { DateTime } from "luxon";
import { db } from "../config/db.js";
import type {
  BranchLiveOrder,
  BranchPickersSummary,
  BranchSnapshot,
  PerformanceBranchCard,
  PerformanceBranchDetailResponse,
  PerformanceCancelledOrderItem,
  PerformanceChainGroup,
  PerformanceEntityBranchCard,
  PerformanceOwnerCoverage,
  PerformanceStatusCount,
  PerformanceSummaryResponse,
  PerformanceUnmappedVendorCard,
  PerformanceVendorDetailResponse,
  ResolvedBranchMapping,
} from "../types/models.js";
import { listResolvedBranches, getResolvedBranchById } from "./branchStore.js";
import { getGlobalEntityId, getSettings } from "./settingsStore.js";
import { extractCancellationDetail, extractCancellationOwner, extractTransportType, getMirrorBranchPickers, getOrdersMirrorEntitySyncStatus } from "./ordersMirrorStore.js";
import { TZ, isPastPickup, nowUtcIso } from "../utils/time.js";

type StatusColor = BranchSnapshot["statusColor"];
type DeliveryMode = PerformanceEntityBranchCard["deliveryMode"];

const LOGISTICS_DELIVERY = "LOGISTICS_DELIVERY";
const IN_PREP_STATUSES = new Set([
  "STARTED",
  "READY_FOR_CHECKOUT",
  "CHECKOUT_CONFIRMED",
  "PROCESSING_CUSTOMER_SELECTION",
  "WAITING_FOR_CUSTOMER",
]);

interface PerformanceMirrorRow {
  dayKey: string;
  globalEntityId: string;
  vendorId: number;
  vendorName: string | null;
  orderId: string;
  externalId: string;
  status: string;
  transportType: string | null;
  shopperId: number | null;
  shopperFirstName: string | null;
  isCompleted: number;
  isCancelled: number;
  isUnassigned: number;
  isActiveNow: number;
  customerFirstName: string | null;
  placedAt: string | null;
  pickupAt: string | null;
  lastSeenAt: string;
  cancellationOwner: string | null;
  cancellationReason: string | null;
  cancellationStage: string | null;
  cancellationSource: string | null;
  cancellationCreatedAt: string | null;
  cancellationUpdatedAt: string | null;
  cancellationOwnerLookupAt: string | null;
  cancellationOwnerLookupError: string | null;
}

interface CoverageCounts {
  totalCancelledOrders: number;
  resolvedOwnerCount: number;
  unresolvedOwnerCount: number;
  vendorOwnerCancelledCount: number;
  transportOwnerCancelledCount: number;
  lookupErrorCount: number;
}

interface PerformanceAggregateMetrics {
  totalOrders: number;
  statusCounts: Map<string, number>;
  cancelledOrders: PerformanceCancelledOrderItem[];
  activeOrders: number;
  lateNow: number;
  onHoldOrders: number;
  unassignedOrders: number;
  inPrepOrders: number;
  readyToPickupOrders: number;
  sawLogisticsDelivery: boolean;
  sawKnownNonLogisticsDelivery: boolean;
  sawShopperAssignment: boolean;
}

interface PerformanceBranchAggregate {
  branch: ResolvedBranchMapping;
  statusColor: StatusColor;
  totalOrders: number;
  statusCounts: Map<string, number>;
  cancelledOrders: PerformanceCancelledOrderItem[];
  activeOrders: number;
  lateNow: number;
  onHoldOrders: number;
  unassignedOrders: number;
  inPrepOrders: number;
  readyToPickupOrders: number;
  sawLogisticsDelivery: boolean;
  sawKnownNonLogisticsDelivery: boolean;
  sawShopperAssignment: boolean;
}

interface PerformanceVendorAggregate {
  vendorId: number;
  vendorName: string;
  globalEntityId: string;
  statusColor: StatusColor;
  totalOrders: number;
  statusCounts: Map<string, number>;
  cancelledOrders: PerformanceCancelledOrderItem[];
  activeOrders: number;
  lateNow: number;
  onHoldOrders: number;
  unassignedOrders: number;
  inPrepOrders: number;
  readyToPickupOrders: number;
  sawLogisticsDelivery: boolean;
  sawKnownNonLogisticsDelivery: boolean;
  sawShopperAssignment: boolean;
}

interface PerformanceEntityBranchAggregate {
  vendorId: number;
  vendorName: string;
  statusColor: StatusColor;
  totalOrders: number;
  statusCounts: Map<string, number>;
  cancelledOrders: PerformanceCancelledOrderItem[];
  activeOrders: number;
  lateNow: number;
  onHoldOrders: number;
  unassignedOrders: number;
  inPrepOrders: number;
  readyToPickupOrders: number;
  sawLogisticsDelivery: boolean;
  sawKnownNonLogisticsDelivery: boolean;
  sawShopperAssignment: boolean;
}

interface PerformanceScope {
  dayKey: string;
  timezone: string;
  startUtcIso: string;
  endUtcIso: string;
}

interface PerformanceDataset {
  summary: PerformanceSummaryResponse;
  branchDetailsById: Map<number, PerformanceBranchDetailResponse>;
  vendorDetailsById: Map<number, PerformanceVendorDetailResponse>;
}

function emptyPickers(): BranchPickersSummary {
  return {
    todayCount: 0,
    activePreparingCount: 0,
    recentActiveCount: 0,
    items: [],
  };
}

function getCurrentCairoDayKey(now = DateTime.utc()) {
  return now.setZone(TZ).toFormat("yyyy-LL-dd");
}

function resolvePerformanceScope(dayKey = getCurrentCairoDayKey()): PerformanceScope {
  const day = DateTime.fromFormat(dayKey, "yyyy-LL-dd", { zone: TZ });
  const resolvedDay = day.isValid ? day : DateTime.utc().setZone(TZ);

  return {
    dayKey: resolvedDay.toFormat("yyyy-LL-dd"),
    timezone: TZ,
    startUtcIso: resolvedDay.startOf("day").toUTC().toISO({ suppressMilliseconds: false })!,
    endUtcIso: resolvedDay.endOf("day").toUTC().toISO({ suppressMilliseconds: false })!,
  };
}

function toMillis(iso: string | null | undefined) {
  if (!iso) return Number.NEGATIVE_INFINITY;
  const value = new Date(iso).getTime();
  return Number.isFinite(value) ? value : Number.NEGATIVE_INFINITY;
}

function compareStatusCounts(left: PerformanceStatusCount, right: PerformanceStatusCount) {
  if (right.count !== left.count) return right.count - left.count;
  return left.status.localeCompare(right.status);
}

function compareCancelledOrders(left: PerformanceCancelledOrderItem, right: PerformanceCancelledOrderItem) {
  return (
    toMillis(right.cancellationCreatedAt) - toMillis(left.cancellationCreatedAt) ||
    toMillis(right.cancellationUpdatedAt) - toMillis(left.cancellationUpdatedAt) ||
    toMillis(right.pickupAt) - toMillis(left.pickupAt) ||
    toMillis(right.placedAt) - toMillis(left.placedAt) ||
    right.externalId.localeCompare(left.externalId)
  );
}

function compareFlowRows(left: PerformanceMirrorRow, right: PerformanceMirrorRow) {
  return (
    toMillis(left.pickupAt) - toMillis(right.pickupAt) ||
    toMillis(left.placedAt) - toMillis(right.placedAt) ||
    left.externalId.localeCompare(right.externalId)
  );
}

function comparePlacedRows(left: PerformanceMirrorRow, right: PerformanceMirrorRow) {
  return (
    toMillis(left.placedAt) - toMillis(right.placedAt) ||
    toMillis(left.pickupAt) - toMillis(right.pickupAt) ||
    left.externalId.localeCompare(right.externalId)
  );
}

function toLiveOrder(row: PerformanceMirrorRow, nowIso: string): BranchLiveOrder {
  const lateEligible = row.status !== "READY_FOR_PICKUP";
  return {
    id: row.orderId,
    externalId: row.externalId,
    status: row.status,
    placedAt: row.placedAt ?? undefined,
    pickupAt: row.pickupAt ?? undefined,
    customerFirstName: row.customerFirstName ?? undefined,
    shopperId: row.shopperId ?? undefined,
    shopperFirstName: row.shopperFirstName ?? undefined,
    isUnassigned: row.isUnassigned === 1,
    isLate: lateEligible && row.pickupAt ? isPastPickup(nowIso, row.pickupAt) : false,
  };
}

function buildFlowOrders(rows: PerformanceMirrorRow[], nowIso: string) {
  return {
    onHoldOrders: rows
      .filter((row) => row.status === "ON_HOLD")
      .sort(compareFlowRows)
      .map((row) => toLiveOrder(row, nowIso)),
    unassignedOrders: rows
      .filter((row) => row.status === "UNASSIGNED")
      .sort(comparePlacedRows)
      .map((row) => toLiveOrder(row, nowIso)),
    inPrepOrders: rows
      .filter((row) => IN_PREP_STATUSES.has(row.status))
      .sort(compareFlowRows)
      .map((row) => toLiveOrder(row, nowIso)),
    readyToPickupOrders: rows
      .filter((row) => row.status === "READY_FOR_PICKUP")
      .sort(compareFlowRows)
      .map((row) => toLiveOrder(row, nowIso)),
  };
}

function comparePerformanceCards(
  left: Pick<PerformanceBranchCard, "vlfr" | "vendorOwnerCancelledCount" | "transportOwnerCancelledCount" | "totalOrders"> & { name: string },
  right: Pick<PerformanceBranchCard, "vlfr" | "vendorOwnerCancelledCount" | "transportOwnerCancelledCount" | "totalOrders"> & { name: string },
) {
  return (
    right.vlfr - left.vlfr ||
    right.vendorOwnerCancelledCount - left.vendorOwnerCancelledCount ||
    right.transportOwnerCancelledCount - left.transportOwnerCancelledCount ||
    right.totalOrders - left.totalOrders ||
    left.name.localeCompare(right.name)
  );
}

function sortStatusCounts(map: Map<string, number>) {
  return Array.from(map.entries())
    .map(([status, count]) => ({ status, count }))
    .sort(compareStatusCounts);
}

function computeCoverageCounts(cancelledOrders: PerformanceCancelledOrderItem[]): CoverageCounts {
  return cancelledOrders.reduce<CoverageCounts>((current, order) => {
    current.totalCancelledOrders += 1;
    if (order.cancellationOwner) {
      current.resolvedOwnerCount += 1;
      if (order.cancellationOwner === "VENDOR") {
        current.vendorOwnerCancelledCount += 1;
      } else if (order.cancellationOwner === "TRANSPORT") {
        current.transportOwnerCancelledCount += 1;
      }
    } else {
      current.unresolvedOwnerCount += 1;
      if (order.cancellationOwnerLookupError) {
        current.lookupErrorCount += 1;
      }
    }
    return current;
  }, {
    totalCancelledOrders: 0,
    resolvedOwnerCount: 0,
    unresolvedOwnerCount: 0,
    vendorOwnerCancelledCount: 0,
    transportOwnerCancelledCount: 0,
    lookupErrorCount: 0,
  });
}

function buildCoverageWarning(counts: CoverageCounts) {
  if (!counts.unresolvedOwnerCount) return null;
  if (counts.lookupErrorCount) {
    return `${counts.unresolvedOwnerCount} cancelled orders still have unresolved owners. ${counts.lookupErrorCount} owner lookups failed, so VFR, LFR, and V+L FR exclude them until the next successful refresh.`;
  }
  return `${counts.unresolvedOwnerCount} cancelled orders still have unresolved owners. VFR, LFR, and V+L FR exclude them until owner enrichment completes.`;
}

function buildPerformanceOwnerCoverage(cancelledOrders: PerformanceCancelledOrderItem[]): PerformanceOwnerCoverage {
  const counts = computeCoverageCounts(cancelledOrders);
  return {
    ...counts,
    coverageRatio: counts.totalCancelledOrders ? counts.resolvedOwnerCount / counts.totalCancelledOrders : 1,
    warning: buildCoverageWarning(counts),
  };
}

function countCancelledOrdersByOwner(cancelledOrders: PerformanceCancelledOrderItem[], owner: string) {
  return cancelledOrders.reduce((count, order) => count + (order.cancellationOwner === owner ? 1 : 0), 0);
}

function buildDetailSummary(params: {
  aggregate: PerformanceAggregateMetrics;
  cancelledOrders: PerformanceCancelledOrderItem[];
  vendorOwnerCancelledCount: number;
  transportOwnerCancelledCount: number;
  deliveryMode: DeliveryMode;
  lfrApplicable: boolean;
}) {
  const customerOwnerCancelledCount = countCancelledOrdersByOwner(params.cancelledOrders, "CUSTOMER");
  const unknownOwnerCancelledCount = params.cancelledOrders.reduce(
    (count, order) => count + (!order.cancellationOwner ? 1 : 0),
    0,
  );

  return {
    totalOrders: params.aggregate.totalOrders,
    totalCancelledOrders: params.cancelledOrders.length,
    activeOrders: params.aggregate.activeOrders,
    lateNow: params.aggregate.lateNow,
    onHoldOrders: params.aggregate.onHoldOrders,
    unassignedOrders: params.aggregate.unassignedOrders,
    inPrepOrders: params.aggregate.inPrepOrders,
    readyToPickupOrders: params.aggregate.readyToPickupOrders,
    vendorOwnerCancelledCount: params.vendorOwnerCancelledCount,
    transportOwnerCancelledCount: params.transportOwnerCancelledCount,
    customerOwnerCancelledCount,
    unknownOwnerCancelledCount,
    vfr: calculateVfr(params.vendorOwnerCancelledCount, params.aggregate.totalOrders),
    lfr: calculateBranchLfr(params.transportOwnerCancelledCount, params.aggregate.totalOrders, params.lfrApplicable),
    vlfr: calculateBranchVlfr(
      params.vendorOwnerCancelledCount,
      params.transportOwnerCancelledCount,
      params.aggregate.totalOrders,
      params.lfrApplicable,
    ),
    deliveryMode: params.deliveryMode,
    lfrApplicable: params.lfrApplicable,
  };
}

function calculateVfr(vendorOwnerCancelledCount: number, totalOrders: number) {
  if (!totalOrders) return 0;
  return (vendorOwnerCancelledCount / totalOrders) * 100;
}

function calculateLfr(transportOwnerCancelledCount: number, totalOrders: number) {
  if (!totalOrders) return 0;
  return (transportOwnerCancelledCount / totalOrders) * 100;
}

function calculateVlfr(vendorOwnerCancelledCount: number, transportOwnerCancelledCount: number, totalOrders: number) {
  if (!totalOrders) return 0;
  return ((vendorOwnerCancelledCount + transportOwnerCancelledCount) / totalOrders) * 100;
}

function createAggregateMetrics(): PerformanceAggregateMetrics {
  return {
    totalOrders: 0,
    statusCounts: new Map<string, number>(),
    cancelledOrders: [],
    activeOrders: 0,
    lateNow: 0,
    onHoldOrders: 0,
    unassignedOrders: 0,
    inPrepOrders: 0,
    readyToPickupOrders: 0,
    sawLogisticsDelivery: false,
    sawKnownNonLogisticsDelivery: false,
    sawShopperAssignment: false,
  };
}

function applyAggregateRow(
  aggregate: PerformanceAggregateMetrics,
  row: PerformanceMirrorRow,
  cancelledOrder: PerformanceCancelledOrderItem | null,
  nowIso: string,
) {
  aggregate.totalOrders += 1;
  aggregate.statusCounts.set(row.status, (aggregate.statusCounts.get(row.status) ?? 0) + 1);
  if (cancelledOrder) {
    aggregate.cancelledOrders.push(cancelledOrder);
  }

  if (row.isCompleted === 0) {
    aggregate.activeOrders += 1;
  }
  if (row.isActiveNow === 1 && row.status !== "READY_FOR_PICKUP" && row.pickupAt && isPastPickup(nowIso, row.pickupAt)) {
    aggregate.lateNow += 1;
  }
  if (row.status === "ON_HOLD") {
    aggregate.onHoldOrders += 1;
  }
  if (row.status === "UNASSIGNED") {
    aggregate.unassignedOrders += 1;
  }
  if (IN_PREP_STATUSES.has(row.status)) {
    aggregate.inPrepOrders += 1;
  }
  if (row.status === "READY_FOR_PICKUP") {
    aggregate.readyToPickupOrders += 1;
  }
  if (row.shopperId != null) {
    aggregate.sawShopperAssignment = true;
  }

  const normalizedTransportType = extractTransportType(row);
  if (normalizedTransportType === LOGISTICS_DELIVERY) {
    aggregate.sawLogisticsDelivery = true;
  } else if (normalizedTransportType) {
    aggregate.sawKnownNonLogisticsDelivery = true;
  }
}

function resolveDeliveryMode(aggregate: PerformanceAggregateMetrics, transportOwnerCancelledCount: number): DeliveryMode {
  const hasLogisticsSignal =
    aggregate.sawLogisticsDelivery ||
    aggregate.sawShopperAssignment ||
    transportOwnerCancelledCount > 0;

  if (hasLogisticsSignal && aggregate.sawKnownNonLogisticsDelivery) {
    return "mixed";
  }
  if (hasLogisticsSignal) {
    return "logistics";
  }
  if (aggregate.sawKnownNonLogisticsDelivery) {
    return "self";
  }
  return aggregate.totalOrders > 0 ? "self" : "unknown";
}

function isLfrApplicable(deliveryMode: DeliveryMode) {
  return deliveryMode === "logistics" || deliveryMode === "mixed";
}

function calculateBranchLfr(transportOwnerCancelledCount: number, totalOrders: number, lfrApplicable: boolean) {
  return lfrApplicable ? calculateLfr(transportOwnerCancelledCount, totalOrders) : 0;
}

function calculateBranchVlfr(
  vendorOwnerCancelledCount: number,
  transportOwnerCancelledCount: number,
  totalOrders: number,
  lfrApplicable: boolean,
) {
  return calculateVlfr(
    vendorOwnerCancelledCount,
    lfrApplicable ? transportOwnerCancelledCount : 0,
    totalOrders,
  );
}

function toCancelledOrderItem(row: PerformanceMirrorRow): PerformanceCancelledOrderItem {
  return {
    orderId: row.orderId,
    externalId: row.externalId,
    status: row.status,
    customerFirstName: row.customerFirstName,
    placedAt: row.placedAt,
    pickupAt: row.pickupAt,
    cancellationOwner: row.cancellationOwner,
    cancellationReason: row.cancellationReason,
    cancellationStage: row.cancellationStage,
    cancellationSource: row.cancellationSource,
    cancellationCreatedAt: row.cancellationCreatedAt,
    cancellationUpdatedAt: row.cancellationUpdatedAt,
    cancellationOwnerLookupAt: row.cancellationOwnerLookupAt,
    cancellationOwnerLookupError: row.cancellationOwnerLookupError,
  };
}

function buildStatusColorMap(items?: Map<number, StatusColor>) {
  return items ?? new Map<number, StatusColor>();
}

function loadPerformanceRows(dayKey: string, globalEntityId: string) {
  return db.prepare<[string, string], PerformanceMirrorRow>(`
    SELECT
      dayKey,
      globalEntityId,
      vendorId,
      vendorName,
      orderId,
      externalId,
      status,
      transportType,
      shopperId,
      shopperFirstName,
      isCompleted,
      isCancelled,
      isUnassigned,
      isActiveNow,
      customerFirstName,
      placedAt,
      pickupAt,
      lastSeenAt,
      cancellationOwner,
      cancellationReason,
      cancellationStage,
      cancellationSource,
      cancellationCreatedAt,
      cancellationUpdatedAt,
      cancellationOwnerLookupAt,
      cancellationOwnerLookupError
    FROM orders_mirror
    WHERE dayKey = ? AND globalEntityId = ?
  `).all(dayKey, globalEntityId);
}

function buildAggregateCoverage(cancelledOrders: PerformanceCancelledOrderItem[]) {
  const sortedCancelledOrders = [...cancelledOrders].sort(compareCancelledOrders);
  return {
    sortedCancelledOrders,
    coverage: buildPerformanceOwnerCoverage(sortedCancelledOrders),
    vendorOwnerCancelledOrders: sortedCancelledOrders.filter((order) => order.cancellationOwner === "VENDOR"),
    unknownOwnerCancelledOrders: sortedCancelledOrders.filter((order) => !order.cancellationOwner),
  };
}

function aggregatePerformanceData(params: {
  scope: PerformanceScope;
  globalEntityId: string;
  branches: ResolvedBranchMapping[];
  rows: PerformanceMirrorRow[];
  statusColorByBranchId?: Map<number, StatusColor>;
  fetchedAt?: string | null;
  cacheState?: PerformanceSummaryResponse["cacheState"];
}): PerformanceDataset {
  const nowIso = nowUtcIso();
  const statusColorByBranchId = buildStatusColorMap(params.statusColorByBranchId);
  const mappedBranchByVendorKey = new Map<string, PerformanceBranchAggregate>();
  const chainBranchIds = new Map<string, number[]>();
  const unmappedVendorByKey = new Map<string, PerformanceVendorAggregate>();
  const entityBranchByVendorKey = new Map<string, PerformanceEntityBranchAggregate>();
  const vendorRowsByKey = new Map<string, PerformanceMirrorRow[]>();
  const globalStatusCounts = new Map<string, number>();
  const globalCancelledOrders: PerformanceCancelledOrderItem[] = [];

  for (const branch of params.branches) {
    mappedBranchByVendorKey.set(`${branch.globalEntityId}::${branch.ordersVendorId}`, {
      branch,
      statusColor: statusColorByBranchId.get(branch.id) ?? "grey",
      ...createAggregateMetrics(),
    });

    const chainName = branch.chainName ?? "";
    const branchIds = chainBranchIds.get(chainName) ?? [];
    branchIds.push(branch.id);
    chainBranchIds.set(chainName, branchIds);
  }

  for (const row of params.rows) {
    globalStatusCounts.set(row.status, (globalStatusCounts.get(row.status) ?? 0) + 1);
    const cancelledOrder = row.isCancelled === 1 || row.status === "CANCELLED" ? toCancelledOrderItem(row) : null;
    if (cancelledOrder) {
      globalCancelledOrders.push(cancelledOrder);
    }

    const vendorKey = `${row.globalEntityId}::${row.vendorId}`;
    const vendorRows = vendorRowsByKey.get(vendorKey) ?? [];
    vendorRows.push(row);
    vendorRowsByKey.set(vendorKey, vendorRows);
    const mappedAggregate = mappedBranchByVendorKey.get(vendorKey);
    const entityBranchAggregate = entityBranchByVendorKey.get(vendorKey) ?? {
      vendorId: row.vendorId,
      vendorName: row.vendorName?.trim() || mappedAggregate?.branch.name || `Vendor ${row.vendorId}`,
      statusColor: mappedAggregate?.statusColor ?? "grey",
      ...createAggregateMetrics(),
    };

    applyAggregateRow(entityBranchAggregate, row, cancelledOrder, nowIso);
    entityBranchByVendorKey.set(vendorKey, entityBranchAggregate);

    if (mappedAggregate) {
      applyAggregateRow(mappedAggregate, row, cancelledOrder, nowIso);
      continue;
    }

    const unmappedAggregate = unmappedVendorByKey.get(vendorKey) ?? {
      vendorId: row.vendorId,
      vendorName: row.vendorName?.trim() || `Vendor ${row.vendorId}`,
      globalEntityId: row.globalEntityId,
      statusColor: "grey" as const,
      ...createAggregateMetrics(),
    };

    applyAggregateRow(unmappedAggregate, row, cancelledOrder, nowIso);
    unmappedVendorByKey.set(vendorKey, unmappedAggregate);
  }

  const fetchedAt = params.fetchedAt ?? null;
  const cacheState = params.cacheState ?? "warming";
  const branchDetailsById = new Map<number, PerformanceBranchDetailResponse>();
  const branchCardsById = new Map<number, PerformanceBranchCard>();
  const vendorDetailsById = new Map<number, PerformanceVendorDetailResponse>();
  const chainGroups = new Map<string, PerformanceChainGroup>();
  const entityBranches = Array.from(entityBranchByVendorKey.values())
    .map<PerformanceEntityBranchCard>((aggregate) => {
      const cancelled = buildAggregateCoverage(aggregate.cancelledOrders);
      const deliveryMode = resolveDeliveryMode(aggregate, cancelled.coverage.transportOwnerCancelledCount);
      const lfrApplicable = isLfrApplicable(deliveryMode);
      const statusCounts = sortStatusCounts(aggregate.statusCounts);
      const vendorRows = vendorRowsByKey.get(`${params.globalEntityId}::${aggregate.vendorId}`) ?? [];
      const flowOrders = buildFlowOrders(vendorRows, nowIso);
      const detailSummary = buildDetailSummary({
        aggregate,
        cancelledOrders: cancelled.sortedCancelledOrders,
        vendorOwnerCancelledCount: cancelled.coverage.vendorOwnerCancelledCount,
        transportOwnerCancelledCount: cancelled.coverage.transportOwnerCancelledCount,
        deliveryMode,
        lfrApplicable,
      });
      const mappedAggregate = mappedBranchByVendorKey.get(`${params.globalEntityId}::${aggregate.vendorId}`);

      vendorDetailsById.set(aggregate.vendorId, {
        kind: "vendor",
        vendor: {
          vendorId: aggregate.vendorId,
          vendorName: aggregate.vendorName,
          globalEntityId: params.globalEntityId,
          statusColor: aggregate.statusColor,
        },
        mappedBranch: mappedAggregate
          ? {
              branchId: mappedAggregate.branch.id,
              name: mappedAggregate.branch.name,
              chainName: mappedAggregate.branch.chainName,
              availabilityVendorId: mappedAggregate.branch.availabilityVendorId,
            }
          : null,
        summary: detailSummary,
        statusCounts,
        ownerCoverage: cancelled.coverage,
        onHoldOrders: flowOrders.onHoldOrders,
        unassignedOrders: flowOrders.unassignedOrders,
        inPrepOrders: flowOrders.inPrepOrders,
        readyToPickupOrders: flowOrders.readyToPickupOrders,
        cancelledOrders: cancelled.sortedCancelledOrders,
        vendorOwnerCancelledOrders: cancelled.vendorOwnerCancelledOrders,
        unknownOwnerCancelledOrders: cancelled.unknownOwnerCancelledOrders,
        pickers: emptyPickers(),
        fetchedAt,
        cacheState,
      });

      return {
        vendorId: aggregate.vendorId,
        name: aggregate.vendorName,
        statusColor: aggregate.statusColor,
        totalOrders: aggregate.totalOrders,
        activeOrders: aggregate.activeOrders,
        lateNow: aggregate.lateNow,
        onHoldOrders: aggregate.onHoldOrders,
        unassignedOrders: aggregate.unassignedOrders,
        inPrepOrders: aggregate.inPrepOrders,
        readyToPickupOrders: aggregate.readyToPickupOrders,
        deliveryMode,
        lfrApplicable,
        vendorOwnerCancelledCount: cancelled.coverage.vendorOwnerCancelledCount,
        transportOwnerCancelledCount: cancelled.coverage.transportOwnerCancelledCount,
        vfr: detailSummary.vfr,
        lfr: detailSummary.lfr,
        vlfr: detailSummary.vlfr,
        statusCounts,
        ownerCoverage: cancelled.coverage,
      };
    })
    .sort((left, right) => right.totalOrders - left.totalOrders || left.name.localeCompare(right.name));

  for (const aggregate of mappedBranchByVendorKey.values()) {
    const cancelled = buildAggregateCoverage(aggregate.cancelledOrders);
    const deliveryMode = resolveDeliveryMode(aggregate, cancelled.coverage.transportOwnerCancelledCount);
    const lfrApplicable = isLfrApplicable(deliveryMode);
    const statusCounts = sortStatusCounts(aggregate.statusCounts);
    const branchRows = vendorRowsByKey.get(`${aggregate.branch.globalEntityId}::${aggregate.branch.ordersVendorId}`) ?? [];
    const flowOrders = buildFlowOrders(branchRows, nowIso);
    const detailSummary = buildDetailSummary({
      aggregate,
      cancelledOrders: cancelled.sortedCancelledOrders,
      vendorOwnerCancelledCount: cancelled.coverage.vendorOwnerCancelledCount,
      transportOwnerCancelledCount: cancelled.coverage.transportOwnerCancelledCount,
      deliveryMode,
      lfrApplicable,
    });
    const branchCard: PerformanceBranchCard = {
      kind: "mapped_branch",
      branchId: aggregate.branch.id,
      name: aggregate.branch.name,
      chainName: aggregate.branch.chainName,
      ordersVendorId: aggregate.branch.ordersVendorId,
      availabilityVendorId: aggregate.branch.availabilityVendorId,
      statusColor: aggregate.statusColor,
      totalOrders: aggregate.totalOrders,
      vendorOwnerCancelledCount: cancelled.coverage.vendorOwnerCancelledCount,
      transportOwnerCancelledCount: cancelled.coverage.transportOwnerCancelledCount,
      vfr: detailSummary.vfr,
      lfr: detailSummary.lfr,
      vlfr: detailSummary.vlfr,
      statusCounts,
      ownerCoverage: cancelled.coverage,
    };

    branchCardsById.set(branchCard.branchId, branchCard);
    branchDetailsById.set(branchCard.branchId, {
      kind: "mapped_branch",
      branch: {
        branchId: branchCard.branchId,
        name: branchCard.name,
        chainName: branchCard.chainName,
        ordersVendorId: branchCard.ordersVendorId,
        availabilityVendorId: branchCard.availabilityVendorId,
        statusColor: branchCard.statusColor,
      },
      summary: detailSummary,
      statusCounts,
      ownerCoverage: cancelled.coverage,
      onHoldOrders: flowOrders.onHoldOrders,
      unassignedOrders: flowOrders.unassignedOrders,
      inPrepOrders: flowOrders.inPrepOrders,
      readyToPickupOrders: flowOrders.readyToPickupOrders,
      cancelledOrders: cancelled.sortedCancelledOrders,
      vendorOwnerCancelledOrders: cancelled.vendorOwnerCancelledOrders,
      unknownOwnerCancelledOrders: cancelled.unknownOwnerCancelledOrders,
      pickers: emptyPickers(),
      fetchedAt,
      cacheState,
    });
  }

  for (const [chainName, branchIds] of chainBranchIds.entries()) {
    const branches = branchIds
      .map((branchId) => branchCardsById.get(branchId))
      .filter((item): item is PerformanceBranchCard => Boolean(item))
      .sort(comparePerformanceCards);

    const chainCancelledOrders = branches.flatMap((branch) => branchDetailsById.get(branch.branchId)?.cancelledOrders ?? []);
    const coverage = buildPerformanceOwnerCoverage(chainCancelledOrders);
    const totalOrders = branches.reduce((sum, branch) => sum + branch.totalOrders, 0);
    const vendorOwnerCancelledCount = branches.reduce((sum, branch) => sum + branch.vendorOwnerCancelledCount, 0);
    const transportOwnerCancelledCount = branches.reduce((sum, branch) => sum + branch.transportOwnerCancelledCount, 0);

    chainGroups.set(chainName, {
      chainName,
      branchCount: branches.length,
      totalOrders,
      vendorOwnerCancelledCount,
      transportOwnerCancelledCount,
      vfr: calculateVfr(vendorOwnerCancelledCount, totalOrders),
      lfr: calculateLfr(transportOwnerCancelledCount, totalOrders),
      vlfr: calculateVlfr(vendorOwnerCancelledCount, transportOwnerCancelledCount, totalOrders),
      ownerCoverage: coverage,
      branches,
    });
  }

  const unmappedVendors = Array.from(unmappedVendorByKey.values())
    .map<PerformanceUnmappedVendorCard>((aggregate) => {
      const cancelled = buildAggregateCoverage(aggregate.cancelledOrders);
      const deliveryMode = resolveDeliveryMode(aggregate, cancelled.coverage.transportOwnerCancelledCount);
      const lfrApplicable = isLfrApplicable(deliveryMode);
      const statusCounts = sortStatusCounts(aggregate.statusCounts);
      const vendorCard: PerformanceUnmappedVendorCard = {
        kind: "unmapped_vendor",
        vendorId: aggregate.vendorId,
        vendorName: aggregate.vendorName,
        globalEntityId: aggregate.globalEntityId,
        statusColor: aggregate.statusColor,
        totalOrders: aggregate.totalOrders,
        vendorOwnerCancelledCount: cancelled.coverage.vendorOwnerCancelledCount,
        transportOwnerCancelledCount: cancelled.coverage.transportOwnerCancelledCount,
        vfr: calculateVfr(cancelled.coverage.vendorOwnerCancelledCount, aggregate.totalOrders),
        lfr: calculateBranchLfr(cancelled.coverage.transportOwnerCancelledCount, aggregate.totalOrders, lfrApplicable),
        vlfr: calculateBranchVlfr(
          cancelled.coverage.vendorOwnerCancelledCount,
          cancelled.coverage.transportOwnerCancelledCount,
          aggregate.totalOrders,
          lfrApplicable,
        ),
        statusCounts,
        ownerCoverage: cancelled.coverage,
      };

      return vendorCard;
    })
    .sort((left, right) => comparePerformanceCards(
      {
        name: left.vendorName,
        vlfr: left.vlfr,
        vendorOwnerCancelledCount: left.vendorOwnerCancelledCount,
        transportOwnerCancelledCount: left.transportOwnerCancelledCount,
        totalOrders: left.totalOrders,
      },
      {
        name: right.vendorName,
        vlfr: right.vlfr,
        vendorOwnerCancelledCount: right.vendorOwnerCancelledCount,
        transportOwnerCancelledCount: right.transportOwnerCancelledCount,
        totalOrders: right.totalOrders,
      },
    ));

  const globalOwnerCoverage = buildPerformanceOwnerCoverage(globalCancelledOrders);
  const summaryActiveOrders = entityBranches.reduce((sum, branch) => sum + branch.activeOrders, 0);
  const summaryLateOrders = entityBranches.reduce((sum, branch) => sum + branch.lateNow, 0);
  const summaryOnHoldOrders = entityBranches.reduce((sum, branch) => sum + branch.onHoldOrders, 0);
  const summaryUnassignedOrders = entityBranches.reduce((sum, branch) => sum + branch.unassignedOrders, 0);
  const summaryInPrepOrders = entityBranches.reduce((sum, branch) => sum + branch.inPrepOrders, 0);
  const summaryReadyToPickupOrders = entityBranches.reduce((sum, branch) => sum + branch.readyToPickupOrders, 0);
  const summaryVendorOwnerCancelledCount = entityBranches.reduce(
    (sum, branch) => sum + branch.vendorOwnerCancelledCount,
    0,
  );
  const summaryTransportOwnerCancelledCount = entityBranches.reduce(
    (sum, branch) => sum + (branch.lfrApplicable ? branch.transportOwnerCancelledCount : 0),
    0,
  );
  const chains = Array.from(chainGroups.values()).sort((left, right) =>
    comparePerformanceCards(
      {
        name: left.chainName,
        vlfr: left.vlfr,
        vendorOwnerCancelledCount: left.vendorOwnerCancelledCount,
        transportOwnerCancelledCount: left.transportOwnerCancelledCount,
        totalOrders: left.totalOrders,
      },
      {
        name: right.chainName,
        vlfr: right.vlfr,
        vendorOwnerCancelledCount: right.vendorOwnerCancelledCount,
        transportOwnerCancelledCount: right.transportOwnerCancelledCount,
        totalOrders: right.totalOrders,
      },
    ),
  );

  return {
    summary: {
      scope: params.scope,
      cards: {
        branchCount: entityBranches.length,
        totalOrders: params.rows.length,
        totalCancelledOrders: globalOwnerCoverage.totalCancelledOrders,
        activeOrders: summaryActiveOrders,
        lateNow: summaryLateOrders,
        onHoldOrders: summaryOnHoldOrders,
        unassignedOrders: summaryUnassignedOrders,
        inPrepOrders: summaryInPrepOrders,
        readyToPickupOrders: summaryReadyToPickupOrders,
        vfr: calculateVfr(summaryVendorOwnerCancelledCount, params.rows.length),
        lfr: calculateLfr(summaryTransportOwnerCancelledCount, params.rows.length),
        vlfr: calculateVlfr(
          summaryVendorOwnerCancelledCount,
          summaryTransportOwnerCancelledCount,
          params.rows.length,
        ),
        vendorOwnerCancelledCount: summaryVendorOwnerCancelledCount,
        transportOwnerCancelledCount: summaryTransportOwnerCancelledCount,
      },
      branches: entityBranches,
      statusCounts: sortStatusCounts(globalStatusCounts),
      ownerCoverage: globalOwnerCoverage,
      chains,
      unmappedVendors,
      fetchedAt,
      cacheState,
    },
    branchDetailsById,
    vendorDetailsById,
  };
}

export function buildPerformanceDataset(params: {
  dayKey?: string;
  globalEntityId?: string;
  branches: ResolvedBranchMapping[];
  rows: PerformanceMirrorRow[];
  statusColorByBranchId?: Map<number, StatusColor>;
  fetchedAt?: string | null;
  cacheState?: PerformanceSummaryResponse["cacheState"];
}) {
  return aggregatePerformanceData({
    scope: resolvePerformanceScope(params.dayKey),
    globalEntityId: params.globalEntityId ?? getGlobalEntityId(),
    branches: params.branches,
    rows: params.rows,
    statusColorByBranchId: params.statusColorByBranchId,
    fetchedAt: params.fetchedAt,
    cacheState: params.cacheState,
  });
}

export async function getPerformanceSummary(statusColorByBranchId?: Map<number, StatusColor>) {
  const globalEntityId = getGlobalEntityId();
  const scope = resolvePerformanceScope();
  const branches = listResolvedBranches();
  const syncStatus = getOrdersMirrorEntitySyncStatus({
    dayKey: scope.dayKey,
    globalEntityId,
  });

  return aggregatePerformanceData({
    scope,
    globalEntityId,
    branches,
    rows: loadPerformanceRows(scope.dayKey, globalEntityId),
    statusColorByBranchId,
    fetchedAt: syncStatus.fetchedAt,
    cacheState: syncStatus.cacheState,
  }).summary;
}

export async function getPerformanceBranchDetail(
  branchId: number,
  statusColorByBranchId?: Map<number, StatusColor>,
) {
  const branch = getResolvedBranchById(branchId);
  if (!branch) return null;

  const globalEntityId = branch.globalEntityId;
  const scope = resolvePerformanceScope();
  const syncStatus = getOrdersMirrorEntitySyncStatus({
    dayKey: scope.dayKey,
    globalEntityId,
  });
  const dataset = aggregatePerformanceData({
    scope,
    globalEntityId,
    branches: [branch],
    rows: loadPerformanceRows(scope.dayKey, globalEntityId).filter((row) => row.vendorId === branch.ordersVendorId),
    statusColorByBranchId,
    fetchedAt: syncStatus.fetchedAt,
    cacheState: syncStatus.cacheState,
  });
  const detail = dataset.branchDetailsById.get(branchId) ?? null;
  if (!detail) return null;

  const pickers = getMirrorBranchPickers({
    dayKey: scope.dayKey,
    globalEntityId,
    vendorId: branch.ordersVendorId,
    ordersRefreshSeconds: getSettings().ordersRefreshSeconds,
  });

  return {
    ...detail,
    pickers: pickers.pickers,
  };
}

export async function getPerformanceVendorDetail(vendorId: number) {
  const globalEntityId = getGlobalEntityId();
  const scope = resolvePerformanceScope();
  const syncStatus = getOrdersMirrorEntitySyncStatus({
    dayKey: scope.dayKey,
    globalEntityId,
  });
  const dataset = aggregatePerformanceData({
    scope,
    globalEntityId,
    branches: listResolvedBranches(),
    rows: loadPerformanceRows(scope.dayKey, globalEntityId).filter((row) => row.vendorId === vendorId),
    fetchedAt: syncStatus.fetchedAt,
    cacheState: syncStatus.cacheState,
  });
  const detail = dataset.vendorDetailsById.get(vendorId) ?? null;
  if (!detail) return null;

  const pickers = getMirrorBranchPickers({
    dayKey: scope.dayKey,
    globalEntityId,
    vendorId,
    ordersRefreshSeconds: getSettings().ordersRefreshSeconds,
  });

  return {
    ...detail,
    pickers: pickers.pickers,
  };
}

export { extractCancellationDetail, extractCancellationOwner, extractTransportType };
