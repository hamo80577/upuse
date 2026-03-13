import { beforeEach, describe, expect, it, vi } from "vitest";
import { TEST_GLOBAL_ENTITY_ID_VARIANT } from "../../../../test/globalEntityId";

const { mockPrepare, mockGetGlobalEntityId } = vi.hoisted(() => ({
  mockPrepare: vi.fn(),
  mockGetGlobalEntityId: vi.fn(),
}));

vi.mock("../config/db.js", () => ({
  db: {
    prepare: mockPrepare,
  },
}));

vi.mock("./settingsStore.js", () => ({
  getGlobalEntityId: mockGetGlobalEntityId,
}));

vi.mock("./vendorCatalogStore.js", () => ({
  getVendorCatalogItem: vi.fn(),
}));

import { getResolvedBranchById, listResolvedBranches } from "./branchStore.js";

type JoinedBranchRow = {
  id: number;
  availabilityVendorId: string;
  chainName: string | null;
  enabled: number;
  lateThresholdOverride: number | null;
  unassignedThresholdOverride: number | null;
  name: string | null;
  ordersVendorId: number | null;
};

function joinedBranchRow(overrides?: Partial<JoinedBranchRow>): JoinedBranchRow {
  return {
    id: 1,
    availabilityVendorId: "av-1",
    chainName: "Chain A",
    enabled: 1,
    lateThresholdOverride: null,
    unassignedThresholdOverride: null,
    name: "Branch 1",
    ordersVendorId: 101,
    ...overrides,
  };
}

describe("branchStore globalEntityId derivation", () => {
  let rows: JoinedBranchRow[];

  beforeEach(() => {
    rows = [joinedBranchRow()];
    mockPrepare.mockReset();
    mockGetGlobalEntityId.mockReset();
    mockPrepare.mockImplementation((sql: string) => {
      if (sql.includes("WHERE branches.id = ?")) {
        return {
          get: (id: number) => rows.find((row) => row.id === id) ?? null,
        };
      }

      if (sql.includes("FROM branches")) {
        return {
          all: () => rows,
        };
      }

      throw new Error(`Unexpected query in branchStore test: ${sql}`);
    });
  });

  it("resolved branches inherit globalEntityId from settings only and react to settings changes", () => {
    mockGetGlobalEntityId.mockReturnValue(TEST_GLOBAL_ENTITY_ID_VARIANT);
    expect(listResolvedBranches()).toEqual([
      expect.objectContaining({
        id: 1,
        ordersVendorId: 101,
        globalEntityId: TEST_GLOBAL_ENTITY_ID_VARIANT,
      }),
    ]);

    mockGetGlobalEntityId.mockReturnValue("HF_UAE");
    expect(listResolvedBranches()).toEqual([
      expect.objectContaining({
        id: 1,
        ordersVendorId: 101,
        globalEntityId: "HF_UAE",
      }),
    ]);

    expect(getResolvedBranchById(1)).toEqual(expect.objectContaining({
      id: 1,
      globalEntityId: "HF_UAE",
    }));
  });

  it("never resolves missing-catalog branches into their own entity source", () => {
    rows = [joinedBranchRow({ name: null, ordersVendorId: null })];
    mockGetGlobalEntityId.mockReturnValue(TEST_GLOBAL_ENTITY_ID_VARIANT);

    expect(listResolvedBranches()).toEqual([]);
    expect(getResolvedBranchById(1)).toBeNull();
  });
});
