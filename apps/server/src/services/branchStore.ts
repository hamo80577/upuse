import { z } from "zod";
import { db } from "../config/db.js";
import { FIXED_GLOBAL_ENTITY_ID } from "../config/constants.js";
import { getVendorCatalogItem } from "./vendorCatalogStore.js";
import type { BranchMapping, ResolvedBranchMapping } from "../types/models.js";

interface BranchRow {
  id: number;
  availabilityVendorId: string;
  chainName: string | null;
  enabled: number;
  lateThresholdOverride: number | null;
  unassignedThresholdOverride: number | null;
}

interface JoinedBranchRow extends BranchRow {
  name: string | null;
  ordersVendorId: number | null;
}

interface BranchRuntimeRow {
  branchId: number;
  lastUpuseCloseUntil?: string | null;
  lastUpuseCloseReason?: string | null;
  lastUpuseCloseAt?: string | null;
  lastUpuseCloseEventId?: number | null;
  lastExternalCloseUntil?: string | null;
  lastExternalCloseAt?: string | null;
  externalOpenDetectedAt?: string | null;
  lastActionAt?: string | null;
}

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

  if (hasLate === hasUnassigned) return;

  ctx.addIssue({
    code: z.ZodIssueCode.custom,
    message: "Branch threshold overrides must include both late and unassigned values.",
    path: ["lateThresholdOverride"],
  });
});

function mapBranchRow(row: JoinedBranchRow): BranchMapping {
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

function buildResolvedBranch(branch: BranchMapping): ResolvedBranchMapping | null {
  if (!branch.name || !branch.ordersVendorId || branch.catalogState !== "available") {
    return null;
  }

  return {
    ...branch,
    name: branch.name,
    ordersVendorId: branch.ordersVendorId,
    globalEntityId: FIXED_GLOBAL_ENTITY_ID,
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

export function listBranches(): BranchMapping[] {
  const rows = db.prepare<[], JoinedBranchRow>(getJoinedBranchQuery()).all();
  return rows.map(mapBranchRow);
}

export function listResolvedBranches(options?: { enabledOnly?: boolean }): ResolvedBranchMapping[] {
  const whereClause = options?.enabledOnly ? "WHERE branches.enabled = 1" : "";
  const rows = db.prepare<[], JoinedBranchRow>(getJoinedBranchQuery(whereClause)).all();
  return rows
    .map(mapBranchRow)
    .map(buildResolvedBranch)
    .filter((branch): branch is ResolvedBranchMapping => branch !== null);
}

export function getBranchById(id: number): BranchMapping | null {
  const row = db.prepare<[number], JoinedBranchRow>(getJoinedBranchQuery("WHERE branches.id = ?", "")).get(id);
  return row ? mapBranchRow(row) : null;
}

export function getResolvedBranchById(id: number): ResolvedBranchMapping | null {
  const branch = getBranchById(id);
  return branch ? buildResolvedBranch(branch) : null;
}

export function addBranch(input: { availabilityVendorId: string; chainName?: string; enabled?: boolean }) {
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
  `).run(
    catalogItem.availabilityVendorId,
    parsed.chainName,
    parsed.enabled ? 1 : 0,
  );

  db.prepare("INSERT OR IGNORE INTO branch_runtime (branchId) VALUES (?)").run(info.lastInsertRowid as number);
  return info.lastInsertRowid as number;
}

function ensureBranchExists(id: number) {
  const row = db.prepare<[number], BranchRow>("SELECT * FROM branches WHERE id = ?").get(id);
  if (!row) throw new Error("Branch not found");
  return row;
}

export function setBranchMonitoringEnabled(id: number, enabled: boolean) {
  ensureBranchExists(id);
  db.prepare("UPDATE branches SET enabled = ? WHERE id = ?").run(enabled ? 1 : 0, id);
  return getBranchById(id);
}

export function setBranchThresholdOverrides(
  id: number,
  overrides: {
    lateThresholdOverride: number | null;
    unassignedThresholdOverride: number | null;
  },
) {
  ensureBranchExists(id);
  const parsed = ThresholdOverrideSchema.parse(overrides);
  db.prepare(`
    UPDATE branches
    SET lateThresholdOverride = ?,
        unassignedThresholdOverride = ?
    WHERE id = ?
  `).run(
    parsed.lateThresholdOverride,
    parsed.unassignedThresholdOverride,
    id,
  );
  return getBranchById(id);
}

export function deleteBranch(id: number) {
  const result = db.prepare("DELETE FROM branches WHERE id = ?").run(id);
  return result.changes;
}

export function getRuntime(branchId: number) {
  return db.prepare<[number], BranchRuntimeRow>("SELECT * FROM branch_runtime WHERE branchId = ?").get(branchId) ?? null;
}

export function setRuntime(branchId: number, patch: Partial<BranchRuntimeRow>) {
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
