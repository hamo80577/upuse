import ExpandMoreRoundedIcon from "@mui/icons-material/ExpandMoreRounded";
import RestartAltRoundedIcon from "@mui/icons-material/RestartAltRounded";
import SaveRoundedIcon from "@mui/icons-material/SaveRounded";
import TuneRoundedIcon from "@mui/icons-material/TuneRounded";
import { Accordion, AccordionDetails, AccordionSummary, Alert, Box, Button, Checkbox, Chip, FormControlLabel, Stack, TextField, Typography } from "@mui/material";
import type { BranchMappingItem, ChainThreshold, ThresholdProfile } from "../../api/types";

export interface BranchThresholdEditorDraft {
  lateThreshold: string;
  unassignedThreshold: string;
  capacityRuleEnabled: boolean;
}

interface ThresholdGroup {
  key: string;
  label: string;
  branches: BranchMappingItem[];
  overrideCount: number;
  profile: ThresholdProfile;
}

function safeText(value: unknown) {
  return typeof value === "string" ? value : "";
}

function resolveEffectiveThresholdProfile(
  branch: Pick<BranchMappingItem, "chainName" | "lateThresholdOverride" | "unassignedThresholdOverride" | "capacityRuleEnabledOverride">,
  chains: ChainThreshold[],
  globalThresholds: Pick<ThresholdProfile, "lateThreshold" | "unassignedThreshold" | "capacityRuleEnabled">,
): ThresholdProfile {
  const chainKey = safeText(branch.chainName).trim().toLowerCase();
  const chain = chainKey
    ? chains.find((item) => item.name.trim().toLowerCase() === chainKey)
    : undefined;
  const inherited = chain
    ? {
        lateThreshold: chain.lateThreshold,
        unassignedThreshold: chain.unassignedThreshold,
        capacityRuleEnabled: chain.capacityRuleEnabled !== false,
        source: "chain" as const,
      }
    : {
        lateThreshold: globalThresholds.lateThreshold,
        unassignedThreshold: globalThresholds.unassignedThreshold,
        capacityRuleEnabled: globalThresholds.capacityRuleEnabled !== false,
        source: "global" as const,
      };

  const hasThresholdOverride =
    typeof branch.lateThresholdOverride === "number" &&
    typeof branch.unassignedThresholdOverride === "number";
  const hasCapacityOverride = typeof branch.capacityRuleEnabledOverride === "boolean";

  if (hasThresholdOverride || hasCapacityOverride) {
    return {
      lateThreshold: hasThresholdOverride ? branch.lateThresholdOverride as number : inherited.lateThreshold,
      unassignedThreshold: hasThresholdOverride ? branch.unassignedThresholdOverride as number : inherited.unassignedThreshold,
      capacityRuleEnabled: hasCapacityOverride ? branch.capacityRuleEnabledOverride as boolean : inherited.capacityRuleEnabled,
      source: "branch",
    };
  }

  if (chain) {
    return inherited;
  }

  return inherited;
}

function buildThresholdGroups(
  branches: BranchMappingItem[],
  chains: ChainThreshold[],
  globalThresholds: Pick<ThresholdProfile, "lateThreshold" | "unassignedThreshold" | "capacityRuleEnabled">,
) {
  const groups = new Map<string, ThresholdGroup>();

  for (const chain of chains) {
    const key = chain.name.trim().toLowerCase();
    groups.set(key, {
      key,
      label: chain.name,
      branches: [],
      overrideCount: 0,
      profile: {
        lateThreshold: chain.lateThreshold,
        unassignedThreshold: chain.unassignedThreshold,
        capacityRuleEnabled: chain.capacityRuleEnabled !== false,
        source: "chain",
      },
    });
  }

  for (const branch of branches) {
    const chainName = safeText(branch.chainName).trim();
    const key = chainName ? chainName.toLowerCase() : "__no_chain__";
    const existing = groups.get(key);

    if (existing) {
      existing.branches.push(branch);
      if (
        (typeof branch.lateThresholdOverride === "number" && typeof branch.unassignedThresholdOverride === "number")
        || typeof branch.capacityRuleEnabledOverride === "boolean"
      ) {
        existing.overrideCount += 1;
      }
      continue;
    }

    groups.set(key, {
      key,
      label: chainName || "No Chain",
      branches: [branch],
      overrideCount:
        (typeof branch.lateThresholdOverride === "number" && typeof branch.unassignedThresholdOverride === "number")
        || typeof branch.capacityRuleEnabledOverride === "boolean"
          ? 1
          : 0,
      profile: {
        lateThreshold: globalThresholds.lateThreshold,
        unassignedThreshold: globalThresholds.unassignedThreshold,
        capacityRuleEnabled: globalThresholds.capacityRuleEnabled !== false,
        source: "global",
      },
    });
  }

  return [...groups.values()]
    .map((group) => ({
      ...group,
      branches: [...group.branches].sort((a, b) => safeText(a.name || a.availabilityVendorId).localeCompare(safeText(b.name || b.availabilityVendorId))),
    }))
    .sort((a, b) => {
      if (a.key === "__no_chain__") return 1;
      if (b.key === "__no_chain__") return -1;
      return a.label.localeCompare(b.label);
    });
}

