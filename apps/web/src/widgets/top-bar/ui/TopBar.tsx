import HubIcon from "@mui/icons-material/Hub";
import SettingsIcon from "@mui/icons-material/Settings";
import StorefrontIcon from "@mui/icons-material/Storefront";
import { AppBar, Box, Button, Chip, IconButton, Toolbar } from "@mui/material";
import { memo } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import type { BranchSnapshot } from "../../../api/types";
import { BranchStateTicker } from "./BranchStateTicker";
import { BrandLockup } from "./BrandLockup";

function navButtonSx(isActive: boolean) {
  return {
    color: "text.primary",
    border: isActive ? "1px solid rgba(17,24,39,0.18)" : "1px solid rgba(17,24,39,0.08)",
    bgcolor: isActive ? "rgba(17,24,39,0.04)" : "transparent",
    "&:hover": {
      bgcolor: isActive ? "rgba(17,24,39,0.08)" : "rgba(17,24,39,0.03)",
    },
  };
}

function TopBarBase(props: {
  running: boolean;
  degraded?: boolean;
  degradedLabel?: string;
  degradedColor?: "warning" | "error";
  branchSummary?: Array<Pick<BranchSnapshot, "branchId" | "name" | "status">>;
  onStart: () => void;
  onStop: () => void;
}) {
  const nav = useNavigate();
  const loc = useLocation();
  const active = (path: string) => loc.pathname === path;

  return (
    <AppBar
      position="sticky"
      elevation={0}
      sx={{ borderBottom: "1px solid rgba(17,24,39,0.06)", bgcolor: "white", color: "text.primary" }}
    >
      <Toolbar sx={{ gap: 1.25, py: 0.8, flexWrap: "wrap" }}>
        <BrandLockup />

        <Box sx={{ flex: 1 }} />

        {props.branchSummary ? <BranchStateTicker branches={props.branchSummary} /> : null}

        {props.degraded ? (
          <Chip label={props.degradedLabel ?? "Degraded"} variant="outlined" color={props.degradedColor ?? "warning"} />
        ) : null}

        <Chip
          label={props.running ? "Running" : "Stopped"}
          variant={props.running ? "filled" : "outlined"}
          color={props.running ? "success" : "default"}
        />

        <Button
          variant={props.running ? "outlined" : "contained"}
          color={props.running ? "inherit" : "success"}
          onClick={props.running ? props.onStop : props.onStart}
          sx={{ minWidth: 150 }}
        >
          {props.running ? "Stop" : "Start"}
        </Button>

        <Box sx={{ display: "flex", gap: 0.5 }}>
          <IconButton onClick={() => nav("/")} color="inherit" sx={navButtonSx(active("/"))}>
            <HubIcon />
          </IconButton>

          <IconButton onClick={() => nav("/branches")} color="inherit" sx={navButtonSx(active("/branches"))}>
            <StorefrontIcon />
          </IconButton>
          <IconButton onClick={() => nav("/settings")} color="inherit" sx={navButtonSx(active("/settings"))}>
            <SettingsIcon />
          </IconButton>
        </Box>
      </Toolbar>
    </AppBar>
  );
}

export const TopBar = memo(TopBarBase);
