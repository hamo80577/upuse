import { db } from "../../../config/db.js";
import { normalizeAssignedChains } from "./trackerAccess.js";

function ensureAssignmentTable() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS upuse_user_chain_assignments (
      userId INTEGER NOT NULL,
      chainName TEXT NOT NULL COLLATE NOCASE,
      assignedAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (userId, chainName),
      FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_upuse_user_chain_assignments_user
      ON upuse_user_chain_assignments(userId);
  `);
}

export function getAssignedChainsForUser(userId: number) {
  try {
    ensureAssignmentTable();
    const rows = db.prepare<[number], { chainName: string }>(`
      SELECT chainName
      FROM upuse_user_chain_assignments
      WHERE userId = ?
      ORDER BY LOWER(chainName) ASC, chainName ASC
    `).all(userId);

    return normalizeAssignedChains(rows.map((row) => row.chainName));
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (/no such table/i.test(message)) {
      return [];
    }
    throw error;
  }
}

export function setAssignedChainsForUser(userId: number, chains: readonly string[]) {
  ensureAssignmentTable();
  const normalized = normalizeAssignedChains(chains);

  db.prepare<[number]>("DELETE FROM upuse_user_chain_assignments WHERE userId = ?").run(userId);
  const insert = db.prepare<[number, string]>(`
    INSERT OR IGNORE INTO upuse_user_chain_assignments (userId, chainName)
    VALUES (?, ?)
  `);

  for (const chainName of normalized) {
    insert.run(userId, chainName);
  }

  return normalized;
}

function parseJsonArray(raw: unknown) {
  if (typeof raw !== "string" || !raw.trim()) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function listSettingsChainNames() {
  try {
    const row = db.prepare<[], { chainNamesJson?: string; chainThresholdsJson?: string }>(`
      SELECT chainNamesJson, chainThresholdsJson
      FROM settings
      WHERE id = 1
    `).get();

    if (!row) return [];
    const thresholdNames = parseJsonArray(row.chainThresholdsJson)
      .map((item) => (typeof item === "object" && item !== null ? (item as { name?: unknown }).name : item))
      .filter((value): value is string => typeof value === "string");
    const legacyNames = parseJsonArray(row.chainNamesJson)
      .filter((value): value is string => typeof value === "string");

    return [...thresholdNames, ...legacyNames];
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (/no such table/i.test(message) || /no such column/i.test(message)) {
      return [];
    }
    throw error;
  }
}

function listBranchChainNames() {
  try {
    const rows = db.prepare<[], { chainName: string }>(`
      SELECT DISTINCT TRIM(chainName) AS chainName
      FROM branches
      WHERE TRIM(chainName) <> ''
      ORDER BY LOWER(TRIM(chainName)) ASC
    `).all();
    return rows.map((row) => row.chainName);
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (/no such table/i.test(message) || /no such column/i.test(message)) {
      return [];
    }
    throw error;
  }
}

export function listUpuseChainOptions() {
  return normalizeAssignedChains([
    ...listSettingsChainNames(),
    ...listBranchChainNames(),
  ]).sort((left, right) => left.localeCompare(right));
}
