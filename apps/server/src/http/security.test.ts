import { describe, expect, it } from "vitest";
import { isAllowedOrigin, parseCorsOrigins } from "./security.js";

describe("security helpers", () => {
  it("parses unique configured CORS origins", () => {
    expect(parseCorsOrigins(" https://a.test , https://b.test, https://a.test ")).toEqual([
      "https://a.test",
      "https://b.test",
    ]);
  });

  it("allows localhost origins by default", () => {
    expect(isAllowedOrigin("http://localhost:5173", [])).toBe(true);
    expect(isAllowedOrigin("http://127.0.0.1:3000", [])).toBe(true);
  });

  it("blocks non-local origins when no explicit allowlist exists", () => {
    expect(isAllowedOrigin("https://example.com", [])).toBe(false);
  });

  it("uses the explicit allowlist when provided", () => {
    expect(isAllowedOrigin("https://console.upuse.local", ["https://console.upuse.local"])).toBe(true);
    expect(isAllowedOrigin("https://other.upuse.local", ["https://console.upuse.local"])).toBe(false);
  });
});
