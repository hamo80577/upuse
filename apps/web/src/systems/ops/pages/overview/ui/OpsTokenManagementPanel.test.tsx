import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SettingsTokenTestSnapshot } from "../../../../../api/types";
import type { OpsTokensResponse } from "../../../api/types";

const mockApi = vi.hoisted(() => ({
  opsTokens: vi.fn(),
  opsUpdateTokens: vi.fn(),
  opsTestTokens: vi.fn(),
  opsTokenTestSnapshot: vi.fn(),
}));
const mockOpsTrack = vi.hoisted(() => vi.fn());

vi.mock("../../../../../api/client", () => ({
  api: mockApi,
  describeApiError: (error: unknown, fallback = "Request failed") => (error instanceof Error ? error.message : fallback),
}));

vi.mock("../../../telemetry/opsTelemetryClient", () => ({
  opsTelemetry: {
    track: mockOpsTrack,
  },
}));

import { OpsTokenManagementPanel } from "./OpsTokenManagementPanel";

const tokenResponse: OpsTokensResponse = {
  ok: true,
  tokens: [
    {
      id: "upuse_orders",
      label: "UPuse Orders API",
      system: "upuse",
      description: "Order lookup, branch metrics, and cancellation-owner probes.",
      configured: true,
      mask: "orde…1234",
      updatedAt: null,
    },
    {
      id: "upuse_availability",
      label: "UPuse Availability API",
      system: "upuse",
      description: "Branch availability checks and monitor-controlled closure state.",
      configured: true,
      mask: "avai…5678",
      updatedAt: null,
    },
    {
      id: "scano_catalog",
      label: "Scano Catalog API",
      system: "scano",
      description: "Chain, branch, external product, and enrichment catalog access.",
      configured: true,
      mask: "scan…9999",
      updatedAt: "2026-04-16T09:00:00.000Z",
    },
  ],
};

const testSnapshot: SettingsTokenTestSnapshot = {
  jobId: "11111111-1111-4111-8111-111111111111",
  status: "completed",
  createdAt: "2026-04-16T10:00:00.000Z",
  startedAt: "2026-04-16T10:00:01.000Z",
  completedAt: "2026-04-16T10:00:02.000Z",
  progress: {
    totalBranches: 0,
    processedBranches: 0,
    passedBranches: 0,
    failedBranches: 0,
    percent: 100,
  },
  availability: {
    configured: true,
    ok: true,
    status: 200,
    message: "Availability token is valid.",
  },
  orders: {
    configValid: true,
    ok: true,
    enabledBranchCount: 0,
    passedBranchCount: 0,
    failedBranchCount: 0,
    branches: [],
  },
};

describe("OpsTokenManagementPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApi.opsTokens.mockResolvedValue(tokenResponse);
    mockApi.opsUpdateTokens.mockResolvedValue(tokenResponse);
    mockApi.opsTestTokens.mockResolvedValue({
      ok: true,
      upuse: {
        ok: true,
        jobId: testSnapshot.jobId,
        snapshot: testSnapshot,
      },
      scano: {
        ok: true,
        message: "Scano catalog token is valid.",
        baseUrl: "https://catalog.example.test",
      },
    });
  });

  it("loads masked token status without rendering raw stored secrets", async () => {
    render(<OpsTokenManagementPanel />);

    expect(await screen.findByText("Token Management")).toBeInTheDocument();
    expect(screen.getByText("UPuse Orders API")).toBeInTheDocument();
    expect(screen.getByText("orde…1234")).toBeInTheDocument();
    expect(screen.getByText("UPuse Availability API")).toBeInTheDocument();
    expect(screen.getByText("avai…5678")).toBeInTheDocument();
    expect(screen.getByText("Scano Catalog API")).toBeInTheDocument();
    expect(screen.getByText("scan…9999")).toBeInTheDocument();
    expect(screen.queryByText("orders-token-secret-value")).not.toBeInTheDocument();
    expect(screen.queryByText("availability-token-secret-value")).not.toBeInTheDocument();
    expect(screen.queryByText("scano-token-secret-value")).not.toBeInTheDocument();
  });

  it("saves only explicitly entered replacement token values", async () => {
    render(<OpsTokenManagementPanel />);

    await screen.findByText("UPuse Orders API");
    fireEvent.change(screen.getByLabelText("New UPuse Orders API token"), {
      target: { value: "new-orders-token-secret" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));

    await waitFor(() => {
      expect(mockApi.opsUpdateTokens).toHaveBeenCalledWith({
        upuseOrdersToken: "new-orders-token-secret",
      });
    });
    expect(await screen.findByText("Token settings saved.")).toBeInTheDocument();
    expect(screen.queryByDisplayValue("new-orders-token-secret")).not.toBeInTheDocument();
  });

  it("tests draft tokens while keeping telemetry metadata free of raw token values", async () => {
    render(<OpsTokenManagementPanel />);

    await screen.findByText("Scano Catalog API");
    fireEvent.change(screen.getByLabelText("New UPuse Orders API token"), {
      target: { value: "draft-orders-token-secret" },
    });
    fireEvent.change(screen.getByLabelText("New Scano Catalog API token"), {
      target: { value: "draft-scano-token-secret" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Test Tokens" }));

    await waitFor(() => {
      expect(mockApi.opsTestTokens).toHaveBeenCalledWith({
        upuseOrdersToken: "draft-orders-token-secret",
        scanoCatalogToken: "draft-scano-token-secret",
        targets: ["upuse", "scano"],
      });
    });
    expect(await screen.findByText("Scano Catalog: Scano catalog token is valid.")).toBeInTheDocument();
    expect(screen.getByText(/Token Test Job: completed/)).toBeInTheDocument();
    expect(mockOpsTrack).toHaveBeenCalledWith("token_test_started", {
      metadata: {
        source: "ops",
        hasUpuseOrdersToken: true,
        hasUpuseAvailabilityToken: false,
        hasScanoCatalogToken: true,
      },
    });
    expect(JSON.stringify(mockOpsTrack.mock.calls)).not.toContain("draft-orders-token-secret");
    expect(JSON.stringify(mockOpsTrack.mock.calls)).not.toContain("draft-scano-token-secret");
  });
});
