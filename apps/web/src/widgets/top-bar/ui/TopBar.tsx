import HubIcon from "@mui/icons-material/Hub";
import Inventory2RoundedIcon from "@mui/icons-material/Inventory2Rounded";
import KeyboardArrowDownRoundedIcon from "@mui/icons-material/KeyboardArrowDownRounded";
import LeaderboardRoundedIcon from "@mui/icons-material/LeaderboardRounded";
import LogoutRoundedIcon from "@mui/icons-material/LogoutRounded";
import ManageAccountsRoundedIcon from "@mui/icons-material/ManageAccountsRounded";
import QrCodeScannerRoundedIcon from "@mui/icons-material/QrCodeScannerRounded";
import SettingsIcon from "@mui/icons-material/Settings";
import StorefrontIcon from "@mui/icons-material/Storefront";
import TuneRoundedIcon from "@mui/icons-material/TuneRounded";
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

type WorkspaceSystem = "upuse" | "scano";

function TopBarBase(props: {
  running?: boolean;
  degraded?: boolean;
  degradedLabel?: string;
  degradedColor?: "warning" | "error";
  branchSummary?: Array<Pick<BranchSnapshot, "branchId" | "name" | "status">>;
  onStart?: () => void;
  onStop?: () => void;
  canControlMonitor?: boolean;
}) {
  const nav = useNavigate();
  const loc = useLocation();
  const { user, isAdmin, canAccessScano, canManageMonitor, canManageScanoSettings, canManageScanoTasks, canSwitchSystems, logout, scanoRole } = useAuth();
  const [loggingOut, setLoggingOut] = useState(false);
  const [userMenuAnchor, setUserMenuAnchor] = useState<HTMLElement | null>(null);
  const canControlMonitor = props.canControlMonitor ?? canManageMonitor;
  const active = (path: string) => loc.pathname === path;
  const activeGroup = (path: string) => loc.pathname === path || loc.pathname.startsWith(`${path}/`);
  const scanoActive = activeGroup("/scano");
  const currentSystem: WorkspaceSystem = scanoActive ? "scano" : "upuse";
  const running = props.running ?? false;
  const showUpuseControls = currentSystem === "upuse";
  const showMonitorAction = showUpuseControls && typeof props.onStart === "function" && typeof props.onStop === "function";
  const performanceActive = active("/performance");
  const branchesActive = active("/branches");
  const thresholdsActive = active("/thresholds") || activeGroup("/settings/thresholds");
  const scanoAssignTaskActive = active("/scano/assign-task") || (canManageScanoTasks && activeGroup("/scano/tasks/"));
  const scanoMasterProductActive = active("/scano/master-product");
  const scanoMyTasksActive = active("/scano/my-tasks") || (!canManageScanoTasks && activeGroup("/scano/tasks/"));
  const scanoSettingsActive = active("/scano/settings");
  const userInitials = getUserInitials(user?.name);
  const handleMenuClose = () => setUserMenuAnchor(null);
  const handleNavigate = (path: string) => {
    handleMenuClose();
    nav(path);
  };

  const handleSystemSwitch = (system: WorkspaceSystem) => {
    handleMenuClose();
    if (system === currentSystem) {
      return;
    }
    nav(`/system-switch/${system}`);
  };

  const systemItems = [
    {
      label: "UPuse",
      caption: "Operations workspace",
      icon: <HubIcon fontSize="small" />,
      isActive: currentSystem === "upuse",
      onClick: () => handleSystemSwitch("upuse"),
    },
    ...(canAccessScano ? [{
      label: "Scano",
      caption: "Standalone workspace",
      icon: <QrCodeScannerRoundedIcon fontSize="small" />,
      isActive: currentSystem === "scano",
      onClick: () => handleSystemSwitch("scano"),
    }] : []),
  ];

  const upuseNavigationItems = [
    {
      label: "Dashboard",
      caption: "Live board",
      icon: <HubIcon fontSize="small" />,
      isActive: active("/"),
      onClick: () => handleNavigate("/"),
    },
    {
      label: "Performance",
      caption: "Chains and branches",
      icon: <LeaderboardRoundedIcon fontSize="small" />,
      isActive: performanceActive,
      onClick: () => handleNavigate("/performance"),
    },
    {
      label: "Branches",
      caption: "Branch mappings",
      icon: <StorefrontIcon fontSize="small" />,
      isActive: branchesActive,
      onClick: () => handleNavigate("/branches"),
    },
    {
      label: "Thresholds",
      caption: "Rules and overrides",
      icon: <TuneRoundedIcon fontSize="small" />,
      isActive: thresholdsActive,
      onClick: () => handleNavigate("/thresholds"),
    },
    {
      label: "Settings",
      caption: "Tokens and timings",
      icon: <SettingsIcon fontSize="small" />,
      isActive: active("/settings"),
      onClick: () => handleNavigate("/settings"),
    },
  ];
  const navigationItems = currentSystem === "upuse"
    ? upuseNavigationItems
    : [
        ...(canManageScanoTasks ? [{
          label: "Assign Task",
          caption: "Scano tasks",
          icon: <QrCodeScannerRoundedIcon fontSize="small" />,
          isActive: scanoAssignTaskActive,
          onClick: () => handleNavigate("/scano/assign-task"),
        }, {
          label: "Master Product",
          caption: "Chain imports",
          icon: <Inventory2RoundedIcon fontSize="small" />,
          isActive: scanoMasterProductActive,
          onClick: () => handleNavigate("/scano/master-product"),
        }] : []),
        ...(!canManageScanoTasks && scanoRole === "scanner" ? [{
          label: "My Tasks",
          caption: "Assigned work",
          icon: <QrCodeScannerRoundedIcon fontSize="small" />,
          isActive: scanoMyTasksActive,
          onClick: () => handleNavigate("/scano/my-tasks"),
        }] : []),
        ...(canManageScanoSettings ? [{
          label: "Scano Settings",
          caption: "Catalog token",
          icon: <SettingsIcon fontSize="small" />,
          isActive: scanoSettingsActive,
          onClick: () => handleNavigate("/scano/settings"),
        }] : []),
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
      <Toolbar
        sx={{
          gap: { xs: 0.75, md: 1.25 },
          py: { xs: 0.65, md: 0.8 },
          px: { xs: 1.25, sm: 2 },
          flexWrap: "wrap",
          rowGap: { xs: 0.75, md: 1 },
        }}
      >
        <BrandLockup />

        <Box sx={{ flex: 1, minWidth: { xs: 0, sm: 24 } }} />

        {showUpuseControls && props.branchSummary ? (
          <Box sx={{ display: { xs: "none", sm: "block" } }}>
            <BranchStateTicker branches={props.branchSummary} />
          </Box>
        ) : null}

        {showUpuseControls && props.degraded ? (
          <Chip
            label={props.degradedLabel ?? "Degraded"}
            variant="outlined"
            color={props.degradedColor ?? "warning"}
            sx={{ height: { xs: 28, sm: 32 }, fontWeight: 800 }}
          />
        ) : null}

        {showUpuseControls ? (
          <>
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
        ) : null}

        <Stack
          direction="row"
          spacing={1}
          alignItems="center"
          sx={{
            pl: { xs: 0, sm: 1 },
            ml: { xs: 0, md: 0.5 },
            borderLeft: { xs: "none", sm: "1px solid rgba(148,163,184,0.18)" },
          }}
        >
          <Button
            type="button"
            color="inherit"
            onClick={(event) => setUserMenuAnchor(event.currentTarget)}
            sx={{
              minWidth: 0,
              px: { xs: 0.85, sm: 1.15 },
              py: 0.65,
              borderRadius: 999,
              border: "1px solid rgba(148,163,184,0.16)",
              bgcolor: "rgba(248,250,252,0.92)",
              textTransform: "none",
            }}
          >
            <Stack direction="row" spacing={{ xs: 0.75, sm: 1 }} alignItems="center">
              <Avatar
                sx={{
                  width: { xs: 30, sm: 34 },
                  height: { xs: 30, sm: 34 },
                  fontSize: { xs: 12, sm: 13 },
                  fontWeight: 900,
                  color: "#0f172a",
                  bgcolor: "rgba(15,23,42,0.08)",
                }}
              >
                {userInitials}
              </Avatar>

              <Box sx={{ minWidth: 0, textAlign: "left", display: { xs: "none", sm: "block" } }}>
                <Typography sx={{ fontSize: 13, fontWeight: 900, lineHeight: 1.1 }} noWrap>
                  {user?.name ?? "Signed in"}
                </Typography>
                <Typography variant="caption" sx={{ color: "text.secondary", display: "block" }} noWrap>
                  {currentSystem === "scano" && user?.isPrimaryAdmin
                    ? "Scano Admin"
                    : currentSystem === "scano" && scanoRole
                    ? scanoRole === "team_lead" ? "Scano Team Lead" : "Scano Scanner"
                    : user?.role === "admin" ? "Admin" : "User"}
                </Typography>
              </Box>

              <KeyboardArrowDownRoundedIcon sx={{ color: "#64748b", fontSize: { xs: 18, sm: 22 } }} />
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
                maxHeight: "min(80vh, 560px)",
                borderRadius: 2,
                border: "1px solid rgba(148,163,184,0.14)",
                boxShadow: "0 22px 44px rgba(15,23,42,0.12)",
                overflowX: "hidden",
                overflowY: "auto",
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

            {canSwitchSystems ? (
              <>
                <Divider />

                <Box sx={{ px: 1.5, pt: 1.1, pb: 0.45 }}>
                  <Typography variant="caption" sx={{ color: "#64748b", fontWeight: 900, letterSpacing: 0.3 }}>
                    Systems
                  </Typography>
                </Box>

                {systemItems.map((item) => (
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
              </>
            ) : (
              <Divider />
            )}

            <Box sx={{ px: 1.5, pt: 1.1, pb: 0.45 }}>
              <Typography variant="caption" sx={{ color: "#64748b", fontWeight: 900, letterSpacing: 0.3 }}>
                {currentSystem === "upuse" ? "UPuse Navigation" : "Scano Navigation"}
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

            {currentSystem === "upuse" && isAdmin ? (
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
