import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, useNavigate } from "react-router-dom";
import { setApiFailureReporter } from "../../../shared/api/httpClient";

const authState = vi.hoisted(() => ({
  current: {
    status: "authenticated" as "authenticated" | "unauthenticated" | "loading",
    user: { id: 1 } as { id: number } | null,
  },
}));

const telemetryMocks = vi.hoisted(() => ({
  start: vi.fn(),
  stop: vi.fn(),
  setRouteContext: vi.fn(),
  captureApiFailure: vi.fn(),
}));

vi.mock("../../../app/providers/AuthProvider", () => ({
  useAuth: () => authState.current,
}));

vi.mock("../telemetry/opsTelemetryClient", () => ({
  opsTelemetry: telemetryMocks,
}));

import { OpsTelemetryProvider } from "./OpsTelemetryProvider";

function RouteChanger() {
  const navigate = useNavigate();
  return <button onClick={() => navigate("/scano/assign-task")}>Go</button>;
}

describe("OpsTelemetryProvider", () => {
  afterEach(() => {
    authState.current = {
      status: "authenticated",
      user: { id: 1 },
    };
    setApiFailureReporter(null);
    vi.clearAllMocks();
  });

  it("starts telemetry for authenticated sessions and updates route context on navigation", () => {
    render(
      <MemoryRouter initialEntries={["/"]}>
        <OpsTelemetryProvider>
          <RouteChanger />
        </OpsTelemetryProvider>
      </MemoryRouter>,
    );

    expect(telemetryMocks.start).toHaveBeenCalledWith(expect.objectContaining({
      system: "upuse",
      path: "/",
    }));

    fireEvent.click(screen.getByRole("button", { name: "Go" }));

    expect(telemetryMocks.setRouteContext).toHaveBeenCalledWith(expect.objectContaining({
      system: "scano",
      path: "/scano/assign-task",
    }));
  });

  it("stops telemetry when auth is not authenticated", () => {
    authState.current = {
      status: "unauthenticated",
      user: null,
    };

    render(
      <MemoryRouter initialEntries={["/"]}>
        <OpsTelemetryProvider>
          <div>Screen</div>
        </OpsTelemetryProvider>
      </MemoryRouter>,
    );

    expect(telemetryMocks.start).not.toHaveBeenCalled();
    expect(telemetryMocks.stop).toHaveBeenCalledWith({
      clearSessionId: true,
      discardQueue: true,
    });
  });

  it("rotates telemetry when the authenticated user identity changes in the same tab", () => {
    const view = render(
      <MemoryRouter initialEntries={["/"]}>
        <OpsTelemetryProvider>
          <div>Screen</div>
        </OpsTelemetryProvider>
      </MemoryRouter>,
    );
    expect(telemetryMocks.start).toHaveBeenCalledTimes(1);

    authState.current = {
      status: "authenticated",
      user: { id: 2 },
    };
    view.rerender(
      <MemoryRouter initialEntries={["/"]}>
        <OpsTelemetryProvider>
          <div>Screen</div>
        </OpsTelemetryProvider>
      </MemoryRouter>,
    );

    expect(telemetryMocks.stop).toHaveBeenCalledWith({
      clearSessionId: true,
      discardQueue: true,
    });
    expect(telemetryMocks.start).toHaveBeenCalledTimes(2);
  });
});
