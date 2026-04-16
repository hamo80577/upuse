import { CssBaseline, ThemeProvider } from "@mui/material";
import type { PropsWithChildren } from "react";
import { BrowserRouter } from "react-router-dom";
import { OpsTelemetryProvider } from "../../systems/ops/providers/OpsTelemetryProvider";
import { theme } from "../../theme";
import { AuthProvider } from "./AuthProvider";

export function AppProviders(props: PropsWithChildren) {
  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <BrowserRouter>
        <AuthProvider>
          <OpsTelemetryProvider>
            {props.children}
          </OpsTelemetryProvider>
        </AuthProvider>
      </BrowserRouter>
    </ThemeProvider>
  );
}
