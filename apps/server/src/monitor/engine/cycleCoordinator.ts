export type CycleOptions = {
  suppressPublish?: boolean;
  forceOrdersSync?: boolean;
};

export type ScheduledSource = "orders" | "availability";

type ScheduledCycleState = {
  timer: NodeJS.Timeout | null;
  inFlight: Promise<void> | null;
  pending: boolean;
  pendingOptions?: CycleOptions;
  completedRuns: number;
  waiters: Array<{ targetRun: number; resolve: () => void }>;
};

type MonitorCycleCoordinatorDependencies = {
  isActive: (expectedLifecycleId?: number) => boolean;
  getIntervalMs: (source: ScheduledSource) => number;
  runCycle: (source: ScheduledSource, options?: CycleOptions, expectedLifecycleId?: number) => Promise<void>;
};

function mergePendingCycleOptions(
  current?: CycleOptions,
  incoming?: CycleOptions,
): CycleOptions | undefined {
  if (!current && !incoming) return undefined;

  if (current?.forceOrdersSync || incoming?.forceOrdersSync) {
    return { forceOrdersSync: true };
  }

  return undefined;
}

export class MonitorCycleCoordinator {
  private readonly cycleStates: Record<ScheduledSource, ScheduledCycleState> = {
    orders: {
      timer: null,
      inFlight: null,
      pending: false,
      pendingOptions: undefined,
      completedRuns: 0,
      waiters: [],
    },
    availability: {
      timer: null,
      inFlight: null,
      pending: false,
      pendingOptions: undefined,
      completedRuns: 0,
      waiters: [],
    },
  };

  constructor(private readonly deps: MonitorCycleCoordinatorDependencies) {}

  private getCycleState(source: ScheduledSource) {
    return this.cycleStates[source];
  }

  private clearTimer(source: ScheduledSource) {
    const state = this.getCycleState(source);
    if (state.timer) {
      clearTimeout(state.timer);
    }
    state.timer = null;
  }

  private resolveWaiters(source: ScheduledSource) {
    const state = this.getCycleState(source);
    const remaining: ScheduledCycleState["waiters"] = [];

    for (const waiter of state.waiters) {
      if (state.completedRuns >= waiter.targetRun || !this.deps.isActive()) {
        waiter.resolve();
        continue;
      }
      remaining.push(waiter);
    }

    state.waiters = remaining;
  }

  private resetState(source: ScheduledSource) {
    const state = this.getCycleState(source);
    this.clearTimer(source);
    state.inFlight = null;
    state.pending = false;
    state.pendingOptions = undefined;
    state.completedRuns = 0;
    for (const waiter of state.waiters) {
      waiter.resolve();
    }
    state.waiters = [];
  }

  clearAll() {
    this.resetState("orders");
    this.resetState("availability");
  }

  arm(source: ScheduledSource, delayMs: number, expectedLifecycleId?: number) {
    if (!this.deps.isActive(expectedLifecycleId)) {
      return;
    }

    const state = this.getCycleState(source);
    this.clearTimer(source);
    state.timer = setTimeout(() => {
      state.timer = null;
      void this.request(source, expectedLifecycleId);
    }, delayMs);
  }

  private start(source: ScheduledSource, options?: CycleOptions, expectedLifecycleId?: number) {
    if (!this.deps.isActive(expectedLifecycleId)) {
      return;
    }

    const state = this.getCycleState(source);
    if (state.inFlight) {
      return;
    }

    this.clearTimer(source);

    const cyclePromise = Promise.resolve()
      .then(() => this.deps.runCycle(source, options, expectedLifecycleId))
      .catch(() => {})
      .finally(() => {
        if (state.inFlight === cyclePromise) {
          state.inFlight = null;
        }

        state.completedRuns += 1;
        this.resolveWaiters(source);

        if (!this.deps.isActive(expectedLifecycleId)) {
          state.pending = false;
          state.pendingOptions = undefined;
          return;
        }

        if (state.pending) {
          const rerunOptions = state.pendingOptions;
          state.pending = false;
          state.pendingOptions = undefined;
          this.start(source, rerunOptions, expectedLifecycleId);
          return;
        }

        this.arm(source, this.deps.getIntervalMs(source), expectedLifecycleId);
      });

    state.inFlight = cyclePromise;
  }

  request(source: ScheduledSource, expectedLifecycleId?: number, options?: CycleOptions) {
    if (!this.deps.isActive(expectedLifecycleId)) {
      return Promise.resolve();
    }

    const state = this.getCycleState(source);
    const targetRun = state.completedRuns + (state.inFlight ? 2 : 1);

    if (state.inFlight) {
      state.pending = true;
      state.pendingOptions = mergePendingCycleOptions(state.pendingOptions, options);
    } else {
      this.start(source, options, expectedLifecycleId);
    }

    return new Promise<void>((resolve) => {
      if (state.completedRuns >= targetRun || !this.deps.isActive(expectedLifecycleId)) {
        resolve();
        return;
      }

      state.waiters.push({ targetRun, resolve });
    });
  }
}
