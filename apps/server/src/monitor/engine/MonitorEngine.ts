import { DateTime } from "luxon";
import type {
  AvailabilityRecord,
  BranchMapping,
  CloseReason,
  DashboardSnapshot,
  MonitorIssueSource,
  MonitorSourceError,
  OrdersMetrics,
  ResolvedBranchMapping,
  Settings,
} from "../../types/models.js";
import { getSettings } from "../../services/settingsStore.js";
import { listBranches, listResolvedBranches, getRuntime, setRuntime } from "../../services/branchStore.js";
import { fetchAvailabilities, setAvailability } from "../../services/availabilityClient.js";
import { log } from "../../services/logger.js";
import { markCloseEventReopened, recordMonitorCloseAction } from "../../services/actionReportStore.js";
import {
  getCurrentHourPlacedCountByVendor,
  getMirrorBranchDetail,
  syncOrdersMirror,
} from "../../services/ordersMirrorStore.js";
import { derivePreparingNow } from "../../services/orders/classification.js";
import { decide } from "../../services/policyEngine.js";
import { Mutex } from "../../utils/mutex.js";
import { nowUtcIso } from "../../utils/time.js";
import { resolveOrdersStaleMultiplier } from "../../services/orders/shared.js";
import { MonitorCycleCoordinator, type CycleOptions, type ScheduledSource } from "./cycleCoordinator.js";
import { closeReasonLogTag, currentPreparation, type OrdersPressureSummary } from "./monitorState.js";
import { buildMonitorSnapshot } from "./snapshotBuilder.js";
import { MonitorRuntimeTracker, type RuntimeRow } from "./runtimeTracking.js";
import { getMonitorErrorDetail } from "./upstreamErrorSummary.js";

export class MonitorEngine {
  private ordersByVendor = new Map<number, OrdersMetrics>();
  private preparationByVendor = new Map<number, OrdersPressureSummary>();
  private currentHourPlacedByVendor = new Map<number, number>();
  private ordersDataStateByVendor = new Map<number, "fresh" | "stale" | "warming">();
  private ordersLastSyncedAtByVendor = new Map<number, string | undefined>();
  private availabilityByVendor = new Map<string, AvailabilityRecord>();

  private running = false;
  private degraded = false;
  private ordersFresh = false;
  private errors: { orders?: MonitorSourceError; availability?: MonitorSourceError } = {};

  private lastOrdersFetchAt: string | undefined;
  private lastAvailabilityFetchAt: string | undefined;
  private lastHealthyAt: string | undefined;
  private ordersLastSuccessfulSyncAt: string | undefined;
  private staleOrdersBranchCount = 0;
  private consecutiveOrdersSourceFailures = 0;
  private lifecycleId = 0;
  private manualOrdersRefreshPromise: Promise<void> | null = null;

  private jobMutex = new Mutex();
  private actionMutex = new Mutex();
  private runtimeTracker = new MonitorRuntimeTracker();
  private cycleCoordinator = new MonitorCycleCoordinator({
    isActive: (expectedLifecycleId?: number) => this.isLifecycleActive(expectedLifecycleId),
    getIntervalMs: (source: ScheduledSource) => this.getCycleIntervalMs(source),
    runCycle: (source: ScheduledSource, options?: CycleOptions, expectedLifecycleId?: number) =>
      source === "orders"
        ? this.runOrdersCycle(options, expectedLifecycleId)
        : this.runAvailabilityCycle(options, expectedLifecycleId),
  });

  private subscribers = new Set<(snapshot: DashboardSnapshot) => void>();

  subscribe(fn: (snapshot: DashboardSnapshot) => void) {
    this.subscribers.add(fn);
    fn(this.getSnapshot());
    return () => this.subscribers.delete(fn);
  }

  publishSnapshot() {
    this.publish();
  }

  resetBranchTransientState(branch: BranchMapping) {
    if (typeof branch.ordersVendorId === "number") {
      this.ordersByVendor.delete(branch.ordersVendorId);
      this.preparationByVendor.delete(branch.ordersVendorId);
      this.currentHourPlacedByVendor.delete(branch.ordersVendorId);
    }
    this.availabilityByVendor.delete(branch.availabilityVendorId);
    setRuntime(branch.id, {
      lastUpuseCloseUntil: null,
      lastUpuseCloseReason: null,
      lastUpuseCloseAt: null,
      lastUpuseCloseEventId: null,
      lastExternalCloseUntil: null,
      lastExternalCloseAt: null,
      closureOwner: null,
      closureObservedUntil: null,
      closureObservedAt: null,
      externalOpenDetectedAt: null,
      lastActionAt: null,
    });
    this.publish();
  }

