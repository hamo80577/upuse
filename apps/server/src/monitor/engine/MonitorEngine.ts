import { DateTime } from "luxon";
import type {
  AvailabilityRecord,
  BranchMapping,
  CloseReason,
  DashboardSnapshot,
  MonitorIssueSource,
  MonitorSourceError,
  OrdersMetrics,
  Settings,
} from "../../types/models.js";
import { getSettings } from "../../services/settingsStore.js";
import { listBranches, getRuntime, setRuntime } from "../../services/branchStore.js";
import { fetchOrdersAggregates } from "../../services/ordersClient.js";
import { fetchAvailabilities, setAvailability } from "../../services/availabilityClient.js";
import { log } from "../../services/logger.js";
import { markCloseEventReopened, recordMonitorCloseAction } from "../../services/actionReportStore.js";
import { createOrdersPollingPlan, createOrdersPollingRequests, resolveOrdersGlobalEntityId } from "../../services/monitorOrdersPolling.js";
import { decide } from "../../services/policyEngine.js";
import { resolveBranchThresholdProfile } from "../../services/thresholds.js";
import { Mutex } from "../../utils/mutex.js";
import { nowUtcIso } from "../../utils/time.js";

type RuntimeRow = ReturnType<typeof getRuntime>;
type RuntimePatch = Partial<NonNullable<RuntimeRow>>;
type CycleOptions = {
  suppressPublish?: boolean;
};

export class MonitorEngine {
  private ordersByVendor = new Map<number, OrdersMetrics>();
  private availabilityByVendor = new Map<string, AvailabilityRecord>();

  private running = false;
  private degraded = false;
  private ordersFresh = false;
  private errors: { orders?: MonitorSourceError; availability?: MonitorSourceError } = {};

  private lastOrdersFetchAt: string | undefined;
  private lastAvailabilityFetchAt: string | undefined;
  private lastHealthyAt: string | undefined;

  private ordersTimer: NodeJS.Timeout | null = null;
  private availabilityTimer: NodeJS.Timeout | null = null;
  private availabilityStartTimeout: NodeJS.Timeout | null = null;
  private immediateAvailabilityTimeout: NodeJS.Timeout | null = null;
  private lifecycleId = 0;
  private closedOrdersSnapshotDayByBranch = new Map<number, string>();
  private manualOrdersRefreshPromise: Promise<void> | null = null;

  private jobMutex = new Mutex();
  private actionMutex = new Mutex();

  private subscribers = new Set<(snapshot: DashboardSnapshot) => void>();

