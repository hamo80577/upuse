import { Alert, Box, Button, CircularProgress, Stack, Typography } from "@mui/material";
import { useAuth } from "../providers/AuthProvider";

export function SystemSwitchLoadingPage(props: {
  systemLabel: string;
  title?: string;
  subtitle?: string;
}) {
  return (
    <Box
      sx={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        px: 2,
        bgcolor: "#f4f7fb",
        background:
          "radial-gradient(circle at top left, rgba(14,165,233,0.12), transparent 28%), radial-gradient(circle at bottom right, rgba(15,23,42,0.08), transparent 32%), linear-gradient(180deg, #f7fafc 0%, #edf4f8 100%)",
      }}
    >
      <Stack spacing={1.35} alignItems="center" sx={{ textAlign: "center", maxWidth: 480 }}>
        <CircularProgress size={34} sx={{ color: "#0f172a" }} />
        <Typography sx={{ fontSize: { xs: 28, md: 34 }, lineHeight: 1, fontWeight: 900, letterSpacing: "-0.04em", color: "#0f172a" }}>
          {props.title ?? `Switching to ${props.systemLabel}`}
        </Typography>
        <Typography sx={{ color: "#64748b", lineHeight: 1.75 }}>
          {props.subtitle ?? `Preparing the ${props.systemLabel} workspace and refreshing the session shell.`}
        </Typography>
      </Stack>
    </Box>
  );
}

export function RouteFallback() {
  const { bootstrapError, retryBootstrap } = useAuth();

  return (
    <Box
      sx={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        bgcolor: "background.default",
        px: 2,
      }}
    >
      {bootstrapError ? (
        <Stack spacing={1.5} sx={{ width: "100%", maxWidth: 420 }}>
          <Alert severity="error" variant="outlined">
            {bootstrapError}
          </Alert>
          <Button variant="contained" onClick={retryBootstrap}>
            Retry
          </Button>
        </Stack>
      ) : (
        <CircularProgress size={28} />
      )}
    </Box>
  );
}
