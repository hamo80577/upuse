import AccessTimeRoundedIcon from "@mui/icons-material/AccessTimeRounded";
import BoltRoundedIcon from "@mui/icons-material/BoltRounded";
import Inventory2RoundedIcon from "@mui/icons-material/Inventory2Rounded";
import PersonOffRoundedIcon from "@mui/icons-material/PersonOffRounded";
import TimelineRoundedIcon from "@mui/icons-material/TimelineRounded";
import type { ReactNode } from "react";
import type { BranchMappingItem, ChainThreshold, ThresholdProfile } from "../../../api/types";

export type ThresholdWorkspaceMode = "chains" | "overrides";

export type ThresholdScopeSelection =
  | { kind: "global" }
  | { kind: "chain"; chainName: string }
  | { kind: "branch"; branchId: number };

export type ThresholdRuleId = "late" | "unassigned" | "ready" | "capacity" | "capacityHour";

export interface RuleCatalogEntry {
  id: ThresholdRuleId;
  label: string;
  shortLabel: string;
  description: string;
  icon: ReactNode;
  accent: {
    soft: string;
    solid: string;
    border: string;
    glow: string;
  };
  supportsClose: boolean;
  supportsReopen: boolean;
  supportsToggle: boolean;
  supportsLimit: boolean;
}

export interface RuleEditorDraft {
  late: { close: string; reopen: string };
  unassigned: { close: string; reopen: string };
  ready: { close: string; reopen: string };
  capacity: { enabled: boolean };
  capacityHour: { enabled: boolean; limit: string };
}

export const thresholdRuleCatalog: RuleCatalogEntry[] = [
  {
    id: "late",
    label: "Late Orders",
    shortLabel: "Late",
    description: "Temporary close when late orders cross the configured threshold.",
    icon: <AccessTimeRoundedIcon sx={{ fontSize: 20 }} />,
    accent: {
      soft: "rgba(251,146,60,0.14)",
      solid: "#c2410c",
      border: "rgba(251,146,60,0.26)",
      glow: "0 20px 36px rgba(251,146,60,0.16)",
    },
    supportsClose: true,
    supportsReopen: true,
    supportsToggle: false,
    supportsLimit: false,
  },
  {
    id: "unassigned",
    label: "Unassigned Orders",
    shortLabel: "Unassigned",
    description: "Protect operations when too many orders still have no picker assigned.",
    icon: <PersonOffRoundedIcon sx={{ fontSize: 20 }} />,
    accent: {
      soft: "rgba(239,68,68,0.14)",
      solid: "#b91c1c",
      border: "rgba(239,68,68,0.24)",
      glow: "0 20px 36px rgba(239,68,68,0.14)",
    },
    supportsClose: true,
    supportsReopen: true,
    supportsToggle: false,
    supportsLimit: false,
  },
  {
    id: "ready",
    label: "Ready To Pickup",
    shortLabel: "Ready",
    description: "Watch ready-to-pickup pressure and reopen only after the queue cools down.",
    icon: <Inventory2RoundedIcon sx={{ fontSize: 20 }} />,
    accent: {
      soft: "rgba(59,130,246,0.14)",
      solid: "#1d4ed8",
      border: "rgba(59,130,246,0.24)",
      glow: "0 20px 36px rgba(59,130,246,0.14)",
    },
    supportsClose: true,
    supportsReopen: true,
    supportsToggle: false,
    supportsLimit: false,
  },
  {
    id: "capacity",
    label: "Capacity",
    shortLabel: "Capacity",
    description: "Enable the picker-capacity protection rule for this scope.",
    icon: <BoltRoundedIcon sx={{ fontSize: 20 }} />,
    accent: {
      soft: "rgba(20,184,166,0.14)",
      solid: "#0f766e",
      border: "rgba(20,184,166,0.24)",
      glow: "0 20px 36px rgba(20,184,166,0.14)",
    },
    supportsClose: false,
    supportsReopen: false,
    supportsToggle: true,
    supportsLimit: false,
  },
  {
    id: "capacityHour",
    label: "Capacity / Hour",
    shortLabel: "Capacity / Hour",
    description: "Optional hourly limiter for placed orders with a fixed per-hour limit.",
    icon: <TimelineRoundedIcon sx={{ fontSize: 20 }} />,
    accent: {
      soft: "rgba(99,102,241,0.14)",
      solid: "#4338ca",
      border: "rgba(99,102,241,0.24)",
      glow: "0 20px 36px rgba(99,102,241,0.14)",
    },
    supportsClose: false,
    supportsReopen: false,
    supportsToggle: true,
    supportsLimit: true,
  },
];

export function getRuleCatalogEntry(id: ThresholdRuleId) {
  return thresholdRuleCatalog.find((entry) => entry.id === id) ?? thresholdRuleCatalog[0];
}

