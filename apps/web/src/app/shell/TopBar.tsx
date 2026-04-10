import HubIcon from "@mui/icons-material/Hub";
import KeyboardArrowDownRoundedIcon from "@mui/icons-material/KeyboardArrowDownRounded";
import LogoutRoundedIcon from "@mui/icons-material/LogoutRounded";
import ManageAccountsRoundedIcon from "@mui/icons-material/ManageAccountsRounded";
import {
  AppBar,
  Avatar,
  Box,
  Button,
  Chip,
  Divider,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  Stack,
  Toolbar,
  Typography,
} from "@mui/material";
import { memo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import type { BranchSnapshot } from "../../api/types";
import { getWebSystems } from "../../core/systems/registry";
import { resolveSystemFromPath } from "../../core/systems/navigation";
import { useAuth } from "../providers/AuthProvider";
import { BrandLockup } from "../../widgets/top-bar/ui/BrandLockup";
import { BranchStateTicker } from "../../widgets/top-bar/ui/BranchStateTicker";

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

function resolveUserRoleLabel(currentSystemId: string, auth: ReturnType<typeof useAuth>) {
  if (currentSystemId === "scano" && auth.user?.isPrimaryAdmin) {
    return "Scano Admin";
  }
  if (currentSystemId === "scano" && auth.scanoRole) {
    return auth.scanoRole === "team_lead" ? "Scano Team Lead" : "Scano Scanner";
  }
  return auth.user?.role === "admin" ? "Admin" : "User";
}

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
  const location = useLocation();
  const auth = useAuth();
  const [loggingOut, setLoggingOut] = useState(false);
  const [userMenuAnchor, setUserMenuAnchor] = useState<HTMLElement | null>(null);
  const currentSystem = resolveSystemFromPath(location.pathname);
  const navigationItems = currentSystem.getNavigation(auth, location);
  const accessibleSystems = getWebSystems().filter((system) => system.canAccess(auth));
  const running = props.running ?? false;
  const canControlMonitor = props.canControlMonitor ?? auth.canManageMonitor;
  const showUpuseControls = currentSystem.id === "upuse";
  const showMonitorAction = showUpuseControls && typeof props.onStart === "function" && typeof props.onStop === "function";
  const userInitials = getUserInitials(auth.user?.name);

  const handleMenuClose = () => setUserMenuAnchor(null);
  const handleNavigate = (path: string) => {
    handleMenuClose();
    nav(path);
  };

  const handleSystemSwitch = (systemId: string) => {
    handleMenuClose();
    if (systemId === currentSystem.id) {
      return;
    }
    nav(`/system-switch/${systemId}`);
  };

  const handleLogout = async () => {
    if (loggingOut) return;

    try {
      setLoggingOut(true);
      await auth.logout();
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
                  {auth.user?.name ?? "Signed in"}
                </Typography>
                <Typography variant="caption" sx={{ color: "text.secondary", display: "block" }} noWrap>
                  {resolveUserRoleLabel(currentSystem.id, auth)}
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
                  {auth.user?.name ?? "Signed in"}
                </Typography>
                <Typography variant="caption" sx={{ color: "text.secondary", display: "block" }} noWrap>
                  {auth.user?.email ?? ""}
                </Typography>
              </Box>
            </Stack>

            {accessibleSystems.length > 1 ? (
              <>
                <Divider />

                <Box sx={{ px: 1.5, pt: 1.1, pb: 0.45 }}>
                  <Typography variant="caption" sx={{ color: "#64748b", fontWeight: 900, letterSpacing: 0.3 }}>
                    Systems
                  </Typography>
                </Box>

                {accessibleSystems.map((system) => (
                  <MenuItem
                    key={system.id}
                    selected={system.id === currentSystem.id}
                    onClick={() => handleSystemSwitch(system.id)}
                    sx={navMenuItemSx(system.id === currentSystem.id)}
                  >
                    <ListItemIcon sx={{ minWidth: 36, color: system.id === currentSystem.id ? "#1d4ed8" : "#475569" }}>
                      {system.id === "upuse" ? <HubIcon fontSize="small" /> : <Box component="span">{system.getNavigation(auth, location)[0]?.icon ?? <HubIcon fontSize="small" />}</Box>}
                    </ListItemIcon>
                    <ListItemText
                      primary={system.label}
                      secondary={system.id === "upuse" ? "Operations workspace" : "Standalone workspace"}
                      primaryTypographyProps={{
                        fontWeight: system.id === currentSystem.id ? 900 : 800,
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
                {currentSystem.label} Navigation
              </Typography>
            </Box>

            {navigationItems.map((item) => (
              <MenuItem
                key={item.key}
                selected={item.isActive}
                onClick={() => handleNavigate(item.path)}
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

            {currentSystem.id === "upuse" && auth.isAdmin ? (
              <MenuItem
                onClick={() => handleNavigate("/users")}
                sx={navMenuItemSx(location.pathname === "/users")}
              >
                <ListItemIcon sx={{ minWidth: 36, color: location.pathname === "/users" ? "#1d4ed8" : "#475569" }}>
                  <ManageAccountsRoundedIcon fontSize="small" />
                </ListItemIcon>
                <ListItemText
                  primary="User Management"
                  secondary="Admin only"
                  primaryTypographyProps={{
                    fontWeight: location.pathname === "/users" ? 900 : 800,
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
