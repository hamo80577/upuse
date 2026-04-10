import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockGetWithRetry } = vi.hoisted(() => ({
  mockGetWithRetry: vi.fn(),
}));

vi.mock("../config/db.js", async () => {
  const BetterSqlite3 = (await import("better-sqlite3")).default;
  const db = new BetterSqlite3(":memory:");

  db.exec(`
    CREATE TABLE orders_mirror (
      dayKey TEXT NOT NULL,
      globalEntityId TEXT NOT NULL,
      vendorId INTEGER NOT NULL,
      vendorName TEXT,
      orderId TEXT NOT NULL,
      externalId TEXT NOT NULL,
      status TEXT NOT NULL,
      transportType TEXT,
      isCompleted INTEGER NOT NULL DEFAULT 0,
      isCancelled INTEGER NOT NULL DEFAULT 0,
      isUnassigned INTEGER NOT NULL DEFAULT 0,
      placedAt TEXT,
      pickupAt TEXT,
      customerFirstName TEXT,
      shopperId INTEGER,
      shopperFirstName TEXT,
      isActiveNow INTEGER NOT NULL DEFAULT 0,
      lastSeenAt TEXT NOT NULL,
      lastActiveSeenAt TEXT,
      cancellationOwner TEXT,
      cancellationReason TEXT,
      cancellationStage TEXT,
      cancellationSource TEXT,
      cancellationCreatedAt TEXT,
      cancellationUpdatedAt TEXT,
      cancellationOwnerLookupAt TEXT,
      cancellationOwnerLookupError TEXT,
      transportTypeLookupAt TEXT,
      transportTypeLookupError TEXT,
      PRIMARY KEY (dayKey, globalEntityId, vendorId, orderId)
    );

    CREATE TABLE orders_sync_state (
      dayKey TEXT NOT NULL,
      globalEntityId TEXT NOT NULL,
      vendorId INTEGER NOT NULL,
      lastBootstrapSyncAt TEXT,
      lastActiveSyncAt TEXT,
      lastHistorySyncAt TEXT,
      lastFullHistorySweepAt TEXT,
      lastSuccessfulSyncAt TEXT,
      lastHistoryCursorAt TEXT,
      consecutiveFailures INTEGER NOT NULL DEFAULT 0,
      lastErrorAt TEXT,
      lastErrorCode TEXT,
      lastErrorMessage TEXT,
      staleSince TEXT,
      quarantinedUntil TEXT,
      PRIMARY KEY (dayKey, globalEntityId, vendorId)
    );

    CREATE TABLE orders_entity_sync_state (
      dayKey TEXT NOT NULL,
      globalEntityId TEXT NOT NULL,
      lastBootstrapSyncAt TEXT,
      lastActiveSyncAt TEXT,
      lastHistorySyncAt TEXT,
      lastFullHistorySweepAt TEXT,
      lastSuccessfulSyncAt TEXT,
      lastHistoryCursorAt TEXT,
      consecutiveFailures INTEGER NOT NULL DEFAULT 0,
      lastErrorAt TEXT,
      lastErrorCode TEXT,
      lastErrorMessage TEXT,
      staleSince TEXT,
      bootstrapCompletedAt TEXT,
      PRIMARY KEY (dayKey, globalEntityId)
    );
  `);

  return { db };
});

vi.mock("./branchStore.js", () => ({
  listResolvedBranches: vi.fn(() => []),
}));

vi.mock("./settingsStore.js", () => ({
  getGlobalEntityId: vi.fn(() => "HF_EG"),
  getSettings: vi.fn(() => ({
    ordersRefreshSeconds: 30,
    ordersToken: "token",
  })),
}));

vi.mock("./orders/httpClient.js", () => ({
  getWithRetry: mockGetWithRetry,
}));

import { db as testDb } from "../config/db.js";
import { getMirrorBranchDetail, syncOrdersMirror } from "./ordersMirrorStore.js";
import { buildPerformanceDataset } from "./performanceStore.js";

