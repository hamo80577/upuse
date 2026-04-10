import Database from "better-sqlite3";
import fs from "node:fs";
import { resolveDataDir, resolveDbFilePath } from "../../config/paths.js";

export const dataDir = resolveDataDir({ env: process.env });

if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

export const dbFilePath = resolveDbFilePath({ env: process.env });
export const db = new Database(dbFilePath);

db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");
