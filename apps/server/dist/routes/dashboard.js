export function dashboardRoute(engine) {
    return (_req, res) => {
        res.json(engine.getSnapshot());
    };
}
