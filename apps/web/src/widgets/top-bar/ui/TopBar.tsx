import HubIcon from "@mui/icons-material/Hub";
import KeyboardArrowDownRoundedIcon from "@mui/icons-material/KeyboardArrowDownRounded";
import LogoutRoundedIcon from "@mui/icons-material/LogoutRounded";
import ManageAccountsRoundedIcon from "@mui/icons-material/ManageAccountsRounded";
import SettingsIcon from "@mui/icons-material/Settings";
import StorefrontIcon from "@mui/icons-material/Storefront";
import { AppBar, Avatar, Box, Button, Chip, Divider, ListItemIcon, ListItemText, Menu, MenuItem, Stack, Toolbar, Typography } from "@mui/material";
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

function navMenuItemSx(isActive: boolean) {
  return {
    mx: 0.75,
    my: 0.35,
    borderRadius: 1.2,
    border: isActive ? "1px solid rgba(37,99,235,0.18)" : "1px solid transparent",
    bgcolor: isActive ? "rgba(37,99,235,0.08)" : "transparent",
    "&:hover": {
      bgcolor: isActive ? "rgba(37,99,235,0.12)" : "rgba(15,23,42,0.04)",
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
  const mappingActive = loc.pathname === "/mapping" || loc.pathname === "/branches" || activeGroup("/settings/thresholds");
  const userInitials = getUserInitials(user?.name);
  const handleMenuClose = () => setUserMenuAnchor(null);
  const handleNavigate = (path: string) => {
    handleMenuClose();
    nav(path);
  };

  const navigationItems = [
    {
      label: "Dashboard",
      caption: "Live board",
      icon: <HubIcon fontSize="small" />,
      isActive: active("/"),
      onClick: () => handleNavigate("/"),
    },
    {
      label: "Mapping",
      caption: "Branches + rules",
      icon: <StorefrontIcon fontSize="small" />,
      isActive: mappingActive,
      onClick: () => handleNavigate("/mapping"),
    },
    {
      label: "Settings",
      caption: "Tokens and timings",
      icon: <SettingsIcon fontSize="small" />,
      isActive: active("/settings"),
      onClick: () => handleNavigate("/settings"),
    },
  ];

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
            onClose={handleMenuClose}
            anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
            transformOrigin={{ vertical: "top", horizontal: "right" }}
            PaperProps={{
              sx: {
                mt: 1,
                minWidth: 290,
                maxWidth: 320,
                borderRadius: 2,
                border: "1px solid rgba(148,163,184,0.14)",
                boxShadow: "0 22px 44px rgba(15,23,42,0.12)",
                overflow: "hidden",
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

            <Box sx={{ px: 1.5, pt: 1.1, pb: 0.45 }}>
              <Typography variant="caption" sx={{ color: "#64748b", fontWeight: 900, letterSpacing: 0.3 }}>
                Navigation
              </Typography>
            </Box>

            {navigationItems.map((item) => (
              <MenuItem
                key={item.label}
                selected={item.isActive}
                onClick={item.onClick}
                sx={navMenuItemSx(item.isActive)}
              >
                <ListItemIcon sx={{ minWidth: 36, color: item.isActive ? "#1d4ed8" : "#475569" }}>
                  {item.icon}
                </ListItemIcon>
                <ListItemText
                  primary={item.label}
                  secondary={item.caption}
                  primaryTypographyProps={{
                    fontWeight: item.isActive ? 900 : 800,
                    color: "#0f172a",
                    fontSize: 14,
                  }}
                  secondaryTypographyProps={{
                    color: "text.secondary",
                    fontSize: 12,
                  }}
                />
              </MenuItem>
            ))}

            <Divider sx={{ mt: 0.8 }} />

            {isAdmin ? (
              <MenuItem
                onClick={() => handleNavigate("/users")}
                sx={navMenuItemSx(active("/users"))}
              >
                <ListItemIcon sx={{ minWidth: 36, color: active("/users") ? "#1d4ed8" : "#475569" }}>
                  <ManageAccountsRoundedIcon fontSize="small" />
                </ListItemIcon>
                <ListItemText
                  primary="User Management"
                  secondary="Admin only"
                  primaryTypographyProps={{
                    fontWeight: active("/users") ? 900 : 800,
                    color: "#0f172a",
                    fontSize: 14,
                  }}
                  secondaryTypographyProps={{
                    color: "text.secondary",
                    fontSize: 12,
                  }}
                />
              </MenuItem>
            ) : null}

            <MenuItem
              onClick={() => {
                handleMenuClose();
                void handleLogout();
              }}
              disabled={loggingOut}
              sx={{ mx: 0.75, my: 0.45, borderRadius: 1.2 }}
            >
              <ListItemIcon sx={{ minWidth: 36, color: "#b91c1c" }}>
                <LogoutRoundedIcon fontSize="small" />
              </ListItemIcon>
              <ListItemText
                primary={loggingOut ? "Signing out..." : "Logout"}
                secondary="End this session"
                primaryTypographyProps={{
                  fontWeight: 800,
                  color: "#991b1b",
                  fontSize: 14,
                }}
                secondaryTypographyProps={{
                  color: "text.secondary",
                  fontSize: 12,
                }}
              />
            </MenuItem>
          </Menu>
        </Stack>
      </Toolbar>
    </AppBar>
  );
}

export const TopBar = memo(TopBarBase);
