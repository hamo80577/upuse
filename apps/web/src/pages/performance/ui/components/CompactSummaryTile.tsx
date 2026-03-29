import { Box, Typography } from "@mui/material";

export function CompactSummaryTile(props: { label: string; value: string; secondaryValue?: string; tone?: "default" | "danger" | "warning" | "info"; featured?: boolean }) {
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
                p: props.featured ? { xs: 1.05, md: 1.15 } : 0.9,
                borderRadius: props.featured ? 2.8 : 2.4,
                border: `1px solid ${palette.border}`,
                bgcolor: palette.bg,
                minHeight: props.featured ? 84 : 68,
                gridColumn: props.featured ? { xs: "span 2", md: "span 2" } : undefined,
            }}
        >
            <Typography sx={{ color: "#64748b", fontSize: props.featured ? 11.5 : 10.5, fontWeight: 800, letterSpacing: 0.16 }}>
                {props.label}
            </Typography>
            <Box sx={{ mt: 0.35, display: "inline-flex", alignItems: "baseline", gap: 0.45, flexWrap: "wrap" }}>
                <Typography
                    sx={{
                        fontSize: props.featured ? { xs: 28, md: 32 } : { xs: 19, md: 21 },
                        lineHeight: 1.02,
                        fontWeight: 900,
                        color: palette.text,
                    }}
                >
                    {props.value}
                </Typography>
                {props.secondaryValue ? (
                    <Typography
                        sx={{
                            fontSize: props.featured ? { xs: 11, md: 12 } : { xs: 10, md: 10.5 },
                            lineHeight: 1,
                            fontWeight: 800,
                            color: palette.text,
                            opacity: 0.8,
                        }}
                    >
                        {props.secondaryValue}
                    </Typography>
                ) : null}
            </Box>
        </Box>
    );
}
