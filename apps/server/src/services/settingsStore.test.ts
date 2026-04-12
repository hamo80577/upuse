import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { TEST_GLOBAL_ENTITY_ID } from "../../../../test/globalEntityId";

vi.mock("../config/db.js", async () => {
  const Database = (await import("better-sqlite3")).default;
  const db = new Database(":memory:");
  return {
    db,
    cryptoBox: {
      encrypt(value: string) {
        return `enc:${value}`;
      },
      decrypt(value: string) {
        return value.startsWith("enc:") ? value.slice(4) : value;
      },
    },
  };
});

import { db } from "../config/db.js";
import { getSettings, updateSettings } from "./settingsStore.js";

function seedSettingsRow() {
  db.exec(`
    DROP TABLE IF EXISTS settings;

    CREATE TABLE settings (
      id INTEGER PRIMARY KEY,
      ordersTokenEnc TEXT NOT NULL,
      availabilityTokenEnc TEXT NOT NULL,
      globalEntityId TEXT NOT NULL,
      chainNamesJson TEXT NOT NULL,
      chainThresholdsJson TEXT NOT NULL,
      lateThreshold INTEGER NOT NULL,
      lateReopenThreshold INTEGER NOT NULL,
      unassignedThreshold INTEGER NOT NULL,
      unassignedReopenThreshold INTEGER NOT NULL,
      readyThreshold INTEGER,
      readyReopenThreshold INTEGER,
      tempCloseMinutes INTEGER NOT NULL,
      graceMinutes INTEGER NOT NULL,
      ordersRefreshSeconds INTEGER NOT NULL,
      availabilityRefreshSeconds INTEGER NOT NULL,
      maxVendorsPerOrdersRequest INTEGER NOT NULL
    );
  `);

  db.prepare(`
    INSERT INTO settings (
      id,
      ordersTokenEnc,
      availabilityTokenEnc,
      globalEntityId,
      chainNamesJson,
      chainThresholdsJson,
      lateThreshold,
      lateReopenThreshold,
      unassignedThreshold,
      unassignedReopenThreshold,
      readyThreshold,
      readyReopenThreshold,
      tempCloseMinutes,
      graceMinutes,
      ordersRefreshSeconds,
      availabilityRefreshSeconds,
      maxVendorsPerOrdersRequest
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    1,
    "enc:orders-token",
    "enc:availability-token",
    TEST_GLOBAL_ENTITY_ID,
    JSON.stringify(["Chain A"]),
    JSON.stringify([
      {
        name: "Chain A",
        lateThreshold: 5,
        lateReopenThreshold: 2,
        unassignedThreshold: 4,
        unassignedReopenThreshold: 1,
        readyThreshold: 3,
        readyReopenThreshold: 1,
        capacityRuleEnabled: true,
        capacityPerHourEnabled: false,
        capacityPerHourLimit: null,
      },
    ]),
    5,
    0,
    5,
    0,
    3,
    0,
    30,
    5,
    30,
    30,
    50,
  );
}

function createChainPatch(overrides: Record<string, unknown> = {}) {
  return [{
    name: "Chain A",
    lateThreshold: 5,
    lateReopenThreshold: 2,
    unassignedThreshold: 4,
    unassignedReopenThreshold: 1,
    readyThreshold: 3,
    readyReopenThreshold: 1,
    capacityRuleEnabled: true,
    capacityPerHourEnabled: false,
    capacityPerHourLimit: null,
    ...overrides,
  }];
}

describe("settingsStore.updateSettings", () => {
  beforeEach(() => {
    seedSettingsRow();
  });

  afterAll(() => {
    db.close();
  });

  it("rejects a top-level late reopen threshold above the close threshold instead of clamping it", () => {
    expect(() => updateSettings({
      lateThreshold: 4,
      lateReopenThreshold: 5,
    })).toThrowError(/Late reopen threshold cannot be greater than the close threshold\./);

    expect(getSettings().lateReopenThreshold).toBe(0);
  });

  it("rejects a chain late reopen threshold above the close threshold even when hourly capacity is disabled", () => {
    expect(() => updateSettings({
      chains: createChainPatch({
        lateThreshold: 3,
        lateReopenThreshold: 4,
      }),
    })).toThrowError(/Late reopen threshold cannot be greater than the close threshold\./);
  });

  it("rejects a chain unassigned reopen threshold above the close threshold", () => {
    expect(() => updateSettings({
      chains: createChainPatch({
        unassignedThreshold: 2,
        unassignedReopenThreshold: 3,
      }),
    })).toThrowError(/Unassigned reopen threshold cannot be greater than the close threshold\./);
  });

  it("rejects a chain ready reopen threshold above the close threshold", () => {
    expect(() => updateSettings({
      chains: createChainPatch({
        readyThreshold: 2,
        readyReopenThreshold: 3,
      }),
    })).toThrowError(/Ready to pickup reopen threshold cannot be greater than the close threshold\./);
  });

  it("still requires a capacity-per-hour limit when the hourly rule is enabled", () => {
    expect(() => updateSettings({
      chains: createChainPatch({
        capacityPerHourEnabled: true,
        capacityPerHourLimit: null,
      }),
    })).toThrowError(/Capacity \/ hour limit is required when the hourly rule is enabled\./);
  });
});
