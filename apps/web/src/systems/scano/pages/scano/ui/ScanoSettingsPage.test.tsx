import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ScanoSettingsPage } from "./ScanoSettingsPage";

const {
  mockGetScanoSettings,
  mockPutScanoSettings,
  mockTestScanoSettings,
} = vi.hoisted(() => ({
  mockGetScanoSettings: vi.fn(),
  mockPutScanoSettings: vi.fn(),
  mockTestScanoSettings: vi.fn(),
}));

vi.mock("../../../widgets/top-bar/ui/TopBar", () => ({
  TopBar: () => <div>top-bar</div>,
}));

vi.mock("../../../api/client", () => ({
  describeApiError: (error: unknown, fallback: string) => {
    if (error instanceof Error && error.message) return error.message;
    return fallback;
  },
  api: {
    getScanoSettings: mockGetScanoSettings,
    putScanoSettings: mockPutScanoSettings,
    testScanoSettings: mockTestScanoSettings,
  },
}));

describe("ScanoSettingsPage", () => {
  beforeEach(() => {
    mockGetScanoSettings.mockResolvedValue({
      catalogBaseUrl: "https://catalog.example.com",
      catalogToken: "test…oken",
      updatedAt: "2026-04-04T10:00:00.000Z",
    });
    mockPutScanoSettings.mockResolvedValue({
      ok: true,
      settings: {
        catalogBaseUrl: "https://catalog.next.example.com",
        catalogToken: "next…alue",
        updatedAt: "2026-04-04T10:15:00.000Z",
      },
    });
    mockTestScanoSettings.mockResolvedValue({
      ok: true,
      message: "Scano catalog token is valid.",
      baseUrl: "https://catalog.next.example.com",
    });
  });

  it("loads the current settings and saves a rotated token", async () => {
    render(<ScanoSettingsPage />);

    expect(await screen.findByLabelText("Catalog Token")).toBeInTheDocument();
    expect(screen.queryByText("Scano Settings")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Catalog Base URL")).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Catalog Token"), {
      target: { value: "next-token-value" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save Token" }));

    await waitFor(() => {
      expect(mockPutScanoSettings).toHaveBeenCalledWith({
        catalogToken: "next-token-value",
      });
    });
    expect(screen.getByLabelText("Catalog Token")).toHaveValue("");
  });

  it("tests the current Scano token using the typed token when provided", async () => {
    render(<ScanoSettingsPage />);

    expect(await screen.findByLabelText("Catalog Token")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Catalog Token"), {
      target: { value: "next-token-value" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Test Token" }));

    await waitFor(() => {
      expect(mockTestScanoSettings).toHaveBeenCalledWith({
        catalogToken: "next-token-value",
      });
    });
    expect(await screen.findByText("Scano catalog token is valid.")).toBeInTheDocument();
  });
});