  private publish() {
    const snap = this.getSnapshot();
    for (const fn of this.subscribers) fn(snap);
  }

  private nextLifecycleId() {
    this.lifecycleId += 1;
    return this.lifecycleId;
  }

  private isLifecycleCurrent(expectedLifecycleId?: number) {
    return expectedLifecycleId == null || this.lifecycleId === expectedLifecycleId;
  }

  private isLifecycleActive(expectedLifecycleId?: number) {
    return this.running && this.isLifecycleCurrent(expectedLifecycleId);
  }

  private getCycleIntervalMs(source: ScheduledSource) {
    const settings = getSettings();
    return source === "orders"
      ? settings.ordersRefreshSeconds * 1000
      : settings.availabilityRefreshSeconds * 1000;
  }

  private getAvailabilityOffsetMs() {
    const availabilityMs = this.getCycleIntervalMs("availability");
    return Math.min(15000, Math.floor(availabilityMs / 2));
  }

  private getExpectedAvailabilityVendorIds() {
    return listResolvedBranches({ enabledOnly: true }).map((branch) => branch.availabilityVendorId);
  }

  private clearScheduleHandles() {
    this.cycleCoordinator.clearAll();
  }

  private requestScheduledCycle(source: ScheduledSource, expectedLifecycleId?: number, options?: CycleOptions) {
    return this.cycleCoordinator.request(source, expectedLifecycleId, options);
  }

  isRunning() {
    return this.running;
  }

