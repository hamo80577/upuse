import { db } from "../config/db.js";
import type {
  PerformanceBranchFilter,
  PerformanceDeliveryTypeFilter,
  PerformanceNumericSortKey,
  PerformancePreferencesResponse,
  PerformancePreferencesState,
  PerformanceSavedGroup,
  PerformanceSavedView,
} from "../types/models.js";

interface PerformanceUserStateRow {
  userId: number;
  stateJson: string;
  updatedAt: string;
}

interface PerformanceUserGroupRow {
  id: number;
  userId: number;
  name: string;
  vendorIdsJson: string;
  createdAt: string;
  updatedAt: string;
}

interface PerformanceUserViewRow {
  id: number;
  userId: number;
  name: string;
  stateJson: string;
  createdAt: string;
  updatedAt: string;
}

const DELIVERY_TYPE_FILTER_ORDER: PerformanceDeliveryTypeFilter[] = ["logistics", "vendor_delivery"];
const BRANCH_FILTER_ORDER: PerformanceBranchFilter[] = ["vendor", "transport", "late", "on_hold", "unassigned", "in_prep", "ready"];
const NUMERIC_SORT_ORDER: PerformanceNumericSortKey[] = ["orders", "vfr", "lfr", "vlfr", "active", "late", "on_hold", "unassigned", "in_prep", "ready"];

export class PerformancePreferencesStoreError extends Error {
  status: number;
  code: string;

  constructor(message: string, status: number, code: string) {
    super(message);
    this.name = "PerformancePreferencesStoreError";
    this.status = status;
    this.code = code;
  }
}

function nowIso() {
  return new Date().toISOString();
}

function createDefaultPerformancePreferencesState(): PerformancePreferencesState {
  return {
    searchQuery: "",
    selectedVendorIds: [],
    selectedDeliveryTypes: [],
    selectedBranchFilters: [],
    selectedSortKeys: ["orders"],
    nameSortEnabled: false,
    activeGroupId: null,
    activeViewId: null,
  };
}

function createDefaultPerformanceViewState(): PerformanceSavedView["state"] {
  const current = createDefaultPerformancePreferencesState();
  return {
    searchQuery: current.searchQuery,
    selectedVendorIds: current.selectedVendorIds,
    selectedDeliveryTypes: current.selectedDeliveryTypes,
    selectedBranchFilters: current.selectedBranchFilters,
    selectedSortKeys: current.selectedSortKeys,
    nameSortEnabled: current.nameSortEnabled,
  };
}

function parseJsonValue(value: string | null | undefined) {
  if (!value) return null;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function sanitizeString(value: unknown, maxLength: number) {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, maxLength);
}

function sanitizeVendorIds(value: unknown) {
  if (!Array.isArray(value)) return [];
  const unique = new Set<number>();
  for (const item of value) {
    const normalized = typeof item === "number" ? item : Number(item);
    if (Number.isInteger(normalized) && normalized > 0) {
      unique.add(normalized);
    }
  }

  return Array.from(unique).sort((left, right) => left - right);
}

function sanitizeOrderedSelection<T extends string>(value: unknown, order: readonly T[]) {
  if (!Array.isArray(value)) return [];
  const selected = new Set<T>();
  for (const item of value) {
    if (typeof item === "string" && order.includes(item as T)) {
      selected.add(item as T);
    }
  }

  return order.filter((item) => selected.has(item));
}

function sanitizeOptionalId(value: unknown, validIds?: Set<number>) {
  const normalized = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(normalized) || normalized <= 0) {
    return null;
  }
  if (validIds && !validIds.has(normalized)) {
    return null;
  }
  return normalized;
}

function sanitizeViewState(input: unknown): PerformanceSavedView["state"] {
  const value = typeof input === "object" && input !== null ? input as Record<string, unknown> : {};
  const nameSortEnabled = Boolean(value.nameSortEnabled);
  const selectedSortKeys = nameSortEnabled
    ? []
    : sanitizeOrderedSelection(value.selectedSortKeys, NUMERIC_SORT_ORDER);

  return {
    searchQuery: sanitizeString(value.searchQuery, 160),
    selectedVendorIds: sanitizeVendorIds(value.selectedVendorIds),
    selectedDeliveryTypes: sanitizeOrderedSelection(value.selectedDeliveryTypes, DELIVERY_TYPE_FILTER_ORDER),
    selectedBranchFilters: sanitizeOrderedSelection(value.selectedBranchFilters, BRANCH_FILTER_ORDER),
    selectedSortKeys: selectedSortKeys.length ? selectedSortKeys : (nameSortEnabled ? [] : ["orders"]),
    nameSortEnabled,
  };
}

