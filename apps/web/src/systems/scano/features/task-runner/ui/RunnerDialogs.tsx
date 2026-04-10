import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  List,
  ListItemButton,
  ListItemText,
  Stack,
  Typography,
} from "@mui/material";
import CheckCircleRoundedIcon from "@mui/icons-material/CheckCircleRounded";
import type { ScanoExternalProductSearchResult, ScanoTaskId } from "../../../api/types";
import type { EndDialogState, PendingSelectionState } from "../types";

export function RunnerSelectionDialog(props: {
  onClose: () => void;
  onSelect: (item: ScanoExternalProductSearchResult, pendingSelection: PendingSelectionState | null) => void;
  pendingSelection: PendingSelectionState | null;
  selectionItems: ScanoExternalProductSearchResult[];
}) {
  return (
    <Dialog open={props.selectionItems.length > 0} onClose={props.onClose} fullWidth maxWidth="sm">
      <DialogTitle>Select Product</DialogTitle>
      <DialogContent dividers>
        <List disablePadding>
          {props.selectionItems.map((item) => (
            <ListItemButton key={item.id} onClick={() => props.onSelect(item, props.pendingSelection)}>
              <ListItemText
                primary={item.itemNameEn || item.itemNameAr || item.barcode}
                secondary={[item.barcode, item.itemNameAr].filter(Boolean).join(" · ")}
              />
            </ListItemButton>
          ))}
        </List>
      </DialogContent>
      <DialogActions>
        <Button onClick={props.onClose}>
          Cancel
        </Button>
      </DialogActions>
    </Dialog>
  );
}

export function RunnerEndTaskDialog(props: {
  actionLoading: boolean;
  endDialogState: EndDialogState;
  onBackToProfile: () => void;
  onClose: () => void;
  onConfirm: () => void;
  taskId: ScanoTaskId;
}) {
  return (
    <Dialog open={props.endDialogState !== "closed"} onClose={props.onClose} fullWidth maxWidth="xs">
      {props.endDialogState === "confirm" ? (
        <>
          <DialogTitle>End Task</DialogTitle>
          <DialogContent dividers>
            <Typography>
              Confirm ending this task. After that, barcode search will be disabled and the runner will return to the task profile.
            </Typography>
          </DialogContent>
          <DialogActions>
            <Button onClick={props.onClose} disabled={props.actionLoading}>
              Cancel
            </Button>
            <Button variant="contained" color="error" onClick={props.onConfirm} disabled={props.actionLoading}>
              Confirm
            </Button>
          </DialogActions>
        </>
      ) : (
        <>
          <DialogTitle>Task Ended</DialogTitle>
          <DialogContent dividers>
            <Stack direction="row" spacing={1} alignItems="center">
              <CheckCircleRoundedIcon color="success" />
              <Typography>The task was ended successfully.</Typography>
            </Stack>
          </DialogContent>
          <DialogActions>
            <Button onClick={props.onBackToProfile}>Back To Profile</Button>
          </DialogActions>
        </>
      )}
    </Dialog>
  );
}
