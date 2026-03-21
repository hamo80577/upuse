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
import { getMirrorBranchDetail, syncOrdersMirror } from "../../services/ordersMirrorStore.js";
import { decide } from "../../services/policyEngine.js";
import { resolveBranchThresholdProfile } from "../../services/thresholds.js";
import { Mutex } from "../../utils/mutex.js";
import { nowUtcIso } from "../../utils/time.js";
import { resolveOrdersStaleMultiplier } from "../../services/orders/shared.js";

type RuntimeRow = ReturnType<typeof getRuntime>;
type RuntimePatch = Partial<NonNullable<RuntimeRow>>;
type CycleOptions = {
  suppressPublish?: boolean;
  forceOrdersSync?: boolean;
};
type ScheduledSource = "orders" | "availability";
type ScheduledCycleState = {
  timer: NodeJS.Timeout | null;
  inFlight: Promise<void> | null;
  pending: boolean;
  completedRuns: number;
  waiters: Array<{ targetRun: number; resolve: () => void }>;
};
type OrdersPressureSummary = {
  preparingNow: number;
  preparingPickersNow: number;
  recentActivePickers: number;
  recentActiveAvailable: boolean;
};

function normalizeRecentActivePickers(value: number) {
  return Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0;
}

function capacityLimit(recentActivePickers: number) {
  return normalizeRecentActivePickers(recentActivePickers) * 3;
}

function closeReasonLogTag(reason: CloseReason, metrics: OrdersMetrics, recentActivePickers: number) {
  if (reason === "LATE") return `Late=${metrics.lateNow}`;
  if (reason === "UNASSIGNED") return `Unassigned=${metrics.unassignedNow}`;

  const pickers = normalizeRecentActivePickers(recentActivePickers);
  return `Capacity active=${metrics.activeNow} cap=${capacityLimit(pickers)} recentActivePickers=${pickers}`;
}

function collapseWhitespace(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function stripHtmlTags(value: string) {
  return collapseWhitespace(
    value
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " "),
  );
}

function extractHtmlTitle(value: string) {
  const match = value.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return match ? stripHtmlTags(match[1]) : "";
}

function looksLikeHtmlDocument(value: string) {
  const sample = value.trim();
  if (!sample) return false;

  return (
    sample.startsWith("<!doctype html") ||
    sample.startsWith("<!DOCTYPE html") ||
    sample.startsWith("<html") ||
    /<html[\s>]/i.test(sample) ||
    /<head[\s>]/i.test(sample) ||
    /<body[\s>]/i.test(sample)
  );
}

function summarizeUpstreamErrorDetail(rawDetail: unknown) {
  if (typeof rawDetail !== "string") return undefined;

  const detail = rawDetail.trim();
  if (!detail) return undefined;

  if (looksLikeHtmlDocument(detail)) {
    const title = extractHtmlTitle(detail);
    const isCloudflareTunnel =
      /cloudflare/i.test(detail) ||
      /cloudflare/i.test(title) ||
      /tunnel error/i.test(detail) ||
      /cf-error/i.test(detail);

    if (isCloudflareTunnel) {
      return "Cloudflare tunnel error";
    }

    if (title) {
      return `HTML error page: ${title}`;
    }

    return "Unexpected HTML error page";
  }

  const normalized = collapseWhitespace(detail);
  return normalized.length > 220 ? `${normalized.slice(0, 217)}...` : normalized;
}

export class MonitorEngine {
  private ordersByVendor = new Map<number, OrdersMetrics>();
  private preparationByVendor = new Map<number, OrdersPressureSummary>();
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

  // Each source is single-flight with at most one coalesced rerun request.
  private cycleStates: Record<ScheduledSource, ScheduledCycleState> = {
    orders: {
      timer: null,
      inFlight: null,
      pending: false,
      completedRuns: 0,
      waiters: [],
    },
    availability: {
      timer: null,
      inFlight: null,
      pending: false,
      completedRuns: 0,
      waiters: [],
    },
  };
  private lifecycleId = 0;
  private manualOrdersRefreshPromise: Promise<void> | null = null;

