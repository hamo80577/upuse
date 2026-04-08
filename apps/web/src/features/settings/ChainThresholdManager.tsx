import AccountTreeRoundedIcon from "@mui/icons-material/AccountTreeRounded";
import AddRoundedIcon from "@mui/icons-material/AddRounded";
import ArrowOutwardRoundedIcon from "@mui/icons-material/ArrowOutwardRounded";
import CloseRoundedIcon from "@mui/icons-material/CloseRounded";
import DeleteOutlineRoundedIcon from "@mui/icons-material/DeleteOutlineRounded";
import EditOutlinedIcon from "@mui/icons-material/EditOutlined";
import PublicRoundedIcon from "@mui/icons-material/PublicRounded";
import SearchRoundedIcon from "@mui/icons-material/SearchRounded";
import TuneRoundedIcon from "@mui/icons-material/TuneRounded";
import {
  Alert,
  Box,
  Button,
  ButtonBase,
  Chip,
  Dialog,
  DialogContent,
  Divider,
  Drawer,
  InputAdornment,
  Stack,
  Switch,
  TextField,
  Typography,
  useMediaQuery,
} from "@mui/material";
import { useTheme } from "@mui/material/styles";
import { useDeferredValue, useEffect, useState } from "react";
import type { ChainThreshold } from "../../api/types";
import {
  buildRuleEditorDraft,
  countProfileRules,
  formatThresholdPair,
  getRuleCatalogEntry,
  thresholdRuleCatalog,
  type RuleCatalogEntry,
  type RuleEditorDraft,
} from "./lib/ruleCatalog";

export interface ChainEditorDraft {
  name: string;
  lateThreshold: string;
  lateReopenThreshold: string;
  unassignedThreshold: string;
  unassignedReopenThreshold: string;
  readyThreshold: string;
  readyReopenThreshold: string;
  capacityRuleEnabled: boolean;
  capacityPerHourEnabled: boolean;
  capacityPerHourLimit: string;
}

export interface DefaultThresholdEditorDraft {
  lateThreshold: string;
  lateReopenThreshold: string;
  unassignedThreshold: string;
  unassignedReopenThreshold: string;
  readyThreshold: string;
  readyReopenThreshold: string;
}

function surfaceCardSx(entry: RuleCatalogEntry, highlighted = false) {
  return {
    position: "relative" as const,
    overflow: "hidden",
    p: 1.35,
    borderRadius: 3,
    border: `1px solid ${highlighted ? entry.accent.border : "rgba(148,163,184,0.16)"}`,
    bgcolor: "rgba(255,255,255,0.94)",
    boxShadow: highlighted ? entry.accent.glow : "0 18px 40px rgba(15,23,42,0.06)",
    transition: "transform 180ms ease, box-shadow 180ms ease, border-color 180ms ease",
    "&:hover": {
      transform: "translateY(-2px)",
      boxShadow: entry.accent.glow,
      borderColor: entry.accent.border,
    },
  };
}

function buildChainRuleEditorDraft(chainEditor: ChainEditorDraft): RuleEditorDraft {
  return {
    late: {
      close: chainEditor.lateThreshold,
      reopen: chainEditor.lateReopenThreshold,
    },
    unassigned: {
      close: chainEditor.unassignedThreshold,
      reopen: chainEditor.unassignedReopenThreshold,
    },
    ready: {
      close: chainEditor.readyThreshold,
      reopen: chainEditor.readyReopenThreshold,
    },
    capacity: {
      enabled: chainEditor.capacityRuleEnabled,
    },
    capacityHour: {
      enabled: chainEditor.capacityPerHourEnabled,
      limit: chainEditor.capacityPerHourLimit,
    },
  };
}

function buildDefaultRuleEditorDraft(defaultEditor: DefaultThresholdEditorDraft): RuleEditorDraft {
  return {
    late: {
      close: defaultEditor.lateThreshold,
      reopen: defaultEditor.lateReopenThreshold,
    },
    unassigned: {
      close: defaultEditor.unassignedThreshold,
      reopen: defaultEditor.unassignedReopenThreshold,
    },
    ready: {
      close: defaultEditor.readyThreshold,
      reopen: defaultEditor.readyReopenThreshold,
    },
    capacity: {
      enabled: true,
    },
    capacityHour: {
      enabled: false,
      limit: "",
    },
  };
}

