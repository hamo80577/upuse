export function health(engine) {
    return (_req, res) => {
        const monitoring = engine?.getSnapshot().monitoring;
        const lastErrorAt = monitoring?.errors?.orders?.at ??
            monitoring?.errors?.availability?.at;
        res.json({
            ok: true,
            name: "UPuse",
            monitorRunning: monitoring?.running ?? false,
            monitorDegraded: monitoring?.degraded ?? false,
            lastSnapshotAt: monitoring?.lastHealthyAt ?? monitoring?.lastOrdersFetchAt ?? monitoring?.lastAvailabilityFetchAt ?? null,
            lastErrorAt: lastErrorAt ?? null,
            ordersSync: monitoring?.ordersSync ?? {
                mode: "mirror",
                state: "warming",
                staleBranchCount: 0,
                consecutiveSourceFailures: 0,
            },
        });
    };
}
