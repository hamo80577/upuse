import { createTheme } from "@mui/material/styles";

export const theme = createTheme({
  palette: {
    mode: "light",
    background: {
      default: "#f7f8fa",
      paper: "#ffffff",
    },
    text: {
      primary: "#111827",
      secondary: "#4b5563",
    },
  },
  shape: { borderRadius: 8 },
  typography: {
    fontFamily: [
      "Segoe UI",
      "Tahoma",
      "Noto Sans Arabic",
      "Arial",
      "Helvetica Neue",
      "system-ui",
      "-apple-system",
      "sans-serif",
    ].join(","),
    h5: { fontWeight: 800 },
    h6: { fontWeight: 800 },
  },
  components: {
    MuiCard: {
      styleOverrides: {
        root: {
          borderRadius: 16,
          border: "1px solid rgba(17,24,39,0.05)",
          boxShadow: "0 14px 28px rgba(17,24,39,0.08), 0 2px 8px rgba(17,24,39,0.04)",
        },
      },
    },
    MuiButton: {
      styleOverrides: { root: { textTransform: "none", borderRadius: 12, fontWeight: 700 } },
    },
    MuiChip: {
      styleOverrides: { root: { fontWeight: 800 } },
    },
  },
});