describe("ordersMirrorStore incremental reconciliation", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-20T12:00:00.000Z"));
    mockGetWithRetry.mockReset();
    testDb.prepare("DELETE FROM orders_mirror").run();
    testDb.prepare("DELETE FROM orders_sync_state").run();
    testDb.prepare("DELETE FROM orders_entity_sync_state").run();
    delete process.env.UPUSE_ORDERS_HISTORY_SYNC_SECONDS;
    delete process.env.UPUSE_ORDERS_REPAIR_SWEEP_SECONDS;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  afterAll(() => {
    testDb.close();
  });

  it("keeps inactive incomplete mirror rows out of the preparation queue", () => {
    testDb.prepare(`
      INSERT INTO orders_entity_sync_state (
        dayKey,
        globalEntityId,
        lastBootstrapSyncAt,
        lastActiveSyncAt,
        lastHistorySyncAt,
        lastFullHistorySweepAt,
        lastSuccessfulSyncAt,
        lastHistoryCursorAt,
        consecutiveFailures,
        lastErrorAt,
        lastErrorCode,
        lastErrorMessage,
        staleSince,
        bootstrapCompletedAt
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, NULL, NULL, NULL, ?)
    `).run(
      "2026-03-20",
      "HF_EG",
      "2026-03-20T11:00:00.000Z",
      "2026-03-20T11:59:30.000Z",
      "2026-03-20T11:59:30.000Z",
      "2026-03-20T11:59:30.000Z",
      "2026-03-20T11:59:30.000Z",
      "2026-03-20T11:59:30.000Z",
      "2026-03-20T11:00:00.000Z",
    );

    testDb.prepare(`
      INSERT INTO orders_mirror (
        dayKey,
        globalEntityId,
        vendorId,
        vendorName,
        orderId,
        externalId,
        status,
        transportType,
        isCompleted,
        isCancelled,
        isUnassigned,
        placedAt,
        pickupAt,
        customerFirstName,
        shopperId,
        shopperFirstName,
        isActiveNow,
        lastSeenAt,
        lastActiveSeenAt
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      "2026-03-20",
      "HF_EG",
      10,
      "Branch 10",
      "internal-1",
      "3556731079",
      "STARTED",
      "LOGISTICS_DELIVERY",
      0,
      0,
      0,
      "2026-03-20T09:00:00.000Z",
      "2026-03-20T09:15:00.000Z",
      "Customer",
      101,
      "Ali",
      0,
      "2026-03-20T11:50:00.000Z",
      "2026-03-20T11:50:00.000Z",
    );

    const detail = getMirrorBranchDetail({
      dayKey: "2026-03-20",
      globalEntityId: "HF_EG",
      vendorId: 10,
      ordersRefreshSeconds: 30,
    });

    expect(detail.metrics.activeNow).toBe(0);
    expect(detail.metrics.preparingNow).toBe(0);
    expect(detail.preparingOrders).toEqual([]);
  });

  it("keeps dashboard branch metrics and performance cards in parity for the same vendor", () => {
    testDb.prepare(`
      INSERT INTO orders_entity_sync_state (
        dayKey,
        globalEntityId,
        lastBootstrapSyncAt,
        lastActiveSyncAt,
        lastHistorySyncAt,
        lastFullHistorySweepAt,
        lastSuccessfulSyncAt,
        lastHistoryCursorAt,
        consecutiveFailures,
        lastErrorAt,
        lastErrorCode,
        lastErrorMessage,
        staleSince,
        bootstrapCompletedAt
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, NULL, NULL, NULL, ?)
    `).run(
      "2026-03-20",
      "HF_EG",
      "2026-03-20T11:00:00.000Z",
      "2026-03-20T11:59:30.000Z",
      "2026-03-20T11:59:30.000Z",
      "2026-03-20T11:59:30.000Z",
      "2026-03-20T11:59:30.000Z",
      "2026-03-20T11:59:30.000Z",
      "2026-03-20T11:00:00.000Z",
    );

    const insertRow = testDb.prepare(`
      INSERT INTO orders_mirror (
        dayKey,
        globalEntityId,
        vendorId,
        vendorName,
        orderId,
        externalId,
        status,
        transportType,
        isCompleted,
        isCancelled,
        isUnassigned,
        placedAt,
        pickupAt,
        customerFirstName,
        shopperId,
        shopperFirstName,
        isActiveNow,
        lastSeenAt,
        lastActiveSeenAt
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    insertRow.run(
      "2026-03-20", "HF_EG", 10, "Branch 10", "unassigned-1", "3556732001", "UNASSIGNED", "LOGISTICS_DELIVERY", 0, 0, 1,
      "2026-03-20T08:00:00.000Z", "2026-03-20T08:20:00.000Z", "Customer A", null, null, 1, "2026-03-20T11:59:00.000Z", "2026-03-20T11:59:00.000Z",
    );
    insertRow.run(
      "2026-03-20", "HF_EG", 10, "Branch 10", "hold-1", "3556732002", "ON_HOLD", "LOGISTICS_DELIVERY", 0, 0, 0,
      "2026-03-20T08:10:00.000Z", "2026-03-20T08:30:00.000Z", "Customer B", 201, "Ali", 1, "2026-03-20T11:59:00.000Z", "2026-03-20T11:59:00.000Z",
    );
    insertRow.run(
      "2026-03-20", "HF_EG", 10, "Branch 10", "ready-1", "3556732003", "READY_FOR_PICKUP", "LOGISTICS_DELIVERY", 0, 0, 0,
      "2026-03-20T08:20:00.000Z", "2026-03-20T08:40:00.000Z", "Customer C", 202, "Mona", 1, "2026-03-20T11:59:00.000Z", "2026-03-20T11:59:00.000Z",
    );
    insertRow.run(
      "2026-03-20", "HF_EG", 10, "Branch 10", "prep-1", "3556732004", "STARTED", "LOGISTICS_DELIVERY", 0, 0, 0,
      "2026-03-20T08:25:00.000Z", "2026-03-20T08:45:00.000Z", "Customer D", 203, "Laila", 1, "2026-03-20T11:59:00.000Z", "2026-03-20T11:59:00.000Z",
    );

    const detail = getMirrorBranchDetail({
      dayKey: "2026-03-20",
      globalEntityId: "HF_EG",
      vendorId: 10,
      ordersRefreshSeconds: 30,
    });

    const dataset = buildPerformanceDataset({
      dayKey: "2026-03-20",
      globalEntityId: "HF_EG",
      branches: [{
        id: 1,
        name: "Branch 10",
        chainName: "Carrefour",
        ordersVendorId: 10,
        availabilityVendorId: "745260",
        enabled: true,
        catalogState: "available",
        globalEntityId: "HF_EG",
        lateThresholdOverride: null,
        lateReopenThresholdOverride: null,
        unassignedThresholdOverride: null,
        unassignedReopenThresholdOverride: null,
        readyThresholdOverride: null,
        readyReopenThresholdOverride: null,
        capacityRuleEnabledOverride: null,
        capacityPerHourEnabledOverride: null,
        capacityPerHourLimitOverride: null,
      }],
      rows: testDb.prepare(`
        SELECT
          dayKey,
          globalEntityId,
          vendorId,
          vendorName,
          orderId,
          externalId,
          status,
          transportType,
          shopperId,
          shopperFirstName,
          isCompleted,
          isCancelled,
          isUnassigned,
          isActiveNow,
          customerFirstName,
          placedAt,
          pickupAt,
          lastSeenAt,
          cancellationOwner,
          cancellationReason,
          cancellationStage,
          cancellationSource,
          cancellationCreatedAt,
          cancellationUpdatedAt,
          cancellationOwnerLookupAt,
          cancellationOwnerLookupError
        FROM orders_mirror
        WHERE dayKey = ? AND globalEntityId = ? AND vendorId = ?
      `).all("2026-03-20", "HF_EG", 10),
    });

    expect(detail.metrics.activeNow).toBe(2);
    expect(detail.metrics.preparingNow).toBe(1);
    expect(detail.metrics.unassignedNow).toBe(1);
    expect(detail.metrics.readyNow).toBe(1);
    expect(dataset.summary.branches[0]).toMatchObject({
      activeOrders: detail.metrics.activeNow,
      preparingNow: detail.metrics.preparingNow,
      unassignedOrders: detail.metrics.unassignedNow,
      readyToPickupOrders: detail.metrics.readyNow,
      onHoldOrders: 1,
    });
  });

  it("reconciles dropped active orders against the external order detail before leaving stale completion data", async () => {
    testDb.prepare(`
      INSERT INTO orders_entity_sync_state (
        dayKey,
        globalEntityId,
        lastBootstrapSyncAt,
        lastActiveSyncAt,
        lastHistorySyncAt,
        lastFullHistorySweepAt,
        lastSuccessfulSyncAt,
        lastHistoryCursorAt,
        consecutiveFailures,
        lastErrorAt,
        lastErrorCode,
        lastErrorMessage,
        staleSince,
        bootstrapCompletedAt
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, NULL, NULL, NULL, ?)
    `).run(
      "2026-03-20",
      "HF_EG",
      "2026-03-20T10:00:00.000Z",
      "2026-03-20T11:59:30.000Z",
      "2026-03-20T11:59:30.000Z",
      "2026-03-20T11:59:30.000Z",
      "2026-03-20T11:59:00.000Z",
      "2026-03-20T11:59:30.000Z",
      "2026-03-20T10:00:00.000Z",
    );

    testDb.prepare(`
      INSERT INTO orders_mirror (
        dayKey,
        globalEntityId,
        vendorId,
        vendorName,
        orderId,
        externalId,
        status,
        transportType,
        isCompleted,
        isCancelled,
        isUnassigned,
        placedAt,
        pickupAt,
        customerFirstName,
        shopperId,
        shopperFirstName,
        isActiveNow,
        lastSeenAt,
        lastActiveSeenAt
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      "2026-03-20",
      "HF_EG",
      10,
      "Branch 10",
      "internal-1",
      "3556731079",
      "STARTED",
      null,
      0,
      0,
      0,
      "2026-03-20T09:00:00.000Z",
      "2026-03-20T09:15:00.000Z",
      "Customer",
      101,
      "Ali",
      1,
      "2026-03-20T11:58:00.000Z",
      "2026-03-20T11:58:00.000Z",
    );

    mockGetWithRetry.mockImplementation(async (url: string) => {
      const parsedUrl = new URL(url);

      if (parsedUrl.pathname === "/orders") {
        expect(parsedUrl.searchParams.get("isCompleted")).toBe("false");
        return { data: { items: [] } };
      }

      if (parsedUrl.pathname === "/orders/internal-1") {
        return {
          data: {
            id: "internal-1",
            externalId: "3556731079",
            status: "DELIVERED",
            isCompleted: true,
            transportType: "logistics_delivery",
            vendor: {
              id: 10,
              name: "Branch 10",
            },
            shopper: {
              id: 101,
              firstName: "Ali",
            },
            placedAt: "2026-03-20T09:00:00.000Z",
            pickupAt: "2026-03-20T09:15:00.000Z",
          },
        };
      }

      throw new Error(`Unexpected URL ${url}`);
    });

    await syncOrdersMirror({
      token: "token",
      branches: [{
        id: 1,
        name: "Branch 10",
        chainName: "Carrefour",
        ordersVendorId: 10,
        availabilityVendorId: "745260",
        enabled: true,
        catalogState: "available",
        globalEntityId: "HF_EG",
        lateThresholdOverride: null,
        lateReopenThresholdOverride: null,
        unassignedThresholdOverride: null,
        unassignedReopenThresholdOverride: null,
        readyThresholdOverride: null,
        readyReopenThresholdOverride: null,
        capacityRuleEnabledOverride: null,
        capacityPerHourEnabledOverride: null,
        capacityPerHourLimitOverride: null,
      }],
      ordersRefreshSeconds: 30,
    });

    const row = testDb.prepare(`
      SELECT
        status,
        isCompleted,
        isActiveNow,
        transportType,
        transportTypeLookupAt
      FROM orders_mirror
      WHERE dayKey = ? AND globalEntityId = ? AND vendorId = ? AND orderId = ?
    `).get("2026-03-20", "HF_EG", 10, "internal-1") as {
      status: string;
      isCompleted: number;
      isActiveNow: number;
      transportType: string | null;
      transportTypeLookupAt: string | null;
    };

    expect(row).toMatchObject({
      status: "DELIVERED",
      isCompleted: 1,
      isActiveNow: 0,
      transportType: "LOGISTICS_DELIVERY",
      transportTypeLookupAt: "2026-03-20T12:00:00.000Z",
    });
    expect(mockGetWithRetry).toHaveBeenCalledWith(
      "https://shopper-management-api-live-me.deliveryhero.io/orders/internal-1",
      expect.any(Object),
      1,
    );
  });

  it("runs a full-day recovery audit and drains enrichment after stale sync failures", async () => {
    testDb.prepare(`
      INSERT INTO orders_entity_sync_state (
        dayKey,
        globalEntityId,
        lastBootstrapSyncAt,
        lastActiveSyncAt,
        lastHistorySyncAt,
        lastFullHistorySweepAt,
        lastSuccessfulSyncAt,
        lastHistoryCursorAt,
        consecutiveFailures,
        lastErrorAt,
        lastErrorCode,
        lastErrorMessage,
        staleSince,
        bootstrapCompletedAt
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      "2026-03-20",
      "HF_EG",
      "2026-03-20T08:00:00.000Z",
      "2026-03-20T09:00:00.000Z",
      "2026-03-20T09:00:00.000Z",
      "2026-03-20T09:00:00.000Z",
      "2026-03-20T09:00:00.000Z",
      "2026-03-20T09:00:00.000Z",
      2,
      "2026-03-20T09:30:00.000Z",
      "401",
      "Token expired",
      "2026-03-20T09:30:00.000Z",
      "2026-03-20T08:00:00.000Z",
    );

    testDb.prepare(`
      INSERT INTO orders_mirror (
        dayKey,
        globalEntityId,
        vendorId,
        vendorName,
        orderId,
        externalId,
        status,
        transportType,
        isCompleted,
        isCancelled,
        isUnassigned,
        placedAt,
        pickupAt,
        customerFirstName,
        shopperId,
        shopperFirstName,
        isActiveNow,
        lastSeenAt,
        lastActiveSeenAt
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      "2026-03-20",
      "HF_EG",
      10,
      "Branch 10",
      "internal-2",
      "3556731080",
      "STARTED",
      null,
      0,
      0,
      0,
      "2026-03-20T08:30:00.000Z",
      "2026-03-20T08:55:00.000Z",
      "Customer",
      101,
      "Ali",
      0,
      "2026-03-20T09:00:00.000Z",
      "2026-03-20T09:00:00.000Z",
    );

    mockGetWithRetry.mockImplementation(async (url: string) => {
      const parsedUrl = new URL(url);

      if (parsedUrl.pathname === "/orders" && parsedUrl.searchParams.get("isCompleted") === "false") {
        return { data: { items: [] } };
      }

      if (parsedUrl.pathname === "/orders" && parsedUrl.searchParams.get("isCompleted") == null) {
        return {
          data: {
            items: [
              {
                id: "internal-2",
                externalId: "3556731080",
                status: "CANCELLED",
                isCompleted: true,
                vendor: {
                  id: 10,
                  name: "Branch 10",
                },
                shopper: {
                  id: 101,
                  firstName: "Ali",
                },
                placedAt: "2026-03-20T08:30:00.000Z",
                pickupAt: "2026-03-20T08:55:00.000Z",
              },
            ],
          },
        };
      }

      if (parsedUrl.pathname === "/orders/internal-2") {
        return {
          data: {
            id: "internal-2",
            externalId: "3556731080",
            status: "CANCELLED",
            isCompleted: true,
            transportType: "logistics_delivery",
            vendor: {
              id: 10,
              name: "Branch 10",
            },
            shopper: {
              id: 101,
              firstName: "Ali",
            },
            placedAt: "2026-03-20T08:30:00.000Z",
            pickupAt: "2026-03-20T08:55:00.000Z",
            cancellation: {
              owner: "vendor",
              reason: "OUT_OF_STOCK",
              stage: "PREPARATION",
              source: "OPS",
              createdAt: "2026-03-20T08:45:00.000Z",
              updatedAt: "2026-03-20T08:46:00.000Z",
            },
          },
        };
      }

      throw new Error(`Unexpected URL ${url}`);
    });

    await syncOrdersMirror({
      token: "token",
      branches: [{
        id: 1,
        name: "Branch 10",
        chainName: "Carrefour",
        ordersVendorId: 10,
        availabilityVendorId: "745260",
        enabled: true,
        catalogState: "available",
        globalEntityId: "HF_EG",
        lateThresholdOverride: null,
        lateReopenThresholdOverride: null,
        unassignedThresholdOverride: null,
        unassignedReopenThresholdOverride: null,
        readyThresholdOverride: null,
        readyReopenThresholdOverride: null,
        capacityRuleEnabledOverride: null,
        capacityPerHourEnabledOverride: null,
        capacityPerHourLimitOverride: null,
      }],
      ordersRefreshSeconds: 30,
    });

    const row = testDb.prepare(`
      SELECT
        status,
        isCompleted,
        isCancelled,
        isActiveNow,
        transportType,
        cancellationOwner,
        cancellationReason
      FROM orders_mirror
      WHERE dayKey = ? AND globalEntityId = ? AND vendorId = ? AND orderId = ?
    `).get("2026-03-20", "HF_EG", 10, "internal-2") as {
      status: string;
      isCompleted: number;
      isCancelled: number;
      isActiveNow: number;
      transportType: string | null;
      cancellationOwner: string | null;
      cancellationReason: string | null;
    };

    expect(row).toMatchObject({
      status: "CANCELLED",
      isCompleted: 1,
      isCancelled: 1,
      isActiveNow: 0,
      transportType: "LOGISTICS_DELIVERY",
      cancellationOwner: "VENDOR",
      cancellationReason: "OUT_OF_STOCK",
    });

    expect(mockGetWithRetry.mock.calls.some(([url]) => {
      const parsedUrl = new URL(String(url));
      return parsedUrl.pathname === "/orders" && parsedUrl.searchParams.get("isCompleted") == null;
    })).toBe(true);
    expect(mockGetWithRetry).toHaveBeenCalledWith(
      "https://shopper-management-api-live-me.deliveryhero.io/orders/internal-2",
      expect.any(Object),
      1,
    );
  });
});
