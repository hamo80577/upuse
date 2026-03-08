import HubIcon from "@mui/icons-material/Hub";
import KeyboardArrowDownRoundedIcon from "@mui/icons-material/KeyboardArrowDownRounded";
import LogoutRoundedIcon from "@mui/icons-material/LogoutRounded";
import ManageAccountsRoundedIcon from "@mui/icons-material/ManageAccountsRounded";
import SettingsIcon from "@mui/icons-material/Settings";
import StorefrontIcon from "@mui/icons-material/Storefront";
import TuneRoundedIcon from "@mui/icons-material/TuneRounded";
import { AppBar, Avatar, Box, Button, Chip, Divider, IconButton, Menu, MenuItem, Stack, Toolbar, Typography } from "@mui/material";
import { memo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import type { BranchSnapshot } from "../../../api/types";
import { useAuth } from "../../../app/providers/AuthProvider";
import { BranchStateTicker } from "./BranchStateTicker";
import { BrandLockup } from "./BrandLockup";

function getUserInitials(name?: string | null) {
  const parts = (name ?? "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  if (!parts.length) return "U";
  if (parts.length === 1) return parts[0].slice(0, 1).toUpperCase();
  return `${parts[0][0] ?? ""}${parts[1][0] ?? ""}`.toUpperCase();
}

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
  canControlMonitor?: boolean;
}) {
  const nav = useNavigate();
  const loc = useLocation();
  const { user, isAdmin, canManageMonitor, logout } = useAuth();
  const [loggingOut, setLoggingOut] = useState(false);
  const [userMenuAnchor, setUserMenuAnchor] = useState<HTMLElement | null>(null);
  const canControlMonitor = props.canControlMonitor ?? canManageMonitor;
  const active = (path: string) => loc.pathname === path;
  const activeGroup = (path: string) => loc.pathname === path || loc.pathname.startsWith(`${path}/`);
  const userInitials = getUserInitials(user?.name);

  const handleLogout = async () => {
    if (loggingOut) return;

    try {
      setLoggingOut(true);
      await logout();
      nav("/login", { replace: true });
    } finally {
      setLoggingOut(false);
    }
  };

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

        {canControlMonitor ? (
          <Button
            variant={props.running ? "outlined" : "contained"}
            color={props.running ? "inherit" : "success"}
            onClick={props.running ? props.onStop : props.onStart}
            sx={{ minWidth: 150 }}
          >
            {props.running ? "Stop" : "Start"}
          </Button>
        ) : (
          <Button variant="outlined" disabled sx={{ minWidth: 150 }}>
            Read Only
          </Button>
        )}

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
          <IconButton onClick={() => nav("/settings/thresholds")} color="inherit" sx={navButtonSx(activeGroup("/settings/thresholds"))}>
            <TuneRoundedIcon />
          </IconButton>
        </Box>

        <Stack
          direction="row"
          spacing={1}
          alignItems="center"
          sx={{
            pl: 1,
            ml: { xs: 0, md: 0.5 },
            borderLeft: "1px solid rgba(148,163,184,0.18)",
          }}
        >
          <Button
            type="button"
            color="inherit"
            onClick={(event) => setUserMenuAnchor(event.currentTarget)}
            sx={{
              px: 1.15,
              py: 0.65,
              borderRadius: 999,
              border: "1px solid rgba(148,163,184,0.16)",
              bgcolor: "rgba(248,250,252,0.92)",
              textTransform: "none",
            }}
          >
            <Stack direction="row" spacing={1} alignItems="center">
              <Avatar
                sx={{
                  width: 34,
                  height: 34,
                  fontSize: 13,
                  fontWeight: 900,
                  color: "#0f172a",
                  bgcolor: "rgba(15,23,42,0.08)",
                }}
              >
                {userInitials}
              </Avatar>

              <Box sx={{ minWidth: 0, textAlign: "left" }}>
                <Typography sx={{ fontSize: 13, fontWeight: 900, lineHeight: 1.1 }} noWrap>
                  {user?.name ?? "Signed in"}
                </Typography>
                <Typography variant="caption" sx={{ color: "text.secondary", display: "block" }} noWrap>
                  {user?.role === "admin" ? "Admin" : "User"}
                </Typography>
              </Box>

              <KeyboardArrowDownRoundedIcon sx={{ color: "#64748b" }} />
            </Stack>
          </Button>

          <Menu
            anchorEl={userMenuAnchor}
            open={!!userMenuAnchor}
            onClose={() => setUserMenuAnchor(null)}
            anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
            transformOrigin={{ vertical: "top", horizontal: "right" }}
            PaperProps={{
              sx: {
                mt: 1,
                minWidth: 220,
                borderRadius: 3,
                border: "1px solid rgba(148,163,184,0.14)",
                boxShadow: "0 18px 40px rgba(15,23,42,0.10)",
              },
            }}
          >
            <Stack direction="row" spacing={1.1} alignItems="center" sx={{ px: 1.5, py: 1.25 }}>
              <Avatar
                sx={{
                  width: 40,
                  height: 40,
                  fontSize: 14,
                  fontWeight: 900,
                  color: "#0f172a",
                  bgcolor: "rgba(15,23,42,0.08)",
                }}
              >
                {userInitials}
              </Avatar>

              <Box sx={{ minWidth: 0 }}>
                <Typography sx={{ fontWeight: 900, color: "#0f172a", lineHeight: 1.2 }} noWrap>
                  {user?.name ?? "Signed in"}
                </Typography>
                <Typography variant="caption" sx={{ color: "text.secondary", display: "block" }} noWrap>
                  {user?.email ?? ""}
                </Typography>
              </Box>
            </Stack>

            <Divider />

            {isAdmin ? (
              <MenuItem
                onClick={() => {
                  setUserMenuAnchor(null);
                  nav("/users");
                }}
              >
                <ManageAccountsRoundedIcon fontSize="small" sx={{ mr: 1 }} />
                User Management
              </MenuItem>
            ) : null}

            <MenuItem
              onClick={() => {
                setUserMenuAnchor(null);
                void handleLogout();
              }}
              disabled={loggingOut}
            >
              <LogoutRoundedIcon fontSize="small" sx={{ mr: 1 }} />
              {loggingOut ? "Signing out..." : "Logout"}
            </MenuItem>
          </Menu>
        </Stack>
      </Toolbar>
    </AppBar>
  );
}

export const TopBar = memo(TopBarBase);
