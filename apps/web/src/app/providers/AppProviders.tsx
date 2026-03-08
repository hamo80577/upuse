import { CssBaseline, ThemeProvider } from "@mui/material";
import type { PropsWithChildren } from "react";
import { BrowserRouter } from "react-router-dom";
import { theme } from "../../theme";
import { AuthProvider } from "./AuthProvider";
import { MonitorStatusProvider } from "./MonitorStatusProvider";

export function AppProviders(props: PropsWithChildren) {
  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <BrowserRouter>
        <AuthProvider>
          <MonitorStatusProvider>{props.children}</MonitorStatusProvider>
        </AuthProvider>
      </BrowserRouter>
    </ThemeProvider>
  );
}