function RuleShowcaseCard(props: {
  entry: RuleCatalogEntry;
  closeValue?: number;
  reopenValue?: number;
  enabled?: boolean;
  limit?: number | null;
  caption: string;
}) {
  const { entry } = props;

  return (
    <Box sx={surfaceCardSx(entry)}>
      <Stack spacing={1.05}>
        <Stack direction="row" spacing={1} alignItems="center">
          <Box
            sx={{
              width: 42,
              height: 42,
              borderRadius: 2.2,
              display: "grid",
              placeItems: "center",
              color: entry.accent.solid,
              bgcolor: entry.accent.soft,
              border: `1px solid ${entry.accent.border}`,
            }}
          >
            {entry.icon}
          </Box>
          <Box sx={{ minWidth: 0 }}>
            <Typography sx={{ fontWeight: 900, color: "#0f172a" }}>
              {entry.label}
            </Typography>
            <Typography variant="caption" sx={{ color: "text.secondary", display: "block" }}>
              {entry.description}
            </Typography>
          </Box>
        </Stack>

        <Stack direction="row" spacing={0.75} flexWrap="wrap">
          {entry.supportsClose ? (
            <Chip
              size="small"
              label={`Close ${props.closeValue ?? 0}`}
              sx={{ fontWeight: 900, bgcolor: entry.accent.soft, color: entry.accent.solid }}
            />
          ) : null}
          {entry.supportsReopen ? (
            <Chip
              size="small"
              label={`Reopen ${props.reopenValue ?? 0}`}
              sx={{ fontWeight: 900, bgcolor: "rgba(15,23,42,0.05)", color: "#334155" }}
            />
          ) : null}
          {entry.supportsToggle ? (
            <Chip
              size="small"
              label={props.enabled === false ? "Disabled" : "Enabled"}
              sx={{
                fontWeight: 900,
                bgcolor: props.enabled === false ? "rgba(148,163,184,0.14)" : entry.accent.soft,
                color: props.enabled === false ? "#475569" : entry.accent.solid,
              }}
            />
          ) : null}
          {entry.supportsLimit ? (
            <Chip
              size="small"
              label={props.limit != null ? `${props.limit}/h` : "No limit"}
              sx={{ fontWeight: 900, bgcolor: "rgba(15,23,42,0.05)", color: "#334155" }}
            />
          ) : null}
        </Stack>

        <Typography variant="caption" sx={{ color: "#64748b" }}>
          {props.caption}
        </Typography>
      </Stack>
    </Box>
  );
}

function RuleEditorCard(props: {
  entry: RuleCatalogEntry;
  draft: RuleEditorDraft;
  closeLabelSuffix: string;
  reopenLabelSuffix: string;
  limitLabel: string;
  disabled: boolean;
  onCloseChange?: (value: string) => void;
  onReopenChange?: (value: string) => void;
  onToggleChange?: (value: boolean) => void;
  onLimitChange?: (value: string) => void;
}) {
  const { entry, draft } = props;
  const values = draft[entry.id] as {
    close?: string;
    reopen?: string;
    enabled?: boolean;
    limit?: string;
  };

  return (
    <Box sx={surfaceCardSx(entry, true)}>
      <Stack spacing={1.15}>
        <Stack direction="row" spacing={1} alignItems="center">
          <Box
            sx={{
              width: 42,
              height: 42,
              borderRadius: 2.2,
              display: "grid",
              placeItems: "center",
              color: entry.accent.solid,
              bgcolor: entry.accent.soft,
              border: `1px solid ${entry.accent.border}`,
            }}
          >
            {entry.icon}
          </Box>
          <Box sx={{ minWidth: 0 }}>
            <Typography sx={{ fontWeight: 900, color: "#0f172a" }}>
              {entry.label}
            </Typography>
            <Typography variant="caption" sx={{ color: "text.secondary", display: "block" }}>
              {entry.description}
            </Typography>
          </Box>
        </Stack>

        {entry.supportsClose ? (
          <Stack direction={{ xs: "column", sm: "row" }} spacing={1}>
            <TextField
              label={`${entry.shortLabel} ${props.closeLabelSuffix}`}
              type="number"
              value={values.close}
              onChange={(event) => props.onCloseChange?.(event.target.value)}
              inputProps={{ min: 0 }}
              disabled={props.disabled}
              fullWidth
            />
            <TextField
              label={`${entry.shortLabel} ${props.reopenLabelSuffix}`}
              type="number"
              value={values.reopen}
              onChange={(event) => props.onReopenChange?.(event.target.value)}
              inputProps={{ min: 0 }}
              disabled={props.disabled}
              fullWidth
            />
          </Stack>
        ) : null}

        {entry.supportsToggle ? (
          <Stack
            direction={{ xs: "column", sm: "row" }}
            spacing={1}
            alignItems={{ xs: "flex-start", sm: "center" }}
            justifyContent="space-between"
          >
            <Stack spacing={0.25}>
              <Typography sx={{ fontWeight: 800, color: "#0f172a" }}>
                {entry.supportsLimit ? "Hourly limiter" : "Rule state"}
              </Typography>
              <Typography variant="caption" sx={{ color: "#64748b" }}>
                {entry.supportsLimit ? "Keep a custom limit only when this limiter is enabled." : "Turn this rule on or off for the selected scope."}
              </Typography>
            </Stack>

            <Stack direction="row" spacing={0.9} alignItems="center">
              <Typography variant="caption" sx={{ color: "#64748b" }}>
                {values.enabled ? "Enabled" : "Disabled"}
              </Typography>
              <Switch
                checked={values.enabled}
                onChange={(event) => props.onToggleChange?.(event.target.checked)}
                disabled={props.disabled}
              />
            </Stack>
          </Stack>
        ) : null}

        {entry.supportsLimit ? (
          <TextField
            label={props.limitLabel}
            type="number"
            value={values.limit}
            onChange={(event) => props.onLimitChange?.(event.target.value)}
            inputProps={{ min: 1 }}
            disabled={props.disabled}
            fullWidth
          />
        ) : null}
      </Stack>
    </Box>
  );
}

