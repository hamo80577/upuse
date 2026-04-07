import AddRoundedIcon from "@mui/icons-material/AddRounded";
import CloseRoundedIcon from "@mui/icons-material/CloseRounded";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import EditOutlinedIcon from "@mui/icons-material/EditOutlined";
import SaveRoundedIcon from "@mui/icons-material/SaveRounded";
import { Alert, Box, Button, Checkbox, Chip, FormControlLabel, IconButton, Stack, TextField, Typography } from "@mui/material";
import type { ChainThreshold } from "../../api/types";

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

function thresholdChipLabel(label: string, closeThreshold: number, reopenThreshold: number | undefined) {
  return `${label} ${closeThreshold} -> ${reopenThreshold ?? 0}`;
}

export function ChainThresholdManager(props: {
  chains: ChainThreshold[];
  editingChainIndex: number | null;
  chainEditor: ChainEditorDraft;
  readOnly?: boolean;
  onChangeEditor: (patch: Partial<ChainEditorDraft>) => void;
  onEditChain: (chain: ChainThreshold, index: number) => void;
  onRemoveChain: (index: number) => void;
  onSaveChain: () => void;
  onCancelEdit: () => void;
}) {
  const { chains, editingChainIndex, chainEditor, readOnly = false } = props;

  return (
    <Box
      sx={{
        p: { xs: 1.5, md: 1.8 },
        borderRadius: 3,
        border: "1px solid rgba(148,163,184,0.12)",
        bgcolor: "rgba(248,250,252,0.75)",
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
            Chains
          </Typography>
          <Typography variant="caption" sx={{ color: "text.secondary", display: { xs: "none", sm: "block" } }}>
            Chain base thresholds.
          </Typography>
        </Box>

        <Chip
          size="small"
          label={`${chains.length} chain${chains.length === 1 ? "" : "s"}`}
          sx={{
            fontWeight: 800,
            bgcolor: "rgba(37,99,235,0.08)",
            color: "#1d4ed8",
          }}
        />
      </Stack>

      <Stack spacing={1.1} sx={{ mt: 1.4 }}>
        {chains.length ? (
          chains.map((chain, index) => (
            <Box
              key={`${chain.name}-${index}`}
              sx={{
                px: 1.35,
                py: 1.1,
                borderRadius: 2.5,
                border: editingChainIndex === index ? "1px solid rgba(37,99,235,0.18)" : "1px solid rgba(148,163,184,0.10)",
                bgcolor: editingChainIndex === index ? "rgba(37,99,235,0.04)" : "rgba(255,255,255,0.92)",
                display: "flex",
                alignItems: { xs: "stretch", sm: "center" },
                gap: 1,
                flexDirection: { xs: "column", sm: "row" },
              }}
            >
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography sx={{ fontWeight: 900, color: "#0f172a" }} noWrap>
                  {chain.name}
                </Typography>
                <Typography variant="caption" sx={{ color: "text.secondary", display: { xs: "none", sm: "block" } }}>
                  {thresholdChipLabel("Late", chain.lateThreshold, chain.lateReopenThreshold)}
                  {" • "}
                  {thresholdChipLabel("Unassigned", chain.unassignedThreshold, chain.unassignedReopenThreshold)}
                  {" • "}
                  {thresholdChipLabel("Ready", chain.readyThreshold ?? 0, chain.readyReopenThreshold)}
                </Typography>
              </Box>

              <Stack direction="row" spacing={0.7} sx={{ flexWrap: "wrap" }}>
                <Chip
                  size="small"
                  label={thresholdChipLabel("Late", chain.lateThreshold, chain.lateReopenThreshold)}
                  sx={{
                    fontWeight: 800,
                    bgcolor: "rgba(251,146,60,0.10)",
                    color: "#c2410c",
                  }}
                />
                <Chip
                  size="small"
                  label={thresholdChipLabel("Unassigned", chain.unassignedThreshold, chain.unassignedReopenThreshold)}
                  sx={{
                    fontWeight: 800,
                    bgcolor: "rgba(239,68,68,0.10)",
                    color: "#b91c1c",
                  }}
                />
                <Chip
                  size="small"
                  label={thresholdChipLabel("Ready", chain.readyThreshold ?? 0, chain.readyReopenThreshold)}
                  sx={{
                    fontWeight: 800,
                    bgcolor: "rgba(59,130,246,0.10)",
                    color: "#1d4ed8",
                  }}
                />
                <Chip
                  size="small"
                  label={chain.capacityRuleEnabled === false ? "Capacity Off" : "Capacity On"}
                  sx={{
                    fontWeight: 800,
                    bgcolor: chain.capacityRuleEnabled === false ? "rgba(148,163,184,0.14)" : "rgba(20,184,166,0.10)",
                    color: chain.capacityRuleEnabled === false ? "#475569" : "#0f766e",
                  }}
                />
                <Chip
                  size="small"
                  label={
                    chain.capacityPerHourEnabled === true && typeof chain.capacityPerHourLimit === "number"
                      ? `Capacity / Hour ${chain.capacityPerHourLimit}/h`
                      : "Capacity / Hour Off"
                  }
                  sx={{
                    fontWeight: 800,
                    bgcolor:
                      chain.capacityPerHourEnabled === true && typeof chain.capacityPerHourLimit === "number"
                        ? "rgba(37,99,235,0.08)"
                        : "rgba(148,163,184,0.14)",
                    color:
                      chain.capacityPerHourEnabled === true && typeof chain.capacityPerHourLimit === "number"
                        ? "#1d4ed8"
                        : "#475569",
                  }}
                />
              </Stack>

              <Stack direction="row" spacing={0.4} justifyContent={{ xs: "flex-end", sm: "flex-start" }}>
                <IconButton
                  onClick={() => props.onEditChain(chain, index)}
                  color={editingChainIndex === index ? "primary" : "default"}
                  disabled={readOnly}
                >
                  <EditOutlinedIcon />
                </IconButton>
                <IconButton onClick={() => props.onRemoveChain(index)} color="default" disabled={readOnly}>
                  <DeleteOutlineIcon />
                </IconButton>
              </Stack>
            </Box>
          ))
        ) : (
          <Alert severity="info" variant="outlined" sx={{ borderRadius: 2.5 }}>
            No chains yet.
          </Alert>
        )}
      </Stack>

      <Box
        sx={{
          mt: 1.4,
          p: 1.35,
          borderRadius: 2.5,
          border: "1px dashed rgba(59,130,246,0.25)",
          bgcolor: "rgba(255,255,255,0.94)",
        }}
      >
        <Typography sx={{ fontWeight: 900, fontSize: 14, color: "#0f172a", mb: 1.1 }}>
          {editingChainIndex !== null ? "Edit chain" : "New chain"}
        </Typography>

        <Stack direction={{ xs: "column", md: "row" }} spacing={1.2}>
          <TextField
            label="Chain Name"
            value={chainEditor.name}
            onChange={(event) => props.onChangeEditor({ name: event.target.value })}
            disabled={readOnly}
            fullWidth
          />
          <TextField
            label="Late Threshold"
            type="number"
            value={chainEditor.lateThreshold}
            onChange={(event) => props.onChangeEditor({ lateThreshold: event.target.value })}
            inputProps={{ min: 0 }}
            disabled={readOnly}
            sx={{ width: { xs: "100%", md: 180 } }}
          />
          <TextField
            label="Late Reopen Threshold"
            type="number"
            value={chainEditor.lateReopenThreshold}
            onChange={(event) => props.onChangeEditor({ lateReopenThreshold: event.target.value })}
            inputProps={{ min: 0 }}
            disabled={readOnly}
            sx={{ width: { xs: "100%", md: 220 } }}
          />
          <TextField
            label="Unassigned Threshold"
            type="number"
            value={chainEditor.unassignedThreshold}
            onChange={(event) => props.onChangeEditor({ unassignedThreshold: event.target.value })}
            inputProps={{ min: 0 }}
            disabled={readOnly}
            sx={{ width: { xs: "100%", md: 180 } }}
          />
        </Stack>

        <Stack direction={{ xs: "column", md: "row" }} spacing={1.2} sx={{ mt: 1.2 }}>
          <TextField
            label="Unassigned Reopen Threshold"
            type="number"
            value={chainEditor.unassignedReopenThreshold}
            onChange={(event) => props.onChangeEditor({ unassignedReopenThreshold: event.target.value })}
            inputProps={{ min: 0 }}
            disabled={readOnly}
            sx={{ width: { xs: "100%", md: 220 } }}
          />
          <TextField
            label="Ready To Pickup Threshold"
            type="number"
            value={chainEditor.readyThreshold}
            onChange={(event) => props.onChangeEditor({ readyThreshold: event.target.value })}
            inputProps={{ min: 0 }}
            disabled={readOnly}
            sx={{ width: { xs: "100%", md: 220 } }}
          />
          <TextField
            label="Ready To Pickup Reopen Threshold"
            type="number"
            value={chainEditor.readyReopenThreshold}
            onChange={(event) => props.onChangeEditor({ readyReopenThreshold: event.target.value })}
            inputProps={{ min: 0 }}
            disabled={readOnly}
            sx={{ width: { xs: "100%", md: 260 } }}
          />
        </Stack>

        <FormControlLabel
          sx={{ mt: 0.8 }}
          control={(
            <Checkbox
              checked={chainEditor.capacityRuleEnabled}
              onChange={(event) => props.onChangeEditor({ capacityRuleEnabled: event.target.checked })}
              disabled={readOnly}
            />
          )}
          label="Enable Capacity Rule"
        />

        <Stack direction={{ xs: "column", md: "row" }} spacing={1.2} sx={{ mt: 0.4 }}>
          <FormControlLabel
            control={(
              <Checkbox
                checked={chainEditor.capacityPerHourEnabled}
                onChange={(event) => props.onChangeEditor({ capacityPerHourEnabled: event.target.checked })}
                disabled={readOnly}
              />
            )}
            label="Enable Capacity / Hour"
          />
          <TextField
            label="Capacity / Hour Limit"
            type="number"
            value={chainEditor.capacityPerHourLimit}
            onChange={(event) => props.onChangeEditor({ capacityPerHourLimit: event.target.value })}
            inputProps={{ min: 1 }}
            disabled={readOnly}
            placeholder="5"
            sx={{ width: { xs: "100%", md: 220 } }}
          />
        </Stack>

        <Stack direction={{ xs: "column", sm: "row" }} spacing={1} sx={{ mt: 1.2 }}>
          <Button
            variant="contained"
            onClick={props.onSaveChain}
            disabled={readOnly}
            startIcon={editingChainIndex !== null ? <SaveRoundedIcon /> : <AddRoundedIcon />}
            sx={{ width: { xs: "100%", sm: "auto" } }}
          >
            {editingChainIndex !== null ? "Save Chain" : "Add Chain"}
          </Button>
          {editingChainIndex !== null ? (
            <Button variant="text" onClick={props.onCancelEdit} startIcon={<CloseRoundedIcon />} sx={{ width: { xs: "100%", sm: "auto" } }}>
              Cancel
            </Button>
          ) : null}
        </Stack>
      </Box>
    </Box>
  );
}