function branchSourceLabel(branch: BranchMappingItem, effective: ThresholdProfile) {
  if (effective.source === "branch") return "Custom";
  const chainName = safeText(branch.chainName).trim();
  if (effective.source === "chain" && chainName) return `Inherits ${chainName}`;
  return "Global default";
}

function sourceChipLabel(source: ThresholdProfile["source"]) {
  if (source === "branch") return "Custom";
  if (source === "chain") return "Chain";
  return "Global";
}

export function BranchThresholdOverrideManager(props: {
  branches: BranchMappingItem[];
  chains: ChainThreshold[];
  globalThresholds: { lateThreshold: number; unassignedThreshold: number; capacityRuleEnabled: boolean };
  editingBranchId: number | null;
  branchEditor: BranchThresholdEditorDraft;
  savingBranchId: number | null;
  readOnly?: boolean;
  onEditBranch: (branch: BranchMappingItem) => void;
  onChangeEditor: (patch: Partial<BranchThresholdEditorDraft>) => void;
  onSaveBranch: (branch: BranchMappingItem) => void;
  onClearBranchOverride: (branch: BranchMappingItem) => void;
  onCancelEdit: () => void;
}) {
  const { branches, chains, globalThresholds, editingBranchId, branchEditor, savingBranchId, readOnly = false } = props;
  const groups = buildThresholdGroups(branches, chains, globalThresholds);

  return (
    <Box
      sx={{
        p: { xs: 1.5, md: 1.8 },
        borderRadius: 3,
        border: "1px solid rgba(148,163,184,0.12)",
        bgcolor: "rgba(241,245,249,0.72)",
      }}
    >
      <Stack
        direction={{ xs: "column", md: "row" }}
        spacing={1.25}
        alignItems={{ xs: "flex-start", md: "center" }}
        justifyContent="space-between"
      >
        <Box>
          <Typography sx={{ fontWeight: 900, color: "#0f172a" }}>
            Branch Overrides
          </Typography>
          <Typography variant="caption" sx={{ color: "text.secondary", display: { xs: "none", sm: "block" } }}>
            Optional branch-specific thresholds.
          </Typography>
        </Box>

        <Stack direction="row" spacing={0.8} flexWrap="wrap">
          <Chip
            size="small"
            label={`${branches.length} branch${branches.length === 1 ? "" : "es"}`}
            sx={{ fontWeight: 800, bgcolor: "rgba(15,23,42,0.06)", color: "#0f172a" }}
          />
          <Chip
            size="small"
            label={`${branches.filter((branch) => (
              (typeof branch.lateThresholdOverride === "number" && typeof branch.unassignedThresholdOverride === "number")
              || typeof branch.capacityRuleEnabledOverride === "boolean"
            )).length} custom`}
            sx={{ fontWeight: 800, bgcolor: "rgba(14,165,233,0.10)", color: "#0369a1" }}
          />
        </Stack>
      </Stack>

      <Stack spacing={1.1} sx={{ mt: 1.4 }}>
        {groups.length ? (
          groups.map((group) => (
            <Accordion
              key={group.key}
              disableGutters
              defaultExpanded={false}
              TransitionProps={{ unmountOnExit: true }}
              sx={{
                borderRadius: "18px !important",
                border: "1px solid rgba(148,163,184,0.14)",
                bgcolor: "rgba(255,255,255,0.95)",
                boxShadow: "none",
                "&:before": { display: "none" },
              }}
            >
              <AccordionSummary expandIcon={<ExpandMoreRoundedIcon />} sx={{ px: 1.5, py: 0.35 }}>
                <Stack direction={{ xs: "column", md: "row" }} spacing={1.2} alignItems={{ xs: "flex-start", md: "center" }} sx={{ width: "100%" }}>
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Typography sx={{ fontWeight: 900, color: "#0f172a" }} noWrap>
                      {group.label}
                    </Typography>
                    <Typography variant="caption" sx={{ color: "text.secondary", display: { xs: "none", sm: "block" } }}>
                      {group.branches.length} branch{group.branches.length === 1 ? "" : "es"} • {group.overrideCount} custom override{group.overrideCount === 1 ? "" : "s"}
                    </Typography>
                  </Box>

                  <Stack direction="row" spacing={0.7} flexWrap="wrap">
                    <Chip
                      size="small"
                      label={`Late ${group.profile.lateThreshold}`}
                      sx={{ fontWeight: 800, bgcolor: "rgba(251,146,60,0.10)", color: "#c2410c" }}
                    />
                    <Chip
                      size="small"
                      label={`Unassigned ${group.profile.unassignedThreshold}`}
                      sx={{ fontWeight: 800, bgcolor: "rgba(239,68,68,0.10)", color: "#b91c1c" }}
                    />
                    <Chip
                      size="small"
                      label={group.profile.capacityRuleEnabled === false ? "Capacity Off" : "Capacity On"}
                      sx={{
                        fontWeight: 800,
                        bgcolor: group.profile.capacityRuleEnabled === false ? "rgba(148,163,184,0.14)" : "rgba(20,184,166,0.10)",
                        color: group.profile.capacityRuleEnabled === false ? "#475569" : "#0f766e",
                      }}
                    />
                    <Chip
                      size="small"
                      label={group.profile.source === "chain" ? "Chain base" : "Global base"}
                      sx={{ fontWeight: 800, bgcolor: "rgba(15,23,42,0.06)", color: "#334155" }}
                    />
                  </Stack>
                </Stack>
              </AccordionSummary>

              <AccordionDetails sx={{ px: 1.5, pb: 1.5, pt: 0.2 }}>
                <Stack spacing={1}>
                  {group.branches.length ? (
                    group.branches.map((branch) => {
                      const effective = resolveEffectiveThresholdProfile(branch, chains, globalThresholds);
                      const isEditing = editingBranchId === branch.id;
                      const isSaving = savingBranchId === branch.id;
                      const hasCustomOverride =
                        (typeof branch.lateThresholdOverride === "number" &&
                          typeof branch.unassignedThresholdOverride === "number")
                        || typeof branch.capacityRuleEnabledOverride === "boolean";

                      return (
                        <Box
                          key={branch.id}
                          sx={{
                            p: 1.25,
                            borderRadius: 2.5,
                            border: isEditing ? "1px solid rgba(37,99,235,0.18)" : "1px solid rgba(148,163,184,0.10)",
                            bgcolor: isEditing ? "rgba(37,99,235,0.04)" : "rgba(248,250,252,0.72)",
                          }}
                        >
                          <Stack spacing={1.1}>
                            <Stack direction={{ xs: "column", md: "row" }} spacing={1.2} alignItems={{ xs: "flex-start", md: "center" }}>
                              <Box sx={{ flex: 1, minWidth: 0 }}>
                                <Typography sx={{ fontWeight: 900, color: "#0f172a" }} noWrap>
                                  {branch.name || `Availability ${branch.availabilityVendorId}`}
                                </Typography>
                                <Typography variant="caption" sx={{ color: "text.secondary", display: { xs: "none", sm: "block" } }}>
                                  {branchSourceLabel(branch, effective)} • {branch.ordersVendorId ? `Orders ${branch.ordersVendorId} • ` : ""}Availability {branch.availabilityVendorId}
                                </Typography>
                                <Typography variant="caption" sx={{ color: "text.secondary", display: { xs: "block", sm: "none" } }}>
                                  {branchSourceLabel(branch, effective)}
                                </Typography>
                              </Box>

                              <Stack direction="row" spacing={0.7} flexWrap="wrap">
                                <Chip
                                  size="small"
                                  label={`Late ${effective.lateThreshold}`}
                                  sx={{ fontWeight: 800, bgcolor: "rgba(251,146,60,0.10)", color: "#c2410c" }}
                                />
                                <Chip
                                  size="small"
                                  label={`Unassigned ${effective.unassignedThreshold}`}
                                  sx={{ fontWeight: 800, bgcolor: "rgba(239,68,68,0.10)", color: "#b91c1c" }}
                                />
                                <Chip
                                  size="small"
                                  label={effective.capacityRuleEnabled === false ? "Capacity Off" : "Capacity On"}
                                  sx={{
                                    fontWeight: 800,
                                    bgcolor: effective.capacityRuleEnabled === false ? "rgba(148,163,184,0.14)" : "rgba(20,184,166,0.10)",
                                    color: effective.capacityRuleEnabled === false ? "#475569" : "#0f766e",
                                  }}
                                />
                                <Chip
                                  size="small"
                                  label={sourceChipLabel(effective.source)}
                                  sx={{ fontWeight: 800, bgcolor: "rgba(14,165,233,0.10)", color: "#0369a1" }}
                                />
                              </Stack>
                            </Stack>

                            <Stack direction={{ xs: "column", sm: "row" }} spacing={1}>
                              <Button
                                variant={hasCustomOverride || isEditing ? "contained" : "outlined"}
                                startIcon={<TuneRoundedIcon />}
                                onClick={() => props.onEditBranch(branch)}
                                disabled={readOnly || isSaving}
                              >
                                {hasCustomOverride || isEditing ? "Edit Custom Thresholds" : "Set Custom Thresholds"}
                              </Button>
                              <Button
                                variant="text"
                                color="inherit"
                                startIcon={<RestartAltRoundedIcon />}
                                onClick={() => props.onClearBranchOverride(branch)}
                                disabled={readOnly || isSaving || !hasCustomOverride}
                              >
                                Use Inherited
                              </Button>
                            </Stack>

                            {isEditing ? (
                              <Box
                                sx={{
                                  p: 1.15,
                                  borderRadius: 2.2,
                                  border: "1px dashed rgba(37,99,235,0.22)",
                                  bgcolor: "rgba(255,255,255,0.94)",
                                }}
                              >
                                <Stack direction={{ xs: "column", md: "row" }} spacing={1.1}>
                                  <TextField
                                    label="Late Threshold Override"
                                    type="number"
                                    value={branchEditor.lateThreshold}
                                    onChange={(event) => props.onChangeEditor({ lateThreshold: event.target.value })}
                                    placeholder={String(effective.lateThreshold)}
                                    inputProps={{ min: 0 }}
                                    disabled={readOnly || isSaving}
                                    sx={{ width: { xs: "100%", md: 180 } }}
                                  />
                                  <TextField
                                    label="Unassigned Threshold Override"
                                    type="number"
                                    value={branchEditor.unassignedThreshold}
                                    onChange={(event) => props.onChangeEditor({ unassignedThreshold: event.target.value })}
                                    placeholder={String(effective.unassignedThreshold)}
                                    inputProps={{ min: 0 }}
                                    disabled={readOnly || isSaving}
                                    sx={{ width: { xs: "100%", md: 200 } }}
                                  />
                                </Stack>

                                <FormControlLabel
                                  sx={{ mt: 0.4 }}
                                  control={(
                                    <Checkbox
                                      checked={branchEditor.capacityRuleEnabled}
                                      onChange={(event) => props.onChangeEditor({ capacityRuleEnabled: event.target.checked })}
                                      disabled={readOnly || isSaving}
                                    />
                                  )}
                                  label="Enable Capacity Rule"
                                />

                                <Stack direction={{ xs: "column", sm: "row" }} spacing={1} sx={{ mt: 1.1 }}>
                                  <Button
                                    variant="contained"
                                    startIcon={<SaveRoundedIcon />}
                                    onClick={() => props.onSaveBranch(branch)}
                                    disabled={readOnly || isSaving}
                                    sx={{ width: { xs: "100%", sm: "auto" } }}
                                  >
                                    {isSaving ? "Saving..." : "Save Override"}
                                  </Button>
                                  <Button variant="text" onClick={props.onCancelEdit} disabled={isSaving} sx={{ width: { xs: "100%", sm: "auto" } }}>
                                    Cancel
                                  </Button>
                                </Stack>
                              </Box>
                            ) : null}
                          </Stack>
                        </Box>
                      );
                    })
                  ) : (
                    <Alert severity="info" variant="outlined" sx={{ borderRadius: 2.5 }}>
                      No branches in this chain.
                    </Alert>
                  )}
                </Stack>
              </AccordionDetails>
            </Accordion>
          ))
        ) : (
          <Alert severity="info" variant="outlined" sx={{ borderRadius: 2.5 }}>
            Add a chain and a branch to start.
          </Alert>
        )}
      </Stack>
    </Box>
  );
}
