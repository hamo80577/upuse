import { describe, expect, it, vi } from "vitest";

vi.mock("../config/db.js", () => ({
  db: {
    prepare: vi.fn(),
    transaction: vi.fn((fn: unknown) => fn),
  },
}));

import { parseVendorCatalogCsv } from "./vendorCatalogStore.js";

describe("vendorCatalogStore CSV parsing", () => {
  it("keeps importable rows and skips rows with missing orders IDs", () => {
    const csv = [
      "name,availabilityVendorId,ordersVendorId",
      "\"Branch A\",1001,5001",
      "\"Branch B\",1002,",
      "\"Branch C\",1003,5003",
    ].join("\n");

    const result = parseVendorCatalogCsv(csv);

    expect(result.rows).toEqual([
      { name: "Branch A", availabilityVendorId: "1001", ordersVendorId: 5001 },
      { name: "Branch C", availabilityVendorId: "1003", ordersVendorId: 5003 },
    ]);
    expect(result.skipped).toEqual([
      { lineNumber: 3, reason: 'invalid "ordersVendorId"' },
    ]);
  });

  it("still rejects duplicate IDs among importable rows", () => {
    const csv = [
      "name,availabilityVendorId,ordersVendorId",
      "\"Branch A\",1001,5001",
      "\"Branch B\",1001,5002",
    ].join("\n");

    expect(() => parseVendorCatalogCsv(csv)).toThrow('duplicate availabilityVendorId "1001"');
  });
});
