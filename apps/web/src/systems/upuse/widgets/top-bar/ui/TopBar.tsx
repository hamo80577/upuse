import { Box, Button, Chip } from "@mui/material";
import { TopBar as AppTopBar } from "../../../../../app/shell/TopBar";
import type { BranchSnapshot } from "../../../../../api/types";
import { BranchStateTicker } from "../../../../../widgets/top-bar/ui/BranchStateTicker";

export interface UpuseTopBarProps {
  running?: boolean;
  degraded?: boolean;
  degradedLabel?: string;
  degradedColor?: "warning" | "error";
  branchSummary?: Array<Pick<BranchSnapshot, "branchId" | "name" | "status">>;
  onStart?: () => void;
  onStop?: () => void;
  canControlMonitor?: boolean;
}

function UpuseTopBarChrome(props: UpuseTopBarProps) {
  const running = props.running ?? false;
  const canControlMonitor = props.canControlMonitor ?? false;
  const showMonitorAction = typeof props.onStart === "function" && typeof props.onStop === "function";

  return (
    <>
      {props.branchSummary ? (
        <Box sx={{ display: { xs: "none", sm: "block" } }}>
          <BranchStateTicker branches={props.branchSummary} />
        </Box>
      ) : null}

      {props.degraded ? (
        <Chip
          label={props.degradedLabel ?? "Degraded"}
          variant="outlined"
          color={props.degradedColor ?? "warning"}
          sx={{ height: { xs: 28, sm: 32 }, fontWeight: 800 }}
        />
      ) : null}

      <Chip
        label={running ? "Running" : "Stopped"}
        variant={running ? "filled" : "outlined"}
        color={running ? "success" : "default"}
        sx={{ height: { xs: 28, sm: 32 }, fontWeight: 800 }}
      />

      {showMonitorAction ? (
        canControlMonitor ? (
          <Button
            variant={running ? "outlined" : "contained"}
            color={running ? "inherit" : "success"}
            onClick={running ? props.onStop : props.onStart}
            sx={{ minWidth: { xs: 96, sm: 150 }, px: { xs: 1.5, sm: 2 }, fontWeight: 800 }}
          >
            {running ? "Stop" : "Start"}
          </Button>
        ) : (
          <Button variant="outlined" disabled sx={{ minWidth: { xs: 96, sm: 150 }, px: { xs: 1.5, sm: 2 }, fontWeight: 800 }}>
            <Box component="span" sx={{ display: { xs: "inline", sm: "none" } }}>
              Locked
            </Box>
            <Box component="span" sx={{ display: { xs: "none", sm: "inline" } }}>
              Read Only
            </Box>
          </Button>
        )
      ) : null}
    </>
  );
}

export function TopBar(props: UpuseTopBarProps) {
  return <AppTopBar systemChrome={<UpuseTopBarChrome {...props} />} />;
}
