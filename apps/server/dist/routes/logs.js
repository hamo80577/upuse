import { z } from "zod";
import { clearLogs, getLogsDayPage } from "../services/logger.js";
const LogsQuery = z.object({
    branchId: z.string().regex(/^[0-9]+$/),
    beforeDay: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});
export function logsRoute(req, res) {
    const q = LogsQuery.parse(req.query);
    const branchId = Number(q.branchId);
    res.json(getLogsDayPage(branchId, q.beforeDay));
}
export function clearLogsRoute(req, res) {
    const q = LogsQuery.parse(req.query);
    const branchId = Number(q.branchId);
    clearLogs(branchId);
    res.json({ ok: true });
}