  subscribe(fn: (snapshot: DashboardSnapshot) => void) {
    this.subscribers.add(fn);
    fn(this.getSnapshot());
    return () => this.subscribers.delete(fn);
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

  private clearScheduleHandles() {
    if (this.ordersTimer) clearInterval(this.ordersTimer);
    if (this.availabilityTimer) clearInterval(this.availabilityTimer);
    if (this.availabilityStartTimeout) clearTimeout(this.availabilityStartTimeout);
    if (this.immediateAvailabilityTimeout) clearTimeout(this.immediateAvailabilityTimeout);
    this.ordersTimer = null;
    this.availabilityTimer = null;
    this.availabilityStartTimeout = null;
    this.immediateAvailabilityTimeout = null;
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
    const cyclePromise = this.runOrdersCycle(undefined, expectedLifecycleId)
      .catch(() => {})
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

  private getErrorDetail(e: any) {
    const statusCode = typeof e?.response?.status === "number" ? e.response.status : undefined;
    const responseData = e?.response?.data;
    const candidates = [
      responseData?.message,
      responseData?.error,
      responseData?.details?.message,
      e?.message,
    ];

    const detail = candidates.find((value) => typeof value === "string" && value.trim().length > 0)?.trim();
    return { statusCode, detail };
  }

  private setSourceError(source: MonitorIssueSource, context: string, e: any) {
    const { statusCode, detail } = this.getErrorDetail(e);
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

  private currentMetrics(metrics: OrdersMetrics): OrdersMetrics {
    if (this.ordersFresh) return metrics;
    return {
      ...metrics,
      activeNow: 0,
      lateNow: 0,
      unassignedNow: 0,
    };
  }

  private resolveThresholds(
    branch: Pick<BranchMapping, "chainName" | "lateThresholdOverride" | "unassignedThresholdOverride">,
    settings: Settings,
  ) {
    return resolveBranchThresholdProfile(branch, settings);
  }

  private inferMonitorCloseReason(branch: BranchMapping, metrics: OrdersMetrics, settings: Settings): CloseReason | undefined {
    const thresholds = this.resolveThresholds(branch, settings);
    const exceedLate = metrics.lateNow >= thresholds.lateThreshold && thresholds.lateThreshold > 0;
    const exceedUnassigned = metrics.unassignedNow >= thresholds.unassignedThreshold && thresholds.unassignedThreshold > 0;

    if (exceedLate) return "LATE";
    if (exceedUnassigned) return "UNASSIGNED";
    return undefined;
  }

  private isTrackedUpuseClosure(runtime: RuntimeRow | undefined, closedUntil?: string) {
    if (!closedUntil) return false;
    const lastUntil = runtime?.lastUpuseCloseUntil;
    if (!lastUntil) return false;

    const dt1 = DateTime.fromISO(lastUntil, { zone: "utc" });
    const dt2 = DateTime.fromISO(closedUntil, { zone: "utc" });
    return Math.abs(dt1.diff(dt2).as("seconds")) <= 5;
  }

  private matchesExpectedMonitorCloseWindow(runtime: RuntimeRow | undefined, closedUntil?: string) {
    if (!closedUntil || !runtime?.lastUpuseCloseAt) return false;

    const settings = getSettings();
    const lastCloseAt = DateTime.fromISO(runtime.lastUpuseCloseAt, { zone: "utc" });
    const actualUntil = DateTime.fromISO(closedUntil, { zone: "utc" });
    if (!lastCloseAt.isValid || !actualUntil.isValid) return false;

    const expectedUntil = lastCloseAt.plus({ minutes: Math.max(1, settings.tempCloseMinutes) });
    const toleranceSeconds = Math.max(90, settings.availabilityRefreshSeconds + 30);
    return Math.abs(actualUntil.diff(expectedUntil).as("seconds")) <= toleranceSeconds;
  }

  private isMonitorOwnedClosure(runtime: RuntimeRow | undefined, availability?: AvailabilityRecord) {
    if (!availability || availability.availabilityState !== "CLOSED_UNTIL") return false;
    return (
      availability.modifiedBy === "log_vendor_monitor" ||
      this.isTrackedUpuseClosure(runtime, availability.closedUntil) ||
      this.matchesExpectedMonitorCloseWindow(runtime, availability.closedUntil)
    );
  }

  private hasActiveTrackedMonitorWindow(runtime: RuntimeRow | undefined, nowIso: string) {
    if (!runtime?.lastUpuseCloseUntil) return false;

    const now = DateTime.fromISO(nowIso, { zone: "utc" });
    const lastUntil = DateTime.fromISO(runtime.lastUpuseCloseUntil, { zone: "utc" });
    if (!now.isValid || !lastUntil.isValid) return false;

    return now <= lastUntil.plus({ seconds: 120 });
  }

  private inferCloseStartedAt(closedUntil: string | undefined, durationMinutes: number) {
    if (!closedUntil) return undefined;
    const end = DateTime.fromISO(closedUntil, { zone: "utc" });
    if (!end.isValid) return undefined;
    return end.minus({ minutes: Math.max(1, durationMinutes) }).toISO({ suppressMilliseconds: false }) ?? undefined;
  }

  private syncTrackedMonitorRuntime(
    branch: BranchMapping,
    metrics: OrdersMetrics,
    runtime: RuntimeRow | undefined,
    closedUntil: string,
    settings: Settings,
  ) {
    const patch: RuntimePatch = {};

    if (runtime?.lastUpuseCloseUntil !== closedUntil) {
      patch.lastUpuseCloseUntil = closedUntil;
    }

    if (!runtime?.lastUpuseCloseAt) {
      const inferredCloseAt = this.inferCloseStartedAt(closedUntil, settings.tempCloseMinutes);
      if (inferredCloseAt) {
        patch.lastUpuseCloseAt = inferredCloseAt;
      }
    }

    if (!runtime?.lastUpuseCloseReason) {
      const inferredReason = this.inferMonitorCloseReason(branch, metrics, settings);
      if (inferredReason) {
        patch.lastUpuseCloseReason = inferredReason;
      }
    }

    if (runtime?.externalOpenDetectedAt) {
      patch.externalOpenDetectedAt = null;
    }

    if (!Object.keys(patch).length) {
      return runtime;
    }

    setRuntime(branch.id, patch);
    return getRuntime(branch.id) as RuntimeRow | undefined;
  }

  private extractClosedUntilCandidate(payload: any): string | undefined {
    const candidates = [
      payload?.closedUntil,
      payload?.closed_until,
      payload?.availability?.closedUntil,
      payload?.availability?.closed_until,
      payload?.data?.closedUntil,
      payload?.data?.closed_until,
      payload?.currentSlotEndAt,
    ];

    const value = candidates.find(
      (candidate) => typeof candidate === "string" && candidate.trim().length > 0,
    );
    if (!value) return undefined;

    const parsed = DateTime.fromISO(value, { zone: "utc" });
    return parsed.isValid
      ? parsed.toISO({ suppressMilliseconds: false }) ?? undefined
      : undefined;
  }

  private async syncBranchAvailabilityAfterWrite(
    availabilityVendorId: string,
    expectedState?: AvailabilityRecord["availabilityState"],
  ): Promise<AvailabilityRecord | undefined> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const fresh = await this.fetchAvailabilityFresh();
        const record = fresh.get(availabilityVendorId);
        if (record && (!expectedState || record.availabilityState === expectedState)) {
          return record;
        }
      } catch {}

      if (attempt < 2) {
        await new Promise((resolve) => setTimeout(resolve, 700));
      }
    }

    return this.availabilityByVendor.get(availabilityVendorId);
  }

