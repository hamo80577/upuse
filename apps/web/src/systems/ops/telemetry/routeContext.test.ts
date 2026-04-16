import { describe, expect, it } from "vitest";
import { resolveOpsTelemetryRouteContext } from "./routeContext";

describe("resolveOpsTelemetryRouteContext", () => {
  it("resolves known systems and route patterns without query values", () => {
    expect(resolveOpsTelemetryRouteContext("/performance?token=secret")).toMatchObject({
      system: "upuse",
      path: "/performance",
      routePattern: "/performance",
    });
    expect(resolveOpsTelemetryRouteContext("/scano/tasks/42/run")).toMatchObject({
      system: "scano",
      routePattern: "/scano/tasks/:id/run",
    });
    expect(resolveOpsTelemetryRouteContext("/ops")).toMatchObject({
      system: "ops",
      routePattern: "/ops",
    });
  });
});