  async refreshOrdersNow() {
    if (!this.running) {
      return {
        ok: false,
        running: false,
        message: "Monitoring is not running",
        snapshot: this.getSnapshot(),
      };
    }

    if (this.manualOrdersRefreshPromise) {
      return {
        ok: true,
        running: true,
        inProgress: true,
        message: "Orders refresh is already running",
        snapshot: this.getSnapshot(),
      };
    }

    const expectedLifecycleId = this.lifecycleId;
    const cyclePromise = this.requestScheduledCycle("orders", expectedLifecycleId, { forceOrdersSync: true })
      .finally(() => {
        if (this.manualOrdersRefreshPromise === cyclePromise) {
          this.manualOrdersRefreshPromise = null;
        }
      });

    this.manualOrdersRefreshPromise = cyclePromise;

    const completedQuickly = await Promise.race([
      cyclePromise.then(() => true),
      new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 1500)),
    ]);

    const snapshot = this.getSnapshot();
    const ordersError = snapshot.monitoring.errors?.orders;

    if (completedQuickly && ordersError) {
      return {
        ok: false,
        running: true,
        message: ordersError.message,
        snapshot,
      };
    }

    return {
      ok: true,
      running: true,
      inProgress: !completedQuickly,
      message: completedQuickly ? undefined : "Orders refresh started in background",
      snapshot,
    };
  }

  private syncDegraded() {
    this.degraded = Boolean(this.errors.orders || this.errors.availability);
  }

  private clearSourceError(source: MonitorIssueSource) {
    if (!this.errors[source]) return;
    delete this.errors[source];
    this.syncDegraded();
  }

  private getErrorDetail(error: unknown) {
    return getMonitorErrorDetail(error);
  }

  private setSourceError(source: MonitorIssueSource, context: string, error: unknown) {
    const { statusCode, detail } = this.getErrorDetail(error);
    const base = statusCode ? `${context} (HTTP ${statusCode})` : context;
    const message = detail && detail !== base ? `${base}: ${detail}` : base;

    this.errors[source] = {
      source,
      message,
      at: nowUtcIso(),
      statusCode,
    };
    this.syncDegraded();
    log(null, "ERROR", message);
  }

  private currentPreparation(
    preparation?: Partial<OrdersPressureSummary> & { lastHourPickers?: number },
    recentActiveAvailableFallback = false,
  ): OrdersPressureSummary {
    return currentPreparation(preparation, recentActiveAvailableFallback);
  }

  private resolveThresholds(
    branch: Pick<
      BranchMapping,
      | "chainName"
      | "lateThresholdOverride"
      | "lateReopenThresholdOverride"
      | "unassignedThresholdOverride"
      | "unassignedReopenThresholdOverride"
      | "readyThresholdOverride"
      | "readyReopenThresholdOverride"
      | "capacityRuleEnabledOverride"
      | "capacityPerHourEnabledOverride"
      | "capacityPerHourLimitOverride"
    >,
    settings: Settings,
  ) {
    return this.runtimeTracker.resolveThresholds(branch, settings);
  }

  private inferMonitorCloseReason(
    branch: ResolvedBranchMapping,
    metrics: OrdersMetrics,
    settings: Settings,
    currentHourPlacedCount: number,
    recentActivePickers: number,
    recentActiveAvailable: boolean,
  ): CloseReason | undefined {
    return this.runtimeTracker.inferMonitorCloseReason(
      branch,
      metrics,
      settings,
      currentHourPlacedCount,
      recentActivePickers,
      recentActiveAvailable,
    );
  }

  private hasTrustedMonitorRuntime(runtime: RuntimeRow | undefined, settings: Settings) {
    return this.runtimeTracker.hasTrustedMonitorRuntime(runtime, settings);
  }

  private isTrackedUpuseClosure(runtime: RuntimeRow | undefined, closedUntil?: string) {
    return this.runtimeTracker.isTrackedUpuseClosure(runtime, closedUntil);
  }

  private matchesExpectedMonitorCloseWindow(runtime: RuntimeRow | undefined, closedUntil?: string) {
    return this.runtimeTracker.matchesExpectedMonitorCloseWindow(runtime, closedUntil);
  }

  private isObservedClosureMatch(runtime: RuntimeRow | undefined, closedUntil?: string) {
    return this.runtimeTracker.isObservedClosureMatch(runtime, closedUntil);
  }

  private isMonitorOwnedClosure(runtime: RuntimeRow | undefined, availability?: AvailabilityRecord) {
    return this.runtimeTracker.isMonitorOwnedClosure(runtime, availability);
  }

  private hasActiveTrackedMonitorWindow(runtime: RuntimeRow | undefined, nowIso: string) {
    return this.runtimeTracker.hasActiveTrackedMonitorWindow(runtime, nowIso);
  }

  private inferCloseStartedAt(closedUntil: string | undefined, durationMinutes: number) {
    return this.runtimeTracker.inferCloseStartedAt(closedUntil, durationMinutes);
  }

  private inferObservedExternalCloseStartedAt(runtime: RuntimeRow | undefined, closedUntil: string | undefined) {
    return this.runtimeTracker.inferObservedExternalCloseStartedAt(runtime, closedUntil);
  }

  private buildClearedMonitorRuntimePatch(runtime: RuntimeRow | undefined) {
    return this.runtimeTracker.buildClearedMonitorRuntimePatch(runtime);
  }

  private buildClearedClosureObservationPatch(runtime: RuntimeRow | undefined) {
    return this.runtimeTracker.buildClearedClosureObservationPatch(runtime);
  }

  private syncTrackedMonitorRuntime(
    branch: ResolvedBranchMapping,
    metrics: OrdersMetrics,
    currentHourPlacedCount: number,
    recentActivePickers: number,
    recentActiveAvailable: boolean,
    runtime: RuntimeRow | undefined,
    closedUntil: string,
    nowIso: string,
    settings: Settings,
  ) {
    return this.runtimeTracker.syncTrackedMonitorRuntime(
      branch,
      metrics,
      currentHourPlacedCount,
      recentActivePickers,
      recentActiveAvailable,
      runtime,
      closedUntil,
      nowIso,
      settings,
    );
  }

  private syncExternalTemporaryClosureRuntime(
    branch: ResolvedBranchMapping,
    runtime: RuntimeRow | undefined,
    externalClosedUntil: string,
    nowIso: string,
    clearTrackedMonitorRuntime: boolean,
  ) {
    return this.runtimeTracker.syncExternalTemporaryClosureRuntime(
      branch,
      runtime,
      externalClosedUntil,
      nowIso,
      clearTrackedMonitorRuntime,
    );
  }

  private extractClosedUntilCandidate(payload: unknown): string | undefined {
    return this.runtimeTracker.extractClosedUntilCandidate(payload);
  }

  private syncExternalClosureState(nowIso: string) {
    this.runtimeTracker.syncExternalClosureState({
      availabilityByVendor: this.availabilityByVendor,
      ordersByVendor: this.ordersByVendor,
      preparationByVendor: this.preparationByVendor,
      currentHourPlacedByVendor: this.currentHourPlacedByVendor,
      ordersDataStateByVendor: this.ordersDataStateByVendor,
    }, nowIso);
  }

  getSnapshot(): DashboardSnapshot {
    return buildMonitorSnapshot({
      running: this.running,
      degraded: this.degraded,
      errors: this.errors,
      lastOrdersFetchAt: this.lastOrdersFetchAt,
      lastAvailabilityFetchAt: this.lastAvailabilityFetchAt,
      lastHealthyAt: this.lastHealthyAt,
      ordersLastSuccessfulSyncAt: this.ordersLastSuccessfulSyncAt,
      staleOrdersBranchCount: this.staleOrdersBranchCount,
      consecutiveOrdersSourceFailures: this.consecutiveOrdersSourceFailures,
      ordersByVendor: this.ordersByVendor,
      availabilityByVendor: this.availabilityByVendor,
      preparationByVendor: this.preparationByVendor,
      currentHourPlacedByVendor: this.currentHourPlacedByVendor,
      ordersDataStateByVendor: this.ordersDataStateByVendor,
      ordersLastSyncedAtByVendor: this.ordersLastSyncedAtByVendor,
    }, this.runtimeTracker);
  }

  async start() {
    if (this.running) return;
    const lifecycleId = this.nextLifecycleId();
    this.running = true;
    this.errors = {};
    this.syncDegraded();
    log(null, "INFO", "Monitoring started");
    await this.prime(lifecycleId);
    if (!this.isLifecycleActive(lifecycleId)) return;
    this.schedule(false, lifecycleId);
  }

  stop() {
    this.nextLifecycleId();
    this.running = false;
    this.ordersFresh = false;
    this.manualOrdersRefreshPromise = null;
    this.errors = {};
    this.ordersByVendor.clear();
    this.preparationByVendor.clear();
    this.currentHourPlacedByVendor.clear();
    this.availabilityByVendor.clear();
    this.lastOrdersFetchAt = undefined;
    this.lastAvailabilityFetchAt = undefined;
    this.lastHealthyAt = undefined;
    this.ordersDataStateByVendor.clear();
    this.ordersLastSyncedAtByVendor.clear();
    this.ordersLastSuccessfulSyncAt = undefined;
    this.staleOrdersBranchCount = 0;
    this.consecutiveOrdersSourceFailures = 0;
    this.syncDegraded();
    this.clearScheduleHandles();
    log(null, "INFO", "Monitoring stopped");
    this.publish();
  }

  private schedule(runImmediately = true, lifecycleId?: number) {
    this.clearScheduleHandles();
    this.cycleCoordinator.arm("orders", runImmediately ? 0 : this.getCycleIntervalMs("orders"), lifecycleId);
    this.cycleCoordinator.arm(
      "availability",
      runImmediately ? this.getAvailabilityOffsetMs() : this.getAvailabilityOffsetMs() + this.getCycleIntervalMs("availability"),
      lifecycleId,
    );
  }

  private async prime(lifecycleId?: number) {
    // Best effort initial fetch
    await Promise.allSettled([
      this.runOrdersCycle({ suppressPublish: true }, lifecycleId),
      this.runAvailabilityCycle({ suppressPublish: true }, lifecycleId),
    ]);
    if (!this.isLifecycleActive(lifecycleId)) return;
    this.publish();
  }

  private async runOrdersCycle(options?: CycleOptions, expectedLifecycleId?: number) {
    if (!this.isLifecycleActive(expectedLifecycleId)) return;

    await this.jobMutex.runExclusive(async () => {
      if (!this.isLifecycleActive(expectedLifecycleId)) return;
      const settings = getSettings();
      const branches = listResolvedBranches({ enabledOnly: true });
      if (!branches.length) {
        if (!this.isLifecycleCurrent(expectedLifecycleId)) return;
        this.ordersByVendor.clear();
        this.preparationByVendor.clear();
        this.currentHourPlacedByVendor.clear();
        this.ordersDataStateByVendor.clear();
        this.ordersLastSyncedAtByVendor.clear();
        this.staleOrdersBranchCount = 0;
        this.ordersLastSuccessfulSyncAt = undefined;
        this.consecutiveOrdersSourceFailures = 0;
        this.clearSourceError("orders");
        if (!options?.suppressPublish && this.isLifecycleCurrent(expectedLifecycleId)) {
          this.publish();
        }
        return;
      }

      try {
        const summary = await syncOrdersMirror({
          token: settings.ordersToken,
          branches,
          ordersRefreshSeconds: settings.ordersRefreshSeconds,
          force: options?.forceOrdersSync,
        });
        if (!this.isLifecycleActive(expectedLifecycleId)) return;

        const mergedOrdersByVendor = new Map<number, OrdersMetrics>();
        const mergedPreparationByVendor = new Map<number, OrdersPressureSummary>();
        const mergedCurrentHourPlacedByVendor = getCurrentHourPlacedCountByVendor({
          globalEntityId: settings.globalEntityId,
          vendorIds: branches.map((branch) => branch.ordersVendorId),
        });
        const mergedDataStateByVendor = new Map<number, "fresh" | "stale" | "warming">();
        const mergedLastSyncedAtByVendor = new Map<number, string | undefined>();

        for (const branch of branches) {
          const detail = getMirrorBranchDetail({
            globalEntityId: branch.globalEntityId,
            vendorId: branch.ordersVendorId,
            ordersRefreshSeconds: settings.ordersRefreshSeconds,
            includePickerItems: false,
            dayKey: summary.dayKey,
          });

          mergedOrdersByVendor.set(branch.ordersVendorId, detail.metrics);
          mergedPreparationByVendor.set(branch.ordersVendorId, {
            preparingNow: detail.metrics.preparingNow ?? derivePreparingNow(detail.metrics),
            preparingPickersNow: detail.pickers.activePreparingCount,
            recentActivePickers: detail.pickers.recentActiveCount,
            recentActiveAvailable: detail.cacheState === "fresh",
          });
          mergedDataStateByVendor.set(branch.ordersVendorId, detail.cacheState);
          mergedLastSyncedAtByVendor.set(branch.ordersVendorId, detail.fetchedAt ?? undefined);
        }

        if (!this.isLifecycleActive(expectedLifecycleId)) return;
        this.ordersByVendor = mergedOrdersByVendor;
        this.preparationByVendor = mergedPreparationByVendor;
        this.currentHourPlacedByVendor = mergedCurrentHourPlacedByVendor;
        this.ordersDataStateByVendor = mergedDataStateByVendor;
        this.ordersLastSyncedAtByVendor = mergedLastSyncedAtByVendor;
        this.ordersFresh = true;
        this.ordersLastSuccessfulSyncAt = summary.lastSuccessfulSyncAt ?? this.ordersLastSuccessfulSyncAt;
        this.lastOrdersFetchAt = summary.lastSuccessfulSyncAt ?? this.lastOrdersFetchAt;
        this.staleOrdersBranchCount = branches.filter(
          (branch) => mergedDataStateByVendor.get(branch.ordersVendorId) === "stale",
        ).length;

        const staleMultiplier = resolveOrdersStaleMultiplier();
        const staleRatio = branches.length ? this.staleOrdersBranchCount / branches.length : 0;
        const hardFailure = summary.updatedVendors === 0 && summary.failedVendors > 0;
        this.consecutiveOrdersSourceFailures = hardFailure ? this.consecutiveOrdersSourceFailures + 1 : 0;

        const shouldExposeOrdersError =
          this.consecutiveOrdersSourceFailures >= staleMultiplier ||
          (this.staleOrdersBranchCount > 0 && staleRatio > 0.25);

        if (shouldExposeOrdersError) {
          const primaryError = summary.errors[0];
          this.errors.orders = {
            source: "orders",
            message: primaryError
              ? primaryError.statusCode
                ? `Orders API request failed (HTTP ${primaryError.statusCode}): ${primaryError.message}`
                : `Orders API request failed: ${primaryError.message}`
              : "Orders data is stale across multiple branches.",
            at: nowUtcIso(),
            statusCode: primaryError?.statusCode,
          };
          this.syncDegraded();
        } else {
          this.clearSourceError("orders");
        }

        this.markHealthy();
        await this.reconcile("orders", expectedLifecycleId);
      } catch (error: unknown) {
        if (!this.isLifecycleCurrent(expectedLifecycleId)) return;
        this.ordersFresh = false;
        this.consecutiveOrdersSourceFailures += 1;
        this.setSourceError("orders", "Orders API request failed", error);
      } finally {
        if (!options?.suppressPublish && this.isLifecycleCurrent(expectedLifecycleId)) {
          this.publish();
        }
      }
    });
  }

  private async runAvailabilityCycle(options?: CycleOptions, expectedLifecycleId?: number) {
    if (!this.isLifecycleActive(expectedLifecycleId)) return;

    await this.jobMutex.runExclusive(async () => {
      if (!this.isLifecycleActive(expectedLifecycleId)) return;
      const settings = getSettings();
      try {
        const rows = await fetchAvailabilities(settings.availabilityToken, {
          expectedVendorIds: this.getExpectedAvailabilityVendorIds(),
        });
        if (!this.isLifecycleActive(expectedLifecycleId)) return;
        this.availabilityByVendor = new Map(rows.map((r) => [r.platformRestaurantId, r]));
        this.syncExternalClosureState(nowUtcIso());
        this.clearSourceError("availability");
        this.lastAvailabilityFetchAt = nowUtcIso();
        this.markHealthy();
        await this.reconcile("availability", expectedLifecycleId);
      } catch (error: unknown) {
        if (!this.isLifecycleCurrent(expectedLifecycleId)) return;
        this.setSourceError("availability", "Availability API request failed", error);
      } finally {
        if (!options?.suppressPublish && this.isLifecycleCurrent(expectedLifecycleId)) {
          this.publish();
        }
      }
    });
  }

  private markHealthy() {
    this.lastHealthyAt = nowUtcIso();
  }

  private async reconcile(trigger: "orders" | "availability", expectedLifecycleId?: number) {
    if (!this.ordersFresh || !this.isLifecycleActive(expectedLifecycleId)) return;

    const settings = getSettings();
    const branches = listResolvedBranches({ enabledOnly: true });
    const nowIso = nowUtcIso();
    let actionAvailability: Map<string, AvailabilityRecord> | null =
      trigger === "availability" ? new Map(this.availabilityByVendor) : null;
    let shouldRefreshAvailabilityAfterActions = false;

    const ensureActionAvailability = async () => {
      if (actionAvailability) return actionAvailability;
      actionAvailability = await this.fetchAvailabilityFresh(expectedLifecycleId);
      return actionAvailability;
    };

    for (const branch of branches) {
      if (!this.isLifecycleActive(expectedLifecycleId)) return;
      const ordersDataState = this.ordersDataStateByVendor.get(branch.ordersVendorId) ?? "warming";
      if (ordersDataState !== "fresh") {
        continue;
      }
      const metrics = this.ordersByVendor.get(branch.ordersVendorId) ?? {
        totalToday: 0,
        cancelledToday: 0,
        doneToday: 0,
        activeNow: 0,
        lateNow: 0,
        unassignedNow: 0,
        readyNow: 0,
      };
      const currentHourPlacedCount = this.currentHourPlacedByVendor.get(branch.ordersVendorId) ?? 0;
      const preparation = this.currentPreparation(this.preparationByVendor.get(branch.ordersVendorId), true);

      const avCached = this.availabilityByVendor.get(branch.availabilityVendorId);
      let runtime = getRuntime(branch.id) ?? undefined;
      const trackedMonitorClosedUntil = runtime?.closureObservedUntil ?? runtime?.lastUpuseCloseUntil ?? undefined;

      if (
        avCached?.availabilityState === "CLOSED_UNTIL" &&
        this.isMonitorOwnedClosure(runtime, avCached) &&
        (avCached.closedUntil ?? trackedMonitorClosedUntil)
      ) {
        runtime = this.syncTrackedMonitorRuntime(
          branch,
          metrics,
          currentHourPlacedCount,
          preparation.recentActivePickers,
          preparation.recentActiveAvailable,
          runtime,
          avCached.closedUntil ?? trackedMonitorClosedUntil ?? "",
          nowIso,
          settings,
        );
      }

      if (
        avCached?.availabilityState === "OPEN" &&
        (runtime?.closureOwner === "UPUSE" ||
          (runtime?.closureOwner == null && this.hasTrustedMonitorRuntime(runtime, settings))) &&
        (runtime?.closureObservedUntil || runtime?.lastUpuseCloseUntil)
      ) {
        const lastCloseUntil = DateTime.fromISO(
          runtime?.closureObservedUntil ?? runtime?.lastUpuseCloseUntil ?? "",
          { zone: "utc" },
        );
        const now = DateTime.fromISO(nowIso, { zone: "utc" });
        if (lastCloseUntil.isValid && now >= lastCloseUntil) {
          if (runtime?.externalOpenDetectedAt) {
            log(branch.id, "INFO", "OPEN — tracked close window expired after external reopen");
          } else {
            markCloseEventReopened({
              eventId: runtime?.lastUpuseCloseEventId,
              reopenedAt: nowIso,
              mode: "SOURCE_TIMER",
              note: "Branch reopened automatically from source after closure timer ended",
            });
            log(branch.id, "INFO", "OPEN — source auto reopen after timer");
          }

          if (!this.isLifecycleActive(expectedLifecycleId)) return;
          setRuntime(branch.id, {
            ...this.buildClearedClosureObservationPatch(runtime),
            lastUpuseCloseUntil: null,
            lastUpuseCloseReason: null,
            lastUpuseCloseAt: null,
            lastUpuseCloseEventId: null,
            lastExternalCloseUntil: null,
            lastExternalCloseAt: null,
            externalOpenDetectedAt: null,
          });
          runtime = getRuntime(branch.id) ?? undefined;
        }
      }

      const decision = decide({
        branch,
        metrics,
        currentHourPlacedCount,
        recentActivePickers: preparation.recentActivePickers,
        recentActiveAvailable: preparation.recentActiveAvailable,
        availability: avCached,
        runtime: runtime ?? undefined,
        nowUtcIso: nowIso,
        settings,
      });

      if (decision.type === "MARK_EXTERNAL_OPEN") {
        if (!this.isLifecycleActive(expectedLifecycleId)) return;
        markCloseEventReopened({
          eventId: runtime?.lastUpuseCloseEventId,
          reopenedAt: nowIso,
          mode: "EXTERNAL_OPEN",
          note: "Branch reopened from source during monitored close window",
        });
        setRuntime(branch.id, { externalOpenDetectedAt: nowIso });
        log(branch.id, "WARN", "External open detected — grace started");
        continue;
      }

      if (decision.type === "NOOP") {
        // Clear stale external open marker when not applicable
        if (runtime?.externalOpenDetectedAt && !runtime?.lastUpuseCloseUntil) {
          if (!this.isLifecycleActive(expectedLifecycleId)) return;
          setRuntime(branch.id, { externalOpenDetectedAt: null });
        }
        continue;
      }

      // Cooldown: avoid spamming
      const lastActionAt = runtime?.lastActionAt ? DateTime.fromISO(runtime.lastActionAt, { zone: "utc" }) : null;
      if (lastActionAt && DateTime.fromISO(nowIso, { zone: "utc" }).diff(lastActionAt).as("seconds") < 20) {
        continue;
      }

      if (!this.isLifecycleActive(expectedLifecycleId)) return;
      await this.actionMutex.runExclusive(async () => {
        if (!this.isLifecycleActive(expectedLifecycleId)) return;
        const fresh = await ensureActionAvailability();
        if (!this.isLifecycleActive(expectedLifecycleId)) return;
        const current = fresh.get(branch.availabilityVendorId);
        if (!current) {
          log(branch.id, "WARN", "Skip action — availability missing");
          return;
        }

        if (decision.type === "CLOSE") {
          if (current.availabilityState !== "OPEN") return;

          if (!this.isLifecycleActive(expectedLifecycleId)) return;
          const actionRuntime = getRuntime(branch.id) ?? undefined;
          const isReappliedAfterExternalOpen = Boolean(actionRuntime?.externalOpenDetectedAt);

          if (!this.isLifecycleActive(expectedLifecycleId)) return;
          const mutationResult = await setAvailability({
            token: settings.availabilityToken,
            globalEntityId: branch.globalEntityId,
            availabilityVendorId: branch.availabilityVendorId,
            state: "TEMPORARY_CLOSURE",
            durationMinutes: settings.tempCloseMinutes,
          });
          if (!this.isLifecycleActive(expectedLifecycleId)) return;
          shouldRefreshAvailabilityAfterActions = true;
          const confirmedUntil = this.extractClosedUntilCandidate(mutationResult);
          const actualUntil =
            confirmedUntil ??
            DateTime.fromISO(nowIso, { zone: "utc" })
              .plus({ minutes: settings.tempCloseMinutes })
              .toISO({ suppressMilliseconds: false }) ??
            undefined;

          const updatedAvailability: AvailabilityRecord = {
            ...current,
            availabilityState: "CLOSED_UNTIL",
            platformRestaurantId: branch.availabilityVendorId,
            closedUntil: actualUntil,
            modifiedBy: "log_vendor_monitor",
          };
          fresh.set(branch.availabilityVendorId, updatedAvailability);
          this.availabilityByVendor.set(branch.availabilityVendorId, updatedAvailability);

          const confirmedUntilLabel = confirmedUntil
            ? DateTime.fromISO(confirmedUntil, { zone: "utc" }).setZone("Africa/Cairo").toFormat("HH:mm")
            : null;

          const closeEventId = recordMonitorCloseAction({
            branch,
            at: nowIso,
            reason: decision.reason,
            metrics,
            closedUntil: actualUntil,
            note: isReappliedAfterExternalOpen
              ? confirmedUntilLabel
                ? `Temporary closure re-applied after external open grace until ${confirmedUntilLabel} Cairo time`
                : "Temporary closure re-applied after external open grace"
              : confirmedUntilLabel
                ? `Temporary closure scheduled until ${confirmedUntilLabel} Cairo time`
                : undefined,
          });

          if (!this.isLifecycleActive(expectedLifecycleId)) return;
          setRuntime(branch.id, {
            lastUpuseCloseUntil: actualUntil,
            lastUpuseCloseReason: decision.reason,
            lastUpuseCloseAt: nowIso,
            lastUpuseCloseEventId: closeEventId,
            lastExternalCloseUntil: null,
            lastExternalCloseAt: null,
            closureOwner: "UPUSE",
            closureObservedUntil: actualUntil,
            closureObservedAt: nowIso,
            externalOpenDetectedAt: null,
            lastActionAt: nowIso,
          });

          const tag = closeReasonLogTag(decision.reason, metrics, preparation.recentActivePickers);
          log(
            branch.id,
            "INFO",
            isReappliedAfterExternalOpen
              ? confirmedUntilLabel
                ? `TEMP CLOSE — re-applied after external open grace (${tag}) until ${confirmedUntilLabel}`
                : `TEMP CLOSE — re-applied after external open grace (${tag})`
              : confirmedUntilLabel
                ? `TEMP CLOSE — ${tag} until ${confirmedUntilLabel}`
                : `TEMP CLOSE — ${tag}`,
          );
          return;
        }

        if (decision.type === "EARLY_OPEN") {
          if (current.availabilityState !== "CLOSED_UNTIL") return;

          if (!this.isLifecycleActive(expectedLifecycleId)) return;
          let rt = getRuntime(branch.id) ?? undefined;
          const ownsClosure = this.isMonitorOwnedClosure(rt, current);
          if (!ownsClosure) return;

          if (current.modifiedBy === "log_vendor_monitor" && current.closedUntil) {
            rt = this.syncTrackedMonitorRuntime(
              branch,
              metrics,
              currentHourPlacedCount,
              preparation.recentActivePickers,
              preparation.recentActiveAvailable,
              rt,
              current.closedUntil,
              nowIso,
              settings,
            );
          }

          if (!this.isLifecycleActive(expectedLifecycleId)) return;
          await setAvailability({
            token: settings.availabilityToken,
            globalEntityId: branch.globalEntityId,
            availabilityVendorId: branch.availabilityVendorId,
            state: "OPEN",
          });
          if (!this.isLifecycleActive(expectedLifecycleId)) return;
          shouldRefreshAvailabilityAfterActions = true;
          const updatedAvailability: AvailabilityRecord = {
            ...current,
            availabilityState: "OPEN",
            platformRestaurantId: branch.availabilityVendorId,
            closedUntil: undefined,
            modifiedBy: "log_vendor_monitor",
          };
          fresh.set(branch.availabilityVendorId, updatedAvailability);
          this.availabilityByVendor.set(branch.availabilityVendorId, updatedAvailability);

          markCloseEventReopened({
            eventId: rt?.lastUpuseCloseEventId,
            reopenedAt: nowIso,
            mode: "MONITOR_RECOVERED",
            note: "Trigger recovered to its reopen threshold and monitor reopened the branch",
          });

          if (!this.isLifecycleActive(expectedLifecycleId)) return;
          setRuntime(branch.id, {
            ...this.buildClearedClosureObservationPatch(rt),
            lastUpuseCloseUntil: null,
            lastUpuseCloseReason: null,
            lastUpuseCloseAt: null,
            lastUpuseCloseEventId: null,
            lastExternalCloseUntil: null,
            lastExternalCloseAt: null,
            externalOpenDetectedAt: null,
            lastActionAt: nowIso,
          });
          log(branch.id, "INFO", "OPEN — recovered to reopen threshold");
          return;
        }
      });
    }

    if (!shouldRefreshAvailabilityAfterActions || !this.isLifecycleActive(expectedLifecycleId)) return;

    try {
      await this.fetchAvailabilityFresh(expectedLifecycleId);
    } catch (error: unknown) {
      const detail = this.getErrorDetail(error).detail ?? "Unknown error";
      log(null, "WARN", `Availability confirmation refresh failed: ${detail}`);
    }
  }

  private async fetchAvailabilityFresh(expectedLifecycleId?: number) {
    if (!this.isLifecycleActive(expectedLifecycleId)) {
      return new Map(this.availabilityByVendor);
    }

    const settings = getSettings();
    const rows = await fetchAvailabilities(settings.availabilityToken, {
      expectedVendorIds: this.getExpectedAvailabilityVendorIds(),
    });
    if (!this.isLifecycleActive(expectedLifecycleId)) {
      return new Map(this.availabilityByVendor);
    }
    const map = new Map(rows.map((r) => [r.platformRestaurantId, r]));
    // Update cache too
    this.availabilityByVendor = map;
    this.lastAvailabilityFetchAt = nowUtcIso();
    if (this.isLifecycleCurrent(expectedLifecycleId)) {
      this.publish();
    }
    return map;
  }
}
