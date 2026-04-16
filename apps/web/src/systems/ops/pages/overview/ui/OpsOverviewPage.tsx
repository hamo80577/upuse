import AdminPanelSettingsRoundedIcon from "@mui/icons-material/AdminPanelSettingsRounded";
import KeyRoundedIcon from "@mui/icons-material/KeyRounded";
import MonitorHeartRoundedIcon from "@mui/icons-material/MonitorHeartRounded";
import RuleRoundedIcon from "@mui/icons-material/RuleRounded";
import ShieldRoundedIcon from "@mui/icons-material/ShieldRounded";
import SpeedRoundedIcon from "@mui/icons-material/SpeedRounded";
import VisibilityRoundedIcon from "@mui/icons-material/VisibilityRounded";
import { Box, Card, CardContent, Chip, Container, Divider, Stack, Typography } from "@mui/material";
import type { ReactNode } from "react";
import { TopBar } from "../../../../../app/shell/TopBar";

interface KpiCard {
  label: string;
  value: string;
  detail: string;
  accent: string;
  icon: ReactNode;
}

const kpiCards: KpiCard[] = [
  {
    label: "System Health",
    value: "Ready",
    detail: "Protected Ops API is online.",
    accent: "#0f766e",
    icon: <MonitorHeartRoundedIcon fontSize="small" />,
  },
  {
    label: "Access Model",
    value: "Locked",
    detail: "Primary admin identity only.",
    accent: "#1d4ed8",
    icon: <ShieldRoundedIcon fontSize="small" />,
  },
  {
    label: "Telemetry",
    value: "Planned",
    detail: "Runtime signals land here next.",
    accent: "#b45309",
    icon: <VisibilityRoundedIcon fontSize="small" />,
  },
  {
    label: "Token Control",
    value: "Planned",
    detail: "Credential review stays isolated.",
    accent: "#7c2d12",
    icon: <KeyRoundedIcon fontSize="small" />,
  },
];

const workAreas = [
  {
    title: "Observability",
    copy: "Health, uptime, error pressure, and service readiness in one admin workspace.",
  },
  {
    title: "Control",
    copy: "Future controls for protected operations without expanding User Management.",
  },
  {
    title: "Quality Review",
    copy: "A review surface for exceptions, drift, and operational confidence signals.",
  },
];