  private syncExternalClosureState(nowIso: string) {
    const settings = getSettings();
    const branches = listBranches().filter((branch) => branch.enabled);

    for (const branch of branches) {
      const availability = this.availabilityByVendor.get(branch.availabilityVendorId);
      let runtime = getRuntime(branch.id) as RuntimeRow | undefined;
      const metrics = this.ordersByVendor.get(branch.ordersVendorId) ?? {
        totalToday: 0,
        cancelledToday: 0,
        doneToday: 0,
        activeNow: 0,
        lateNow: 0,
        unassignedNow: 0,
      };
      if (!availability) {
        continue;
      }

      const monitorWindowStillActive = this.hasActiveTrackedMonitorWindow(runtime, nowIso);
      const ownedByUpuse =
        this.isMonitorOwnedClosure(runtime, availability) ||
        Boolean(
          availability.availabilityState === "CLOSED_UNTIL" &&
            availability.closedUntil &&
            monitorWindowStillActive &&
            !runtime?.externalOpenDetectedAt,
        );
      const isExternalTempClose = Boolean(
        availability.availabilityState === "CLOSED_UNTIL" && availability.closedUntil && !ownedByUpuse,
      );
      const isMonitorWindowAlias = Boolean(
        availability.availabilityState === "CLOSED_UNTIL" &&
        availability.closedUntil &&
        monitorWindowStillActive &&
        !runtime?.externalOpenDetectedAt
      );

      if (
        availability.availabilityState === "CLOSED_UNTIL" &&
        availability.closedUntil &&
        monitorWindowStillActive &&
        !runtime?.externalOpenDetectedAt
      ) {
        runtime = this.syncTrackedMonitorRuntime(branch, metrics, runtime, availability.closedUntil, settings);

        if (runtime?.lastExternalCloseUntil || runtime?.lastExternalCloseAt) {
          setRuntime(branch.id, {
            lastExternalCloseUntil: null,
            lastExternalCloseAt: null,
          });
          runtime = getRuntime(branch.id) as RuntimeRow | undefined;
        }
      }

      if (isExternalTempClose) {
        const externalClosedUntil = availability.closedUntil;
        const shouldPersistExternalWindow = Boolean(
          externalClosedUntil &&
          (runtime?.lastExternalCloseUntil !== externalClosedUntil || !runtime?.lastExternalCloseAt),
        );

        if (externalClosedUntil && shouldPersistExternalWindow) {
          setRuntime(branch.id, {
            lastExternalCloseUntil: externalClosedUntil,
            lastExternalCloseAt: runtime?.lastExternalCloseAt ?? nowIso,
          });
          const untilDt = DateTime.fromISO(externalClosedUntil, { zone: "utc" }).setZone("Africa/Cairo");
          const untilLabel = untilDt.isValid ? untilDt.toFormat("HH:mm") : null;
          log(
            branch.id,
            "WARN",
            untilLabel ? `TEMP CLOSE — external source until ${untilLabel}` : "TEMP CLOSE — external source",
          );
        }
        continue;
      }

      if (runtime?.lastExternalCloseUntil || runtime?.lastExternalCloseAt) {
        if (!isMonitorWindowAlias) {
          if (availability.availabilityState === "OPEN") {
            log(branch.id, "INFO", "OPEN — external source reopened");
          } else if (availability.availabilityState === "CLOSED") {
            log(branch.id, "WARN", "CLOSED — external source");
          }
        }

        setRuntime(branch.id, {
          lastExternalCloseUntil: null,
          lastExternalCloseAt: null,
        });
      }
    }
  }

