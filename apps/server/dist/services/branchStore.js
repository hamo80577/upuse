import { z } from "zod";
import { db } from "../config/db.js";
import { getGlobalEntityId } from "./settingsStore.js";
import { getVendorCatalogItem } from "./vendorCatalogStore.js";
const AddBranchSchema = z.object({
    availabilityVendorId: z.string().trim().min(1).max(30),
    chainName: z.string().trim().max(120).default(""),
    enabled: z.boolean().default(true),
});
const ThresholdOverrideSchema = z.object({
    lateThresholdOverride: z.number().int().min(0).max(999).nullable(),
    unassignedThresholdOverride: z.number().int().min(0).max(999).nullable(),
}).superRefine((value, ctx) => {
    const hasLate = value.lateThresholdOverride != null;
    const hasUnassigned = value.unassignedThresholdOverride != null;
    if (hasLate === hasUnassigned)
        return;
    ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Branch threshold overrides must include both late and unassigned values.",
        path: ["lateThresholdOverride"],
    });
});
function mapBranchRow(row) {
    return {
        id: row.id,
        name: row.name,
        chainName: row.chainName ?? "",
        ordersVendorId: row.ordersVendorId ?? null,
        availabilityVendorId: row.availabilityVendorId,
        enabled: !!row.enabled,
        catalogState: row.name && row.ordersVendorId ? "available" : "missing",
        lateThresholdOverride: row.lateThresholdOverride,
        unassignedThresholdOverride: row.unassignedThresholdOverride,
    };
}
function buildResolvedBranch(branch, globalEntityId) {
    if (!branch.name || !branch.ordersVendorId || branch.catalogState !== "available") {
        return null;
    }
    return {
        ...branch,
        name: branch.name,
        ordersVendorId: branch.ordersVendorId,
        globalEntityId,
        catalogState: "available",
    };
}
function getJoinedBranchQuery(whereClause = "", orderClause = "ORDER BY LOWER(COALESCE(vendor_catalog.name, branches.availabilityVendorId)) ASC, branches.id ASC") {
    return `
    SELECT
      branches.id,
      branches.availabilityVendorId,
      branches.chainName,
      branches.enabled,
      branches.lateThresholdOverride,
      branches.unassignedThresholdOverride,
      vendor_catalog.name,
      vendor_catalog.ordersVendorId
    FROM branches
    LEFT JOIN vendor_catalog
      ON vendor_catalog.availabilityVendorId = branches.availabilityVendorId
    ${whereClause}
    ${orderClause}
  `;
}
export function listBranches() {
    const rows = db.prepare(getJoinedBranchQuery()).all();
    return rows.map(mapBranchRow);
}
export function listResolvedBranches(options) {
    const whereClause = options?.enabledOnly ? "WHERE branches.enabled = 1" : "";
    const rows = db.prepare(getJoinedBranchQuery(whereClause)).all();
    const globalEntityId = getGlobalEntityId();
    return rows
        .map(mapBranchRow)
        .map((branch) => buildResolvedBranch(branch, globalEntityId))
        .filter((branch) => branch !== null);
}
export function getBranchById(id) {
    const row = db.prepare(getJoinedBranchQuery("WHERE branches.id = ?", "")).get(id);
    return row ? mapBranchRow(row) : null;
}
export function getResolvedBranchById(id) {
    const branch = getBranchById(id);
    return branch ? buildResolvedBranch(branch, getGlobalEntityId()) : null;
}
export function addBranch(input) {
    const parsed = AddBranchSchema.parse(input);
    const catalogItem = getVendorCatalogItem(parsed.availabilityVendorId);
    if (!catalogItem) {
        throw new Error("Vendor catalog item not found");
    }
    const info = db.prepare(`
    INSERT INTO branches (
      availabilityVendorId,
      chainName,
      enabled,
      lateThresholdOverride,
      unassignedThresholdOverride
    )
    VALUES (?, ?, ?, NULL, NULL)
  `).run(catalogItem.availabilityVendorId, parsed.chainName, parsed.enabled ? 1 : 0);
    db.prepare("INSERT OR IGNORE INTO branch_runtime (branchId) VALUES (?)").run(info.lastInsertRowid);
    return info.lastInsertRowid;
}
function ensureBranchExists(id) {
    const row = db.prepare("SELECT * FROM branches WHERE id = ?").get(id);
    if (!row)
        throw new Error("Branch not found");
    return row;
}
export function setBranchMonitoringEnabled(id, enabled) {
    ensureBranchExists(id);
    db.prepare("UPDATE branches SET enabled = ? WHERE id = ?").run(enabled ? 1 : 0, id);
    return getBranchById(id);
}
export function setBranchThresholdOverrides(id, overrides) {
    ensureBranchExists(id);
    const parsed = ThresholdOverrideSchema.parse(overrides);
    db.prepare(`
    UPDATE branches
    SET lateThresholdOverride = ?,
        unassignedThresholdOverride = ?
    WHERE id = ?
  `).run(parsed.lateThresholdOverride, parsed.unassignedThresholdOverride, id);
    return getBranchById(id);
}
export function deleteBranch(id) {
    const result = db.prepare("DELETE FROM branches WHERE id = ?").run(id);
    return result.changes;
}
export function getRuntime(branchId) {
    return db.prepare("SELECT * FROM branch_runtime WHERE branchId = ?").get(branchId) ?? null;
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
      lastUpuseCloseUntil = excluded.lastUpuseCloseUntil,
      lastUpuseCloseReason = excluded.lastUpuseCloseReason,
      lastUpuseCloseAt = excluded.lastUpuseCloseAt,
      lastUpuseCloseEventId = excluded.lastUpuseCloseEventId,
      lastExternalCloseUntil = excluded.lastExternalCloseUntil,
      lastExternalCloseAt = excluded.lastExternalCloseAt,
      externalOpenDetectedAt = excluded.externalOpenDetectedAt,
      lastActionAt = excluded.lastActionAt
  `).run(merged);
    return merged;
}