function sanitizeCurrentState(
  input: unknown,
  refs?: { groupIds?: Set<number>; viewIds?: Set<number> },
): PerformancePreferencesState {
  const value = typeof input === "object" && input !== null ? input as Record<string, unknown> : {};
  const base = sanitizeViewState(value);
  let activeViewId = sanitizeOptionalId(value.activeViewId, refs?.viewIds);
  let activeGroupId = sanitizeOptionalId(value.activeGroupId, refs?.groupIds);

  if (activeViewId != null) {
    activeGroupId = null;
  }

  return {
    ...base,
    activeGroupId,
    activeViewId,
  };
}

function toSavedGroup(row: PerformanceUserGroupRow): PerformanceSavedGroup {
  return {
    id: row.id,
    name: row.name,
    vendorIds: sanitizeVendorIds(parseJsonValue(row.vendorIdsJson)),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toSavedView(row: PerformanceUserViewRow): PerformanceSavedView {
  return {
    id: row.id,
    name: row.name,
    state: sanitizeViewState(parseJsonValue(row.stateJson)),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function listSavedGroups(userId: number) {
  const rows = db
    .prepare<[number], PerformanceUserGroupRow>(`
      SELECT id, userId, name, vendorIdsJson, createdAt, updatedAt
      FROM performance_user_groups
      WHERE userId = ?
      ORDER BY updatedAt DESC, id DESC
    `)
    .all(userId);

  return rows.map(toSavedGroup);
}

function listSavedViews(userId: number) {
  const rows = db
    .prepare<[number], PerformanceUserViewRow>(`
      SELECT id, userId, name, stateJson, createdAt, updatedAt
      FROM performance_user_views
      WHERE userId = ?
      ORDER BY updatedAt DESC, id DESC
    `)
    .all(userId);

  return rows.map(toSavedView);
}

function upsertCurrentState(userId: number, current: PerformancePreferencesState) {
  const updatedAt = nowIso();
  db.prepare(`
    INSERT INTO performance_user_state (userId, stateJson, updatedAt)
    VALUES (?, ?, ?)
    ON CONFLICT(userId) DO UPDATE SET
      stateJson = excluded.stateJson,
      updatedAt = excluded.updatedAt
  `).run(userId, JSON.stringify(current), updatedAt);
}

function isUniqueNameConstraint(error: unknown) {
  const message = typeof (error as { message?: unknown })?.message === "string"
    ? (error as { message: string }).message
    : "";
  return /unique constraint failed/i.test(message);
}

function createNameConflictError(entityLabel: string) {
  return new PerformancePreferencesStoreError(`${entityLabel} name already exists`, 409, "NAME_CONFLICT");
}

function getExistingGroupRow(userId: number, id: number) {
  return db
    .prepare<[number, number], PerformanceUserGroupRow>(`
      SELECT id, userId, name, vendorIdsJson, createdAt, updatedAt
      FROM performance_user_groups
      WHERE userId = ? AND id = ?
    `)
    .get(userId, id);
}

function getExistingViewRow(userId: number, id: number) {
  return db
    .prepare<[number, number], PerformanceUserViewRow>(`
      SELECT id, userId, name, stateJson, createdAt, updatedAt
      FROM performance_user_views
      WHERE userId = ? AND id = ?
    `)
    .get(userId, id);
}

export function getPerformancePreferences(userId: number): PerformancePreferencesResponse {
  const groups = listSavedGroups(userId);
  const views = listSavedViews(userId);
  const groupIds = new Set(groups.map((group) => group.id));
  const viewIds = new Set(views.map((view) => view.id));
  const row = db
    .prepare<[number], PerformanceUserStateRow>(`
      SELECT userId, stateJson, updatedAt
      FROM performance_user_state
      WHERE userId = ?
    `)
    .get(userId);

  const current = sanitizeCurrentState(parseJsonValue(row?.stateJson), { groupIds, viewIds });
  if (!row || row.stateJson !== JSON.stringify(current)) {
    upsertCurrentState(userId, current);
  }

  return {
    current,
    groups,
    views,
  };
}

export function savePerformanceCurrentState(userId: number, state: PerformancePreferencesState) {
  const existing = getPerformancePreferences(userId);
  const current = sanitizeCurrentState(state, {
    groupIds: new Set(existing.groups.map((group) => group.id)),
    viewIds: new Set(existing.views.map((view) => view.id)),
  });
  upsertCurrentState(userId, current);
  return current;
}

export function createPerformanceSavedGroup(userId: number, input: { name: string; vendorIds: number[] }) {
  const createdAt = nowIso();
  const name = sanitizeString(input.name, 80);
  const vendorIds = sanitizeVendorIds(input.vendorIds);

  try {
    const info = db.prepare(`
      INSERT INTO performance_user_groups (userId, name, vendorIdsJson, createdAt, updatedAt)
      VALUES (?, ?, ?, ?, ?)
    `).run(userId, name, JSON.stringify(vendorIds), createdAt, createdAt);

    return toSavedGroup({
      id: Number(info.lastInsertRowid),
      userId,
      name,
      vendorIdsJson: JSON.stringify(vendorIds),
      createdAt,
      updatedAt: createdAt,
    });
  } catch (error) {
    if (isUniqueNameConstraint(error)) {
      throw createNameConflictError("Group");
    }
    throw error;
  }
}

export function updatePerformanceSavedGroup(userId: number, id: number, input: { name?: string; vendorIds?: number[] }) {
  const existing = getExistingGroupRow(userId, id);
  if (!existing) {
    throw new PerformancePreferencesStoreError("Group not found", 404, "GROUP_NOT_FOUND");
  }

  const updatedAt = nowIso();
  const name = typeof input.name === "string" ? sanitizeString(input.name, 80) : existing.name;
  const vendorIds = Array.isArray(input.vendorIds)
    ? sanitizeVendorIds(input.vendorIds)
    : sanitizeVendorIds(parseJsonValue(existing.vendorIdsJson));

  try {
    db.prepare(`
      UPDATE performance_user_groups
      SET name = ?, vendorIdsJson = ?, updatedAt = ?
      WHERE userId = ? AND id = ?
    `).run(name, JSON.stringify(vendorIds), updatedAt, userId, id);
  } catch (error) {
    if (isUniqueNameConstraint(error)) {
      throw createNameConflictError("Group");
    }
    throw error;
  }

  return toSavedGroup({
    id,
    userId,
    name,
    vendorIdsJson: JSON.stringify(vendorIds),
    createdAt: existing.createdAt,
    updatedAt,
  });
}

export function deletePerformanceSavedGroup(userId: number, id: number) {
  const existing = getExistingGroupRow(userId, id);
  if (!existing) {
    throw new PerformancePreferencesStoreError("Group not found", 404, "GROUP_NOT_FOUND");
  }

  const runDelete = db.transaction(() => {
    db.prepare("DELETE FROM performance_user_groups WHERE userId = ? AND id = ?").run(userId, id);
    const preferences = getPerformancePreferences(userId);
    if (preferences.current.activeGroupId === id) {
      upsertCurrentState(userId, {
        ...preferences.current,
        activeGroupId: null,
      });
    }
  });

  runDelete();
}

export function createPerformanceSavedView(userId: number, input: { name: string; state: PerformanceSavedView["state"] }) {
  const createdAt = nowIso();
  const name = sanitizeString(input.name, 80);
  const state = sanitizeViewState(input.state);

  try {
    const info = db.prepare(`
      INSERT INTO performance_user_views (userId, name, stateJson, createdAt, updatedAt)
      VALUES (?, ?, ?, ?, ?)
    `).run(userId, name, JSON.stringify(state), createdAt, createdAt);

    return toSavedView({
      id: Number(info.lastInsertRowid),
      userId,
      name,
      stateJson: JSON.stringify(state),
      createdAt,
      updatedAt: createdAt,
    });
  } catch (error) {
    if (isUniqueNameConstraint(error)) {
      throw createNameConflictError("View");
    }
    throw error;
  }
}

export function updatePerformanceSavedView(userId: number, id: number, input: { name?: string; state?: PerformanceSavedView["state"] }) {
  const existing = getExistingViewRow(userId, id);
  if (!existing) {
    throw new PerformancePreferencesStoreError("View not found", 404, "VIEW_NOT_FOUND");
  }

  const updatedAt = nowIso();
  const name = typeof input.name === "string" ? sanitizeString(input.name, 80) : existing.name;
  const state = input.state
    ? sanitizeViewState(input.state)
    : sanitizeViewState(parseJsonValue(existing.stateJson));

  try {
    db.prepare(`
      UPDATE performance_user_views
      SET name = ?, stateJson = ?, updatedAt = ?
      WHERE userId = ? AND id = ?
    `).run(name, JSON.stringify(state), updatedAt, userId, id);
  } catch (error) {
    if (isUniqueNameConstraint(error)) {
      throw createNameConflictError("View");
    }
    throw error;
  }

  return toSavedView({
    id,
    userId,
    name,
    stateJson: JSON.stringify(state),
    createdAt: existing.createdAt,
    updatedAt,
  });
}

export function deletePerformanceSavedView(userId: number, id: number) {
  const existing = getExistingViewRow(userId, id);
  if (!existing) {
    throw new PerformancePreferencesStoreError("View not found", 404, "VIEW_NOT_FOUND");
  }

  const runDelete = db.transaction(() => {
    db.prepare("DELETE FROM performance_user_views WHERE userId = ? AND id = ?").run(userId, id);
    const preferences = getPerformancePreferences(userId);
    if (preferences.current.activeViewId === id) {
      upsertCurrentState(userId, {
        ...preferences.current,
        activeViewId: null,
      });
    }
  });

  runDelete();
}
