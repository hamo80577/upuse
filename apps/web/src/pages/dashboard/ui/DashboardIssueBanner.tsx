import ErrorOutlineRoundedIcon from "@mui/icons-material/ErrorOutlineRounded";
import SyncProblemRoundedIcon from "@mui/icons-material/SyncProblemRounded";
import { Box, Chip, Stack, Typography } from "@mui/material";
import type { ReactNode } from "react";

type DashboardIssueKind = "orders" | "sync";

const issueTheme = {
  orders: {
    eyebrow: "Orders Monitor",
    icon: <ErrorOutlineRoundedIcon sx={{ fontSize: 22 }} />,
    border: "rgba(220,38,38,0.16)",
    shadow: "rgba(185,28,28,0.08)",
    background: "linear-gradient(135deg, rgba(255,248,248,0.98) 0%, rgba(255,255,255,0.98) 100%)",
    glow: "rgba(248,113,113,0.18)",
    iconBg: "rgba(220,38,38,0.12)",
    iconColor: "#b91c1c",
    eyebrowColor: "#991b1b",
    textColor: "#7f1d1d",
  },
  sync: {
    eyebrow: "Live Sync",
    icon: <SyncProblemRoundedIcon sx={{ fontSize: 22 }} />,
    border: "rgba(37,99,235,0.16)",
    shadow: "rgba(37,99,235,0.08)",
    background: "linear-gradient(135deg, rgba(245,249,255,0.98) 0%, rgba(255,255,255,0.98) 100%)",
    glow: "rgba(96,165,250,0.18)",
    iconBg: "rgba(37,99,235,0.10)",
    iconColor: "#1d4ed8",
    eyebrowColor: "#1d4ed8",
    textColor: "#1e3a8a",
  },
} satisfies Record<
  DashboardIssueKind,
  {
    eyebrow: string;
    icon: ReactNode;
    border: string;
    shadow: string;
    background: string;
    glow: string;
    iconBg: string;
    iconColor: string;
    eyebrowColor: string;
    textColor: string;
  }
>;

export function DashboardIssueBanner(props: {
  kind: DashboardIssueKind;
  title: string;
  message: string;
  hint?: string;
  statusCode?: number;
  detectedLabel?: string;
  action?: ReactNode;
}) {
  const theme = issueTheme[props.kind];

  return (
    <Box
      sx={{
        position: "relative",
        overflow: "hidden",
        mb: 2,
        px: { xs: 1.35, md: 1.6 },
        py: { xs: 1.35, md: 1.6 },
        borderRadius: { xs: 3.25, md: 4 },
        border: `1px solid ${theme.border}`,
        background: theme.background,
        boxShadow: `0 18px 38px ${theme.shadow}`,
      }}
    >
      <Box
        sx={{
          position: "absolute",
          inset: 0,
          pointerEvents: "none",
          background: `radial-gradient(circle at 100% 0%, ${theme.glow} 0%, transparent 48%)`,
        }}
      />

      <Stack
        direction={{ xs: "column", md: "row" }}
        spacing={1.4}
        alignItems={{ xs: "stretch", md: "center" }}
        justifyContent="space-between"
        sx={{ position: "relative", zIndex: 1 }}
      >
        <Stack direction="row" spacing={1.2} alignItems="flex-start" sx={{ minWidth: 0, flex: 1 }}>
          <Box
            sx={{
              width: 44,
              height: 44,
              borderRadius: 2.5,
              display: "grid",
              placeItems: "center",
              bgcolor: theme.iconBg,
              color: theme.iconColor,
              flexShrink: 0,
            }}
          >
            {theme.icon}
          </Box>

          <Box sx={{ minWidth: 0, flex: 1 }}>
            <Typography
              variant="caption"
              sx={{
                display: "block",
                fontWeight: 900,
                letterSpacing: 0.5,
                textTransform: "uppercase",
                color: theme.eyebrowColor,
              }}
            >
              {theme.eyebrow}
            </Typography>

            <Typography
              sx={{
                mt: 0.3,
                fontWeight: 900,
                fontSize: { xs: 18, md: 20 },
                lineHeight: 1.1,
                color: "#0f172a",
              }}
            >
              {props.title}
            </Typography>

            <Typography
              variant="body2"
              sx={{
                mt: 0.75,
                fontWeight: 700,
                lineHeight: 1.6,
                color: theme.textColor,
                wordBreak: "break-word",
              }}
            >
              {props.message}
            </Typography>

            {props.hint ? (
              <Typography
                variant="caption"
                sx={{
                  display: "block",
                  mt: 0.95,
                  color: "text.secondary",
                  lineHeight: 1.55,
                }}
              >
                {props.hint}
              </Typography>
            ) : null}

            {props.statusCode || props.detectedLabel ? (
              <Stack direction="row" spacing={0.8} sx={{ mt: 1.1, flexWrap: "wrap", rowGap: 0.8 }}>
                {props.statusCode ? (
                  <Chip
                    size="small"
                    label={`HTTP ${props.statusCode}`}
                    sx={{
                      fontWeight: 900,
                      bgcolor: "rgba(255,255,255,0.9)",
                      border: `1px solid ${theme.border}`,
                      color: "#0f172a",
                    }}
                  />
                ) : null}
                {props.detectedLabel ? (
                  <Chip
                    size="small"
                    label={props.detectedLabel}
                    sx={{
                      fontWeight: 900,
                      bgcolor: "rgba(255,255,255,0.9)",
                      border: "1px solid rgba(148,163,184,0.18)",
                      color: "#475569",
                    }}
                  />
                ) : null}
              </Stack>
            ) : null}
          </Box>
        </Stack>

        {props.action ? (
          <Box sx={{ flexShrink: 0, alignSelf: { xs: "stretch", md: "center" } }}>
            {props.action}
          </Box>
        ) : null}
      </Stack>
    </Box>
  );
}
