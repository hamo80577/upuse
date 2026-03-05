import { Box, Typography } from "@mui/material";
import { memo } from "react";
import { fmtInt } from "../../../utils/format";

function SummaryStatBase(props: {
  label: string;
  value: number;
  color: string;
  bg: string;
}) {
  return (
    <Box
      sx={{
        p: 1.15,
        minHeight: 84,
        borderRadius: 3,
        border: "1px solid rgba(148,163,184,0.10)",
        bgcolor: "rgba(255,255,255,0.88)",
      }}
    >
      <Box
        sx={{
          width: 36,
          height: 4,
          borderRadius: 999,
          bgcolor: props.color,
          opacity: 0.9,
        }}
      />

      <Typography
        variant="caption"
        sx={{
          display: "block",
          mt: 1,
          fontWeight: 800,
          color: "text.secondary",
          lineHeight: 1.2,
        }}
      >
        {props.label}
      </Typography>

      <Typography
        sx={{
          mt: 0.35,
          fontWeight: 900,
          fontSize: { xs: 24, md: 28 },
          lineHeight: 1,
          color: props.color,
        }}
      >
        {fmtInt(props.value)}
      </Typography>

      <Box
        sx={{
          mt: 1,
          height: 8,
          borderRadius: 999,
          bgcolor: props.bg,
        }}
      />
    </Box>
  );
}

export const SummaryStat = memo(SummaryStatBase);
