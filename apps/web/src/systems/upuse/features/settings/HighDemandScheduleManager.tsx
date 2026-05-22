import AccessTimeRoundedIcon from "@mui/icons-material/AccessTimeRounded";
import ApartmentRoundedIcon from "@mui/icons-material/ApartmentRounded";
import BoltRoundedIcon from "@mui/icons-material/BoltRounded";
import RestartAltRoundedIcon from "@mui/icons-material/RestartAltRounded";
import SaveRoundedIcon from "@mui/icons-material/SaveRounded";
import SearchRoundedIcon from "@mui/icons-material/SearchRounded";
import {
  Alert,
  Box,
  Button,
  ButtonBase,
  Chip,
  Divider,
  InputAdornment,
  Stack,
  Switch,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from "@mui/material";
import { useEffect, useMemo, useState } from "react";
import type { BranchMappingItem, ChainThreshold, HighDemandSchedule } from "../../api/types";
import {
  DEFAULT_HIGH_DEMAND_SCHEDULE,
  formatHighDemandHour,
  formatHighDemandHourRange,
  formatHighDemandHours,
  matchesBranchQuery,
  normalizeHighDemandSchedule,
  resolveEffectiveHighDemandSchedule,
  safeBranchName,
} from "../branch-mapping/lib/branchMapping";

const HOURS = Array.from({ length: 24 }, (_item, hour) => hour);

type BranchOverrideMode = "inherited" | "custom" | "disabled";

function toggleHour(hours: number[], hour: number) {
  const next = hours.includes(hour)
    ? hours.filter((item) => item !== hour)
    : [...hours, hour];
  return next.sort((left, right) => left - right);
}

function HourGrid(props: {
  hours: number[];
  disabled?: boolean;
  onToggle: (hour: number) => void;
  ariaLabel: string;
}) {
  const selected = new Set(props.hours);

  return (
    <Box
      role="group"
      aria-label={props.ariaLabel}
      sx={{
        display: "grid",
        gridTemplateColumns: {
          xs: "repeat(2, minmax(0, 1fr))",
          sm: "repeat(3, minmax(0, 1fr))",
          md: "repeat(4, minmax(0, 1fr))",
          xl: "repeat(6, minmax(0, 1fr))",
        },
        gap: 0.75,
      }}
    >
      {HOURS.map((hour) => {
        const active = selected.has(hour);
        return (
          <ButtonBase
            key={hour}
            disabled={props.disabled}
            aria-pressed={active}
            aria-label={`${active ? "Remove" : "Select"} ${formatHighDemandHourRange(hour)}`}
            onClick={() => props.onToggle(hour)}
            sx={{
              minHeight: 46,
              borderRadius: 2,
              border: "1px solid",
              borderColor: active ? "rgba(29,78,216,0.44)" : "rgba(148,163,184,0.18)",
              bgcolor: active ? "rgba(219,234,254,0.98)" : "rgba(255,255,255,0.94)",
              color: active ? "#1d4ed8" : "#334155",
              px: 1,
              py: 0.7,
              textAlign: "left",
              outline: "none",
              transition: "border-color 160ms ease, background 160ms ease, box-shadow 160ms ease, transform 160ms ease",
              "&:hover": {
                borderColor: active ? "rgba(29,78,216,0.55)" : "rgba(15,23,42,0.22)",
                boxShadow: "0 10px 20px rgba(15,23,42,0.06)",
              },
              "&.Mui-focusVisible": {
                boxShadow: "0 0 0 3px rgba(96,165,250,0.28)",
              },
              "&.Mui-disabled": {
                opacity: 0.55,
              },
            }}
          >
            <Stack spacing={0.15} sx={{ minWidth: 0, width: "100%" }}>
              <Typography sx={{ fontWeight: 900, lineHeight: 1.1, color: "inherit" }}>
                {formatHighDemandHour(hour)}
              </Typography>
              <Typography variant="caption" sx={{ color: active ? "#1e40af" : "#64748b", lineHeight: 1.15 }}>
                {String(hour).padStart(2, "0")}:00 - {String((hour + 1) % 24).padStart(2, "0")}:00
              </Typography>
            </Stack>
          </ButtonBase>
        );
      })}
    </Box>
  );
}

function panelSx() {
  return {
    p: { xs: 1.25, md: 1.5 },
    borderRadius: 3,
    border: "1px solid rgba(148,163,184,0.16)",
    bgcolor: "rgba(255,255,255,0.96)",
    boxShadow: "0 14px 30px rgba(15,23,42,0.055)",
  };
}

function branchOverrideMode(branch: BranchMappingItem | null | undefined): BranchOverrideMode {
  const override = branch?.highDemandScheduleOverride;
  if (!override) return "inherited";
  return override.enabled ? "custom" : "disabled";
}

export function HighDemandScheduleManager(props: {
  chains: ChainThreshold[];
  branches: BranchMappingItem[];
  readOnly: boolean;
  onSaveChains: (chains: ChainThreshold[]) => Promise<void> | void;
  onSaveBranchOverride: (branch: BranchMappingItem, override: HighDemandSchedule | null) => Promise<void> | void;
}) {
  const [selectedChainName, setSelectedChainName] = useState<string | null>(props.chains[0]?.name ?? null);
  const selectedChain = useMemo(
    () => props.chains.find((chain) => chain.name === selectedChainName) ?? props.chains[0] ?? null,
    [props.chains, selectedChainName],
  );
  const [chainDraft, setChainDraft] = useState<HighDemandSchedule>(DEFAULT_HIGH_DEMAND_SCHEDULE);
  const [savingChain, setSavingChain] = useState(false);

  const [branchQuery, setBranchQuery] = useState("");
  const filteredBranches = useMemo(
    () => props.branches.filter((branch) => matchesBranchQuery(branch, branchQuery)),
    [props.branches, branchQuery],
  );
  const [selectedBranchId, setSelectedBranchId] = useState<number | null>(props.branches[0]?.id ?? null);
  const selectedBranch = useMemo(
    () => props.branches.find((branch) => branch.id === selectedBranchId) ?? props.branches[0] ?? null,
    [props.branches, selectedBranchId],
  );
  const [branchMode, setBranchMode] = useState<BranchOverrideMode>(branchOverrideMode(selectedBranch));
  const [branchDraft, setBranchDraft] = useState<HighDemandSchedule>(DEFAULT_HIGH_DEMAND_SCHEDULE);
  const [savingBranch, setSavingBranch] = useState(false);

  useEffect(() => {
    if (!props.chains.length) {
      setSelectedChainName(null);
      return;
    }

    if (!selectedChainName || !props.chains.some((chain) => chain.name === selectedChainName)) {
      setSelectedChainName(props.chains[0]?.name ?? null);
    }
  }, [props.chains, selectedChainName]);

  useEffect(() => {
    setChainDraft(normalizeHighDemandSchedule(selectedChain?.highDemandSchedule));
  }, [selectedChain?.name, selectedChain?.highDemandSchedule]);

  useEffect(() => {
    if (!props.branches.length) {
      setSelectedBranchId(null);
      return;
    }

    if (!selectedBranchId || !props.branches.some((branch) => branch.id === selectedBranchId)) {
      setSelectedBranchId(props.branches[0]?.id ?? null);
    }
  }, [props.branches, selectedBranchId]);

  useEffect(() => {
    const nextMode = branchOverrideMode(selectedBranch);
    setBranchMode(nextMode);
    setBranchDraft(
      nextMode === "custom"
        ? normalizeHighDemandSchedule(selectedBranch?.highDemandScheduleOverride)
        : DEFAULT_HIGH_DEMAND_SCHEDULE,
    );
  }, [selectedBranch?.id, selectedBranch?.highDemandScheduleOverride]);

  const inheritedBranchSchedule = selectedBranch
    ? resolveEffectiveHighDemandSchedule({ ...selectedBranch, highDemandScheduleOverride: null }, props.chains).schedule
    : DEFAULT_HIGH_DEMAND_SCHEDULE;

  const saveChainSchedule = async () => {
    if (!selectedChain || props.readOnly) return;

    const normalized = normalizeHighDemandSchedule(chainDraft);
    const nextChains = props.chains.map((chain) => (
      chain.name === selectedChain.name
        ? { ...chain, highDemandSchedule: normalized }
        : chain
    ));

    setSavingChain(true);
    try {
      await props.onSaveChains(nextChains);
    } finally {
      setSavingChain(false);
    }
  };

  const saveBranchSchedule = async () => {
    if (!selectedBranch || props.readOnly) return;

    const override =
      branchMode === "inherited"
        ? null
        : branchMode === "disabled"
          ? { enabled: false, hours: [] }
          : normalizeHighDemandSchedule({ enabled: true, hours: branchDraft.hours });

    setSavingBranch(true);
    try {
      await props.onSaveBranchOverride(selectedBranch, override);
    } finally {
      setSavingBranch(false);
    }
  };

  return (
    <Stack spacing={1.5}>
      <Box sx={panelSx()}>
        <Stack direction={{ xs: "column", md: "row" }} spacing={1.1} justifyContent="space-between" alignItems={{ xs: "flex-start", md: "center" }}>
          <Stack direction="row" spacing={1} alignItems="center">
            <Box
              sx={{
                width: 42,
                height: 42,
                borderRadius: 2.2,
                display: "grid",
                placeItems: "center",
                color: "#1d4ed8",
                bgcolor: "rgba(219,234,254,0.96)",
                border: "1px solid rgba(96,165,250,0.24)",
              }}
            >
              <BoltRoundedIcon sx={{ fontSize: 24 }} />
            </Box>
            <Stack spacing={0.15}>
              <Typography variant="h6" sx={{ fontWeight: 900, color: "#0f172a", lineHeight: 1.15 }}>
                High Demand
              </Typography>
              <Stack direction="row" spacing={0.7} flexWrap="wrap">
                <Chip size="small" label="Africa/Cairo" sx={{ fontWeight: 900, bgcolor: "rgba(15,23,42,0.06)", color: "#334155" }} />
                <Chip size="small" label="30m duration" sx={{ fontWeight: 900, bgcolor: "rgba(15,23,42,0.06)", color: "#334155" }} />
                <Chip size="small" label="+10m prep" sx={{ fontWeight: 900, bgcolor: "rgba(15,23,42,0.06)", color: "#334155" }} />
              </Stack>
            </Stack>
          </Stack>
          {props.readOnly ? <Alert severity="info" variant="outlined" sx={{ borderRadius: 2 }}>Read only</Alert> : null}
        </Stack>
      </Box>

      <Box sx={panelSx()}>
        <Stack spacing={1.25}>
          <Stack direction={{ xs: "column", md: "row" }} spacing={1} justifyContent="space-between" alignItems={{ xs: "flex-start", md: "center" }}>
            <Stack direction="row" spacing={1} alignItems="center">
              <ApartmentRoundedIcon sx={{ color: "#334155" }} />
              <Typography sx={{ fontWeight: 900, color: "#0f172a" }}>
                Chain Schedule
              </Typography>
            </Stack>
            <Stack direction="row" spacing={0.75} flexWrap="wrap">
              <Chip size="small" label={formatHighDemandHours(chainDraft)} sx={{ fontWeight: 900, bgcolor: "rgba(219,234,254,0.9)", color: "#1d4ed8" }} />
              <Chip size="small" label={`${chainDraft.hours.length}/24 selected`} sx={{ fontWeight: 900, bgcolor: "rgba(15,23,42,0.06)", color: "#334155" }} />
            </Stack>
          </Stack>

          {props.chains.length ? (
            <Stack direction="row" spacing={0.75} flexWrap="wrap">
              {props.chains.map((chain) => {
                const active = selectedChain?.name === chain.name;
                const schedule = normalizeHighDemandSchedule(chain.highDemandSchedule);
                return (
                  <ButtonBase
                    key={chain.name}
                    onClick={() => setSelectedChainName(chain.name)}
                    aria-pressed={active}
                    sx={{
                      minHeight: 44,
                      borderRadius: 2,
                      px: 1,
                      py: 0.75,
                      border: "1px solid",
                      borderColor: active ? "rgba(29,78,216,0.36)" : "rgba(148,163,184,0.16)",
                      bgcolor: active ? "rgba(219,234,254,0.92)" : "rgba(248,250,252,0.92)",
                      color: active ? "#1d4ed8" : "#334155",
                    }}
                  >
                    <Stack direction="row" spacing={0.75} alignItems="center">
                      <Typography sx={{ fontWeight: 900, color: "inherit" }}>{chain.name}</Typography>
                      <Chip
                        size="small"
                        label={schedule.enabled ? `${schedule.hours.length}h` : "Off"}
                        sx={{ height: 22, fontWeight: 900, bgcolor: "rgba(255,255,255,0.76)", color: "inherit" }}
                      />
                    </Stack>
                  </ButtonBase>
                );
              })}
            </Stack>
          ) : (
            <Alert severity="info" variant="outlined" sx={{ borderRadius: 2 }}>No chains found</Alert>
          )}

          {selectedChain ? (
            <>
              <Divider />
              <Stack spacing={1.15}>
                <Stack direction="row" spacing={1} alignItems="center" justifyContent="space-between">
                  <Stack direction="row" spacing={1} alignItems="center">
                    <Switch
                      checked={chainDraft.enabled}
                      disabled={props.readOnly}
                      onChange={(_event, checked) => {
                        setChainDraft((current) => ({
                          enabled: checked,
                          hours: checked ? current.hours : [],
                        }));
                      }}
                      inputProps={{ "aria-label": `Enable high demand schedule for ${selectedChain.name}` }}
                    />
                    <Typography sx={{ fontWeight: 900, color: "#0f172a" }}>
                      Active
                    </Typography>
                  </Stack>
                  <Button
                    variant="contained"
                    startIcon={<SaveRoundedIcon />}
                    disabled={props.readOnly || savingChain}
                    onClick={() => void saveChainSchedule()}
                    sx={{ borderRadius: 2, textTransform: "none", fontWeight: 900, boxShadow: "none" }}
                  >
                    Save Chain
                  </Button>
                </Stack>

                {chainDraft.enabled ? (
                  <HourGrid
                    ariaLabel={`High demand hours for ${selectedChain.name}`}
                    disabled={props.readOnly}
                    hours={chainDraft.hours}
                    onToggle={(hour) => setChainDraft((current) => ({ ...current, hours: toggleHour(current.hours, hour) }))}
                  />
                ) : null}
              </Stack>
            </>
          ) : null}
        </Stack>
      </Box>

      <Box sx={panelSx()}>
        <Stack spacing={1.25}>
          <Stack direction={{ xs: "column", md: "row" }} spacing={1} justifyContent="space-between" alignItems={{ xs: "flex-start", md: "center" }}>
            <Stack direction="row" spacing={1} alignItems="center">
              <AccessTimeRoundedIcon sx={{ color: "#334155" }} />
              <Typography sx={{ fontWeight: 900, color: "#0f172a" }}>
                Branch Override
              </Typography>
            </Stack>
            {selectedBranch ? (
              <Chip
                size="small"
                label={branchMode === "inherited" ? `Inherited: ${formatHighDemandHours(inheritedBranchSchedule)}` : formatHighDemandHours(branchDraft)}
                sx={{ fontWeight: 900, bgcolor: "rgba(15,23,42,0.06)", color: "#334155" }}
              />
            ) : null}
          </Stack>

          <Stack direction={{ xs: "column", lg: "row" }} spacing={1.25} alignItems="stretch">
            <Box sx={{ flex: { xs: "1 1 auto", lg: "0 0 330px" }, minWidth: 0 }}>
              <Stack spacing={1}>
                <TextField
                  size="small"
                  value={branchQuery}
                  onChange={(event) => setBranchQuery(event.target.value)}
                  placeholder="Search branches"
                  InputProps={{
                    startAdornment: (
                      <InputAdornment position="start">
                        <SearchRoundedIcon fontSize="small" />
                      </InputAdornment>
                    ),
                  }}
                />
                <Stack spacing={0.65} sx={{ maxHeight: 390, overflowY: "auto", pr: 0.25 }}>
                  {filteredBranches.map((branch) => {
                    const active = selectedBranch?.id === branch.id;
                    const mode = branchOverrideMode(branch);
                    return (
                      <ButtonBase
                        key={branch.id}
                        onClick={() => setSelectedBranchId(branch.id)}
                        aria-pressed={active}
                        sx={{
                          minHeight: 54,
                          borderRadius: 2,
                          border: "1px solid",
                          borderColor: active ? "rgba(29,78,216,0.36)" : "rgba(148,163,184,0.15)",
                          bgcolor: active ? "rgba(219,234,254,0.88)" : "rgba(248,250,252,0.78)",
                          px: 1,
                          py: 0.75,
                          textAlign: "left",
                        }}
                      >
                        <Stack spacing={0.2} sx={{ width: "100%", minWidth: 0 }}>
                          <Typography sx={{ fontWeight: 900, color: active ? "#1d4ed8" : "#0f172a", lineHeight: 1.15 }} noWrap>
                            {safeBranchName(branch)}
                          </Typography>
                          <Typography variant="caption" sx={{ color: "#64748b" }} noWrap>
                            {branch.chainName || "No Chain"} • {mode === "inherited" ? "Inherited" : mode === "disabled" ? "Disabled" : "Custom"}
                          </Typography>
                        </Stack>
                      </ButtonBase>
                    );
                  })}
                  {!filteredBranches.length ? <Alert severity="info" variant="outlined" sx={{ borderRadius: 2 }}>No branches found</Alert> : null}
                </Stack>
              </Stack>
            </Box>

            <Box sx={{ flex: "1 1 auto", minWidth: 0 }}>
              {selectedBranch ? (
                <Stack spacing={1.15}>
                  <Stack direction={{ xs: "column", md: "row" }} spacing={1} justifyContent="space-between" alignItems={{ xs: "stretch", md: "center" }}>
                    <ToggleButtonGroup
                      exclusive
                      value={branchMode}
                      onChange={(_event, value: BranchOverrideMode | null) => {
                        if (!value) return;
                        setBranchMode(value);
                        if (value === "custom") {
                          setBranchDraft((current) => (
                            current.enabled
                              ? current
                              : normalizeHighDemandSchedule(selectedBranch.highDemandScheduleOverride) ?? DEFAULT_HIGH_DEMAND_SCHEDULE
                          ));
                        } else {
                          setBranchDraft(DEFAULT_HIGH_DEMAND_SCHEDULE);
                        }
                      }}
                      aria-label="Branch high demand override mode"
                      disabled={props.readOnly}
                      sx={{
                        flexWrap: "wrap",
                        gap: 0.6,
                        "& .MuiToggleButtonGroup-grouped": {
                          borderRadius: "16px !important",
                          border: "1px solid rgba(148,163,184,0.2) !important",
                          minHeight: 44,
                          px: 1.2,
                          textTransform: "none",
                          fontWeight: 900,
                        },
                        "& .Mui-selected": {
                          bgcolor: "rgba(219,234,254,0.94) !important",
                          color: "#1d4ed8 !important",
                        },
                      }}
                    >
                      <ToggleButton value="inherited">Inherited</ToggleButton>
                      <ToggleButton value="custom">Custom</ToggleButton>
                      <ToggleButton value="disabled">Disabled</ToggleButton>
                    </ToggleButtonGroup>

                    <Stack direction="row" spacing={0.75} justifyContent={{ xs: "space-between", md: "flex-end" }}>
                      <Button
                        variant="outlined"
                        startIcon={<RestartAltRoundedIcon />}
                        disabled={props.readOnly || savingBranch}
                        onClick={() => {
                          setBranchMode("inherited");
                          setBranchDraft(DEFAULT_HIGH_DEMAND_SCHEDULE);
                        }}
                        sx={{ borderRadius: 2, textTransform: "none", fontWeight: 900 }}
                      >
                        Reset
                      </Button>
                      <Button
                        variant="contained"
                        startIcon={<SaveRoundedIcon />}
                        disabled={props.readOnly || savingBranch}
                        onClick={() => void saveBranchSchedule()}
                        sx={{ borderRadius: 2, textTransform: "none", fontWeight: 900, boxShadow: "none" }}
                      >
                        Save Branch
                      </Button>
                    </Stack>
                  </Stack>

                  {branchMode === "custom" ? (
                    <HourGrid
                      ariaLabel={`Custom high demand hours for ${safeBranchName(selectedBranch)}`}
                      disabled={props.readOnly}
                      hours={branchDraft.hours}
                      onToggle={(hour) => setBranchDraft((current) => ({
                        enabled: true,
                        hours: toggleHour(current.hours, hour),
                      }))}
                    />
                  ) : (
                    <Alert severity={branchMode === "disabled" ? "warning" : "info"} variant="outlined" sx={{ borderRadius: 2 }}>
                      {branchMode === "disabled"
                        ? "This branch will not run scheduled high demand."
                        : `This branch follows ${selectedBranch.chainName || "the chain"}: ${formatHighDemandHours(inheritedBranchSchedule)}.`}
                    </Alert>
                  )}
                </Stack>
              ) : (
                <Alert severity="info" variant="outlined" sx={{ borderRadius: 2 }}>No branches found</Alert>
              )}
            </Box>
          </Stack>
        </Stack>
      </Box>
    </Stack>
  );
}
