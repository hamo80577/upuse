import { describe, expect, it } from "vitest";
import { createOrdersPollingPlan, createOrdersPollingRequests } from "./monitorOrdersPolling.js";
import type { AvailabilityRecord, ResolvedBranchMapping } from "../types/models.js";
import { TEST_GLOBAL_ENTITY_ID, TEST_GLOBAL_ENTITY_ID_VARIANT } from "../../../../test/globalEntityId";

function branch(
  params: Partial<ResolvedBranchMapping> & Pick<ResolvedBranchMapping, "id" | "ordersVendorId" | "availabilityVendorId">,
): ResolvedBranchMapping {
  return {
    id: params.id,
    name: params.name ?? `Branch ${params.id}`,
    chainName: params.chainName ?? "",
    ordersVendorId: params.ordersVendorId,
    availabilityVendorId: params.availabilityVendorId,
    globalEntityId: params.globalEntityId ?? TEST_GLOBAL_ENTITY_ID,
    enabled: params.enabled ?? true,
    catalogState: "available",
    lateThresholdOverride: null,
    unassignedThresholdOverride: null,
  };
}

function availability(id: string, state: AvailabilityRecord["availabilityState"]): AvailabilityRecord {
  return {
    platformKey: "test",
    changeable: true,
    availabilityState: state,
    platformRestaurantId: id,
    globalEntityId: TEST_GLOBAL_ENTITY_ID,
  };
}

describe("monitorOrdersPolling.createOrdersPollingPlan", () => {
  it("includes every enabled available branch in orders polling regardless of availability state", () => {
    const branches = [
      branch({ id: 1, ordersVendorId: 101, availabilityVendorId: "a1" }),
      branch({ id: 2, ordersVendorId: 102, availabilityVendorId: "a2" }),
      branch({ id: 3, ordersVendorId: 103, availabilityVendorId: "a3" }),
      branch({ id: 4, ordersVendorId: 104, availabilityVendorId: "a4" }),
      branch({ id: 5, ordersVendorId: 105, availabilityVendorId: "a5" }),
    ];

    const availabilityByVendor = new Map([
      ["a1", availability("a1", "OPEN")],
      ["a2", availability("a2", "CLOSED_UNTIL")],
      ["a3", availability("a3", "CLOSED")],
      ["a4", availability("a4", "CLOSED")],
    ]);

    const plan = createOrdersPollingPlan({
      branches,
      availabilityByVendor,
      closedSnapshotDayByBranch: new Map([[3, "2026-03-03"]]),
      cairoDayKey: "2026-03-03",
    });

    expect(plan.vendorIds).toEqual([101, 102, 103, 104, 105]);
    expect(plan.resetBranchIds).toEqual([]);
    expect(plan.captureBranchIds).toEqual([]);
  });

  it("removes disabled branches from polling and clears any cached closed snapshot flag", () => {
    const plan = createOrdersPollingPlan({
      branches: [branch({ id: 7, ordersVendorId: 707, availabilityVendorId: "a7", enabled: false })],
      availabilityByVendor: new Map([["a7", availability("a7", "CLOSED")]]),
      closedSnapshotDayByBranch: new Map([[7, "2026-03-03"]]),
      cairoDayKey: "2026-03-03",
    });

    expect(plan.vendorIds).toEqual([]);
    expect(plan.resetBranchIds).toEqual([7]);
    expect(plan.captureBranchIds).toEqual([]);
  });
});

describe("monitorOrdersPolling.createOrdersPollingRequests", () => {
  it("groups selected vendor ids by configured global entity", () => {
    const requests = createOrdersPollingRequests({
      branches: [
        branch({ id: 1, ordersVendorId: 101, availabilityVendorId: "a1", globalEntityId: TEST_GLOBAL_ENTITY_ID }),
        branch({ id: 2, ordersVendorId: 102, availabilityVendorId: "a2", globalEntityId: TEST_GLOBAL_ENTITY_ID_VARIANT }),
        branch({ id: 3, ordersVendorId: 103, availabilityVendorId: "a3", globalEntityId: TEST_GLOBAL_ENTITY_ID }),
      ],
      vendorIds: [101, 102, 103],
    });

    expect(requests).toEqual([
      { globalEntityId: TEST_GLOBAL_ENTITY_ID, vendorIds: [101, 103] },
      { globalEntityId: TEST_GLOBAL_ENTITY_ID_VARIANT, vendorIds: [102] },
    ]);
  });

  it("deduplicates repeated vendor ids and drops branches outside the selected set", () => {
    const requests = createOrdersPollingRequests({
      branches: [
        branch({ id: 1, ordersVendorId: 201, availabilityVendorId: "b1" }),
        branch({ id: 2, ordersVendorId: 201, availabilityVendorId: "b2" }),
        branch({ id: 3, ordersVendorId: 202, availabilityVendorId: "b3" }),
        branch({ id: 4, ordersVendorId: 999, availabilityVendorId: "b4" }),
      ],
      vendorIds: [202, 201],
    });

    expect(requests).toEqual([
      { globalEntityId: TEST_GLOBAL_ENTITY_ID, vendorIds: [201, 202] },
    ]);
  });
});
