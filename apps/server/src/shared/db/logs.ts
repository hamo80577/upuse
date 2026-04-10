import { db } from "./connection.js";

export function pruneLogs(branchId: number | null, keep: number) {
  if (branchId === null) {
    db.prepare(`
      DELETE FROM logs WHERE id NOT IN (
        SELECT id FROM logs WHERE branchId IS NULL ORDER BY id DESC LIMIT ?
      ) AND branchId IS NULL
    `).run(keep);
    return;
  }

  db.prepare(`
    DELETE FROM logs WHERE id NOT IN (
      SELECT id FROM logs WHERE branchId = ? ORDER BY id DESC LIMIT ?
    ) AND branchId = ?
  `).run(branchId, keep, branchId);
}
