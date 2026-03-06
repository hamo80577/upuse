import { render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MonitorStatusProvider, useMonitorStatus } from "./MonitorStatusProvider";

const mockApi = vi.hoisted(() => ({
  dashboard: vi.fn(),
  monitorStart: vi.fn(),
  monitorStatus: vi.fn(),
  monitorStop: vi.fn(),
}));

vi.mock("../../api/client", () => ({
  api: mockApi,
}));

function Probe() {
  const { monitoring } = useMonitorStatus();
  return <div>{monitoring.running ? "running" : "stopped"}</div>;
}

describe("MonitorStatusProvider", () => {
  beforeEach(() => {
    mockApi.dashboard.mockReset();
    mockApi.monitorStart.mockReset();
    mockApi.monitorStatus.mockReset();
    mockApi.monitorStop.mockReset();

    mockApi.monitorStatus.mockResolvedValue({
      running: true,
      degraded: false,
    });
  });

  it("boots from monitor status without fetching the full dashboard snapshot", async () => {
    render(
      <MonitorStatusProvider>
        <Probe />
      </MonitorStatusProvider>,
    );

    await waitFor(() => {
      expect(mockApi.monitorStatus).toHaveBeenCalled();
    });

    expect(mockApi.dashboard).not.toHaveBeenCalled();
  });
});
