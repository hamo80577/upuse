import { db } from "../config/db.js";
import { z } from "zod";
const BranchSchema = z.object({
    name: z.string().min(1).max(120),
    chainName: z.string().max(120),
    ordersVendorId: z.number().int().positive(),
    availabilityVendorId: z.string().min(1).max(30),
    globalEntityId: z.string().max(20),
    enabled: z.boolean(),
});
export function listBranches() {
    const rows = db.prepare("SELECT * FROM branches ORDER BY name ASC").all();
    return rows.map((r) => ({
        id: r.id,
        name: r.name,
        chainName: r.chainName ?? "",
        ordersVendorId: r.ordersVendorId,
        availabilityVendorId: r.availabilityVendorId,
        globalEntityId: r.globalEntityId,
        enabled: !!r.enabled,
    }));
}
export function getBranchById(id) {
    const row = db.prepare("SELECT * FROM branches WHERE id=?").get(id);
    if (!row)
        return null;
    return {
        id: row.id,
        name: row.name,
        chainName: row.chainName ?? "",
        ordersVendorId: row.ordersVendorId,
        availabilityVendorId: row.availabilityVendorId,
        globalEntityId: row.globalEntityId,
        enabled: !!row.enabled,
    };
}
export function addBranch(input) {
    BranchSchema.parse(input);
    const info = db.prepare(`
    INSERT INTO branches (name, chainName, ordersVendorId, availabilityVendorId, globalEntityId, enabled)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(input.name, input.chainName, input.ordersVendorId, input.availabilityVendorId, input.globalEntityId, input.enabled ? 1 : 0);
    // Ensure runtime row exists
    db.prepare("INSERT OR IGNORE INTO branch_runtime (branchId) VALUES (?)").run(info.lastInsertRowid);
    return info.lastInsertRowid;
}
export function updateBranch(id, patch) {
    const current = db.prepare("SELECT * FROM branches WHERE id=?").get(id);
    if (!current)
        throw new Error("Branch not found");
    const merged = {
        name: patch.name ?? current.name,
        chainName: patch.chainName ?? current.chainName ?? "",
        ordersVendorId: patch.ordersVendorId ?? current.ordersVendorId,
        availabilityVendorId: patch.availabilityVendorId ?? current.availabilityVendorId,
        globalEntityId: patch.globalEntityId ?? current.globalEntityId,
        enabled: patch.enabled ?? !!current.enabled,
    };
    BranchSchema.parse(merged);
    db.prepare(`
    UPDATE branches SET name=?, chainName=?, ordersVendorId=?, availabilityVendorId=?, globalEntityId=?, enabled=?
    WHERE id=?
  `).run(merged.name, merged.chainName, merged.ordersVendorId, merged.availabilityVendorId, merged.globalEntityId, merged.enabled ? 1 : 0, id);
    db.prepare("INSERT OR IGNORE INTO branch_runtime (branchId) VALUES (?)").run(id);
    return merged;
}
export function deleteBranch(id) {
    const result = db.prepare("DELETE FROM branches WHERE id=?").run(id);
    return result.changes;
}
export function getRuntime(branchId) {
    return db.prepare("SELECT * FROM branch_runtime WHERE branchId=?").get(branchId) ?? null;
}
export function setRuntime(branchId, patch) {
    const current = getRuntime(branchId) ?? { branchId };
    const merged = { ...current, ...patch };
    db.prepare(`
    INSERT INTO branch_runtime (
      branchId,
      lastUpuseCloseUntil,
      lastUpuseCloseReason,
      lastUpuseCloseAt,
      lastUpuseCloseEventId,
      lastExternalCloseUntil,
      lastExternalCloseAt,
      externalOpenDetectedAt,
      lastActionAt
    )
    VALUES (
      @branchId,
      @lastUpuseCloseUntil,
      @lastUpuseCloseReason,
      @lastUpuseCloseAt,
      @lastUpuseCloseEventId,
      @lastExternalCloseUntil,
      @lastExternalCloseAt,
      @externalOpenDetectedAt,
      @lastActionAt
    )
    ON CONFLICT(branchId) DO UPDATE SET
      lastUpuseCloseUntil=excluded.lastUpuseCloseUntil,
      lastUpuseCloseReason=excluded.lastUpuseCloseReason,
      lastUpuseCloseAt=excluded.lastUpuseCloseAt,
      lastUpuseCloseEventId=excluded.lastUpuseCloseEventId,
      lastExternalCloseUntil=excluded.lastExternalCloseUntil,
      lastExternalCloseAt=excluded.lastExternalCloseAt,
      externalOpenDetectedAt=excluded.externalOpenDetectedAt,
      lastActionAt=excluded.lastActionAt
  `).run(merged);
    return merged;
}