export function ChainThresholdManager(props: {
  chains: ChainThreshold[];
  globalThresholds: {
    lateThreshold: number;
    lateReopenThreshold?: number;
    unassignedThreshold: number;
    unassignedReopenThreshold?: number;
    readyThreshold?: number;
    readyReopenThreshold?: number;
  };
  selectedChainName: string | null;
  editingChainIndex: number | null;
  chainEditor: ChainEditorDraft;
  chainEditorOpen: boolean;
  defaultEditor: DefaultThresholdEditorDraft;
  defaultEditorOpen: boolean;
  readOnly?: boolean;
  onSelectChain: (chainName: string | null) => void;
  onChangeDefaultEditor: (patch: Partial<DefaultThresholdEditorDraft>) => void;
  onOpenDefaults: () => void;
  onCloseDefaults: () => void;
  onSaveDefaults: () => void;
  onChangeEditor: (patch: Partial<ChainEditorDraft>) => void;
  onOpenNewChain: () => void;
  onEditChain: (chain: ChainThreshold, index: number) => void;
  onRemoveChain: (index: number) => void;
  onSaveChain: () => void;
  onCancelEdit: () => void;
  onOpenOverrides: (chainName: string) => void;
}) {
  const {
    chains,
    globalThresholds,
    selectedChainName,
    editingChainIndex,
    chainEditor,
    chainEditorOpen,
    defaultEditor,
    defaultEditorOpen,
    readOnly = false,
  } = props;
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("md"));
  const [query, setQuery] = useState("");
  const [chainDetailsOpen, setChainDetailsOpen] = useState(false);
  const deferredQuery = useDeferredValue(query);
  const normalizedQuery = deferredQuery.trim().toLowerCase();
  const chainEntries = chains.map((chain, index) => ({ chain, index }));
  const filteredChains = chainEntries.filter(({ chain }) => chain.name.toLowerCase().includes(normalizedQuery));
  const selectedChainEntry =
    filteredChains.find(({ chain }) => chain.name === selectedChainName)
    ?? chainEntries.find(({ chain }) => chain.name === selectedChainName)
    ?? filteredChains[0]
    ?? chainEntries[0]
    ?? null;
  const chainDraft = buildChainRuleEditorDraft(chainEditor);
  const defaultsDraft = buildDefaultRuleEditorDraft(defaultEditor);
  const enabledCapacityChains = chains.filter((chain) => chain.capacityRuleEnabled !== false).length;
  const enabledReadyChains = chains.filter((chain) => (chain.readyThreshold ?? 0) > 0).length;

  useEffect(() => {
    if (!chainEntries.length) {
      if (selectedChainName !== null) {
        props.onSelectChain(null);
      }
      setChainDetailsOpen(false);
      return;
    }

    if (!selectedChainEntry || selectedChainEntry.chain.name !== selectedChainName) {
      props.onSelectChain(selectedChainEntry?.chain.name ?? null);
    }
  }, [chainEntries.length, props, selectedChainEntry, selectedChainName]);

  function handleOpenChainDetails(chainName: string) {
    props.onSelectChain(chainName);
    setChainDetailsOpen(true);
  }

  function handleCloseChainDetails() {
    setChainDetailsOpen(false);
  }

  return (
    <Stack spacing={2}>
      <Box
        sx={{
          p: { xs: 1.4, md: 1.7 },
          borderRadius: 4,
          border: "1px solid rgba(148,163,184,0.16)",
          background:
            "linear-gradient(135deg, rgba(255,255,255,0.95), rgba(248,250,252,0.98) 55%, rgba(239,246,255,0.92) 100%)",
          boxShadow: "0 28px 54px rgba(15,23,42,0.08)",
        }}
      >
        <Stack
          direction={{ xs: "column", xl: "row" }}
          spacing={1.6}
          sx={{ alignItems: { xs: "stretch", xl: "flex-start" } }}
        >
          <Box
            sx={{
              width: { xs: "100%", xl: 320 },
              flexShrink: 0,
              p: 1.35,
              borderRadius: 3.2,
              border: "1px solid rgba(148,163,184,0.16)",
              bgcolor: "rgba(248,250,252,0.8)",
              boxShadow: "inset 0 1px 0 rgba(255,255,255,0.86)",
            }}
          >
            <Stack spacing={1.2}>
              <Stack direction="row" spacing={1} alignItems="center" justifyContent="space-between">
                <Box>
                  <Typography sx={{ fontWeight: 900, color: "#0f172a" }}>
                    Chains Studio
                  </Typography>
                  <Typography variant="caption" sx={{ color: "#64748b" }}>
                    Select a chain to review and tune its rule profile.
                  </Typography>
                </Box>
                <Chip
                  size="small"
                  label={`${chains.length} chains`}
                  sx={{ fontWeight: 900, bgcolor: "rgba(37,99,235,0.08)", color: "#1d4ed8" }}
                />
              </Stack>

              <TextField
                placeholder="Search chains"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                size="small"
                fullWidth
                InputProps={{
                  startAdornment: (
                    <InputAdornment position="start">
                      <SearchRoundedIcon sx={{ fontSize: 18, color: "#64748b" }} />
                    </InputAdornment>
                  ),
                }}
              />

              <Stack direction="row" spacing={0.75} flexWrap="wrap">
                <Chip
                  size="small"
                  label={`${enabledCapacityChains} capacity on`}
                  sx={{ fontWeight: 900, bgcolor: "rgba(20,184,166,0.1)", color: "#0f766e" }}
                />
                <Chip
                  size="small"
                  label={`${enabledReadyChains} ready active`}
                  sx={{ fontWeight: 900, bgcolor: "rgba(59,130,246,0.1)", color: "#1d4ed8" }}
                />
              </Stack>

              <Button
                variant="contained"
                startIcon={<AddRoundedIcon />}
                onClick={props.onOpenNewChain}
                disabled={readOnly}
                sx={{
                  borderRadius: 999,
                  justifyContent: "flex-start",
                  background: "linear-gradient(135deg, #0f172a, #1d4ed8)",
                  boxShadow: "0 18px 30px rgba(29,78,216,0.22)",
                }}
              >
                Add Chain Workspace
              </Button>

              <Divider />

              <Stack spacing={0.9}>
                {filteredChains.length ? (
                  filteredChains.map(({ chain, index }) => {
                    const selected = selectedChainEntry?.chain.name === chain.name;
                    return (
                      <ButtonBase
                        key={`${chain.name}-${index}`}
                        onClick={() => handleOpenChainDetails(chain.name)}
                        sx={{
                          width: "100%",
                          borderRadius: 3,
                          textAlign: "left",
                        }}
                      >
                        <Box
                          sx={{
                            width: "100%",
                            p: 1.15,
                            borderRadius: 3,
                            border: selected ? "1px solid rgba(29,78,216,0.26)" : "1px solid rgba(148,163,184,0.16)",
                            bgcolor: selected ? "rgba(219,234,254,0.72)" : "rgba(255,255,255,0.9)",
                            boxShadow: selected ? "0 20px 32px rgba(29,78,216,0.14)" : "0 10px 20px rgba(15,23,42,0.05)",
                            transition: "transform 180ms ease, box-shadow 180ms ease, border-color 180ms ease",
                            "&:hover": {
                              transform: "translateY(-1px)",
                              boxShadow: "0 18px 30px rgba(15,23,42,0.08)",
                            },
                          }}
                        >
                          <Stack spacing={0.8}>
                            <Stack direction="row" spacing={1} alignItems="center" justifyContent="space-between">
                              <Stack direction="row" spacing={1} alignItems="center" sx={{ minWidth: 0 }}>
                                <Box
                                  sx={{
                                    width: 36,
                                    height: 36,
                                    borderRadius: 2.2,
                                    display: "grid",
                                    placeItems: "center",
                                    bgcolor: selected ? "rgba(29,78,216,0.16)" : "rgba(15,23,42,0.06)",
                                    color: selected ? "#1d4ed8" : "#334155",
                                    flexShrink: 0,
                                  }}
                                >
                                  <AccountTreeRoundedIcon sx={{ fontSize: 18 }} />
                                </Box>
                                <Box sx={{ minWidth: 0 }}>
                                  <Typography sx={{ fontWeight: 900, color: "#0f172a" }} noWrap>
                                    {chain.name}
                                  </Typography>
                                  <Typography variant="caption" sx={{ color: "#64748b", display: "block" }} noWrap>
                                    {countProfileRules({
                                      ...chain,
                                    })} rules tuned
                                  </Typography>
                                </Box>
                              </Stack>
                              {selected ? (
                                <Chip
                                  size="small"
                                  label="Selected"
                                  sx={{ fontWeight: 900, bgcolor: "rgba(29,78,216,0.14)", color: "#1d4ed8" }}
                                />
                              ) : null}
                            </Stack>

                            <Stack direction="row" spacing={0.6} flexWrap="wrap">
                              <Chip
                                size="small"
                                label={`Late ${formatThresholdPair(chain.lateThreshold, chain.lateReopenThreshold)}`}
                                sx={{ fontWeight: 900, bgcolor: "rgba(251,146,60,0.1)", color: "#c2410c" }}
                              />
                              <Chip
                                size="small"
                                label={`Ready ${formatThresholdPair(chain.readyThreshold ?? 0, chain.readyReopenThreshold)}`}
                                sx={{ fontWeight: 900, bgcolor: "rgba(59,130,246,0.1)", color: "#1d4ed8" }}
                              />
                            </Stack>
                          </Stack>
                        </Box>
                      </ButtonBase>
                    );
                  })
                ) : (
                  <Alert severity="info" variant="outlined" sx={{ borderRadius: 2.8 }}>
                    No chains match this search.
                  </Alert>
                )}
              </Stack>
            </Stack>
          </Box>

          <Stack sx={{ flex: 1, minWidth: 0 }} spacing={1.4}>
            <Box
              sx={{
                p: 1.35,
                borderRadius: 3.2,
                border: "1px solid rgba(148,163,184,0.16)",
                bgcolor: "rgba(255,255,255,0.88)",
                boxShadow: "0 18px 40px rgba(15,23,42,0.06)",
              }}
            >
              <Stack
                direction={{ xs: "column", lg: "row" }}
                spacing={1.25}
                justifyContent="space-between"
                alignItems={{ xs: "flex-start", lg: "center" }}
              >
                <Box>
                  <Stack direction="row" spacing={0.9} alignItems="center">
                    <Box
                      sx={{
                        width: 40,
                        height: 40,
                        borderRadius: 2.4,
                        display: "grid",
                        placeItems: "center",
                        bgcolor: "rgba(15,118,110,0.1)",
                        color: "#0f766e",
                      }}
                    >
                      <PublicRoundedIcon sx={{ fontSize: 20 }} />
                    </Box>
                    <Box>
                      <Typography sx={{ fontWeight: 900, color: "#0f172a" }}>
                        Global Defaults
                      </Typography>
                      <Typography variant="caption" sx={{ color: "#64748b", display: "block" }}>
                        Pinned baseline for every chain before custom tuning starts.
                      </Typography>
                    </Box>
                  </Stack>
                </Box>

                <Button
                  variant="outlined"
                  startIcon={<TuneRoundedIcon />}
                  onClick={props.onOpenDefaults}
                  disabled={readOnly}
                  sx={{ borderRadius: 999, fontWeight: 900 }}
                >
                  Edit Defaults
                </Button>
              </Stack>

              <Box
                sx={{
                  mt: 1.3,
                  display: "grid",
                  gap: 1,
                  gridTemplateColumns: { xs: "1fr", md: "repeat(3, minmax(0, 1fr))" },
                }}
              >
                {thresholdRuleCatalog
                  .filter((entry) => entry.id === "late" || entry.id === "unassigned" || entry.id === "ready")
                  .map((entry) => {
                    if (entry.id === "late") {
                      return (
                        <RuleShowcaseCard
                          key={entry.id}
                          entry={entry}
                          closeValue={globalThresholds.lateThreshold}
                          reopenValue={globalThresholds.lateReopenThreshold}
                          caption="Global default pair for late-order closures."
                        />
                      );
                    }

                    if (entry.id === "unassigned") {
                      return (
                        <RuleShowcaseCard
                          key={entry.id}
                          entry={entry}
                          closeValue={globalThresholds.unassignedThreshold}
                          reopenValue={globalThresholds.unassignedReopenThreshold}
                          caption="Global default pair for unassigned queue pressure."
                        />
                      );
                    }

                    return (
                      <RuleShowcaseCard
                        key={entry.id}
                        entry={entry}
                        closeValue={globalThresholds.readyThreshold ?? 0}
                        reopenValue={globalThresholds.readyReopenThreshold}
                        caption="Global default pair for ready-to-pickup pressure."
                      />
                    );
                  })}
              </Box>
            </Box>

            {selectedChainEntry ? (
              <Box
                sx={{
                  p: 1.35,
                  borderRadius: 3.2,
                  border: "1px solid rgba(148,163,184,0.16)",
                  background:
                    "linear-gradient(140deg, rgba(255,255,255,0.94), rgba(239,246,255,0.82) 48%, rgba(248,250,252,0.98) 100%)",
                  boxShadow: "0 18px 44px rgba(15,23,42,0.08)",
                }}
              >
                <Stack spacing={1.25}>
                  <Stack
                    direction={{ xs: "column", lg: "row" }}
                    spacing={1.2}
                    justifyContent="space-between"
                    alignItems={{ xs: "flex-start", lg: "center" }}
                  >
                    <Box>
                      <Stack direction="row" spacing={0.9} alignItems="center">
                        <Box
                          sx={{
                            width: 42,
                            height: 42,
                            borderRadius: 2.4,
                            display: "grid",
                            placeItems: "center",
                            bgcolor: "rgba(29,78,216,0.12)",
                            color: "#1d4ed8",
                          }}
                        >
                          <AccountTreeRoundedIcon sx={{ fontSize: 21 }} />
                        </Box>
                        <Box>
                          <Typography sx={{ fontWeight: 900, color: "#0f172a" }}>
                            Focused Chain Screens
                          </Typography>
                          <Typography variant="caption" sx={{ color: "#64748b", display: "block" }}>
                            Chain details now open in a dedicated popup so the studio stays easy to scan.
                          </Typography>
                        </Box>
                      </Stack>
                    </Box>

                    <Stack direction={{ xs: "column", sm: "row" }} spacing={1}>
                      <Button
                        variant="contained"
                        startIcon={<TuneRoundedIcon />}
                        onClick={() => handleOpenChainDetails(selectedChainEntry.chain.name)}
                        sx={{
                          borderRadius: 999,
                          background: "linear-gradient(135deg, #0f172a, #1d4ed8)",
                          boxShadow: "0 18px 30px rgba(29,78,216,0.18)",
                        }}
                      >
                        Open Chain Screen
                      </Button>
                      <Button
                        variant="outlined"
                        startIcon={<ArrowOutwardRoundedIcon />}
                        onClick={() => props.onOpenOverrides(selectedChainEntry.chain.name)}
                        sx={{ borderRadius: 999, fontWeight: 900 }}
                      >
                        Branch Overrides
                      </Button>
                    </Stack>
                  </Stack>

                  <Stack direction="row" spacing={0.75} flexWrap="wrap">
                    <Chip
                      size="small"
                      label={selectedChainEntry.chain.name}
                      sx={{ fontWeight: 900, bgcolor: "rgba(29,78,216,0.12)", color: "#1d4ed8" }}
                    />
                    <Chip
                      size="small"
                      label={`${countProfileRules({
                        ...selectedChainEntry.chain,
                      })} rules active`}
                      sx={{ fontWeight: 900, bgcolor: "rgba(15,23,42,0.06)", color: "#334155" }}
                    />
                    <Chip
                      size="small"
                      label="Click any chain card to inspect it in a popup"
                      sx={{ fontWeight: 900, bgcolor: "rgba(15,118,110,0.08)", color: "#0f766e" }}
                    />
                  </Stack>
                </Stack>
              </Box>
            ) : (
              <Alert severity="info" variant="outlined" sx={{ borderRadius: 3.2 }}>
                Create your first chain workspace to start grouping rule profiles.
              </Alert>
            )}
          </Stack>
        </Stack>
      </Box>

      <Dialog
        open={chainDetailsOpen && selectedChainEntry != null}
        onClose={handleCloseChainDetails}
        fullWidth
        fullScreen={isMobile}
        maxWidth="lg"
        PaperProps={{
          "data-testid": "chain-details-dialog",
          sx: {
            width: { xs: "100%", sm: "min(1040px, calc(100vw - 56px))" },
            height: { xs: "100%", sm: "min(760px, calc(100vh - 48px))" },
            maxHeight: { xs: "100%", sm: "calc(100vh - 48px)" },
            m: { xs: 0, sm: 2.5 },
            borderRadius: { xs: 0, sm: 3.2 },
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
          },
        }}
      >
        {selectedChainEntry ? (
          <DialogContent
            dividers
            sx={{
              p: { xs: 1, md: 1.35 },
              flex: 1,
              minHeight: 0,
              display: "flex",
              flexDirection: "column",
              gap: 1.5,
              overflowX: "hidden",
              overflowY: "auto",
            }}
          >
            <Stack spacing={1.3}>
              <Stack
                direction={{ xs: "column", lg: "row" }}
                spacing={1.2}
                justifyContent="space-between"
                alignItems={{ xs: "flex-start", lg: "center" }}
              >
                <Stack direction="row" spacing={1} alignItems="center">
                  <Box
                    sx={{
                      width: 48,
                      height: 48,
                      borderRadius: 2.8,
                      display: "grid",
                      placeItems: "center",
                      bgcolor: "rgba(29,78,216,0.12)",
                      color: "#1d4ed8",
                    }}
                  >
                    <AccountTreeRoundedIcon sx={{ fontSize: 22 }} />
                  </Box>
                  <Box>
                    <Typography sx={{ fontWeight: 900, fontSize: { xs: "1.1rem", md: "1.25rem" }, color: "#0f172a" }}>
                      {selectedChainEntry.chain.name}
                    </Typography>
                    <Typography variant="caption" sx={{ color: "#64748b", display: "block" }}>
                      {countProfileRules({
                        ...selectedChainEntry.chain,
                      })} rules active in this workspace.
                    </Typography>
                  </Box>
                </Stack>

                <Stack direction={{ xs: "column-reverse", sm: "row" }} spacing={1}>
                  <Button
                    variant="text"
                    color="inherit"
                    onClick={handleCloseChainDetails}
                    startIcon={<CloseRoundedIcon />}
                  >
                    Close
                  </Button>
                  <Button
                    variant="outlined"
                    startIcon={<ArrowOutwardRoundedIcon />}
                    onClick={() => {
                      handleCloseChainDetails();
                      props.onOpenOverrides(selectedChainEntry.chain.name);
                    }}
                    sx={{ borderRadius: 999, fontWeight: 900 }}
                  >
                    Branch Overrides
                  </Button>
                  <Button
                    variant="contained"
                    startIcon={<EditOutlinedIcon />}
                    onClick={() => {
                      handleCloseChainDetails();
                      props.onEditChain(selectedChainEntry.chain, selectedChainEntry.index);
                    }}
                    disabled={readOnly}
                    sx={{
                      borderRadius: 999,
                      background: "linear-gradient(135deg, #0f172a, #1d4ed8)",
                      boxShadow: "0 18px 30px rgba(29,78,216,0.18)",
                    }}
                  >
                    Edit Chain
                  </Button>
                </Stack>
              </Stack>

              <Stack direction="row" spacing={0.75} flexWrap="wrap">
                <Chip
                  size="small"
                  label={`Late ${formatThresholdPair(selectedChainEntry.chain.lateThreshold, selectedChainEntry.chain.lateReopenThreshold)}`}
                  sx={{ fontWeight: 900, bgcolor: "rgba(251,146,60,0.1)", color: "#c2410c" }}
                />
                <Chip
                  size="small"
                  label={`Ready ${formatThresholdPair(selectedChainEntry.chain.readyThreshold ?? 0, selectedChainEntry.chain.readyReopenThreshold)}`}
                  sx={{ fontWeight: 900, bgcolor: "rgba(59,130,246,0.1)", color: "#1d4ed8" }}
                />
                <Chip
                  size="small"
                  label={selectedChainEntry.chain.capacityRuleEnabled === false ? "Capacity off" : "Capacity on"}
                  sx={{ fontWeight: 900, bgcolor: "rgba(20,184,166,0.1)", color: "#0f766e" }}
                />
              </Stack>

              <Box
                sx={{
                  display: "grid",
                  gap: 1,
                  gridTemplateColumns: { xs: "1fr", md: "repeat(2, minmax(0, 1fr))", xl: "repeat(3, minmax(0, 1fr))" },
                }}
              >
                {thresholdRuleCatalog.map((entry) => {
                  if (entry.id === "late") {
                    return (
                      <RuleShowcaseCard
                        key={entry.id}
                        entry={entry}
                        closeValue={selectedChainEntry.chain.lateThreshold}
                        reopenValue={selectedChainEntry.chain.lateReopenThreshold}
                        caption="Custom chain close/reopen pair."
                      />
                    );
                  }

                  if (entry.id === "unassigned") {
                    return (
                      <RuleShowcaseCard
                        key={entry.id}
                        entry={entry}
                        closeValue={selectedChainEntry.chain.unassignedThreshold}
                        reopenValue={selectedChainEntry.chain.unassignedReopenThreshold}
                        caption="Custom chain pair for picker assignment pressure."
                      />
                    );
                  }

                  if (entry.id === "ready") {
                    return (
                      <RuleShowcaseCard
                        key={entry.id}
                        entry={entry}
                        closeValue={selectedChainEntry.chain.readyThreshold ?? 0}
                        reopenValue={selectedChainEntry.chain.readyReopenThreshold}
                        caption="Ready queue thresholds for this chain."
                      />
                    );
                  }

                  if (entry.id === "capacity") {
                    return (
                      <RuleShowcaseCard
                        key={entry.id}
                        entry={entry}
                        enabled={selectedChainEntry.chain.capacityRuleEnabled !== false}
                        caption="Picker-capacity protection toggle."
                      />
                    );
                  }

                  return (
                    <RuleShowcaseCard
                      key={entry.id}
                      entry={entry}
                      enabled={selectedChainEntry.chain.capacityPerHourEnabled === true}
                      limit={selectedChainEntry.chain.capacityPerHourLimit ?? null}
                      caption="Optional hourly limiter for the selected chain."
                    />
                  );
                })}
              </Box>

              <Stack direction={{ xs: "column-reverse", sm: "row" }} spacing={1} justifyContent="space-between">
                <Button
                  variant="text"
                  color="inherit"
                  startIcon={<DeleteOutlineRoundedIcon />}
                  onClick={() => {
                    handleCloseChainDetails();
                    props.onRemoveChain(selectedChainEntry.index);
                  }}
                  disabled={readOnly}
                  sx={{ borderRadius: 999, fontWeight: 900 }}
                >
                  Remove
                </Button>
              </Stack>
            </Stack>
          </DialogContent>
        ) : null}
      </Dialog>

      <Drawer
        open={defaultEditorOpen}
        anchor={isMobile ? "bottom" : "right"}
        onClose={props.onCloseDefaults}
        PaperProps={{
          "data-testid": "default-threshold-sheet",
          "data-anchor": isMobile ? "bottom" : "right",
          sx: {
            width: { xs: "100%", md: 480 },
            maxWidth: "100%",
            borderTopLeftRadius: isMobile ? 24 : 28,
            borderTopRightRadius: isMobile ? 24 : 0,
            borderBottomLeftRadius: isMobile ? 0 : 28,
            p: 2,
            border: "1px solid rgba(148,163,184,0.16)",
            boxShadow: "0 28px 54px rgba(15,23,42,0.16)",
          },
        }}
      >
        <Stack spacing={1.5}>
          <Stack direction="row" spacing={1} alignItems="center" justifyContent="space-between">
            <Box>
              <Typography sx={{ fontWeight: 900, color: "#0f172a" }}>
                Edit Global Defaults
              </Typography>
              <Typography variant="caption" sx={{ color: "#64748b" }}>
                Update the baseline thresholds every chain starts from.
              </Typography>
            </Box>

            <Button
              variant="text"
              color="inherit"
              onClick={props.onCloseDefaults}
              startIcon={<CloseRoundedIcon />}
            >
              Close
            </Button>
          </Stack>

          <Divider />

          <Stack spacing={1.1}>
            {["late", "unassigned", "ready"].map((ruleId) => {
              const entry = getRuleCatalogEntry(ruleId as "late" | "unassigned" | "ready");

              if (entry.id === "late") {
                return (
                  <RuleEditorCard
                    key={entry.id}
                    entry={entry}
                    draft={defaultsDraft}
                    closeLabelSuffix="Close Threshold"
                    reopenLabelSuffix="Reopen Threshold"
                    limitLabel=""
                    disabled={readOnly}
                    onCloseChange={(value) => props.onChangeDefaultEditor({ lateThreshold: value })}
                    onReopenChange={(value) => props.onChangeDefaultEditor({ lateReopenThreshold: value })}
                  />
                );
              }

              if (entry.id === "unassigned") {
                return (
                  <RuleEditorCard
                    key={entry.id}
                    entry={entry}
                    draft={defaultsDraft}
                    closeLabelSuffix="Close Threshold"
                    reopenLabelSuffix="Reopen Threshold"
                    limitLabel=""
                    disabled={readOnly}
                    onCloseChange={(value) => props.onChangeDefaultEditor({ unassignedThreshold: value })}
                    onReopenChange={(value) => props.onChangeDefaultEditor({ unassignedReopenThreshold: value })}
                  />
                );
              }

              return (
                <RuleEditorCard
                  key={entry.id}
                  entry={entry}
                  draft={defaultsDraft}
                  closeLabelSuffix="Close Threshold"
                  reopenLabelSuffix="Reopen Threshold"
                  limitLabel=""
                  disabled={readOnly}
                  onCloseChange={(value) => props.onChangeDefaultEditor({ readyThreshold: value })}
                  onReopenChange={(value) => props.onChangeDefaultEditor({ readyReopenThreshold: value })}
                />
              );
            })}
          </Stack>

          <Stack direction={{ xs: "column-reverse", sm: "row" }} spacing={1}>
            <Button
              variant="text"
              color="inherit"
              onClick={props.onCloseDefaults}
              sx={{ width: { xs: "100%", sm: "auto" } }}
            >
              Cancel
            </Button>
            <Button
              variant="contained"
              onClick={props.onSaveDefaults}
              disabled={readOnly}
              sx={{
                width: { xs: "100%", sm: "auto" },
                borderRadius: 999,
                background: "linear-gradient(135deg, #0f172a, #1d4ed8)",
              }}
            >
              Save Defaults
            </Button>
          </Stack>
        </Stack>
      </Drawer>

      <Drawer
        open={chainEditorOpen}
        anchor={isMobile ? "bottom" : "right"}
        onClose={props.onCancelEdit}
        PaperProps={{
          "data-testid": "chain-threshold-sheet",
          "data-anchor": isMobile ? "bottom" : "right",
          sx: {
            width: { xs: "100%", md: 520 },
            maxWidth: "100%",
            borderTopLeftRadius: isMobile ? 24 : 28,
            borderTopRightRadius: isMobile ? 24 : 0,
            borderBottomLeftRadius: isMobile ? 0 : 28,
            p: 2,
            border: "1px solid rgba(148,163,184,0.16)",
            boxShadow: "0 28px 54px rgba(15,23,42,0.16)",
          },
        }}
      >
        <Stack spacing={1.5}>
          <Stack direction="row" spacing={1} alignItems="center" justifyContent="space-between">
            <Box>
              <Typography sx={{ fontWeight: 900, color: "#0f172a" }}>
                {editingChainIndex !== null ? "Edit Chain Workspace" : "New Chain Workspace"}
              </Typography>
              <Typography variant="caption" sx={{ color: "#64748b" }}>
                Create a modern rule profile for a single chain and reuse it across overrides.
              </Typography>
            </Box>

            <Button
              variant="text"
              color="inherit"
              onClick={props.onCancelEdit}
              startIcon={<CloseRoundedIcon />}
            >
              Close
            </Button>
          </Stack>

          <TextField
            label="Chain Name"
            value={chainEditor.name}
            onChange={(event) => props.onChangeEditor({ name: event.target.value })}
            disabled={readOnly}
            fullWidth
          />

          <Divider />

          <Stack spacing={1.1}>
            {thresholdRuleCatalog.map((entry) => {
              if (entry.id === "late") {
                return (
                  <RuleEditorCard
                    key={entry.id}
                    entry={entry}
                    draft={chainDraft}
                    closeLabelSuffix="Close Threshold"
                    reopenLabelSuffix="Reopen Threshold"
                    limitLabel=""
                    disabled={readOnly}
                    onCloseChange={(value) => props.onChangeEditor({ lateThreshold: value })}
                    onReopenChange={(value) => props.onChangeEditor({ lateReopenThreshold: value })}
                  />
                );
              }

              if (entry.id === "unassigned") {
                return (
                  <RuleEditorCard
                    key={entry.id}
                    entry={entry}
                    draft={chainDraft}
                    closeLabelSuffix="Close Threshold"
                    reopenLabelSuffix="Reopen Threshold"
                    limitLabel=""
                    disabled={readOnly}
                    onCloseChange={(value) => props.onChangeEditor({ unassignedThreshold: value })}
                    onReopenChange={(value) => props.onChangeEditor({ unassignedReopenThreshold: value })}
                  />
                );
              }

              if (entry.id === "ready") {
                return (
                  <RuleEditorCard
                    key={entry.id}
                    entry={entry}
                    draft={chainDraft}
                    closeLabelSuffix="Close Threshold"
                    reopenLabelSuffix="Reopen Threshold"
                    limitLabel=""
                    disabled={readOnly}
                    onCloseChange={(value) => props.onChangeEditor({ readyThreshold: value })}
                    onReopenChange={(value) => props.onChangeEditor({ readyReopenThreshold: value })}
                  />
                );
              }

              if (entry.id === "capacity") {
                return (
                  <RuleEditorCard
                    key={entry.id}
                    entry={entry}
                    draft={chainDraft}
                    closeLabelSuffix=""
                    reopenLabelSuffix=""
                    limitLabel=""
                    disabled={readOnly}
                    onToggleChange={(value) => props.onChangeEditor({ capacityRuleEnabled: value })}
                  />
                );
              }

              return (
                <RuleEditorCard
                  key={entry.id}
                  entry={entry}
                  draft={chainDraft}
                  closeLabelSuffix=""
                  reopenLabelSuffix=""
                  limitLabel="Capacity / Hour Limit"
                  disabled={readOnly}
                  onToggleChange={(value) => props.onChangeEditor({ capacityPerHourEnabled: value })}
                  onLimitChange={(value) => props.onChangeEditor({ capacityPerHourLimit: value })}
                />
              );
            })}
          </Stack>

          <Stack direction={{ xs: "column-reverse", sm: "row" }} spacing={1}>
            <Button
              variant="text"
              color="inherit"
              onClick={props.onCancelEdit}
              sx={{ width: { xs: "100%", sm: "auto" } }}
            >
              Cancel
            </Button>
            <Button
              variant="contained"
              onClick={props.onSaveChain}
              disabled={readOnly}
              startIcon={editingChainIndex !== null ? <EditOutlinedIcon /> : <AddRoundedIcon />}
              sx={{
                width: { xs: "100%", sm: "auto" },
                borderRadius: 999,
                background: "linear-gradient(135deg, #0f172a, #1d4ed8)",
              }}
            >
              {editingChainIndex !== null ? "Save Chain" : "Create Chain"}
            </Button>
          </Stack>
        </Stack>
      </Drawer>
    </Stack>
  );
}
