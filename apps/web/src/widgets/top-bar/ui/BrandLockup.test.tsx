import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { BrandLockup } from "./BrandLockup";

describe("BrandLockup", () => {
  it("prioritizes the auth logo for the login page", () => {
    render(<BrandLockup variant="auth" />);

    expect(screen.getByAltText("UPuse")).toHaveAttribute("fetchpriority", "high");
  });

  it("does not mark the topbar logo as high priority", () => {
    render(<BrandLockup />);

    expect(screen.getByAltText("UPuse")).not.toHaveAttribute("fetchpriority");
  });
});