  getSnapshot(): DashboardSnapshot {
    const settings = getSettings();
    const branches = listBranches();
    const totals = {
      branchesMonitored: branches.filter((b) => b.enabled).length,
      open: 0,
      tempClose: 0,
      closed: 0,
      unknown: 0,
      ordersToday: 0,
      cancelledToday: 0,
      doneToday: 0,
      activeNow: 0,
      lateNow: 0,
      unassignedNow: 0,
    };

    const branchSnapshots = branches.map((b) => {
      const thresholds = this.resolveThresholds(b, settings);
      const rawMetrics = this.ordersByVendor.get(b.ordersVendorId) ?? {
        totalToday: 0,
        cancelledToday: 0,
        doneToday: 0,
        activeNow: 0,
        lateNow: 0,
        unassignedNow: 0,
      };
      const metrics = this.currentMetrics(rawMetrics);
      totals.ordersToday += metrics.totalToday;
      totals.cancelledToday += metrics.cancelledToday;
      totals.doneToday += metrics.doneToday;
      totals.activeNow += metrics.activeNow;
      totals.lateNow += metrics.lateNow;
      totals.unassignedNow += metrics.unassignedNow;

      const av = this.availabilityByVendor.get(b.availabilityVendorId);
      const runtime = getRuntime(b.id) as RuntimeRow | undefined;
      let status: "OPEN" | "TEMP_CLOSE" | "CLOSED" | "UNKNOWN" = "UNKNOWN";
      let statusColor: "green" | "red" | "orange" | "grey" = "grey";
      let closedUntil: string | undefined;
      let closeStartedAt: string | undefined;
      let closedByUpuse = false;
      let closureSource: "UPUSE" | "EXTERNAL" | undefined;
      let closeReason: DashboardSnapshot["branches"][number]["closeReason"] = undefined;
      let autoReopen = false;

      if (av) {
        if (av.availabilityState === "OPEN") {
          status = "OPEN";
          statusColor = "green";
          totals.open += 1;
        } else if (av.availabilityState === "CLOSED_UNTIL") {
          status = "TEMP_CLOSE";
          statusColor = "red";
          closedUntil = av.closedUntil;
          // Keep the UI timer anchored to the configured closure window:
          // if a branch reopens at 12:30 and tempCloseMinutes is 30, progress starts at 12:00.
          closeStartedAt = this.inferCloseStartedAt(av.closedUntil, settings.tempCloseMinutes);
          closedByUpuse = this.isMonitorOwnedClosure(runtime, av);
          closureSource = closedByUpuse ? "UPUSE" : "EXTERNAL";
          autoReopen = closedByUpuse;
          if (closedByUpuse) {
            closeReason =
              (runtime?.lastUpuseCloseReason as DashboardSnapshot["branches"][number]["closeReason"]) ??
              this.inferMonitorCloseReason(b, rawMetrics, settings);
          } else {
            closeReason = undefined;
          }
          totals.tempClose += 1;
        } else if (av.availabilityState === "CLOSED") {
          status = "CLOSED";
          statusColor = "orange";
          totals.closed += 1;
        }
      } else {
        totals.unknown += 1;
      }

      return {
        branchId: b.id,
        name: b.name,
        chainName: b.chainName,
        ordersVendorId: b.ordersVendorId,
        availabilityVendorId: b.availabilityVendorId,
        status,
        statusColor,
        closedUntil,
        closeStartedAt,
        closedByUpuse,
        closureSource,
        closeReason,
        autoReopen,
        changeable: av?.changeable,
        thresholds,
        metrics,
        lastUpdatedAt: this.lastHealthyAt,
      };
    });

    return {
      monitoring: {
        running: this.running,
        lastOrdersFetchAt: this.lastOrdersFetchAt,
        lastAvailabilityFetchAt: this.lastAvailabilityFetchAt,
        lastHealthyAt: this.lastHealthyAt,
        degraded: this.degraded,
        errors: { ...this.errors },
      },
      totals,
      branches: branchSnapshots,
    };
  }

