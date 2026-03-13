import fs from "node:fs";
import { db } from "../config/db.js";
import { resolveVendorCatalogCsvPath } from "../config/paths.js";
import type { LocalVendorCatalogItem, OrdersVendorId } from "../types/models.js";

interface VendorCatalogRow {
  availabilityVendorId: string;
  ordersVendorId: number;
  name: string;
}

interface SkippedVendorCatalogRow {
  lineNumber: number;
  reason: string;
}

interface JoinedVendorCatalogRow extends VendorCatalogRow {
  branchId: number | null;
  chainName: string | null;
  enabled: number | null;
}

const REQUIRED_COLUMNS = new Set(["name", "availabilityVendorId", "ordersVendorId"]);

function parseCsvLine(line: string) {
  const out: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];

    if (char === "\"") {
      const next = line[index + 1];
      if (inQuotes && next === "\"") {
        current += "\"";
        index += 1;
        continue;
      }
      inQuotes = !inQuotes;
      continue;
    }

    if (char === "," && !inQuotes) {
      out.push(current);
      current = "";
      continue;
    }

    current += char;
  }

  if (inQuotes) {
    throw new Error("Malformed CSV row with unclosed quotes.");
  }

  out.push(current);
  return out;
}

function parseCsvContent(raw: string) {
  const normalized = raw.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const lines = normalized.split("\n").filter((line) => line.length > 0);
  if (!lines.length) {
    throw new Error("Vendor catalog CSV is empty.");
  }

  const header = parseCsvLine(lines[0]).map((value) => value.trim());
  for (const column of REQUIRED_COLUMNS) {
    if (!header.includes(column)) {
      throw new Error(`Vendor catalog CSV is missing required column "${column}".`);
    }
  }

  return {
    header,
    rows: lines.slice(1).map((line, index) => ({
      lineNumber: index + 2,
      values: parseCsvLine(line),
    })),
  };
}

export function parseVendorCatalogCsv(raw: string) {
  const parsed = parseCsvContent(raw);
  const availabilityIds = new Set<string>();
  const ordersIds = new Set<number>();
  const rows: VendorCatalogRow[] = [];
  const skipped: SkippedVendorCatalogRow[] = [];

  for (const row of parsed.rows) {
    const record = Object.fromEntries(parsed.header.map((column, index) => [column, (row.values[index] ?? "").trim()]));
    const name = record.name ?? "";
    const availabilityVendorId = record.availabilityVendorId ?? "";
    const ordersVendorIdRaw = record.ordersVendorId ?? "";
    const ordersVendorId = Number(ordersVendorIdRaw);

    if (!name) {
      skipped.push({
        lineNumber: row.lineNumber,
        reason: 'missing "name"',
      });
      continue;
    }
    if (!availabilityVendorId) {
      skipped.push({
        lineNumber: row.lineNumber,
        reason: 'missing "availabilityVendorId"',
      });
      continue;
    }
    if (!ordersVendorIdRaw || !Number.isInteger(ordersVendorId) || ordersVendorId <= 0) {
      skipped.push({
        lineNumber: row.lineNumber,
        reason: 'invalid "ordersVendorId"',
      });
      continue;
    }
    if (availabilityIds.has(availabilityVendorId)) {
      throw new Error(`Vendor catalog CSV has duplicate availabilityVendorId "${availabilityVendorId}".`);
    }
    if (ordersIds.has(ordersVendorId)) {
      throw new Error(`Vendor catalog CSV has duplicate ordersVendorId "${ordersVendorId}".`);
    }

    availabilityIds.add(availabilityVendorId);
    ordersIds.add(ordersVendorId);
    rows.push({
      name,
      availabilityVendorId,
      ordersVendorId,
    });
  }

  return {
    rows,
    skipped,
  };
}

export function syncVendorCatalogFromCsv(csvPath = resolveVendorCatalogCsvPath(), warn: (message: string) => void = console.warn) {
  if (!fs.existsSync(csvPath)) {
    throw new Error(`Vendor catalog CSV was not found at ${csvPath}.`);
  }

  const { rows, skipped } = parseVendorCatalogCsv(fs.readFileSync(csvPath, "utf8"));
  if (!rows.length) {
    throw new Error(`Vendor catalog CSV at ${csvPath} did not contain any importable rows.`);
  }

  const write = db.transaction((items: VendorCatalogRow[]) => {
    db.prepare("DELETE FROM vendor_catalog").run();

    const insert = db.prepare(`
      INSERT INTO vendor_catalog (
        availabilityVendorId,
        ordersVendorId,
        name
      ) VALUES (?, ?, ?)
    `);

    for (const item of items) {
      insert.run(item.availabilityVendorId, item.ordersVendorId, item.name);
    }

    db.prepare(`
      UPDATE branches
      SET enabled = 0
      WHERE availabilityVendorId NOT IN (
        SELECT availabilityVendorId FROM vendor_catalog
      )
    `).run();
  });

  write(rows);
  if (skipped.length) {
    const preview = skipped
      .slice(0, 5)
      .map((item) => `line ${item.lineNumber}: ${item.reason}`)
      .join(", ");
    const suffix = skipped.length > 5 ? ", ..." : "";
    warn(`Vendor catalog import skipped ${skipped.length} row(s) from ${csvPath}. ${preview}${suffix}`);
  }

  return {
    count: rows.length,
    skippedCount: skipped.length,
    csvPath,
  };
}

function mapJoinedRow(row: JoinedVendorCatalogRow): LocalVendorCatalogItem {
  return {
    availabilityVendorId: row.availabilityVendorId,
    ordersVendorId: row.ordersVendorId,
    name: row.name,
    alreadyAdded: typeof row.branchId === "number",
    branchId: row.branchId ?? null,
    chainName: row.chainName ?? null,
    enabled: row.enabled == null ? null : row.enabled === 1,
  };
}

export function listVendorCatalog(): LocalVendorCatalogItem[] {
  const rows = db.prepare<[], JoinedVendorCatalogRow>(`
    SELECT
      vendor_catalog.availabilityVendorId,
      vendor_catalog.ordersVendorId,
      vendor_catalog.name,
      branches.id AS branchId,
      branches.chainName AS chainName,
      branches.enabled AS enabled
    FROM vendor_catalog
    LEFT JOIN branches
      ON branches.availabilityVendorId = vendor_catalog.availabilityVendorId
    ORDER BY LOWER(vendor_catalog.name) ASC, vendor_catalog.availabilityVendorId ASC
  `).all();

  return rows.map(mapJoinedRow);
}

export function getVendorCatalogItem(availabilityVendorId: string): {
  availabilityVendorId: string;
  ordersVendorId: OrdersVendorId;
  name: string;
} | null {
  const row = db.prepare<[string], VendorCatalogRow>(`
    SELECT availabilityVendorId, ordersVendorId, name
    FROM vendor_catalog
    WHERE availabilityVendorId = ?
  `).get(availabilityVendorId);

  return row
    ? {
      availabilityVendorId: row.availabilityVendorId,
      ordersVendorId: row.ordersVendorId,
      name: row.name,
    }
    : null;
}
