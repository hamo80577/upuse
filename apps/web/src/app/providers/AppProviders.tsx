import { CssBaseline, ThemeProvider } from "@mui/material";
import type { PropsWithChildren } from "react";
import { BrowserRouter } from "react-router-dom";
import { theme } from "../../theme";
import { AuthProvider } from "./AuthProvider";

export function AppProviders(props: PropsWithChildren) {
  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <BrowserRouter>
        <AuthProvider>
          {props.children}
        </AuthProvider>
      </BrowserRouter>
    </ThemeProvider>
  );
}
