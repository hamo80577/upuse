import QrCode2RoundedIcon from "@mui/icons-material/QrCode2Rounded";
import { Box, Card, CardContent, Stack, Typography } from "@mui/material";
import type { ScanoTaskProduct } from "../../../api/types";

export function ProductCounterCard(props: { label: string; total: number; edited?: number }) {
  return (
    <Card variant="outlined" sx={{ borderRadius: 3, minWidth: 128, flex: "1 1 120px" }}>
      <CardContent sx={{ p: 1.3 }}>
        <Typography variant="caption" sx={{ color: "text.secondary" }}>
          {props.label}
        </Typography>
        <Typography sx={{ fontWeight: 900, fontSize: 24 }}>
          {props.total}
        </Typography>
        {typeof props.edited === "number" ? (
          <Typography variant="caption" sx={{ color: "text.secondary" }}>
            Edited {props.edited}
          </Typography>
        ) : null}
      </CardContent>
    </Card>
  );
}

export function LatestConfirmedProductCard(props: { product: ScanoTaskProduct; onOpen: () => void }) {
  const previewUrl = props.product.images[0]?.url ?? props.product.previewImageUrl ?? null;

  return (
    <Card
      variant="outlined"
      onClick={props.onOpen}
      sx={{
        borderRadius: 3.2,
        cursor: "pointer",
        borderColor: "rgba(148,163,184,0.2)",
        transition: "transform 160ms ease, box-shadow 160ms ease, border-color 160ms ease",
        "&:hover": {
          transform: "translateY(-1px)",
          boxShadow: "0 18px 32px rgba(15,23,42,0.08)",
          borderColor: "rgba(14,165,233,0.34)",
        },
      }}
    >
      <CardContent sx={{ p: 1.4 }}>
        <Stack direction="row" spacing={1.2} alignItems="center">
          <Box
            sx={{
              width: 74,
              height: 74,
              borderRadius: 3,
              bgcolor: "#ffffff",
              border: "1px solid rgba(148,163,184,0.18)",
              display: "grid",
              placeItems: "center",
              overflow: "hidden",
              flex: "0 0 auto",
            }}
          >
            {previewUrl ? (
              <Box
                component="img"
                src={previewUrl}
                alt={props.product.itemNameEn}
                sx={{ width: "76%", height: "76%", objectFit: "contain", display: "block" }}
              />
            ) : (
              <QrCode2RoundedIcon sx={{ color: "#94a3b8", fontSize: 28 }} />
            )}
          </Box>

          <Stack spacing={0.35} sx={{ minWidth: 0 }}>
            <Typography variant="overline" sx={{ color: "#64748b", fontWeight: 800, letterSpacing: "0.08em", lineHeight: 1.2 }}>
              Latest Confirmed Product
            </Typography>
            <Typography sx={{ fontWeight: 900, color: "#0f172a", overflowWrap: "anywhere", wordBreak: "break-word" }}>
              {props.product.itemNameEn}
            </Typography>
            <Typography variant="body2" sx={{ color: "text.secondary", overflowWrap: "anywhere", wordBreak: "break-word" }}>
              {props.product.barcode} · {props.product.sku}
            </Typography>
          </Stack>
        </Stack>
      </CardContent>
    </Card>
  );
}
