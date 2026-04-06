import { useEffect, useState } from "react";
import { api, describeApiError } from "../../../api/client";
import type { BranchMappingItem, ChainThreshold, LocalVendorCatalogItem, SettingsMasked } from "../../../api/types";
import { mergeSourceItemsWithBranches, normalizeChains, type SavedChainGroup } from "../lib/branchMapping";

function normalizeSettings(settings: SettingsMasked): SettingsMasked {
  const chains = normalizeChains(settings.chains);
  return {
    ...settings,
    chains,
    chainNames: chains.map((item) => item.name),
  };
}

export function useBranchMappingState() {
  const [settings, setSettings] = useState<SettingsMasked | null>(null);
  const [branches, setBranches] = useState<BranchMappingItem[]>([]);
  const [sourceItems, setSourceItems] = useState<LocalVendorCatalogItem[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  const applySettings = (nextSettings: SettingsMasked) => {
    setSettings(normalizeSettings(nextSettings));
  };

  const refreshData = async (options?: { silent?: boolean }) => {
    const results = await Promise.allSettled([api.getSettings(), api.listBranches(), api.listBranchSource()]);
    const [settingsResult, branchesResult, sourceResult] = results;

    if (settingsResult.status === "rejected" || branchesResult.status === "rejected" || sourceResult.status === "rejected") {
      const rejection = settingsResult.status === "rejected"
        ? settingsResult.reason
        : branchesResult.status === "rejected"
          ? branchesResult.reason
          : (sourceResult as PromiseRejectedResult).reason;
      const message = describeApiError(rejection, "Failed to load branch management");
      setLoadError(message);
      if (!options?.silent) {
        throw new Error(message);
      }
      return;
    }

    applySettings(settingsResult.value);
    setBranches(branchesResult.value.items);
    setSourceItems(mergeSourceItemsWithBranches(sourceResult.value.items, branchesResult.value.items));
    setLoadError(null);
  };

  useEffect(() => {
    void refreshData({ silent: true });
  }, []);

  const setBranchMonitoringState = async (branchId: number, enabled: boolean) => {
    const response = await api.setBranchMonitoring(branchId, enabled);
    setBranches((current) => current.map((item) => (item.id === branchId ? response.item : item)));
    setSourceItems((current) =>
      current.map((item) => (
        item.branchId === branchId
          ? { ...item, enabled: response.item.enabled, chainName: response.item.chainName }
          : item
      )),
    );
    return response.item;
  };

  const deleteBranch = async (branchId: number) => {
    await api.deleteBranch(branchId);
    setBranches((current) => current.filter((item) => item.id !== branchId));
    setSourceItems((current) =>
      current.map((item) => (
        item.branchId === branchId
          ? { ...item, alreadyAdded: false, branchId: null, chainName: null, enabled: null }
          : item
      )),
    );
  };

  const setChainMonitoringState = async (group: SavedChainGroup, enabled: boolean) => {
    const targets = group.branches.filter((branch) => branch.catalogState === "available" && branch.enabled !== enabled);
    const results = await Promise.allSettled(
      targets.map((branch) => api.setBranchMonitoring(branch.id, enabled)),
    );
    await refreshData({ silent: true });

    const failedCount = results.filter((result) => result.status === "rejected").length;
    return {
      failedCount,
      succeededCount: results.length - failedCount,
    };
  };

  const deleteChainBranches = async (group: SavedChainGroup) => {
    const results = await Promise.allSettled(
      group.branches.map((branch) => api.deleteBranch(branch.id)),
    );
    await refreshData({ silent: true });

    const failedCount = results.filter((result) => result.status === "rejected").length;
    return {
      failedCount,
      succeededCount: results.length - failedCount,
    };
  };

  const addBranches = async (items: LocalVendorCatalogItem[], chainName: string) => {
    const results = await Promise.allSettled(
      items.map((item) => api.addBranch({
        availabilityVendorId: item.availabilityVendorId,
        chainName,
        name: item.name,
        ordersVendorId: item.ordersVendorId,
      })),
    );

    const failedAvailabilityVendorIds = items
      .filter((_item, index) => results[index]?.status === "rejected")
      .map((item) => item.availabilityVendorId);

    await refreshData({ silent: true });

    return {
      addedCount: results.length - failedAvailabilityVendorIds.length,
      failedAvailabilityVendorIds,
    };
  };

  const saveChains = async (chains: ChainThreshold[]) => {
    const normalizedChains = normalizeChains(chains);
    await api.putSettings({ chains: normalizedChains });
    setSettings((current) => (
      current
        ? {
            ...current,
            chainNames: normalizedChains.map((item) => item.name),
            chains: normalizedChains,
          }
        : current
    ));
    return normalizedChains;
  };

  const saveGlobalThresholds = async (lateThreshold: number, unassignedThreshold: number) => {
    await api.putSettings({
      lateThreshold: Math.round(lateThreshold),
      unassignedThreshold: Math.round(unassignedThreshold),
    });
    setSettings((current) => (
      current
        ? {
            ...current,
            lateThreshold: Math.round(lateThreshold),
            unassignedThreshold: Math.round(unassignedThreshold),
          }
        : current
    ));
  };

  const saveBranchThresholdOverride = async (
    branchId: number,
    lateThresholdOverride: number | null,
    unassignedThresholdOverride: number | null,
    capacityRuleEnabledOverride: boolean | null,
    capacityPerHourEnabledOverride: boolean | null,
    capacityPerHourLimitOverride: number | null,
  ) => {
    const response = await api.setBranchThresholdOverrides(branchId, {
      lateThresholdOverride,
      unassignedThresholdOverride,
      capacityRuleEnabledOverride,
      capacityPerHourEnabledOverride,
      capacityPerHourLimitOverride,
    });
    setBranches((current) => current.map((item) => (item.id === branchId ? response.item : item)));
    return response.item;
  };

  return {
    settings,
    branches,
    sourceItems,
    loadError,
    refreshData,
    setBranchMonitoringState,
    deleteBranch,
    setChainMonitoringState,
    deleteChainBranches,
    addBranches,
    saveChains,
    saveGlobalThresholds,
    saveBranchThresholdOverride,
  };
}