  private jobMutex = new Mutex();
  private actionMutex = new Mutex();

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
    }
    this.availabilityByVendor.delete(branch.availabilityVendorId);
    setRuntime(branch.id, {
      lastUpuseCloseUntil: null,
      lastUpuseCloseReason: null,
      lastUpuseCloseAt: null,
      lastUpuseCloseEventId: null,
      lastExternalCloseUntil: null,
      lastExternalCloseAt: null,
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

  private getCycleState(source: ScheduledSource) {
    return this.cycleStates[source];
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

  private clearCycleTimer(source: ScheduledSource) {
    const state = this.getCycleState(source);
    if (state.timer) clearTimeout(state.timer);
    state.timer = null;
  }

  private resolveCycleWaiters(source: ScheduledSource) {
    const state = this.getCycleState(source);
    const remaining: ScheduledCycleState["waiters"] = [];

    for (const waiter of state.waiters) {
      if (state.completedRuns >= waiter.targetRun || !this.running) {
        waiter.resolve();
        continue;
      }
      remaining.push(waiter);
    }

    state.waiters = remaining;
  }

  private resetCycleState(source: ScheduledSource) {
    const state = this.getCycleState(source);
    this.clearCycleTimer(source);
    state.inFlight = null;
    state.pending = false;
    state.completedRuns = 0;
    for (const waiter of state.waiters) waiter.resolve();
    state.waiters = [];
  }

  private clearScheduleHandles() {
    this.resetCycleState("orders");
    this.resetCycleState("availability");
  }

  private armCycleTimer(source: ScheduledSource, delayMs: number, expectedLifecycleId?: number) {
    if (!this.isLifecycleActive(expectedLifecycleId)) return;

    const state = this.getCycleState(source);
    this.clearCycleTimer(source);
    state.timer = setTimeout(() => {
      state.timer = null;
      void this.requestScheduledCycle(source, expectedLifecycleId);
    }, delayMs);
  }

  private startScheduledCycle(source: ScheduledSource, options?: CycleOptions, expectedLifecycleId?: number) {
    if (!this.isLifecycleActive(expectedLifecycleId)) return;

    const state = this.getCycleState(source);
    if (state.inFlight) return;

    this.clearCycleTimer(source);

    const runCycle = source === "orders"
      ? this.runOrdersCycle.bind(this)
      : this.runAvailabilityCycle.bind(this);

    const cyclePromise = Promise.resolve()
      .then(() => runCycle(options, expectedLifecycleId))
      .catch(() => {})
      .finally(() => {
        if (state.inFlight === cyclePromise) {
          state.inFlight = null;
        }

        state.completedRuns += 1;
        this.resolveCycleWaiters(source);

        if (!this.isLifecycleActive(expectedLifecycleId)) {
          state.pending = false;
          return;
        }

        if (state.pending) {
          state.pending = false;
          this.startScheduledCycle(source, undefined, expectedLifecycleId);
          return;
        }

        this.armCycleTimer(source, this.getCycleIntervalMs(source), expectedLifecycleId);
      });

    state.inFlight = cyclePromise;
  }

  private requestScheduledCycle(source: ScheduledSource, expectedLifecycleId?: number, options?: CycleOptions) {
    if (!this.isLifecycleActive(expectedLifecycleId)) {
      return Promise.resolve();
    }

    const state = this.getCycleState(source);
    const targetRun = state.completedRuns + (state.inFlight ? 2 : 1);

    if (state.inFlight) {
      state.pending = true;
    } else {
      this.startScheduledCycle(source, options, expectedLifecycleId);
    }

    return new Promise<void>((resolve) => {
      if (state.completedRuns >= targetRun || !this.isLifecycleActive(expectedLifecycleId)) {
        resolve();
        return;
      }

      state.waiters.push({ targetRun, resolve });
    });
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

  private getErrorDetail(e: any) {
    const statusCode = typeof e?.response?.status === "number" ? e.response.status : undefined;
    const responseData = e?.response?.data;
    const candidates = [
      responseData?.message,
      responseData?.error,
      responseData?.details?.message,
      typeof responseData === "string" ? responseData : undefined,
      e?.message,
    ];

    const detail = candidates
      .map((value) => summarizeUpstreamErrorDetail(value))
      .find((value) => typeof value === "string" && value.length > 0);

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
    return metrics;
  }

  private currentPreparation(
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

  private resolveThresholds(
    branch: Pick<BranchMapping, "chainName" | "lateThresholdOverride" | "unassignedThresholdOverride" | "capacityRuleEnabledOverride">,
    settings: Settings,
  ) {
    return resolveBranchThresholdProfile(branch, settings);
  }

  private inferMonitorCloseReason(
    branch: ResolvedBranchMapping,
    metrics: OrdersMetrics,
    settings: Settings,
    recentActivePickers: number,
    recentActiveAvailable: boolean,
  ): CloseReason | undefined {
    const thresholds = this.resolveThresholds(branch, settings);
    const exceedLate = metrics.lateNow >= thresholds.lateThreshold && thresholds.lateThreshold > 0;
    const exceedUnassigned = metrics.unassignedNow >= thresholds.unassignedThreshold && thresholds.unassignedThreshold > 0;
    const exceedCapacity = thresholds.capacityRuleEnabled !== false
      && recentActiveAvailable
      && metrics.activeNow > capacityLimit(recentActivePickers);

    if (exceedLate) return "LATE";
    if (exceedUnassigned) return "UNASSIGNED";
    if (exceedCapacity) return "CAPACITY";
    return undefined;
  }

  private hasTrustedMonitorRuntime(runtime: RuntimeRow | undefined, settings: Settings) {
    if (!runtime) return false;
    if (typeof runtime.lastUpuseCloseEventId === "number" && runtime.lastUpuseCloseEventId > 0) {
      return true;
    }

    if (!runtime.lastUpuseCloseAt || !runtime.lastActionAt) {
      return false;
    }

    const closeAt = DateTime.fromISO(runtime.lastUpuseCloseAt, { zone: "utc" });
    const actionAt = DateTime.fromISO(runtime.lastActionAt, { zone: "utc" });
    if (!closeAt.isValid || !actionAt.isValid) {
      return false;
    }

    const toleranceSeconds = Math.max(120, settings.availabilityRefreshSeconds + 30);
    return Math.abs(actionAt.diff(closeAt).as("seconds")) <= toleranceSeconds;
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
    const settings = getSettings();
    if (!this.hasTrustedMonitorRuntime(runtime, settings)) return false;
    return (
      this.isTrackedUpuseClosure(runtime, availability.closedUntil) ||
      this.matchesExpectedMonitorCloseWindow(runtime, availability.closedUntil)
    );
  }

  private hasActiveTrackedMonitorWindow(runtime: RuntimeRow | undefined, nowIso: string) {
    const settings = getSettings();
    if (!this.hasTrustedMonitorRuntime(runtime, settings)) return false;
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

  private inferObservedExternalCloseStartedAt(runtime: RuntimeRow | undefined, closedUntil: string | undefined) {
    if (!runtime?.lastExternalCloseAt || !closedUntil) return undefined;
    if (runtime.lastExternalCloseUntil !== closedUntil) return undefined;

    const startedAt = DateTime.fromISO(runtime.lastExternalCloseAt, { zone: "utc" });
    return startedAt.isValid
      ? startedAt.toISO({ suppressMilliseconds: false }) ?? undefined
      : undefined;
  }

  private buildClearedTrackedRuntimePatch(runtime: RuntimeRow | undefined) {
    const patch: RuntimePatch = {};

    if (runtime?.lastUpuseCloseUntil) patch.lastUpuseCloseUntil = null;
    if (runtime?.lastUpuseCloseReason) patch.lastUpuseCloseReason = null;
    if (runtime?.lastUpuseCloseAt) patch.lastUpuseCloseAt = null;
    if (runtime?.lastUpuseCloseEventId) patch.lastUpuseCloseEventId = null;
    if (runtime?.externalOpenDetectedAt) patch.externalOpenDetectedAt = null;

    return patch;
  }

  private syncTrackedMonitorRuntime(
    branch: ResolvedBranchMapping,
    metrics: OrdersMetrics,
    recentActivePickers: number,
    recentActiveAvailable: boolean,
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
      const inferredReason = this.inferMonitorCloseReason(
        branch,
        metrics,
        settings,
        recentActivePickers,
        recentActiveAvailable,
      );
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

  private syncExternalClosureState(nowIso: string) {
    const settings = getSettings();
    const branches = listResolvedBranches({ enabledOnly: true });

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
      const preparation = this.currentPreparation(
        this.preparationByVendor.get(branch.ordersVendorId),
        this.ordersDataStateByVendor.get(branch.ordersVendorId) === "fresh",
      );
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
        runtime = this.syncTrackedMonitorRuntime(
          branch,
          metrics,
          preparation.recentActivePickers,
          preparation.recentActiveAvailable,
          runtime,
          availability.closedUntil,
          settings,
        );

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
        const trackedRuntimeReset = !monitorWindowStillActive ? this.buildClearedTrackedRuntimePatch(runtime) : {};
        const shouldResetTrackedRuntime = Object.keys(trackedRuntimeReset).length > 0;

        if (externalClosedUntil && (shouldPersistExternalWindow || shouldResetTrackedRuntime)) {
          runtime = setRuntime(branch.id, {
            lastExternalCloseUntil: externalClosedUntil,
            lastExternalCloseAt:
              runtime?.lastExternalCloseUntil === externalClosedUntil && runtime?.lastExternalCloseAt
                ? runtime.lastExternalCloseAt
                : nowIso,
            ...trackedRuntimeReset,
          });
          const untilDt = DateTime.fromISO(externalClosedUntil, { zone: "utc" }).setZone("Africa/Cairo");
          const untilLabel = untilDt.isValid ? untilDt.toFormat("HH:mm") : null;
          if (shouldPersistExternalWindow) {
            log(
              branch.id,
              "WARN",
              untilLabel ? `TEMP CLOSE — external source until ${untilLabel}` : "TEMP CLOSE — external source",
            );
          }
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
    const branches = listResolvedBranches();
    const monitoredBranches = branches.filter((branch) => branch.enabled);
    const totals = {
      branchesMonitored: monitoredBranches.length,
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

    const branchSnapshots = monitoredBranches.map((b) => {
      const thresholds = this.resolveThresholds(b, settings);
      const ordersDataState = this.ordersDataStateByVendor.get(b.ordersVendorId) ?? "warming";
      const rawMetrics = this.ordersByVendor.get(b.ordersVendorId) ?? {
        totalToday: 0,
        cancelledToday: 0,
        doneToday: 0,
        activeNow: 0,
        lateNow: 0,
        unassignedNow: 0,
      };
      const preparation = this.currentPreparation(
        this.preparationByVendor.get(b.ordersVendorId) ?? {
          preparingNow: Math.max(0, rawMetrics.activeNow - rawMetrics.unassignedNow),
          preparingPickersNow: 0,
          recentActivePickers: 0,
          recentActiveAvailable: ordersDataState === "fresh",
        },
        ordersDataState === "fresh",
      );
      const ordersLastSyncedAt = this.ordersLastSyncedAtByVendor.get(b.ordersVendorId);
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
      let sourceClosedReason: string | undefined;
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
          closedByUpuse = this.isMonitorOwnedClosure(runtime, av);
          closureSource = closedByUpuse ? "UPUSE" : "EXTERNAL";
          sourceClosedReason = closedByUpuse ? undefined : av.closedReason;
          closeStartedAt = closedByUpuse
            ? this.inferCloseStartedAt(av.closedUntil, settings.tempCloseMinutes)
            : this.inferObservedExternalCloseStartedAt(runtime, av.closedUntil);
          autoReopen = closedByUpuse;
          if (closedByUpuse) {
            closeReason =
              (runtime?.lastUpuseCloseReason as DashboardSnapshot["branches"][number]["closeReason"]) ??
              this.inferMonitorCloseReason(
                b,
                rawMetrics,
                settings,
                preparation.recentActivePickers,
                preparation.recentActiveAvailable,
              );
          } else {
            closeReason = undefined;
          }
          totals.tempClose += 1;
        } else if (av.availabilityState === "CLOSED") {
          status = "CLOSED";
          statusColor = "orange";
          closureSource = "EXTERNAL";
          sourceClosedReason = av.closedReason;
          totals.closed += 1;
        }
      } else {
        totals.unknown += 1;
      }

      return {
        branchId: b.id,
        name: b.name,
        chainName: b.chainName,
        monitorEnabled: true,
        ordersVendorId: b.ordersVendorId,
        availabilityVendorId: b.availabilityVendorId,
        status,
        statusColor,
        closedUntil,
        closeStartedAt,
        closedByUpuse,
        closureSource,
        closeReason,
        sourceClosedReason,
        autoReopen,
        changeable: av?.changeable,
        thresholds,
        metrics,
        preparingNow: preparation.preparingNow,
        preparingPickersNow: preparation.preparingPickersNow,
        ordersDataState,
        ordersLastSyncedAt,
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
        ordersSync: {
          mode: "mirror",
          state:
            !this.lastOrdersFetchAt
              ? "warming"
              : this.consecutiveOrdersSourceFailures >= resolveOrdersStaleMultiplier() ||
                  (totals.branchesMonitored > 0 && this.staleOrdersBranchCount / totals.branchesMonitored > 0.25)
                ? "degraded"
                : "healthy",
          lastSuccessfulSyncAt: this.ordersLastSuccessfulSyncAt,
          staleBranchCount: this.staleOrdersBranchCount,
          consecutiveSourceFailures: this.consecutiveOrdersSourceFailures,
        },
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
    this.armCycleTimer("orders", runImmediately ? 0 : this.getCycleIntervalMs("orders"), lifecycleId);
    this.armCycleTimer(
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
            preparingNow: detail.preparingOrders.length,
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
      } catch (e: any) {
        if (!this.isLifecycleCurrent(expectedLifecycleId)) return;
        this.ordersFresh = false;
        this.consecutiveOrdersSourceFailures += 1;
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
      };
      const preparation = this.currentPreparation(this.preparationByVendor.get(branch.ordersVendorId), true);

      const avCached = this.availabilityByVendor.get(branch.availabilityVendorId);
      let runtime = getRuntime(branch.id) as RuntimeRow | undefined;

      if (
        avCached?.availabilityState === "CLOSED_UNTIL" &&
        this.isMonitorOwnedClosure(runtime, avCached) &&
        avCached.closedUntil
      ) {
        runtime = this.syncTrackedMonitorRuntime(
          branch,
          metrics,
          preparation.recentActivePickers,
          preparation.recentActiveAvailable,
          runtime,
          avCached.closedUntil,
          settings,
        );
      }

      if (
        avCached?.availabilityState === "OPEN" &&
        this.hasTrustedMonitorRuntime(runtime, settings) &&
        runtime?.lastUpuseCloseUntil
      ) {
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
        recentActivePickers: preparation.recentActivePickers,
        recentActiveAvailable: preparation.recentActiveAvailable,
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
        const fresh = await ensureActionAvailability();
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
          let rt = getRuntime(branch.id) as any;
          const ownsClosure = this.isMonitorOwnedClosure(rt, current);
          if (!ownsClosure) return;

          if (current.modifiedBy === "log_vendor_monitor" && current.closedUntil) {
            rt = this.syncTrackedMonitorRuntime(
              branch,
              metrics,
              preparation.recentActivePickers,
              preparation.recentActiveAvailable,
              rt,
              current.closedUntil,
              settings,
            ) as any;
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

    if (!shouldRefreshAvailabilityAfterActions || !this.isLifecycleActive(expectedLifecycleId)) return;

    try {
      await this.fetchAvailabilityFresh(expectedLifecycleId);
    } catch (error: any) {
      const detail = this.getErrorDetail(error).detail ?? error?.message ?? "Unknown error";
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