export function OpsOverviewPage() {
  return (
    <Box sx={{ minHeight: "100vh", bgcolor: "#f6f8fb" }}>
      <TopBar />

      <Container maxWidth="xl" sx={{ py: { xs: 2.5, md: 4 } }}>
        <Stack spacing={3}>
          <Box
            sx={{
              borderBottom: "1px solid rgba(15,23,42,0.08)",
              pb: { xs: 2.4, md: 3 },
            }}
          >
            <Stack direction={{ xs: "column", md: "row" }} spacing={2} justifyContent="space-between" alignItems={{ xs: "flex-start", md: "flex-end" }}>
              <Box sx={{ maxWidth: 760 }}>
                <Chip
                  icon={<AdminPanelSettingsRoundedIcon />}
                  label="Primary admin only"
                  sx={{
                    mb: 1.4,
                    height: 32,
                    borderRadius: "8px",
                    bgcolor: "rgba(15,118,110,0.1)",
                    color: "#0f766e",
                    fontWeight: 900,
                    "& .MuiChip-icon": { color: "#0f766e" },
                  }}
                />
                <Typography
                  variant="h3"
                  sx={{
                    fontWeight: 950,
                    color: "#0f172a",
                    letterSpacing: 0,
                    lineHeight: 1.02,
                    fontSize: { xs: 34, md: 48 },
                  }}
                >
                  Ops Center
                </Typography>
                <Typography variant="body1" sx={{ color: "#475569", mt: 1.2, lineHeight: 1.8, maxWidth: 700 }}>
                  Admin-only observability and control workspace for monitoring system health, reviewing quality signals, and preparing protected operational tools.
                </Typography>
              </Box>

              <Stack direction="row" spacing={1} alignItems="center" sx={{ color: "#475569" }}>
                <SpeedRoundedIcon fontSize="small" />
                <Typography variant="body2" sx={{ fontWeight: 800 }}>
                  Phase 01 foundation
                </Typography>
              </Stack>
            </Stack>
          </Box>

          <Box
            sx={{
              display: "grid",
              gridTemplateColumns: { xs: "1fr", sm: "repeat(2, minmax(0, 1fr))", lg: "repeat(4, minmax(0, 1fr))" },
              gap: 1.5,
            }}
          >
            {kpiCards.map((card) => (
              <Card
                key={card.label}
                sx={{
                  borderRadius: "8px",
                  border: "1px solid rgba(148,163,184,0.18)",
                  boxShadow: "0 16px 34px rgba(15,23,42,0.06)",
                }}
              >
                <CardContent sx={{ p: 2.2 }}>
                  <Stack spacing={1.4}>
                    <Stack direction="row" spacing={1} alignItems="center" justifyContent="space-between">
                      <Typography variant="body2" sx={{ color: "#64748b", fontWeight: 900 }}>
                        {card.label}
                      </Typography>
                      <Box
                        sx={{
                          width: 34,
                          height: 34,
                          borderRadius: "8px",
                          display: "grid",
                          placeItems: "center",
                          color: card.accent,
                          bgcolor: `${card.accent}14`,
                        }}
                      >
                        {card.icon}
                      </Box>
                    </Stack>
                    <Typography sx={{ fontSize: 28, lineHeight: 1, fontWeight: 950, color: "#0f172a" }}>
                      {card.value}
                    </Typography>
                    <Typography variant="body2" sx={{ color: "#64748b", lineHeight: 1.65 }}>
                      {card.detail}
                    </Typography>
                  </Stack>
                </CardContent>
              </Card>
            ))}
          </Box>

          <Box
            sx={{
              borderRadius: "8px",
              border: "1px solid rgba(148,163,184,0.18)",
              bgcolor: "#ffffff",
              boxShadow: "0 16px 34px rgba(15,23,42,0.05)",
              overflow: "hidden",
            }}
          >
            <Box sx={{ p: { xs: 2, md: 2.6 } }}>
              <Stack direction={{ xs: "column", md: "row" }} spacing={1.5} alignItems={{ xs: "flex-start", md: "center" }} justifyContent="space-between">
                <Box>
                  <Typography variant="h5" sx={{ color: "#0f172a", fontWeight: 950, letterSpacing: 0 }}>
                    Command Center Tracks
                  </Typography>
                  <Typography variant="body2" sx={{ color: "#64748b", mt: 0.6 }}>
                    The first Ops surface is wired for access, routing, and protected expansion.
                  </Typography>
                </Box>
                <Chip
                  icon={<RuleRoundedIcon />}
                  label="No editable Ops permissions"
                  variant="outlined"
                  sx={{ borderRadius: "8px", fontWeight: 900 }}
                />
              </Stack>
            </Box>

            <Divider />

            <Box
              sx={{
                display: "grid",
                gridTemplateColumns: { xs: "1fr", md: "repeat(3, minmax(0, 1fr))" },
              }}
            >
              {workAreas.map((area, index) => (
                <Box
                  key={area.title}
                  sx={{
                    p: { xs: 2, md: 2.6 },
                    borderLeft: { xs: "none", md: index === 0 ? "none" : "1px solid rgba(148,163,184,0.16)" },
                    borderTop: { xs: index === 0 ? "none" : "1px solid rgba(148,163,184,0.16)", md: "none" },
                  }}
                >
                  <Typography sx={{ fontWeight: 950, color: "#0f172a", mb: 0.8 }}>
                    {area.title}
                  </Typography>
                  <Typography variant="body2" sx={{ color: "#64748b", lineHeight: 1.75 }}>
                    {area.copy}
                  </Typography>
                </Box>
              ))}
            </Box>
          </Box>
        </Stack>
      </Container>
    </Box>
  );
}
