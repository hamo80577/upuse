import { describe, expect, it } from "vitest";
import { isAllowedOrigin, isSameRequestOrigin, parseCorsOrigins, resolveRequestOrigin } from "./security.js";

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

  it("resolves the request origin from forwarded production headers", () => {
    expect(resolveRequestOrigin({
      headers: {
        host: "localhost:8080",
        "x-forwarded-host": "upuse.example.com",
        "x-forwarded-proto": "https",
      },
      protocol: "http",
      get: () => undefined,
    })).toBe("https://upuse.example.com");
  });

  it("allows the real same-origin production request even without an explicit CORS allowlist", () => {
    const request = {
      headers: {
        origin: "https://upuse.example.com",
        host: "upuse.example.com",
        "x-forwarded-proto": "https",
      },
      protocol: "http",
      get: (name: string) => (name.toLowerCase() === "host" ? "upuse.example.com" : undefined),
    };

    expect(isAllowedOrigin("https://upuse.example.com", [])).toBe(false);
    expect(isSameRequestOrigin("https://upuse.example.com", request)).toBe(true);
    expect(isSameRequestOrigin("https://other.example.com", request)).toBe(false);
  });
});
