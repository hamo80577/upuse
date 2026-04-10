import { Outlet } from "react-router-dom";
import { MonitorStatusProvider } from "../providers/MonitorStatusProvider";

export function UpuseRouteShell() {
  return (
    <MonitorStatusProvider>
      <Outlet />
    </MonitorStatusProvider>
  );
}
