import { randomUUID } from "node:crypto";
import { db } from "../config/db.js";
import { listResolvedBranches } from "./branchStore.js";
import { getSettings } from "./settingsStore.js";
import { fetchAvailabilities } from "./availabilityClient.js";
import { probeOrdersVendorAccess } from "./ordersClient.js";
function resolveOrdersTestConcurrency() {
    const raw = Number(process.env.UPUSE_ORDERS_TEST_CONCURRENCY ?? "2");
    if (!Number.isFinite(raw))
        return 2;
    return Math.max(1, Math.min(8, Math.floor(raw)));
}
async function mapWithConcurrency(items, concurrency, worker) {
    if (!items.length)
        return;
    const safeConcurrency = Math.max(1, Math.min(concurrency, items.length));
    let cursor = 0;
    const consume = async () => {
        while (true) {
            const index = cursor;
            cursor += 1;
            if (index >= items.length)
                return;
            await worker(items[index], index);
        }
    };
    await Promise.all(Array.from({ length: safeConcurrency }, () => consume()));
}
function normalizeError(error) {
    return {
        status: typeof error?.response?.status === "number" ? error.response.status : null,
        message: error?.response?.data?.message || error?.message || "Request failed.",
    };
}
function jobRow(jobId) {
    return db.prepare("SELECT * FROM settings_token_test_jobs WHERE id = ?").get(jobId) ?? null;
}
function resultRows(jobId) {
    return db.prepare(`
    SELECT branchId, name, ordersVendorId, ok, status, message, sampleVendorName
    FROM settings_token_test_results
    WHERE jobId = ?
    ORDER BY ok DESC, name ASC, branchId ASC
  `).all(jobId);
}
function upsertJob(jobId, patch) {
    const current = jobRow(jobId);
    if (!current) {
        throw new Error(`Token test job ${jobId} not found`);
    }
    const next = {
        ...current,
        ...patch,
    };
    db.prepare(`
    UPDATE settings_token_test_jobs
    SET
      status = @status,
      createdAt = @createdAt,
      startedAt = @startedAt,
      completedAt = @completedAt,
      availabilityConfigured = @availabilityConfigured,
      availabilityOk = @availabilityOk,
      availabilityStatus = @availabilityStatus,
      availabilityMessage = @availabilityMessage,
      ordersConfigured = @ordersConfigured,
      ordersConfigValid = @ordersConfigValid,
      ordersConfigMessage = @ordersConfigMessage,
      ordersProbeOk = @ordersProbeOk,
      ordersProbeStatus = @ordersProbeStatus,
      ordersProbeMessage = @ordersProbeMessage,
      totalBranches = @totalBranches,
      processedBranches = @processedBranches,
      passedBranches = @passedBranches,
      failedBranches = @failedBranches
    WHERE id = @id
  `).run(next);
}
function pruneOldJobs(keep = 20) {
    db.prepare(`
    DELETE FROM settings_token_test_jobs
    WHERE id NOT IN (
      SELECT id
      FROM settings_token_test_jobs
      ORDER BY createdAt DESC
      LIMIT ?
    )
  `).run(keep);
}
function buildTokenResult(input) {
    return {
        configured: input.configured,
        ok: input.ok,
        status: input.status,
        message: input.message ?? undefined,
    };
}
export function getSettingsTokenTestSnapshot(jobId) {
    const row = jobRow(jobId);
    if (!row)
        return null;
    const branches = resultRows(jobId).map((item) => ({
        branchId: item.branchId,
        name: item.name,
        ordersVendorId: item.ordersVendorId,
        ok: item.ok === 1,
        status: item.status,
        message: item.message ?? undefined,
        sampleVendorName: item.sampleVendorName,
    }));
    const percent = row.totalBranches > 0
        ? Math.round((Math.min(row.totalBranches, row.processedBranches) / row.totalBranches) * 100)
        : 100;
    return {
        jobId: row.id,
        status: row.status,
        createdAt: row.createdAt,
        startedAt: row.startedAt,
        completedAt: row.completedAt,
        progress: {
            totalBranches: row.totalBranches,
            processedBranches: row.processedBranches,
            passedBranches: row.passedBranches,
            failedBranches: row.failedBranches,
            percent,
        },
        availability: buildTokenResult({
            configured: row.availabilityConfigured === 1,
            ok: row.availabilityOk === 1,
            status: row.availabilityStatus,
            message: row.availabilityMessage,
        }),
        orders: {
            configValid: row.ordersConfigValid === 1,
            configMessage: row.ordersConfigMessage ?? undefined,
            ok: row.ordersConfigValid === 1 && row.ordersProbeOk === 1 && row.failedBranches === 0,
            probe: buildTokenResult({
                configured: row.ordersConfigured === 1,
                ok: row.ordersProbeOk === 1,
                status: row.ordersProbeStatus,
                message: row.ordersProbeMessage,
            }),
            enabledBranchCount: row.totalBranches,
            passedBranchCount: row.passedBranches,
            failedBranchCount: row.failedBranches,
            branches,
        },
    };
}
function insertBranchResult(jobId, branch, result) {
    const processedAt = new Date().toISOString();
    db.prepare(`
    INSERT INTO settings_token_test_results (
      jobId,
      branchId,
      name,
      ordersVendorId,
      ok,
      status,
      message,
      sampleVendorName,
      processedAt
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(jobId, branchId) DO UPDATE SET
      name = excluded.name,
      ordersVendorId = excluded.ordersVendorId,
      ok = excluded.ok,
      status = excluded.status,
      message = excluded.message,
      sampleVendorName = excluded.sampleVendorName,
      processedAt = excluded.processedAt
  `).run(jobId, branch.id, branch.name, branch.ordersVendorId, result.ok ? 1 : 0, result.status, result.message ?? null, result.sampleVendorName ?? null, processedAt);
    const current = jobRow(jobId);
    if (!current)
        return;
    upsertJob(jobId, {
        processedBranches: current.processedBranches + 1,
        passedBranches: current.passedBranches + (result.ok ? 1 : 0),
        failedBranches: current.failedBranches + (result.ok ? 0 : 1),
    });
}
async function runSettingsTokenTestJob(jobId, settings, branches) {
    upsertJob(jobId, {
        status: "running",
        startedAt: new Date().toISOString(),
    });
    const availabilityToken = settings.availabilityToken.trim();
    if (!availabilityToken) {
        upsertJob(jobId, {
            availabilityConfigured: 0,
            availabilityOk: 0,
            availabilityStatus: null,
            availabilityMessage: "Availability token is not configured.",
        });
    }
    else {
        try {
            await fetchAvailabilities(availabilityToken, {
                expectedVendorIds: branches.map((branch) => branch.availabilityVendorId),
            });
            upsertJob(jobId, {
                availabilityConfigured: 1,
                availabilityOk: 1,
                availabilityStatus: null,
                availabilityMessage: null,
            });
        }
        catch (error) {
            const normalized = normalizeError(error);
            upsertJob(jobId, {
                availabilityConfigured: 1,
                availabilityOk: 0,
                availabilityStatus: normalized.status,
                availabilityMessage: normalized.message,
            });
        }
    }
    const ordersToken = settings.ordersToken.trim();
    const ordersConfigValid = ordersToken.length > 0 && branches.length > 0;
    upsertJob(jobId, {
        ordersConfigured: ordersToken.length > 0 ? 1 : 0,
        ordersConfigValid: ordersConfigValid ? 1 : 0,
        ordersConfigMessage: ordersToken
            ? (branches.length ? null : "Enable at least one available branch mapping to test Orders token.")
            : "Orders token is not configured.",
    });
    if (!ordersConfigValid) {
        upsertJob(jobId, {
            status: "completed",
            completedAt: new Date().toISOString(),
            ordersProbeOk: 0,
            ordersProbeStatus: null,
            ordersProbeMessage: ordersToken ? "No enabled branch mappings to test." : "Orders token is not configured.",
        });
        return;
    }
    try {
        await probeOrdersVendorAccess({
            token: ordersToken,
            globalEntityId: branches[0].globalEntityId,
            ordersVendorId: branches[0].ordersVendorId,
        });
        upsertJob(jobId, {
            ordersProbeOk: 1,
            ordersProbeStatus: null,
            ordersProbeMessage: null,
        });
    }
    catch (error) {
        const normalized = normalizeError(error);
        upsertJob(jobId, {
            ordersProbeOk: 0,
            ordersProbeStatus: normalized.status,
            ordersProbeMessage: normalized.message,
        });
        for (const branch of branches) {
            insertBranchResult(jobId, branch, {
                ok: false,
                status: normalized.status,
                message: normalized.message,
            });
        }
        upsertJob(jobId, {
            status: "completed",
            completedAt: new Date().toISOString(),
        });
        return;
    }
    await mapWithConcurrency(branches, resolveOrdersTestConcurrency(), async (branch) => {
        try {
            const probe = await probeOrdersVendorAccess({
                token: ordersToken,
                globalEntityId: branch.globalEntityId,
                ordersVendorId: branch.ordersVendorId,
            });
            insertBranchResult(jobId, branch, {
                ok: true,
                status: null,
                message: probe.sampleVendorName ? undefined : "Token worked, but no live vendor sample was returned.",
                sampleVendorName: probe.sampleVendorName,
            });
        }
        catch (error) {
            const normalized = normalizeError(error);
            insertBranchResult(jobId, branch, {
                ok: false,
                status: normalized.status,
                message: normalized.message,
            });
        }
    });
    upsertJob(jobId, {
        status: "completed",
        completedAt: new Date().toISOString(),
    });
}
export function startSettingsTokenTestJob() {
    const settings = getSettings();
    const branches = listResolvedBranches({ enabledOnly: true });
    const jobId = randomUUID();
    const createdAt = new Date().toISOString();
    db.prepare(`
    INSERT INTO settings_token_test_jobs (
      id,
      status,
      createdAt,
      startedAt,
      completedAt,
      availabilityConfigured,
      availabilityOk,
      availabilityStatus,
      availabilityMessage,
      ordersConfigured,
      ordersConfigValid,
      ordersConfigMessage,
      ordersProbeOk,
      ordersProbeStatus,
      ordersProbeMessage,
      totalBranches,
      processedBranches,
      passedBranches,
      failedBranches
    ) VALUES (?, 'pending', ?, NULL, NULL, 0, 0, NULL, NULL, 0, 0, NULL, 0, NULL, NULL, ?, 0, 0, 0)
  `).run(jobId, createdAt, branches.length);
    pruneOldJobs();
    void runSettingsTokenTestJob(jobId, settings, branches).catch((error) => {
        const normalized = normalizeError(error);
        upsertJob(jobId, {
            status: "failed",
            completedAt: new Date().toISOString(),
            ordersProbeMessage: normalized.message,
            ordersProbeStatus: normalized.status,
        });
    });
    const snapshot = getSettingsTokenTestSnapshot(jobId);
    if (!snapshot) {
        throw new Error("Failed to create token test job");
    }
    return {
        jobId,
        snapshot,
    };
}
