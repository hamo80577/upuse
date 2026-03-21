import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../config/db.js", async () => {
  const Database = (await import("better-sqlite3")).default;
  return {
    db: new Database(":memory:"),
  };
});

import { db } from "../config/db.js";
import {
  PerformancePreferencesStoreError,
  createPerformanceSavedGroup,
  createPerformanceSavedView,
  deletePerformanceSavedGroup,
  deletePerformanceSavedView,
  getPerformancePreferences,
  savePerformanceCurrentState,
  updatePerformanceSavedGroup,
  updatePerformanceSavedView,
} from "./performancePreferencesStore.js";

function resetSchema() {
  db.exec(`
    DROP TABLE IF EXISTS performance_user_state;
    DROP TABLE IF EXISTS performance_user_groups;
    DROP TABLE IF EXISTS performance_user_views;
    DROP TABLE IF EXISTS users;

    CREATE TABLE users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      role TEXT NOT NULL,
      passwordHash TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 1,
      createdAt TEXT NOT NULL
    );

    CREATE TABLE performance_user_state (
      userId INTEGER PRIMARY KEY,
      stateJson TEXT NOT NULL,
      updatedAt TEXT NOT NULL,
      FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE performance_user_groups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      userId INTEGER NOT NULL,
      name TEXT NOT NULL COLLATE NOCASE,
      vendorIdsJson TEXT NOT NULL,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL,
      FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE UNIQUE INDEX idx_performance_user_groups_user_name
      ON performance_user_groups(userId, name);

    CREATE TABLE performance_user_views (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      userId INTEGER NOT NULL,
      name TEXT NOT NULL COLLATE NOCASE,
      stateJson TEXT NOT NULL,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL,
      FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE UNIQUE INDEX idx_performance_user_views_user_name
      ON performance_user_views(userId, name);
  `);

  db.prepare(`
    INSERT INTO users (id, email, name, role, passwordHash, active, createdAt)
    VALUES
      (1, 'user1@example.com', 'User One', 'user', 'hash-1', 1, '2026-03-21T10:00:00.000Z'),
      (2, 'user2@example.com', 'User Two', 'user', 'hash-2', 1, '2026-03-21T10:00:00.000Z')
  `).run();
}

describe("performancePreferencesStore", () => {
  beforeEach(() => {
    resetSchema();
  });

  it("saves and reloads current state per user independently", () => {
    savePerformanceCurrentState(1, {
      searchQuery: "nasr",
      selectedVendorIds: [111, 112],
      selectedDeliveryTypes: ["logistics"],
      selectedBranchFilters: ["vendor", "late"],
      selectedSortKeys: ["orders"],
      nameSortEnabled: false,
      activeGroupId: null,
      activeViewId: null,
    });

    savePerformanceCurrentState(2, {
      searchQuery: "heliopolis",
      selectedVendorIds: [220],
      selectedDeliveryTypes: ["vendor_delivery"],
      selectedBranchFilters: ["ready"],
      selectedSortKeys: [],
      nameSortEnabled: true,
      activeGroupId: null,
      activeViewId: null,
    });

    expect(getPerformancePreferences(1).current).toMatchObject({
      searchQuery: "nasr",
      selectedVendorIds: [111, 112],
      selectedDeliveryTypes: ["logistics"],
      selectedBranchFilters: ["vendor", "late"],
      selectedSortKeys: ["orders"],
      nameSortEnabled: false,
    });

    expect(getPerformancePreferences(2).current).toMatchObject({
      searchQuery: "heliopolis",
      selectedVendorIds: [220],
      selectedDeliveryTypes: ["vendor_delivery"],
      selectedBranchFilters: ["ready"],
      selectedSortKeys: [],
      nameSortEnabled: true,
    });
  });

  it("isolates groups by user and releases active group references when deleted", () => {
    const groupUser1 = createPerformanceSavedGroup(1, { name: "Carrefour", vendorIds: [111, 112] });
    const groupUser2 = createPerformanceSavedGroup(2, { name: "Carrefour", vendorIds: [991] });

    expect(getPerformancePreferences(1).groups).toEqual([
      expect.objectContaining({ id: groupUser1.id, name: "Carrefour", vendorIds: [111, 112] }),
    ]);
    expect(getPerformancePreferences(2).groups).toEqual([
      expect.objectContaining({ id: groupUser2.id, name: "Carrefour", vendorIds: [991] }),
    ]);

    savePerformanceCurrentState(1, {
      ...getPerformancePreferences(1).current,
      activeGroupId: groupUser1.id,
    });

    expect(() => updatePerformanceSavedGroup(2, groupUser1.id, { name: "Wrong user" })).toThrow(PerformancePreferencesStoreError);

    deletePerformanceSavedGroup(1, groupUser1.id);

    expect(getPerformancePreferences(1).current.activeGroupId).toBeNull();
    expect(getPerformancePreferences(1).groups).toEqual([]);
    expect(getPerformancePreferences(2).groups).toEqual([
      expect.objectContaining({ id: groupUser2.id }),
    ]);
  });

  it("isolates views by user and releases active view references when deleted", () => {
    const viewUser1 = createPerformanceSavedView(1, {
      name: "Morning watch",
      state: {
        searchQuery: "nasr",
        selectedVendorIds: [111],
        selectedDeliveryTypes: ["logistics"],
        selectedBranchFilters: ["vendor"],
        selectedSortKeys: ["orders"],
        nameSortEnabled: false,
      },
    });
    const viewUser2 = createPerformanceSavedView(2, {
      name: "Morning watch",
      state: {
        searchQuery: "heliopolis",
        selectedVendorIds: [220],
        selectedDeliveryTypes: [],
        selectedBranchFilters: [],
        selectedSortKeys: ["ready"],
        nameSortEnabled: false,
      },
    });

    savePerformanceCurrentState(1, {
      ...getPerformancePreferences(1).current,
      activeViewId: viewUser1.id,
    });

    expect(() => updatePerformanceSavedView(2, viewUser1.id, { name: "Wrong user" })).toThrow(PerformancePreferencesStoreError);

    deletePerformanceSavedView(1, viewUser1.id);

    expect(getPerformancePreferences(1).current.activeViewId).toBeNull();
    expect(getPerformancePreferences(1).views).toEqual([]);
    expect(getPerformancePreferences(2).views).toEqual([
      expect.objectContaining({ id: viewUser2.id }),
    ]);
  });

  it("cleans stale group and view references from persisted current state", () => {
    db.prepare(`
      INSERT INTO performance_user_state (userId, stateJson, updatedAt)
      VALUES (?, ?, ?)
    `).run(
      1,
      JSON.stringify({
        searchQuery: "stale",
        selectedVendorIds: [111, 112],
        selectedDeliveryTypes: ["logistics", "vendor_delivery"],
        selectedBranchFilters: ["vendor", "late"],
        selectedSortKeys: ["orders", "late"],
        nameSortEnabled: false,
        activeGroupId: 999,
        activeViewId: 888,
      }),
      "2026-03-21T11:00:00.000Z",
    );

    expect(getPerformancePreferences(1).current).toMatchObject({
      searchQuery: "stale",
      selectedVendorIds: [111, 112],
      selectedDeliveryTypes: ["logistics", "vendor_delivery"],
      selectedBranchFilters: ["vendor", "late"],
      selectedSortKeys: ["orders", "late"],
      activeGroupId: null,
      activeViewId: null,
    });
  });
});
