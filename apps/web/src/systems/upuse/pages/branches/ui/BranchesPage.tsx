import AddRoundedIcon from "@mui/icons-material/AddRounded";
import DeleteSweepRoundedIcon from "@mui/icons-material/DeleteSweepRounded";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import ExpandMoreRoundedIcon from "@mui/icons-material/ExpandMoreRounded";
import PauseCircleOutlineRoundedIcon from "@mui/icons-material/PauseCircleOutlineRounded";
import PlayCircleOutlineRoundedIcon from "@mui/icons-material/PlayCircleOutlineRounded";
import SearchRoundedIcon from "@mui/icons-material/SearchRounded";
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Checkbox,
  Chip,
  Collapse,
  IconButton,
  InputAdornment,
  MenuItem,
  Snackbar,
  Stack,
  Switch,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import { useDeferredValue, useEffect, useMemo, useState, type KeyboardEvent } from "react";
import { describeApiError } from "../../../api/client";
import type { BranchMappingItem } from "../../../api/types";
import { useAuth } from "../../../app/providers/AuthProvider";
import { useMonitorStatus } from "../../../app/providers/MonitorStatusProvider";
import {
  UPUSE_BRANCHES_DELETE_CAPABILITY,
  UPUSE_BRANCHES_MANAGE_CAPABILITY,
  UPUSE_MONITOR_MANAGE_CAPABILITY,
} from "../../../routes/capabilities";
import {
  buildSavedChainGroups,
  formatBranchCount,
  matchesBranchQuery,
  safeBranchName,
  scoreSourceItem,
  type SavedChainGroup,
} from "../../../features/branch-mapping/lib/branchMapping";
import { useBranchMappingState } from "../../../features/branch-mapping/model/useBranchMappingState";
import { TopBar } from "../../../widgets/top-bar/ui/TopBar";

