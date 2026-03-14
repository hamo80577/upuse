import type { BranchMappingItem, ChainThreshold, LocalVendorCatalogItem, ThresholdProfile } from "../../../api/types";

export interface SavedChainGroup {
  key: string;
  label: string;
  branches: BranchMappingItem[];
  availableCount: number;
  enabledCount: number;
  pausedCount: number;
  missingCount: number;
}

export function normalizeChains(chains: ChainThreshold[]) {
  const seen = new Set<string>();
  const out: ChainThreshold[] = [];

  for (const chain of chains) {
    const name = chain.name.trim();
    if (!name) continue;

    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    out.push({
      name,
      lateThreshold: Math.max(0, Math.round(chain.lateThreshold)),
      unassignedThreshold: Math.max(0, Math.round(chain.unassignedThreshold)),
    });
  }

  return out.sort((left, right) => left.name.localeCompare(right.name));
}

export function emptyChainEditor() {
  return {
    name: "",
    lateThreshold: "5",
    unassignedThreshold: "5",
  };
}

export function emptyBranchThresholdEditor() {
  return {
    lateThreshold: "",
    unassignedThreshold: "",
  };
}

export function safeBranchName(branch: Pick<BranchMappingItem, "name" | "availabilityVendorId">) {
  return branch.name?.trim() || `Availability ${branch.availabilityVendorId}`;
}

export function resolveEffectiveThresholds(
  branch: BranchMappingItem,
  chains: ChainThreshold[],
  globalThresholds: Pick<ThresholdProfile, "lateThreshold" | "unassignedThreshold">,
) {
  if (typeof branch.lateThresholdOverride === "number" && typeof branch.unassignedThresholdOverride === "number") {
    return {
      lateThreshold: branch.lateThresholdOverride,
      unassignedThreshold: branch.unassignedThresholdOverride,
      source: "branch" as const,
    };
  }

  const chain = chains.find((item) => item.name.trim().toLowerCase() === branch.chainName.trim().toLowerCase());
  if (chain) {
    return {
      lateThreshold: chain.lateThreshold,
      unassignedThreshold: chain.unassignedThreshold,
      source: "chain" as const,
    };
  }

  return {
    lateThreshold: globalThresholds.lateThreshold,
    unassignedThreshold: globalThresholds.unassignedThreshold,
    source: "global" as const,
  };
}

export function scoreSourceItem(item: LocalVendorCatalogItem, query: string) {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) return 100;

  const name = item.name.toLowerCase();
  const availabilityId = item.availabilityVendorId.toLowerCase();
  const ordersId = String(item.ordersVendorId);

  if (availabilityId === normalizedQuery || ordersId === normalizedQuery) return 0;
  if (name === normalizedQuery) return 1;
  if (name.startsWith(normalizedQuery)) return 2;
  if (availabilityId.startsWith(normalizedQuery) || ordersId.startsWith(normalizedQuery)) return 3;
  if (name.includes(normalizedQuery)) return 4;
  if (availabilityId.includes(normalizedQuery) || ordersId.includes(normalizedQuery)) return 5;
  return 100;
}

export function matchesBranchQuery(branch: BranchMappingItem, query: string) {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) return true;

  return safeBranchName(branch).toLowerCase().includes(normalizedQuery)
    || branch.chainName.toLowerCase().includes(normalizedQuery)
    || branch.availabilityVendorId.toLowerCase().includes(normalizedQuery)
    || String(branch.ordersVendorId ?? "").includes(normalizedQuery);
}

export function mergeSourceItemsWithBranches(sourceItems: LocalVendorCatalogItem[], branches: BranchMappingItem[]) {
  const branchByAvailabilityVendorId = new Map(
    branches.map((branch) => [branch.availabilityVendorId, branch] as const),
  );

  return sourceItems.map((item) => {
    const branch = branchByAvailabilityVendorId.get(item.availabilityVendorId);
    if (!branch) {
      return {
        ...item,
        alreadyAdded: false,
        branchId: null,
        chainName: null,
        enabled: null,
      };
    }

    return {
      ...item,
      alreadyAdded: true,
      branchId: branch.id,
      chainName: branch.chainName || null,
      enabled: branch.enabled,
    };
  });
}

export function formatBranchCount(count: number) {
  return `${count} branch${count === 1 ? "" : "es"}`;
}

export function buildSavedChainGroups(branches: BranchMappingItem[]) {
  const groups = new Map<string, SavedChainGroup>();

  for (const branch of branches) {
    const label = branch.chainName.trim() || "No Chain";
    const key = label.toLowerCase();
    const existing = groups.get(key) ?? {
      key,
      label,
      branches: [],
      availableCount: 0,
      enabledCount: 0,
      pausedCount: 0,
      missingCount: 0,
    };

    existing.branches.push(branch);
    if (branch.catalogState === "missing") {
      existing.missingCount += 1;
    } else {
      existing.availableCount += 1;
      if (branch.enabled) {
        existing.enabledCount += 1;
      } else {
        existing.pausedCount += 1;
      }
    }

    groups.set(key, existing);
  }

  return [...groups.values()]
    .map((group) => ({
      ...group,
      branches: [...group.branches].sort((left, right) => safeBranchName(left).localeCompare(safeBranchName(right))),
    }))
    .sort((left, right) => {
      if (left.label === "No Chain") return 1;
      if (right.label === "No Chain") return -1;
      return left.label.localeCompare(right.label);
    });
}
