import type Database from "better-sqlite3";
import { resolveBootstrapGlobalEntityId } from "../../../config/globalEntityId.js";

type EncryptLike = {
  encrypt(value: string): string;
};

export function ensureDefaultSettingsRow(params: {
  cryptoBox: EncryptLike;
  db: Database.Database;
  env: NodeJS.ProcessEnv;
}) {
  const { cryptoBox, db, env } = params;
  const row = db.prepare("SELECT id FROM settings WHERE id=1").get();

  if (row) {
    return;
  }

  const defaultSettings = {
    ordersTokenEnc: cryptoBox.encrypt(""),
    availabilityTokenEnc: cryptoBox.encrypt(""),
    globalEntityId: resolveBootstrapGlobalEntityId(env),
    chainNamesJson: "[]",
    chainThresholdsJson: "[]",
    lateThreshold: 5,
    lateReopenThreshold: 0,
    unassignedThreshold: 5,
    unassignedReopenThreshold: 0,
    readyThreshold: 0,
    readyReopenThreshold: 0,
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
      lateThreshold, lateReopenThreshold, unassignedThreshold, unassignedReopenThreshold, readyThreshold, readyReopenThreshold, tempCloseMinutes, graceMinutes,
      ordersRefreshSeconds, availabilityRefreshSeconds, maxVendorsPerOrdersRequest
    ) VALUES (
      1, @ordersTokenEnc, @availabilityTokenEnc, @globalEntityId,
      @chainNamesJson, @chainThresholdsJson,
      @lateThreshold, @lateReopenThreshold, @unassignedThreshold, @unassignedReopenThreshold, @readyThreshold, @readyReopenThreshold, @tempCloseMinutes, @graceMinutes,
      @ordersRefreshSeconds, @availabilityRefreshSeconds, @maxVendorsPerOrdersRequest
    )
  `).run(defaultSettings);
}

export function backfillLegacyChainThresholds(db: Database.Database) {
  const settingsRow = db.prepare("SELECT chainNamesJson, chainThresholdsJson FROM settings WHERE id=1").get() as
    | { chainNamesJson?: string; chainThresholdsJson?: string }
    | undefined;

  if (!settingsRow) {
    return;
  }

  const rawThresholds = typeof settingsRow.chainThresholdsJson === "string" ? settingsRow.chainThresholdsJson.trim() : "";
  if (rawThresholds && rawThresholds !== "[]") {
    return;
  }

  let chainNames: string[] = [];

  try {
    const parsedNames = JSON.parse(settingsRow.chainNamesJson || "[]");
    if (Array.isArray(parsedNames)) {
      chainNames = parsedNames
        .filter((value): value is string => typeof value === "string")
        .map((value) => value.trim())
        .filter((value, index, values) => value && values.findIndex((item) => item.toLowerCase() === value.toLowerCase()) === index);
    }
  } catch {}

  if (!chainNames.length) {
    chainNames = (db
      .prepare("SELECT DISTINCT chainName FROM branches WHERE TRIM(chainName) <> '' ORDER BY chainName ASC")
      .all() as Array<{ chainName: string }>)
      .map((row) => row.chainName.trim())
      .filter(Boolean);
  }

  if (!chainNames.length) {
    return;
  }

  db.prepare("UPDATE settings SET chainThresholdsJson = ?, chainNamesJson = ? WHERE id = 1").run(
    JSON.stringify(
      chainNames.map((name) => ({
        name,
        lateThreshold: 5,
        lateReopenThreshold: 0,
        unassignedThreshold: 5,
        unassignedReopenThreshold: 0,
        readyThreshold: 0,
        readyReopenThreshold: 0,
        capacityRuleEnabled: true,
        capacityPerHourEnabled: false,
        capacityPerHourLimit: null,
      })),
    ),
    JSON.stringify(chainNames),
  );
}
