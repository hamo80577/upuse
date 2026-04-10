import { Box, Typography } from "@mui/material";

export function MetricTile(props: {
  label: string;
  value: string;
  secondaryValue?: string;
  tone?: "default" | "danger" | "warning" | "info";
}) {
  const palette =
    props.tone === "danger"
      ? { bg: "rgba(254,242,242,0.98)", text: "#b91c1c", border: "rgba(239,68,68,0.12)" }
      : props.tone === "warning"
        ? { bg: "rgba(255,247,237,0.98)", text: "#c2410c", border: "rgba(249,115,22,0.12)" }
        : props.tone === "info"
          ? { bg: "rgba(239,246,255,0.98)", text: "#075985", border: "rgba(14,165,233,0.12)" }
          : { bg: "rgba(248,250,252,0.98)", text: "#0f172a", border: "rgba(148,163,184,0.12)" };

  return (
    <Box
      sx={{
        p: 1.15,
        borderRadius: 2.8,
        border: `1px solid ${palette.border}`,
        bgcolor: palette.bg,
        minHeight: 92,
        display: "flex",
        flexDirection: "column",
      }}
    >
      <Typography
        variant="caption"
        sx={{
          display: "block",
          color: "#64748b",
          fontWeight: 800,
          letterSpacing: 0.2,
          lineHeight: 1.1,
        }}
      >
        {props.label}
      </Typography>
      <Box sx={{ mt: 0.6, display: "flex", alignItems: "baseline", gap: 0.55, flexWrap: "wrap" }}>
        <Typography sx={{ fontSize: { xs: 22, md: 24 }, lineHeight: 1, fontWeight: 900, color: palette.text }}>
          {props.value}
        </Typography>
        {props.secondaryValue ? (
          <Typography sx={{ fontSize: { xs: 12, md: 13 }, lineHeight: 1, fontWeight: 800, color: palette.text, opacity: 0.8 }}>
            {props.secondaryValue}
          </Typography>
        ) : null}
      </Box>
    </Box>
  );
}
