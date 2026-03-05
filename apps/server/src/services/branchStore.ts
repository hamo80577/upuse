import { db } from "../config/db.js";
import { z } from "zod";
import type { BranchMapping } from "../types/models.js";

interface BranchRow {
  id: number;
  name: string;
  chainName: string | null;
  ordersVendorId: number;
  availabilityVendorId: string;
  globalEntityId: string;
  enabled: number;
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

const BranchSchema = z.object({
  name: z.string().min(1).max(120),
  chainName: z.string().max(120),
  ordersVendorId: z.number().int().positive(),
  availabilityVendorId: z.string().min(1).max(30),
  globalEntityId: z.string().max(20),
  enabled: z.boolean(),
});

export function listBranches(): BranchMapping[] {
  const rows = db.prepare<[], BranchRow>("SELECT * FROM branches ORDER BY name ASC").all();
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

export function getBranchById(id: number): BranchMapping | null {
  const row = db.prepare<[number], BranchRow>("SELECT * FROM branches WHERE id=?").get(id);
  if (!row) return null;
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

export function addBranch(input: Omit<BranchMapping, "id">) {
  BranchSchema.parse(input);
  const info = db.prepare(`
    INSERT INTO branches (name, chainName, ordersVendorId, availabilityVendorId, globalEntityId, enabled)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(input.name, input.chainName, input.ordersVendorId, input.availabilityVendorId, input.globalEntityId, input.enabled ? 1 : 0);

  // Ensure runtime row exists
  db.prepare("INSERT OR IGNORE INTO branch_runtime (branchId) VALUES (?)").run(info.lastInsertRowid as number);

  return info.lastInsertRowid as number;
}

export function updateBranch(id: number, patch: Partial<Omit<BranchMapping, "id">>) {
  const current = db.prepare<[number], BranchRow>("SELECT * FROM branches WHERE id=?").get(id);
  if (!current) throw new Error("Branch not found");

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

  return merged as Omit<BranchMapping, "id">;
}

export function deleteBranch(id: number) {
  const result = db.prepare("DELETE FROM branches WHERE id=?").run(id);
  return result.changes;
}

export function getRuntime(branchId: number) {
  return db.prepare<[number], BranchRuntimeRow>("SELECT * FROM branch_runtime WHERE branchId=?").get(branchId) ?? null;
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
