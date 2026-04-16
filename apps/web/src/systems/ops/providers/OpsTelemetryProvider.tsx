import { useEffect, useLayoutEffect, useMemo, type PropsWithChildren } from "react";
import { useLocation } from "react-router-dom";
import { useAuth } from "../../../app/providers/AuthProvider";
import { setApiFailureReporter } from "../../../shared/api/httpClient";
import { opsTelemetry } from "../telemetry/opsTelemetryClient";
import { resolveOpsTelemetryRouteContext } from "../telemetry/routeContext";

export function OpsTelemetryProvider(props: PropsWithChildren) {
  const auth = useAuth();
  const location = useLocation();
  const routeContext = useMemo(
    () => resolveOpsTelemetryRouteContext(location.pathname),
    [location.pathname],
  );

  useLayoutEffect(() => {
    if (auth.status === "authenticated") {
      opsTelemetry.start(routeContext);
      return;
    }

    opsTelemetry.stop();
  }, [auth.status]);

  useEffect(() => {
    if (auth.status !== "authenticated") return;
    opsTelemetry.setRouteContext(routeContext);
  }, [auth.status, routeContext]);

  useEffect(() => setApiFailureReporter((failure) => {
    opsTelemetry.captureApiFailure(failure);
  }), []);

  useEffect(() => () => {
    opsTelemetry.stop();
  }, []);

  return <>{props.children}</>;
}
