import { z } from "zod";
import { buildActionEventsCsv } from "../services/actionReportStore.js";
export function downloadMonitorReportRoute(req, res) {
    const query = z
        .object({
        preset: z.enum(["today", "yesterday", "last7", "last30", "day"]).default("today"),
        day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    })
        .parse(req.query);
    const report = buildActionEventsCsv(query);
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${report.fileName}"`);
    res.status(200).send(report.csv);
}
