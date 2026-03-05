import Database from "better-sqlite3";
import fs from "node:fs";
import crypto from "node:crypto";
import { resolveDataDir, resolveDbFilePath } from "./paths.js";
import { resolveEncryptionSecret } from "./secret.js";
export const dataDir = resolveDataDir({ env: process.env });
if (!fs.existsSync(dataDir))
    fs.mkdirSync(dataDir, { recursive: true });
export const dbFilePath = resolveDbFilePath({ env: process.env });
export const db = new Database(dbFilePath);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");
const secret = resolveEncryptionSecret({
    env: process.env,
    dataDir,
    existingEncryptedSettings: readExistingEncryptedSettings(),
});
const key = crypto.createHash("sha256").update(secret).digest(); // 32 bytes
const ivLen = 12;
function encrypt(plain) {
    const iv = crypto.randomBytes(ivLen);
    const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
    const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    return Buffer.concat([iv, tag, enc]).toString("base64");
}
function decrypt(payload) {
    const buf = Buffer.from(payload, "base64");
    const iv = buf.subarray(0, ivLen);
    const tag = buf.subarray(ivLen, ivLen + 16);
    const enc = buf.subarray(ivLen + 16);
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    const dec = Buffer.concat([decipher.update(enc), decipher.final()]);
    return dec.toString("utf8");
}
export const cryptoBox = { encrypt, decrypt };
function readExistingEncryptedSettings() {
    const hasSettingsTable = db
        .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'settings' LIMIT 1")
        .get();
    if (!hasSettingsTable)
        return [];
    const row = db.prepare("SELECT ordersTokenEnc, availabilityTokenEnc FROM settings WHERE id = 1").get();
    if (!row)
        return [];
    return [row.ordersTokenEnc, row.availabilityTokenEnc].filter((value) => typeof value === "string" && value.trim().length > 0);
}
export function migrate() {
    db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      ordersTokenEnc TEXT NOT NULL,
      availabilityTokenEnc TEXT NOT NULL,
      globalEntityId TEXT NOT NULL,
      chainNamesJson TEXT NOT NULL DEFAULT '[]',
      chainThresholdsJson TEXT NOT NULL DEFAULT '[]',
      lateThreshold INTEGER NOT NULL,
      unassignedThreshold INTEGER NOT NULL,
      tempCloseMinutes INTEGER NOT NULL,
      graceMinutes INTEGER NOT NULL,
      ordersRefreshSeconds INTEGER NOT NULL,
      availabilityRefreshSeconds INTEGER NOT NULL,
      maxVendorsPerOrdersRequest INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS branches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      chainName TEXT NOT NULL DEFAULT '',
      ordersVendorId INTEGER NOT NULL,
      availabilityVendorId TEXT NOT NULL,
      globalEntityId TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_branches_ordersVendorId ON branches(ordersVendorId);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_branches_availabilityVendorId ON branches(availabilityVendorId);

    CREATE TABLE IF NOT EXISTS branch_runtime (
      branchId INTEGER PRIMARY KEY,
      lastUpuseCloseUntil TEXT,
      lastUpuseCloseReason TEXT,
      lastUpuseCloseAt TEXT,
      lastUpuseCloseEventId INTEGER,
      lastExternalCloseUntil TEXT,
      lastExternalCloseAt TEXT,
      externalOpenDetectedAt TEXT,
      lastActionAt TEXT,
      FOREIGN KEY (branchId) REFERENCES branches(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      branchId INTEGER,
      ts TEXT NOT NULL,
      level TEXT NOT NULL,
      message TEXT NOT NULL,
      FOREIGN KEY (branchId) REFERENCES branches(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_logs_branch_ts ON logs(branchId, ts);

    CREATE TABLE IF NOT EXISTS action_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      branchId INTEGER NOT NULL,
      branchName TEXT NOT NULL,
      chainName TEXT NOT NULL DEFAULT '',
      ordersVendorId INTEGER NOT NULL,
      availabilityVendorId TEXT NOT NULL,
      source TEXT NOT NULL,
      actionType TEXT NOT NULL,
      ts TEXT NOT NULL,
      reason TEXT,
      note TEXT,
      closedUntil TEXT,
      reopenedAt TEXT,
      reopenMode TEXT,
      totalToday INTEGER NOT NULL DEFAULT 0,
      cancelledToday INTEGER NOT NULL DEFAULT 0,
      doneToday INTEGER NOT NULL DEFAULT 0,
      activeNow INTEGER NOT NULL DEFAULT 0,
      lateNow INTEGER NOT NULL DEFAULT 0,
      unassignedNow INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (branchId) REFERENCES branches(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_action_events_ts ON action_events(ts);
    CREATE INDEX IF NOT EXISTS idx_action_events_branch_ts ON action_events(branchId, ts);
  `);
    const settingsColumns = db.prepare("PRAGMA table_info(settings)").all();
    if (!settingsColumns.some((column) => column.name === "chainNamesJson")) {
        db.exec("ALTER TABLE settings ADD COLUMN chainNamesJson TEXT NOT NULL DEFAULT '[]'");
    }
    if (!settingsColumns.some((column) => column.name === "chainThresholdsJson")) {
        db.exec("ALTER TABLE settings ADD COLUMN chainThresholdsJson TEXT NOT NULL DEFAULT '[]'");
    }
    const branchColumns = db.prepare("PRAGMA table_info(branches)").all();
    if (!branchColumns.some((column) => column.name === "chainName")) {
        db.exec("ALTER TABLE branches ADD COLUMN chainName TEXT NOT NULL DEFAULT ''");
    }
    const branchRuntimeColumns = db.prepare("PRAGMA table_info(branch_runtime)").all();
    if (!branchRuntimeColumns.some((column) => column.name === "lastExternalCloseUntil")) {
        db.exec("ALTER TABLE branch_runtime ADD COLUMN lastExternalCloseUntil TEXT");
    }
    if (!branchRuntimeColumns.some((column) => column.name === "lastExternalCloseAt")) {
        db.exec("ALTER TABLE branch_runtime ADD COLUMN lastExternalCloseAt TEXT");
    }
    if (!branchRuntimeColumns.some((column) => column.name === "lastUpuseCloseEventId")) {
        db.exec("ALTER TABLE branch_runtime ADD COLUMN lastUpuseCloseEventId INTEGER");
    }
    const row = db.prepare("SELECT id FROM settings WHERE id=1").get();
    if (!row) {
        const defaultSettings = {
            ordersTokenEnc: cryptoBox.encrypt(""),
            availabilityTokenEnc: cryptoBox.encrypt(""),
            globalEntityId: "HF_EG",
            chainNamesJson: "[]",
            chainThresholdsJson: "[]",
            lateThreshold: 5,
            unassignedThreshold: 5,
            tempCloseMinutes: 30,
            graceMinutes: 5,
            ordersRefreshSeconds: 30,
            availabilityRefreshSeconds: 30,
            maxVendorsPerOrdersRequest: 50,
        };
        db.prepare(`
      INSERT INTO settings (
        id, ordersTokenEnc, availabilityTokenEnc, globalEntityId,
        chainNamesJson, chainThresholdsJson,
        lateThreshold, unassignedThreshold, tempCloseMinutes, graceMinutes,
        ordersRefreshSeconds, availabilityRefreshSeconds, maxVendorsPerOrdersRequest
      ) VALUES (
        1, @ordersTokenEnc, @availabilityTokenEnc, @globalEntityId,
        @chainNamesJson, @chainThresholdsJson,
        @lateThreshold, @unassignedThreshold, @tempCloseMinutes, @graceMinutes,
        @ordersRefreshSeconds, @availabilityRefreshSeconds, @maxVendorsPerOrdersRequest
      )
    `).run(defaultSettings);
    }
    const settingsRow = db.prepare("SELECT chainNamesJson, chainThresholdsJson FROM settings WHERE id=1").get();
    if (settingsRow) {
        const rawThresholds = typeof settingsRow.chainThresholdsJson === "string" ? settingsRow.chainThresholdsJson.trim() : "";
        if (!rawThresholds || rawThresholds === "[]") {
            let chainNames = [];
            try {
                const parsedNames = JSON.parse(settingsRow.chainNamesJson || "[]");
                if (Array.isArray(parsedNames)) {
                    chainNames = parsedNames
                        .filter((value) => typeof value === "string")
                        .map((value) => value.trim())
                        .filter((value, index, values) => value && values.findIndex((item) => item.toLowerCase() === value.toLowerCase()) === index);
                }
            }
            catch { }
            if (!chainNames.length) {
                chainNames = db
                    .prepare("SELECT DISTINCT chainName FROM branches WHERE TRIM(chainName) <> '' ORDER BY chainName ASC")
                    .all()
                    .map((rowItem) => rowItem.chainName.trim())
                    .filter(Boolean);
            }
            if (chainNames.length) {
                db.prepare("UPDATE settings SET chainThresholdsJson = ?, chainNamesJson = ? WHERE id = 1").run(JSON.stringify(chainNames.map((name) => ({
                    name,
                    lateThreshold: 5,
                    unassignedThreshold: 5,
                }))), JSON.stringify(chainNames));
            }
        }
    }
}
export function pruneLogs(branchId, keep) {
    if (branchId === null) {
        // Keep global logs (branchId NULL)
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