  async start() {
    if (this.running) return;
    const lifecycleId = this.nextLifecycleId();
    this.running = true;
    this.errors = {};
    this.closedOrdersSnapshotDayByBranch.clear();
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
    this.availabilityByVendor.clear();
    this.lastOrdersFetchAt = undefined;
    this.lastAvailabilityFetchAt = undefined;
    this.lastHealthyAt = undefined;
    this.closedOrdersSnapshotDayByBranch.clear();
    this.syncDegraded();
    this.clearScheduleHandles();
    log(null, "INFO", "Monitoring stopped");
    this.publish();
  }

  private schedule(runImmediately = true, lifecycleId?: number) {
    this.clearScheduleHandles();
    const settings = getSettings();

    // Orders runs at t0, availability is offset to avoid collision.
    const ordersMs = settings.ordersRefreshSeconds * 1000;
    const availMs = settings.availabilityRefreshSeconds * 1000;
    const offsetMs = Math.min(15000, Math.floor(availMs / 2)); // default 15s for 30s

    this.ordersTimer = setInterval(() => {
      void this.runOrdersCycle(undefined, lifecycleId).catch(() => {});
    }, ordersMs);

    this.availabilityStartTimeout = setTimeout(() => {
      if (!this.isLifecycleActive(lifecycleId)) return;
      this.availabilityTimer = setInterval(() => {
        void this.runAvailabilityCycle(undefined, lifecycleId).catch(() => {});
      }, availMs);
    }, offsetMs);

    if (runImmediately) {
      // Run once immediately
      void this.runOrdersCycle(undefined, lifecycleId).catch(() => {});
      this.immediateAvailabilityTimeout = setTimeout(() => {
        void this.runAvailabilityCycle(undefined, lifecycleId).catch(() => {});
      }, offsetMs);
    }
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
      const branches = listBranches();
      const cairoDayKey = DateTime.utc().setZone("Africa/Cairo").toFormat("yyyy-LL-dd");
      const pollingPlan = createOrdersPollingPlan({
        branches,
        availabilityByVendor: this.availabilityByVendor,
        closedSnapshotDayByBranch: this.closedOrdersSnapshotDayByBranch,
        cairoDayKey,
      });

      pollingPlan.resetBranchIds.forEach((branchId) => {
        this.closedOrdersSnapshotDayByBranch.delete(branchId);
      });

      if (!pollingPlan.vendorIds.length) {
        if (!this.isLifecycleCurrent(expectedLifecycleId)) return;
        this.clearSourceError("orders");
        if (!options?.suppressPublish && this.isLifecycleCurrent(expectedLifecycleId)) {
          this.publish();
        }
        return;
      }

      const pollingRequests = createOrdersPollingRequests({
        branches,
        vendorIds: pollingPlan.vendorIds,
        fallbackGlobalEntityId: settings.globalEntityId,
      });

      try {
        const mergedOrdersByVendor = new Map(this.ordersByVendor);
        let lastFetchedAt = this.lastOrdersFetchAt ?? nowUtcIso();

        for (const request of pollingRequests) {
          if (!this.isLifecycleActive(expectedLifecycleId)) return;
          const res = await fetchOrdersAggregates({
            token: settings.ordersToken,
            globalEntityId: request.globalEntityId,
            vendorIds: request.vendorIds,
            pageSize: 500,
            maxVendorsPerRequest: settings.maxVendorsPerOrdersRequest,
          });
          if (!this.isLifecycleActive(expectedLifecycleId)) return;

          lastFetchedAt = res.fetchedAt;
          for (const [vendorId, metrics] of res.byVendor) {
            mergedOrdersByVendor.set(vendorId, metrics);
          }
        }

        if (!this.isLifecycleActive(expectedLifecycleId)) return;
        this.ordersByVendor = mergedOrdersByVendor;
        pollingPlan.captureBranchIds.forEach((branchId) => {
          this.closedOrdersSnapshotDayByBranch.set(branchId, cairoDayKey);
        });
        this.ordersFresh = true;
        this.clearSourceError("orders");
        this.lastOrdersFetchAt = lastFetchedAt;
        this.markHealthy();
        await this.reconcile("orders", expectedLifecycleId);
      } catch (e: any) {
        if (!this.isLifecycleCurrent(expectedLifecycleId)) return;
        this.ordersFresh = false;
        this.setSourceError("orders", "Orders API request failed", e);
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
        const rows = await fetchAvailabilities(settings.availabilityToken);
        if (!this.isLifecycleActive(expectedLifecycleId)) return;
        this.availabilityByVendor = new Map(rows.map((r) => [r.platformRestaurantId, r]));
        this.syncExternalClosureState(nowUtcIso());
        this.clearSourceError("availability");
        this.lastAvailabilityFetchAt = nowUtcIso();
        this.markHealthy();
        await this.reconcile("availability", expectedLifecycleId);
      } catch (e: any) {
        if (!this.isLifecycleCurrent(expectedLifecycleId)) return;
        this.setSourceError("availability", "Availability API request failed", e);
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
    // Use latest caches for UI; actions require fresh availability snapshot just-in-time.
    if (!this.ordersFresh || !this.isLifecycleActive(expectedLifecycleId)) return;

    const settings = getSettings();
    const branches = listBranches().filter((b) => b.enabled);
    const nowIso = nowUtcIso();

    for (const branch of branches) {
      if (!this.isLifecycleActive(expectedLifecycleId)) return;
      const metrics = this.ordersByVendor.get(branch.ordersVendorId) ?? {
        totalToday: 0,
        cancelledToday: 0,
        doneToday: 0,
        activeNow: 0,
        lateNow: 0,
        unassignedNow: 0,
      };

      const avCached = this.availabilityByVendor.get(branch.availabilityVendorId);
      let runtime = getRuntime(branch.id) as RuntimeRow | undefined;

      if (
        avCached?.availabilityState === "CLOSED_UNTIL" &&
        avCached.modifiedBy === "log_vendor_monitor" &&
        avCached.closedUntil
      ) {
        runtime = this.syncTrackedMonitorRuntime(branch, metrics, runtime, avCached.closedUntil, settings);
      }

      if (avCached?.availabilityState === "OPEN" && runtime?.lastUpuseCloseUntil) {
        const lastCloseUntil = DateTime.fromISO(runtime.lastUpuseCloseUntil, { zone: "utc" });
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
            lastUpuseCloseUntil: null,
            lastUpuseCloseReason: null,
            lastUpuseCloseAt: null,
            lastUpuseCloseEventId: null,
            lastExternalCloseUntil: null,
            lastExternalCloseAt: null,
            externalOpenDetectedAt: null,
          });
          runtime = getRuntime(branch.id) as RuntimeRow | undefined;
        }
      }

