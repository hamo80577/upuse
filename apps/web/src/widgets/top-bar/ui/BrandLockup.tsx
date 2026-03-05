import { Box, Stack, Typography } from "@mui/material";

export function BrandLockup() {
  return (
    <Stack direction="row" spacing={1.2} alignItems="center" sx={{ minWidth: 0 }}>
      <Box
        sx={{
          width: 42,
          height: 42,
          borderRadius: "14px",
          display: "grid",
          placeItems: "center",
          background: "linear-gradient(135deg, #0f172a 0%, #1e293b 100%)",
          boxShadow: "0 12px 26px rgba(15,23,42,0.14)",
          position: "relative",
          flexShrink: 0,
        }}
      >
        <Box
          sx={{
            position: "absolute",
            left: "50%",
            top: 9,
            transform: "translateX(-50%)",
            width: 22,
            height: 22,
            borderRadius: "50%",
            border: "3px solid rgba(255,255,255,0.9)",
            boxSizing: "border-box",
          }}
        />
        <Box
          sx={{
            position: "absolute",
            left: "50%",
            top: 14,
            transform: "translateX(-50%)",
            width: 12,
            height: 12,
            borderRadius: "50%",
            border: "2px solid rgba(255,255,255,0.72)",
            boxSizing: "border-box",
          }}
        />
        <Box
          sx={{
            position: "absolute",
            left: "50%",
            top: 19,
            transform: "translateX(-50%)",
            width: 6,
            height: 6,
            borderRadius: "50%",
            bgcolor: "#22c55e",
            boxShadow: "0 0 0 3px rgba(34,197,94,0.12)",
          }}
        />
        <Box
          sx={{
            position: "absolute",
            left: 16,
            top: 15,
            width: 4,
            height: 4,
            borderRadius: "50%",
            bgcolor: "#ffffff",
            opacity: 0.92,
          }}
        />
        <Box
          sx={{
            position: "absolute",
            right: 11,
            bottom: 9,
            width: 5,
            height: 15,
            borderRadius: 999,
            bgcolor: "rgba(255,255,255,0.88)",
            transform: "rotate(-45deg)",
            transformOrigin: "center",
          }}
        />
      </Box>

      <Box sx={{ minWidth: 0 }}>
        <Typography
          sx={{
            fontSize: 25,
            fontWeight: 900,
            lineHeight: 1,
            letterSpacing: "-0.04em",
            color: "#0f172a",
          }}
        >
          <Box component="span" sx={{ color: "#0f172a" }}>
            UP
          </Box>
          <Box component="span" sx={{ color: "#16a34a" }}>
            use
          </Box>
        </Typography>
        <Typography
          variant="caption"
          sx={{
            display: "block",
            mt: 0.15,
            color: "#64748b",
            fontWeight: 800,
            letterSpacing: 0.5,
            textTransform: "uppercase",
          }}
        >
          All Under Control
        </Typography>
      </Box>
    </Stack>
  );
}
