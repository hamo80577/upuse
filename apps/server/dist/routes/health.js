function fallbackOrdersSync() {
    return {
        mode: "mirror",
        state: "warming",
        staleBranchCount: 0,
        consecutiveSourceFailures: 0,
    };
}
function summarizeReadiness(monitoring) {
    if (!monitoring?.running) {
        return {
            ready: true,
            state: "idle",
            message: "Monitor is stopped.",
        };
    }
    if (monitoring.degraded ||
        monitoring.ordersSync?.state === "degraded" ||
        monitoring.errors?.orders ||
        monitoring.errors?.availability) {
        return {
            ready: false,
            state: "degraded",
            message: monitoring.errors?.orders?.message ?? monitoring.errors?.availability?.message ?? "Monitor is degraded.",
        };
    }
    if (!monitoring.lastOrdersFetchAt || !monitoring.lastAvailabilityFetchAt) {
        return {
            ready: false,
            state: "warming",
            message: "Monitor is warming and has not completed its initial data fetches yet.",
        };
    }
    return {
        ready: true,
        state: "ready",
        message: "Monitor is healthy.",
    };
}
export function buildHealthPayload(engine) {
    const monitoring = engine?.getSnapshot().monitoring;
    const readiness = summarizeReadiness(monitoring);
    const lastErrorAt = monitoring?.errors?.orders?.at ??
        monitoring?.errors?.availability?.at;
    return {
        name: "UPuse",
        live: true,
        ready: readiness.ready,
        readiness: {
            state: readiness.state,
            message: readiness.message,
        },
        monitorRunning: monitoring?.running ?? false,
        monitorDegraded: monitoring?.degraded ?? false,
        lastSnapshotAt: monitoring?.lastHealthyAt ?? monitoring?.lastOrdersFetchAt ?? monitoring?.lastAvailabilityFetchAt ?? null,
        lastErrorAt: lastErrorAt ?? null,
        ordersSync: monitoring?.ordersSync ?? fallbackOrdersSync(),
    };
}
export function health(engine) {
    return (_req, res) => {
        res.json({
            ok: true,
            ...buildHealthPayload(engine),
        });
    };
}
export function readiness(engine) {
    return (_req, res) => {
        const payload = buildHealthPayload(engine);
        res.status(payload.ready ? 200 : 503).json({
            ok: payload.ready,
            ...payload,
        });
    };
}