      const decision = decide({
        branch,
        metrics,
        availability: avCached,
        runtime: runtime as any,
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
        // Before any action: fetch fresh availability NOW (bulk) and filter for this branch.
        const fresh = await this.fetchAvailabilityFresh(expectedLifecycleId);
        if (!this.isLifecycleActive(expectedLifecycleId)) return;
        const current = fresh.get(branch.availabilityVendorId);
        if (!current) {
          log(branch.id, "WARN", "Skip action — availability missing");
          return;
        }

        if (!current.changeable) {
          log(branch.id, "WARN", "Skip action — not changeable");
          return;
        }

        if (decision.type === "CLOSE") {
          if (current.availabilityState !== "OPEN") return;

          if (!this.isLifecycleActive(expectedLifecycleId)) return;
          const actionRuntime = getRuntime(branch.id) as RuntimeRow | undefined;
          const isReappliedAfterExternalOpen = Boolean(actionRuntime?.externalOpenDetectedAt);
          const availabilityGlobalEntityId = resolveOrdersGlobalEntityId(branch, settings.globalEntityId);

          if (!this.isLifecycleActive(expectedLifecycleId)) return;
          const mutationResult = await setAvailability({
            token: settings.availabilityToken,
            globalEntityId: availabilityGlobalEntityId,
            availabilityVendorId: branch.availabilityVendorId,
            state: "TEMPORARY_CLOSURE",
            durationMinutes: settings.tempCloseMinutes,
          });
          if (!this.isLifecycleActive(expectedLifecycleId)) return;

          const syncedAvailability = await this.syncBranchAvailabilityAfterWrite(
            branch.availabilityVendorId,
            "CLOSED_UNTIL",
          );
          if (!this.isLifecycleActive(expectedLifecycleId)) return;
          const actualUntil =
            syncedAvailability?.closedUntil ??
            this.extractClosedUntilCandidate(mutationResult) ??
            DateTime.fromISO(nowIso, { zone: "utc" })
              .plus({ minutes: settings.tempCloseMinutes })
              .toISO({ suppressMilliseconds: false }) ??
            undefined;

          this.availabilityByVendor.set(branch.availabilityVendorId, {
            ...(syncedAvailability ?? current),
            availabilityState: "CLOSED_UNTIL",
            closedUntil: actualUntil,
            modifiedBy: "log_vendor_monitor",
          });

          const untilLabel = actualUntil
            ? DateTime.fromISO(actualUntil, { zone: "utc" }).setZone("Africa/Cairo").toFormat("HH:mm")
            : null;

          const closeEventId = recordMonitorCloseAction({
            branch,
            at: nowIso,
            reason: decision.reason,
            metrics,
            closedUntil: actualUntil,
            note: isReappliedAfterExternalOpen
              ? untilLabel
                ? `Temporary closure re-applied after external open grace until ${untilLabel} Cairo time`
                : "Temporary closure re-applied after external open grace"
              : untilLabel
                ? `Temporary closure scheduled until ${untilLabel} Cairo time`
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
            externalOpenDetectedAt: null,
            lastActionAt: nowIso,
          });

          const tag = decision.reason === "LATE" ? `Late=${metrics.lateNow}` : `Unassigned=${metrics.unassignedNow}`;
          log(
            branch.id,
            "INFO",
            isReappliedAfterExternalOpen
              ? untilLabel
                ? `TEMP CLOSE — re-applied after external open grace (${tag}) until ${untilLabel}`
                : `TEMP CLOSE — re-applied after external open grace (${tag})`
              : untilLabel
                ? `TEMP CLOSE — ${tag} until ${untilLabel}`
                : `TEMP CLOSE — ${tag}`,
          );
          return;
        }

        if (decision.type === "EARLY_OPEN") {
          if (current.availabilityState !== "CLOSED_UNTIL") return;

          if (!this.isLifecycleActive(expectedLifecycleId)) return;
          let rt = getRuntime(branch.id) as any;
          const ownsClosure = this.isMonitorOwnedClosure(rt, current);
          if (!ownsClosure) return;
          const availabilityGlobalEntityId = resolveOrdersGlobalEntityId(branch, settings.globalEntityId);

          if (current.modifiedBy === "log_vendor_monitor" && current.closedUntil) {
            rt = this.syncTrackedMonitorRuntime(branch, metrics, rt, current.closedUntil, settings) as any;
          }

          if (!this.isLifecycleActive(expectedLifecycleId)) return;
          await setAvailability({
            token: settings.availabilityToken,
            globalEntityId: availabilityGlobalEntityId,
            availabilityVendorId: branch.availabilityVendorId,
            state: "OPEN",
          });
          if (!this.isLifecycleActive(expectedLifecycleId)) return;

          const syncedAvailability = await this.syncBranchAvailabilityAfterWrite(
            branch.availabilityVendorId,
            "OPEN",
          );
          if (!this.isLifecycleActive(expectedLifecycleId)) return;

          this.availabilityByVendor.set(branch.availabilityVendorId, {
            ...(syncedAvailability ?? current),
            availabilityState: "OPEN",
            closedUntil: undefined,
            modifiedBy: "log_vendor_monitor",
          });

          markCloseEventReopened({
            eventId: rt?.lastUpuseCloseEventId,
            reopenedAt: nowIso,
            mode: "MONITOR_RECOVERED",
            note: "Trigger recovered to zero and monitor reopened the branch",
          });

          if (!this.isLifecycleActive(expectedLifecycleId)) return;
          setRuntime(branch.id, {
            lastUpuseCloseUntil: null,
            lastUpuseCloseReason: null,
            lastUpuseCloseAt: null,
            lastUpuseCloseEventId: null,
            lastExternalCloseUntil: null,
            lastExternalCloseAt: null,
            externalOpenDetectedAt: null,
            lastActionAt: nowIso,
          });
          log(branch.id, "INFO", "OPEN — recovered to zero");
          return;
        }
      });
    }
  }

  private async fetchAvailabilityFresh(expectedLifecycleId?: number) {
    if (!this.isLifecycleActive(expectedLifecycleId)) {
      return new Map(this.availabilityByVendor);
    }

    const settings = getSettings();
    const rows = await fetchAvailabilities(settings.availabilityToken);
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
