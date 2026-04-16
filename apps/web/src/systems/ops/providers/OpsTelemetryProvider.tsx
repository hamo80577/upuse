import { useEffect, useLayoutEffect, useMemo, useRef, type PropsWithChildren } from "react";
import { useLocation } from "react-router-dom";
import { useAuth } from "../../../app/providers/AuthProvider";
import { setApiFailureReporter } from "../../../shared/api/httpClient";
import { opsTelemetry } from "../telemetry/opsTelemetryClient";
import { resolveOpsTelemetryRouteContext } from "../telemetry/routeContext";

export function OpsTelemetryProvider(props: PropsWithChildren) {
  const auth = useAuth();
  const location = useLocation();
  const activeIdentityRef = useRef<number | null>(null);
  const routeContext = useMemo(
    () => resolveOpsTelemetryRouteContext(location.pathname),
    [location.pathname],
  );
  const authenticatedUserId = auth.status === "authenticated" ? auth.user?.id ?? null : null;

  useLayoutEffect(() => {
    if (auth.status === "authenticated" && authenticatedUserId != null) {
      if (activeIdentityRef.current != null && activeIdentityRef.current !== authenticatedUserId) {
        opsTelemetry.stop({ clearSessionId: true, discardQueue: true });
      }
      activeIdentityRef.current = authenticatedUserId;
      opsTelemetry.start(routeContext);
      return;
    }

    if (auth.status === "unauthenticated") {
      activeIdentityRef.current = null;
      opsTelemetry.stop({ clearSessionId: true, discardQueue: true });
    }
  }, [auth.status, authenticatedUserId]);

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
