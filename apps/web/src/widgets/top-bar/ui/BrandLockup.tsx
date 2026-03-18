import { Box } from "@mui/material";

export function BrandLockup(props: { variant?: "topbar" | "auth" }) {
  const variant = props.variant ?? "topbar";
  const isTopbar = variant === "topbar";
  const shouldPrioritizeImage = variant === "auth";

  return (
    <Box
      component="img"
      src="/logo.png"
      alt="UPuse"
      {...(shouldPrioritizeImage ? { fetchpriority: "high" } : {})}
      sx={{
        display: "block",
        width: isTopbar ? { xs: 116, md: 136 } : { xs: 172, sm: 196 },
        height: isTopbar ? { xs: 44, md: 50 } : { xs: 68, sm: 76 },
        objectFit: "contain",
        objectPosition: "left center",
        flexShrink: 0,
      }}
    />
  );
}