export function BranchesPage() {
  const { hasSystemCapability } = useAuth();
  const canManageBranches = hasSystemCapability("upuse", UPUSE_BRANCHES_MANAGE_CAPABILITY);
  const canDeleteBranches = hasSystemCapability("upuse", UPUSE_BRANCHES_DELETE_CAPABILITY);
  const canManageMonitor = hasSystemCapability("upuse", UPUSE_MONITOR_MANAGE_CAPABILITY);
  const { monitoring, startMonitoring, stopMonitoring } = useMonitorStatus();
  const {
    settings,
    branches,
    sourceItems,
    loadError,
    setBranchMonitoringState,
    deleteBranch,
    setChainMonitoringState,
    deleteChainBranches,
    addBranches,
  } = useBranchMappingState();

  const [toast, setToast] = useState<{ type: "success" | "error" | "info"; msg: string } | null>(null);
  const [branchQuery, setBranchQuery] = useState("");
  const [sourceQuery, setSourceQuery] = useState("");
  const [expandedChainGroups, setExpandedChainGroups] = useState<Record<string, boolean>>({});
  const [selectedAvailabilityVendorIds, setSelectedAvailabilityVendorIds] = useState<string[]>([]);
  const [selectedChainName, setSelectedChainName] = useState("");
  const [addingBranch, setAddingBranch] = useState(false);
  const [processingChainKey, setProcessingChainKey] = useState<string | null>(null);
  const [savingMonitorBranchId, setSavingMonitorBranchId] = useState<number | null>(null);
  const deferredSourceQuery = useDeferredValue(sourceQuery);

  useEffect(() => {
    setSelectedAvailabilityVendorIds((current) => current.filter((availabilityVendorId) => {
      const item = sourceItems.find((sourceItem) => sourceItem.availabilityVendorId === availabilityVendorId);
      return !!item && !item.alreadyAdded;
    }));
  }, [sourceItems]);

  const filteredBranches = useMemo(() => branches.filter((branch) => matchesBranchQuery(branch, branchQuery)), [branchQuery, branches]);
  const savedChainGroups = useMemo(() => buildSavedChainGroups(filteredBranches), [filteredBranches]);
  const selectedAvailabilityVendorIdSet = useMemo(() => new Set(selectedAvailabilityVendorIds), [selectedAvailabilityVendorIds]);
  const sourceSearchResults = useMemo(() => {
    const query = deferredSourceQuery.trim();
    if (!query) return [];

    return [...sourceItems]
      .filter((item) => scoreSourceItem(item, query) < 100)
      .sort((left, right) => {
        const leftScore = scoreSourceItem(left, query);
        const rightScore = scoreSourceItem(right, query);
        if (leftScore !== rightScore) return leftScore - rightScore;
        if (left.alreadyAdded !== right.alreadyAdded) return left.alreadyAdded ? 1 : -1;
        return left.name.localeCompare(right.name);
      })
      .slice(0, 60);
  }, [deferredSourceQuery, sourceItems]);
  const visibleAddableSourceItems = useMemo(() => sourceSearchResults.filter((item) => !item.alreadyAdded), [sourceSearchResults]);
  const selectedSourceItems = useMemo(() => sourceItems.filter((item) => selectedAvailabilityVendorIdSet.has(item.availabilityVendorId) && !item.alreadyAdded), [selectedAvailabilityVendorIdSet, sourceItems]);
  const allVisibleAddableSelected = visibleAddableSourceItems.length > 0 && visibleAddableSourceItems.every((item) => selectedAvailabilityVendorIdSet.has(item.availabilityVendorId));
  const chainOptions = useMemo(() => {
    const names = settings?.chains.map((item) => item.name) ?? [];
    if (selectedChainName && !names.includes(selectedChainName)) {
      return [...names, selectedChainName].sort((left, right) => left.localeCompare(right));
    }
    return names;
  }, [selectedChainName, settings?.chains]);

  const onStart = async () => {
    if (!canManageMonitor) {
      setToast({ type: "info", msg: "No access" });
      return;
    }

    try {
      await startMonitoring();
      setToast({ type: "success", msg: "Monitoring started" });
    } catch (error) {
      setToast({ type: "error", msg: describeApiError(error, "Failed to start") });
    }
  };

  const onStop = async () => {
    if (!canManageMonitor) {
      setToast({ type: "info", msg: "No access" });
      return;
    }

    try {
      await stopMonitoring();
      setToast({ type: "success", msg: "Monitoring stopped" });
    } catch (error) {
      setToast({ type: "error", msg: describeApiError(error, "Failed to stop") });
    }
  };

  const toggleChainGroup = (groupKey: string) => {
    setExpandedChainGroups((current) => ({
      ...current,
      [groupKey]: !current[groupKey],
    }));
  };

  const toggleSourceSelection = (availabilityVendorId: string) => {
    setSelectedAvailabilityVendorIds((current) => (
      current.includes(availabilityVendorId)
        ? current.filter((item) => item !== availabilityVendorId)
        : [...current, availabilityVendorId]
    ));
  };

  const toggleVisibleSourceSelection = () => {
    const visibleIds = visibleAddableSourceItems.map((item) => item.availabilityVendorId);
    if (!visibleIds.length) return;

    setSelectedAvailabilityVendorIds((current) => {
      const next = new Set(current);
      if (allVisibleAddableSelected) {
        visibleIds.forEach((availabilityVendorId) => next.delete(availabilityVendorId));
      } else {
        visibleIds.forEach((availabilityVendorId) => next.add(availabilityVendorId));
      }
      return Array.from(next);
    });
  };

  const clearSelectedSourceItems = () => {
    setSelectedAvailabilityVendorIds([]);
  };

  const handleBranchMonitoringToggle = async (branch: BranchMappingItem, enabled: boolean) => {
    if (!canManageBranches) {
      setToast({ type: "info", msg: "No access" });
      return;
    }

    try {
      setSavingMonitorBranchId(branch.id);
      await setBranchMonitoringState(branch.id, enabled);
      setToast({ type: "success", msg: enabled ? "Branch enabled in monitor" : "Branch paused from monitor" });
    } catch (error) {
      setToast({ type: "error", msg: describeApiError(error, "Monitor state update failed") });
    } finally {
      setSavingMonitorBranchId(null);
    }
  };

  const handleDeleteBranch = async (branchId: number) => {
    if (!canDeleteBranches) {
      setToast({ type: "info", msg: "No access" });
      return;
    }

    try {
      await deleteBranch(branchId);
      setToast({ type: "success", msg: "Branch deleted" });
    } catch (error) {
      setToast({ type: "error", msg: describeApiError(error, "Delete failed") });
    }
  };

  const handleSetChainMonitoringState = async (group: ReturnType<typeof buildSavedChainGroups>[number], enabled: boolean) => {
    if (!canManageBranches) {
      setToast({ type: "info", msg: "No access" });
      return;
    }

    const targets = group.branches.filter((branch) => branch.catalogState === "available" && branch.enabled !== enabled);
    if (!targets.length) {
      setToast({
        type: "info",
        msg: enabled ? "This chain is already active in monitor" : "This chain is already paused",
      });
      return;
    }

    try {
      setProcessingChainKey(group.key);
      const result = await setChainMonitoringState(group, enabled);
      if (!result.failedCount) {
        setToast({ type: "success", msg: enabled ? `${group.label} resumed` : `${group.label} paused` });
        return;
      }

      setToast({
        type: "error",
        msg: result.succeededCount
          ? `${formatBranchCount(result.succeededCount)} updated, ${formatBranchCount(result.failedCount)} failed`
          : `Could not update ${group.label}`,
      });
    } catch (error) {
      setToast({ type: "error", msg: describeApiError(error, "Chain monitor update failed") });
    } finally {
      setProcessingChainKey(null);
    }
  };

  const handleDeleteChainBranches = async (group: ReturnType<typeof buildSavedChainGroups>[number]) => {
    if (!canDeleteBranches) {
      setToast({ type: "info", msg: "No access" });
      return;
    }

    try {
      setProcessingChainKey(group.key);
      const result = await deleteChainBranches(group);
      if (!result.failedCount) {
        setToast({ type: "success", msg: `${group.label} removed` });
        return;
      }

      setToast({
        type: "error",
        msg: result.succeededCount
          ? `${formatBranchCount(result.succeededCount)} deleted, ${formatBranchCount(result.failedCount)} failed`
          : `Could not delete ${group.label}`,
      });
    } catch (error) {
      setToast({ type: "error", msg: describeApiError(error, "Chain delete failed") });
    } finally {
      setProcessingChainKey(null);
    }
  };

  const handleAddSelectedBranches = async () => {
    if (!canManageBranches) {
      setToast({ type: "info", msg: "No access" });
      return;
    }
    if (!selectedSourceItems.length) {
      setToast({ type: "error", msg: "Select at least one branch first" });
      return;
    }

    try {
      setAddingBranch(true);
      const result = await addBranches(selectedSourceItems, selectedChainName.trim());
      setSelectedAvailabilityVendorIds(result.failedAvailabilityVendorIds);

      if (!result.failedAvailabilityVendorIds.length) {
        setSelectedChainName("");
        setSourceQuery("");
        setToast({ type: "success", msg: `${formatBranchCount(result.addedCount)} added` });
        return;
      }

      if (result.addedCount > 0) {
        setToast({
          type: "error",
          msg: `${formatBranchCount(result.addedCount)} added, ${formatBranchCount(result.failedAvailabilityVendorIds.length)} failed`,
        });
        return;
      }

      setToast({ type: "error", msg: "Selected branches could not be added" });
    } catch (error) {
      setToast({ type: "error", msg: describeApiError(error, "Branch add failed") });
    } finally {
      setAddingBranch(false);
    }
  };

  const renderBranchCard = (branch: BranchMappingItem) => {
    const missing = branch.catalogState === "missing";

    return (
      <Box
        key={branch.id}
        sx={{
          p: 1.2,
          borderRadius: 3,
          border: "1px solid rgba(148,163,184,0.12)",
          bgcolor: missing ? "rgba(255,251,235,0.82)" : "rgba(248,250,252,0.72)",
        }}
      >
        <Stack spacing={1}>
          <Stack direction={{ xs: "column", sm: "row" }} justifyContent="space-between" spacing={1}>
            <Box>
              <Typography sx={{ fontWeight: 900, color: "#0f172a" }}>{safeBranchName(branch)}</Typography>
              <Typography variant="caption" sx={{ color: "text.secondary" }}>
                {branch.ordersVendorId ? `Orders ${branch.ordersVendorId} • ` : "Orders unavailable • "}Availability {branch.availabilityVendorId}
              </Typography>
            </Box>
            <Button
              size="small"
              color="inherit"
              startIcon={<DeleteOutlineIcon />}
              onClick={() => void handleDeleteBranch(branch.id)}
              disabled={!canDeleteBranches}
            >
              Delete
            </Button>
          </Stack>
          <Stack direction="row" spacing={0.75} useFlexGap flexWrap="wrap">
            <Chip
              size="small"
              label={missing ? "Missing" : branch.enabled ? "In Monitor" : "Paused"}
              color={missing ? "warning" : branch.enabled ? "success" : "default"}
            />
          </Stack>
          <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 1 }}>
            <Typography variant="caption" sx={{ color: missing ? "#b45309" : "#475569", fontWeight: 700 }}>
              {missing ? "Disabled until it returns to the local catalog." : branch.enabled ? "Included in live monitor cycles" : "Skipped from live monitor cycles"}
            </Typography>
            <Switch
              checked={branch.enabled}
              onChange={(_event, checked) => void handleBranchMonitoringToggle(branch, checked)}
              disabled={!canManageBranches || missing || savingMonitorBranchId === branch.id}
              inputProps={{ "aria-label": `Toggle monitor for ${safeBranchName(branch)}` }}
            />
          </Box>
        </Stack>
      </Box>
    );
  };

  const renderChainGroup = (group: SavedChainGroup) => {
    const expanded = expandedChainGroups[group.key] ?? false;
    const canToggleChain = group.availableCount > 0;
    const shouldResumeChain = group.enabledCount === 0 && group.availableCount > 0;
    const chainActionLabel = shouldResumeChain ? "Resume Chain" : "Pause Chain";
    const processing = processingChainKey === group.key;
    const chainActionTone = shouldResumeChain
      ? {
          color: "#166534",
          bgcolor: "rgba(220,252,231,0.82)",
          borderColor: "rgba(34,197,94,0.18)",
          shadowColor: "rgba(34,197,94,0.12)",
        }
      : {
          color: "#9a3412",
          bgcolor: "rgba(255,247,237,0.92)",
          borderColor: "rgba(249,115,22,0.18)",
          shadowColor: "rgba(249,115,22,0.12)",
        };

    return (
      <Box key={group.key}>
        <Box
          role="button"
          tabIndex={0}
          aria-label={`Toggle ${group.label} group`}
          aria-expanded={expanded}
          onClick={() => toggleChainGroup(group.key)}
          onKeyDown={(event: KeyboardEvent<HTMLDivElement>) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              toggleChainGroup(group.key);
            }
          }}
          sx={{
            px: 1.2,
            py: 1.05,
            borderRadius: 3,
            border: "1px solid rgba(148,163,184,0.14)",
            bgcolor: "rgba(255,255,255,0.94)",
            cursor: "pointer",
            transition: "border-color 160ms ease, box-shadow 160ms ease, background-color 160ms ease",
            "&:hover": {
              borderColor: "rgba(100,116,139,0.24)",
              boxShadow: "0 12px 28px rgba(15,23,42,0.06)",
              bgcolor: "rgba(255,255,255,0.98)",
            },
            "&:focus-visible": {
              outline: "2px solid rgba(37,99,235,0.22)",
              outlineOffset: 2,
            },
          }}
        >
          <Stack direction={{ xs: "column", md: "row" }} spacing={1.1} alignItems={{ xs: "flex-start", md: "center" }} justifyContent="space-between">
            <Stack direction="row" spacing={1} alignItems="center" sx={{ minWidth: 0, flex: 1 }}>
              <Box
                sx={{
                  width: 30,
                  height: 30,
                  borderRadius: "10px",
                  display: "grid",
                  placeItems: "center",
                  bgcolor: "rgba(241,245,249,0.95)",
                  color: "#334155",
                  flexShrink: 0,
                }}
              >
                <ExpandMoreRoundedIcon
                  sx={{
                    fontSize: 22,
                    transform: expanded ? "rotate(180deg)" : "rotate(90deg)",
                    transition: "transform 180ms ease",
                  }}
                />
              </Box>
              <Box sx={{ minWidth: 0 }}>
                <Typography sx={{ fontWeight: 900, color: "#0f172a" }}>{group.label}</Typography>
                <Typography variant="caption" sx={{ color: "text.secondary", display: { xs: "none", sm: "block" } }}>
                  {formatBranchCount(group.branches.length)} • {expanded ? "Click to collapse" : "Click to expand"}
                </Typography>
              </Box>
            </Stack>

            <Stack direction={{ xs: "column", sm: "row" }} spacing={0.8} alignItems={{ xs: "stretch", sm: "center" }} sx={{ width: { xs: "100%", md: "auto" } }}>
              <Stack direction="row" spacing={0.7} flexWrap="wrap">
                <Chip size="small" label={`Total ${group.branches.length}`} sx={{ fontWeight: 900, bgcolor: "rgba(15,23,42,0.06)", color: "#0f172a" }} />
                {group.enabledCount ? <Chip size="small" label={`Live ${group.enabledCount}`} sx={{ fontWeight: 900, bgcolor: "rgba(236,253,245,0.92)", color: "#166534" }} /> : null}
                {group.pausedCount ? <Chip size="small" label={`Paused ${group.pausedCount}`} sx={{ fontWeight: 900, bgcolor: "rgba(241,245,249,0.95)", color: "#334155" }} /> : null}
                {group.missingCount ? <Chip size="small" label={`Missing ${group.missingCount}`} sx={{ fontWeight: 900, bgcolor: "rgba(255,247,237,0.95)", color: "#b45309" }} /> : null}
              </Stack>
              <Stack direction="row" spacing={0.65} sx={{ flexWrap: "wrap" }}>
                <Tooltip title={processing ? `${chainActionLabel}...` : chainActionLabel}>
                  <span>
                    <IconButton
                      size="small"
                      aria-label={chainActionLabel}
                      disabled={!canManageBranches || !canToggleChain || processing}
                      onClick={(event) => {
                        event.stopPropagation();
                        void handleSetChainMonitoringState(group, shouldResumeChain);
                      }}
                      sx={{
                        width: 36,
                        height: 36,
                        borderRadius: "12px",
                        color: chainActionTone.color,
                        bgcolor: chainActionTone.bgcolor,
                        border: `1px solid ${chainActionTone.borderColor}`,
                        boxShadow: `0 8px 18px ${chainActionTone.shadowColor}`,
                        transition: "transform 160ms ease, background-color 160ms ease, box-shadow 160ms ease, color 160ms ease",
                        "@keyframes chainActionPulse": {
                          "0%": { transform: "scale(1)" },
                          "50%": { transform: "scale(0.95)" },
                          "100%": { transform: "scale(1)" },
                        },
                        ...(processing ? { animation: "chainActionPulse 900ms ease-in-out infinite" } : null),
                        "&:hover": {
                          bgcolor: shouldResumeChain ? "rgba(220,252,231,0.98)" : "rgba(255,237,213,0.98)",
                          transform: "translateY(-1px)",
                          boxShadow: `0 12px 22px ${chainActionTone.shadowColor}`,
                        },
                        "&.Mui-disabled": {
                          bgcolor: "rgba(241,245,249,0.92)",
                          color: "rgba(100,116,139,0.58)",
                          borderColor: "rgba(148,163,184,0.16)",
                          boxShadow: "none",
                        },
                      }}
                    >
                      {shouldResumeChain ? <PlayCircleOutlineRoundedIcon sx={{ fontSize: 21 }} /> : <PauseCircleOutlineRoundedIcon sx={{ fontSize: 21 }} />}
                    </IconButton>
                  </span>
                </Tooltip>
                <Tooltip title={processing ? "Delete disabled while another chain action is running" : "Delete Chain"}>
                  <span>
                    <IconButton
                      size="small"
                      aria-label="Delete Chain"
                      disabled={!canDeleteBranches || processing}
                      onClick={(event) => {
                        event.stopPropagation();
                        void handleDeleteChainBranches(group);
                      }}
                      sx={{
                        width: 36,
                        height: 36,
                        borderRadius: "12px",
                        color: "#b91c1c",
                        bgcolor: "rgba(254,242,242,0.96)",
                        border: "1px solid rgba(248,113,113,0.2)",
                        boxShadow: "0 8px 18px rgba(239,68,68,0.1)",
                        transition: "transform 160ms ease, background-color 160ms ease, box-shadow 160ms ease, color 160ms ease",
                        "&:hover": {
                          bgcolor: "rgba(254,226,226,0.98)",
                          transform: "translateY(-1px)",
                          boxShadow: "0 12px 22px rgba(239,68,68,0.14)",
                        },
                        "&.Mui-disabled": {
                          bgcolor: "rgba(241,245,249,0.92)",
                          color: "rgba(100,116,139,0.58)",
                          borderColor: "rgba(148,163,184,0.16)",
                          boxShadow: "none",
                        },
                      }}
                    >
                      <DeleteSweepRoundedIcon sx={{ fontSize: 21 }} />
                    </IconButton>
                  </span>
                </Tooltip>
              </Stack>
            </Stack>
          </Stack>
        </Box>

        <Collapse in={expanded} timeout={220} unmountOnExit>
          <Stack spacing={1} sx={{ pt: 1 }}>
            {group.branches.map(renderBranchCard)}
          </Stack>
        </Collapse>
      </Box>
    );
  };

  return (
    <Box sx={{ minHeight: "100vh", bgcolor: "background.default" }}>
      <TopBar running={monitoring.running} degraded={monitoring.degraded} onStart={onStart} onStop={onStop} canControlMonitor={canManageMonitor} />
      <Box sx={{ p: { xs: 2, md: 3 }, display: "grid", gap: 2 }}>
        {loadError ? <Alert severity="error" variant="outlined">{loadError}</Alert> : null}
        <Card>
          <CardContent sx={{ display: "grid", gap: 2, gridTemplateColumns: { xs: "1fr", xl: "1.2fr 0.95fr" } }}>
            <Stack spacing={1.25}>
              <Stack direction={{ xs: "column", sm: "row" }} spacing={1} justifyContent="space-between" alignItems={{ xs: "flex-start", sm: "center" }}>
                <Typography sx={{ fontWeight: 900 }}>Saved Branches</Typography>
                <Stack direction="row" spacing={0.8} flexWrap="wrap">
                  <Chip size="small" label={`${formatBranchCount(filteredBranches.length)} in view`} sx={{ fontWeight: 900, bgcolor: "rgba(15,23,42,0.06)", color: "#0f172a" }} />
                  <Chip size="small" label={`${savedChainGroups.length} chain${savedChainGroups.length === 1 ? "" : "s"}`} sx={{ fontWeight: 900, bgcolor: "rgba(37,99,235,0.10)", color: "#1d4ed8" }} />
                </Stack>
              </Stack>
              <TextField placeholder="Search saved branches or vendor IDs" value={branchQuery} onChange={(event) => setBranchQuery(event.target.value)} size="small" InputProps={{ startAdornment: <InputAdornment position="start"><SearchRoundedIcon fontSize="small" /></InputAdornment> }} />
              {savedChainGroups.length ? <Stack spacing={1}>{savedChainGroups.map(renderChainGroup)}</Stack> : <Alert severity="info" variant="outlined">No saved branches in this view.</Alert>}
            </Stack>

            <Stack spacing={1.25}>
              <Stack direction={{ xs: "column", sm: "row" }} spacing={1} justifyContent="space-between" alignItems={{ xs: "flex-start", sm: "center" }}>
                <Typography sx={{ fontWeight: 900 }}>Add From Local Source</Typography>
                <Stack direction="row" spacing={0.8} flexWrap="wrap">
                  <Chip size="small" label={`Selected ${selectedSourceItems.length}`} sx={{ fontWeight: 900, bgcolor: "rgba(37,99,235,0.10)", color: "#1d4ed8" }} />
                  <Button size="small" color="inherit" onClick={toggleVisibleSourceSelection} disabled={!visibleAddableSourceItems.length} sx={{ borderRadius: 999, fontWeight: 800 }}>
                    {allVisibleAddableSelected ? "Clear Visible" : "Select Visible"}
                  </Button>
                  <Button size="small" color="inherit" onClick={clearSelectedSourceItems} disabled={!selectedSourceItems.length} sx={{ borderRadius: 999, fontWeight: 800 }}>
                    Clear Selection
                  </Button>
                </Stack>
              </Stack>
              <TextField placeholder="Search by branch name or availability ID" value={sourceQuery} onChange={(event) => setSourceQuery(event.target.value)} size="small" InputProps={{ startAdornment: <InputAdornment position="start"><SearchRoundedIcon fontSize="small" /></InputAdornment> }} />
              {selectedSourceItems.length ? (
                <Box sx={{ p: 1.25, borderRadius: 3, border: "1px solid rgba(37,99,235,0.14)", bgcolor: "rgba(239,246,255,0.9)" }}>
                  <Stack spacing={1.1}>
                    <Box>
                      <Typography sx={{ fontWeight: 900, color: "#0f172a" }}>Ready to add {formatBranchCount(selectedSourceItems.length)}</Typography>
                      <Typography variant="caption" sx={{ color: "text.secondary" }}>Apply one chain to all selected branches, then add them in one step.</Typography>
                    </Box>
                    <Stack direction="row" spacing={0.75} useFlexGap flexWrap="wrap">
                      {selectedSourceItems.slice(0, 8).map((item) => <Chip key={item.availabilityVendorId} label={item.name} onDelete={() => toggleSourceSelection(item.availabilityVendorId)} sx={{ maxWidth: "100%", "& .MuiChip-label": { display: "block", overflow: "hidden", textOverflow: "ellipsis" } }} />)}
                      {selectedSourceItems.length > 8 ? <Chip label={`+${selectedSourceItems.length - 8} more`} sx={{ fontWeight: 900, bgcolor: "rgba(15,23,42,0.06)", color: "#334155" }} /> : null}
                    </Stack>
                    <TextField select label="Chain for selected branches" value={selectedChainName} onChange={(event) => setSelectedChainName(event.target.value)} disabled={!canManageBranches || addingBranch} fullWidth>
                      <MenuItem value="">No Chain</MenuItem>
                      {chainOptions.map((chainName) => <MenuItem key={chainName} value={chainName}>{chainName}</MenuItem>)}
                    </TextField>
                    <Button variant="contained" startIcon={<AddRoundedIcon />} onClick={() => void handleAddSelectedBranches()} disabled={!canManageBranches || addingBranch || !selectedSourceItems.length}>
                      {addingBranch ? `Adding ${selectedSourceItems.length}...` : `Add ${formatBranchCount(selectedSourceItems.length)}`}
                    </Button>
                  </Stack>
                </Box>
              ) : null}
              {!deferredSourceQuery.trim() ? (
                <Alert severity="info" variant="outlined">Start typing to search source branches.</Alert>
              ) : sourceSearchResults.length ? (
                <Stack spacing={0.75} sx={{ maxHeight: 320, overflowY: "auto" }}>
                  {sourceSearchResults.map((item) => (
                    <Box
                      key={item.availabilityVendorId}
                      role="button"
                      tabIndex={0}
                      aria-label={item.alreadyAdded ? `${item.name} already added` : `Select ${item.name}`}
                      onClick={() => {
                        if (item.alreadyAdded) return;
                        toggleSourceSelection(item.availabilityVendorId);
                      }}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          if (item.alreadyAdded) return;
                          toggleSourceSelection(item.availabilityVendorId);
                        }
                      }}
                      sx={{
                        p: 1.1,
                        borderRadius: 2.5,
                        border: selectedAvailabilityVendorIdSet.has(item.availabilityVendorId) ? "1px solid rgba(37,99,235,0.26)" : "1px solid rgba(148,163,184,0.12)",
                        bgcolor: selectedAvailabilityVendorIdSet.has(item.availabilityVendorId) ? "rgba(37,99,235,0.06)" : item.alreadyAdded ? "rgba(241,245,249,0.82)" : "rgba(248,250,252,0.72)",
                        cursor: item.alreadyAdded ? "default" : "pointer",
                        opacity: item.alreadyAdded ? 0.78 : 1,
                      }}
                    >
                      <Stack direction="row" spacing={1} alignItems="flex-start">
                        <Checkbox checked={selectedAvailabilityVendorIdSet.has(item.availabilityVendorId)} disabled={item.alreadyAdded} onClick={(event) => event.stopPropagation()} onChange={() => toggleSourceSelection(item.availabilityVendorId)} inputProps={{ "aria-label": `Select ${item.name}` }} sx={{ mt: -0.35, ml: -0.35 }} />
                        <Box sx={{ minWidth: 0, flex: 1 }}>
                          <Stack direction={{ xs: "column", sm: "row" }} spacing={0.8} justifyContent="space-between" alignItems={{ xs: "flex-start", sm: "center" }}>
                            <Typography sx={{ fontWeight: 900 }}>{item.name}</Typography>
                            <Chip size="small" label={item.alreadyAdded ? "Saved" : selectedAvailabilityVendorIdSet.has(item.availabilityVendorId) ? "Selected" : "Ready"} color={item.alreadyAdded ? "default" : selectedAvailabilityVendorIdSet.has(item.availabilityVendorId) ? "primary" : "success"} />
                          </Stack>
                          <Typography variant="caption" sx={{ color: "text.secondary" }}>Availability {item.availabilityVendorId} • Orders {item.ordersVendorId}</Typography>
                        </Box>
                      </Stack>
                    </Box>
                  ))}
                </Stack>
              ) : (
                <Alert severity="info" variant="outlined">No branch match.</Alert>
              )}
            </Stack>
          </CardContent>
        </Card>
      </Box>
      <Snackbar open={!!toast} autoHideDuration={2500} onClose={() => setToast(null)} anchorOrigin={{ vertical: "bottom", horizontal: "center" }}>
        {toast ? <Alert severity={toast.type}>{toast.msg}</Alert> : undefined}
      </Snackbar>
    </Box>
  );
}