export function formatThresholdPair(closeThreshold: number | undefined, reopenThreshold: number | undefined) {
  return `${closeThreshold ?? 0} -> ${reopenThreshold ?? 0}`;
}

export function branchHasCustomOverride(branch: Pick<
  BranchMappingItem,
  | "lateThresholdOverride"
  | "lateReopenThresholdOverride"
  | "unassignedThresholdOverride"
  | "unassignedReopenThresholdOverride"
  | "readyThresholdOverride"
  | "readyReopenThresholdOverride"
  | "capacityRuleEnabledOverride"
  | "capacityPerHourEnabledOverride"
  | "capacityPerHourLimitOverride"
>) {
  return (
    (typeof branch.lateThresholdOverride === "number" && typeof branch.unassignedThresholdOverride === "number")
    || typeof branch.lateReopenThresholdOverride === "number"
    || typeof branch.unassignedReopenThresholdOverride === "number"
    || typeof branch.readyThresholdOverride === "number"
    || typeof branch.readyReopenThresholdOverride === "number"
    || typeof branch.capacityRuleEnabledOverride === "boolean"
    || (
      typeof branch.capacityPerHourEnabledOverride === "boolean"
      && typeof branch.capacityPerHourLimitOverride === "number"
    )
  );
}

export function countActiveRules(
  chains: ChainThreshold[],
  branches: BranchMappingItem[],
  globalThresholds: Pick<
    ThresholdProfile,
    | "lateThreshold"
    | "unassignedThreshold"
    | "readyThreshold"
    | "capacityRuleEnabled"
    | "capacityPerHourEnabled"
    | "capacityPerHourLimit"
  >,
) {
  const hasLate = globalThresholds.lateThreshold > 0 || chains.some((chain) => chain.lateThreshold > 0);
  const hasUnassigned = globalThresholds.unassignedThreshold > 0 || chains.some((chain) => chain.unassignedThreshold > 0);
  const hasReady = (globalThresholds.readyThreshold ?? 0) > 0 || chains.some((chain) => (chain.readyThreshold ?? 0) > 0);
  const hasCapacity =
    globalThresholds.capacityRuleEnabled !== false
    || chains.some((chain) => chain.capacityRuleEnabled !== false)
    || branches.some((branch) => branch.capacityRuleEnabledOverride === true);
  const hasCapacityHour =
    (globalThresholds.capacityPerHourEnabled === true && typeof globalThresholds.capacityPerHourLimit === "number")
    || chains.some((chain) => chain.capacityPerHourEnabled === true && typeof chain.capacityPerHourLimit === "number")
    || branches.some((branch) => (
      branch.capacityPerHourEnabledOverride === true && typeof branch.capacityPerHourLimitOverride === "number"
    ));

  return [hasLate, hasUnassigned, hasReady, hasCapacity, hasCapacityHour].filter(Boolean).length;
}

export function countProfileRules(profile: Pick<
  ThresholdProfile,
  | "lateThreshold"
  | "unassignedThreshold"
  | "readyThreshold"
  | "capacityRuleEnabled"
  | "capacityPerHourEnabled"
  | "capacityPerHourLimit"
>) {
  return [
    profile.lateThreshold > 0,
    profile.unassignedThreshold > 0,
    (profile.readyThreshold ?? 0) > 0,
    profile.capacityRuleEnabled !== false,
    profile.capacityPerHourEnabled === true && typeof profile.capacityPerHourLimit === "number",
  ].filter(Boolean).length;
}

export function buildRuleEditorDraft(profile: Pick<
  ThresholdProfile,
  | "lateThreshold"
  | "lateReopenThreshold"
  | "unassignedThreshold"
  | "unassignedReopenThreshold"
  | "readyThreshold"
  | "readyReopenThreshold"
  | "capacityRuleEnabled"
  | "capacityPerHourEnabled"
  | "capacityPerHourLimit"
>): RuleEditorDraft {
  return {
    late: {
      close: String(profile.lateThreshold ?? 0),
      reopen: String(profile.lateReopenThreshold ?? 0),
    },
    unassigned: {
      close: String(profile.unassignedThreshold ?? 0),
      reopen: String(profile.unassignedReopenThreshold ?? 0),
    },
    ready: {
      close: String(profile.readyThreshold ?? 0),
      reopen: String(profile.readyReopenThreshold ?? 0),
    },
    capacity: {
      enabled: profile.capacityRuleEnabled !== false,
    },
    capacityHour: {
      enabled: profile.capacityPerHourEnabled === true,
      limit: profile.capacityPerHourLimit == null ? "" : String(profile.capacityPerHourLimit),
    },
  };
}

export function thresholdSourceLabel(source: ThresholdProfile["source"]) {
  if (source === "branch") return "Custom";
  if (source === "chain") return "Chain";
  return "Global";
}
