import type Database from "better-sqlite3";
import { buildOpsSchemaSql } from "./schema.js";

export function applyOpsSchemaMigrations(db: Database.Database) {
  db.exec(buildOpsSchemaSql());
}

