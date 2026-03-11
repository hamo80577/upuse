import { describe, expect, it } from "vitest";
import {
  createOrdersPollingPlan,
  createOrdersPollingRequests,
  resolveOrdersGlobalEntityId,
} from "./monitorOrdersPolling.js";
import type { AvailabilityRecord, BranchMapping } from "../types/models.js";

function branch(params: Partial<BranchMapping> & Pick<BranchMapping, "id" | "ordersVendorId" | "availabilityVendorId">): BranchMapping {
  return {
    id: params.id,
    name: `Branch ${params.id}`,
    chainName: "",
    ordersVendorId: params.ordersVendorId,
    availabilityVendorId: params.availabilityVendorId,
    globalEntityId: params.globalEntityId ?? "HF_EG",
    enabled: params.enabled ?? true,
  };
}

describe("monitorOrdersPolling.resolveOrdersGlobalEntityId", () => {
  it("prefers the branch entity id when present", () => {
    expect(
      resolveOrdersGlobalEntityId(
        { globalEntityId: "CHAIN_ENTITY" },
        "HF_EG",
      ),
    ).toBe("CHAIN_ENTITY");
  });

  it("falls back to the global settings entity id when the branch value is blank", () => {
    expect(
      resolveOrdersGlobalEntityId(
        { globalEntityId: "   " },
        "HF_EG",
      ),
    ).toBe("HF_EG");
  });
});

function availability(id: string, state: AvailabilityRecord["availabilityState"]): AvailabilityRecord {
  return {
    platformKey: "test",
    changeable: true,
    availabilityState: state,
    platformRestaurantId: id,
    globalEntityId: "HF_EG",
  };
}

describe("monitorOrdersPolling.createOrdersPollingPlan", () => {
  it("includes every enabled branch in orders polling regardless of availability state", () => {
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

  it("keeps a closed branch queued even if it was already captured earlier in the day", () => {
    const plan = createOrdersPollingPlan({
      branches: [branch({ id: 1, ordersVendorId: 101, availabilityVendorId: "a1" })],
      availabilityByVendor: new Map([["a1", availability("a1", "CLOSED")]]),
      closedSnapshotDayByBranch: new Map([[1, "2026-03-02"]]),
      cairoDayKey: "2026-03-03",
    });

    expect(plan.vendorIds).toEqual([101]);
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
  it("groups vendor ids by resolved entity id", () => {
    const requests = createOrdersPollingRequests({
      branches: [
        branch({ id: 1, ordersVendorId: 101, availabilityVendorId: "a1", globalEntityId: "ENTITY_A" }),
        branch({ id: 2, ordersVendorId: 102, availabilityVendorId: "a2", globalEntityId: "" }),
        branch({ id: 3, ordersVendorId: 103, availabilityVendorId: "a3", globalEntityId: "ENTITY_A" }),
        branch({ id: 4, ordersVendorId: 104, availabilityVendorId: "a4", globalEntityId: "ENTITY_B" }),
      ],
      vendorIds: [101, 102, 103, 104],
      fallbackGlobalEntityId: "HF_EG",
    });

    expect(requests).toEqual([
      { globalEntityId: "ENTITY_A", vendorIds: [101, 103] },
      { globalEntityId: "HF_EG", vendorIds: [102] },
      { globalEntityId: "ENTITY_B", vendorIds: [104] },
    ]);
  });

  it("keeps single-entity deployments behavior when branches do not override the entity id", () => {
    const requests = createOrdersPollingRequests({
      branches: [
        branch({ id: 1, ordersVendorId: 201, availabilityVendorId: "b1", globalEntityId: "" }),
        branch({ id: 2, ordersVendorId: 202, availabilityVendorId: "b2", globalEntityId: "" }),
      ],
      vendorIds: [201, 202],
      fallbackGlobalEntityId: "HF_EG",
    });

    expect(requests).toEqual([
      { globalEntityId: "HF_EG", vendorIds: [201, 202] },
    ]);
  });
});
