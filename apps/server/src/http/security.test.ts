import { describe, expect, it, vi } from "vitest";
import {
  createApiNoStoreMiddleware,
  createContentSecurityPolicyDirectives,
  createCorsOptions,
  createCspNonceMiddleware,
  createTrustedOriginMiddleware,
  CLOUDFLARE_INSIGHTS_BEACON_ORIGIN,
  CLOUDFLARE_INSIGHTS_SCRIPT_ORIGIN,
  isAllowedOrigin,
  isSameRequestOrigin,
  parseCorsOrigins,
  resolveRequestOrigin,
} from "./security.js";

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

  it("returns a CORS deny error for blocked origins in the cors delegate", () => {
    const delegate = createCorsOptions(["https://console.upuse.local"]);
    const callback = vi.fn();

    delegate({
      headers: {
        origin: "https://evil.example.com",
        host: "api.upuse.local",
      },
      protocol: "https",
      get: (name: string) => (name.toLowerCase() === "host" ? "api.upuse.local" : undefined),
      app: {
        get: () => false,
      },
    } as any, callback);

    expect(callback).toHaveBeenCalledWith(expect.any(Error), {
      origin: false,
      credentials: true,
    });
    expect((callback.mock.calls[0]?.[0] as Error).message).toBe("CORS origin not allowed");
  });

  it("resolves the request origin from forwarded production headers", () => {
    expect(resolveRequestOrigin({
      app: {
        get: () => true,
      },
      headers: {
        host: "localhost:8080",
        "x-forwarded-host": "upuse.example.com",
        "x-forwarded-proto": "https",
      },
      protocol: "http",
      get: () => undefined,
    })).toBe("https://upuse.example.com");
  });

  it("ignores spoofed forwarded headers when trust proxy is disabled", () => {
    expect(resolveRequestOrigin({
      app: {
        get: () => false,
      },
      headers: {
        host: "localhost:8080",
        "x-forwarded-host": "upuse.example.com",
        "x-forwarded-proto": "https",
      },
      protocol: "http",
      get: () => undefined,
    })).toBe("http://localhost:8080");
  });

  it("allows the real same-origin production request even without an explicit CORS allowlist", () => {
    const request = {
      app: {
        get: () => true,
      },
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

  it("blocks unsafe browser requests from an untrusted origin", () => {
    const middleware = createTrustedOriginMiddleware();
    const req: any = {
      path: "/api/auth/logout",
      method: "POST",
      headers: {
        origin: "https://evil.example.com",
        host: "upuse.example.com",
        "sec-fetch-site": "cross-site",
      },
      protocol: "https",
      get: (name: string) => (name.toLowerCase() === "host" ? "upuse.example.com" : undefined),
      app: {
        get: () => false,
      },
    };
    const res: any = {
      statusCode: 200,
      body: undefined,
      status: vi.fn((statusCode: number) => {
        res.statusCode = statusCode;
        return res;
      }),
      json: vi.fn((body: unknown) => {
        res.body = body;
        return res;
      }),
    };
    const next = vi.fn();

    middleware(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
    expect(res.body).toEqual({
      ok: false,
      message: "Cross-site API request blocked",
    });
  });

  it("allows unsafe API requests from the trusted same origin", () => {
    const middleware = createTrustedOriginMiddleware();
    const req: any = {
      path: "/api/auth/logout",
      method: "POST",
      headers: {
        origin: "https://upuse.example.com",
        host: "upuse.example.com",
        "sec-fetch-site": "same-origin",
      },
      protocol: "https",
      get: (name: string) => (name.toLowerCase() === "host" ? "upuse.example.com" : undefined),
      app: {
        get: () => false,
      },
    };
    const res: any = {
      status: vi.fn(),
      json: vi.fn(),
    };
    const next = vi.fn();

    middleware(req, res, next);

    expect(next).toHaveBeenCalledOnce();
  });

  it("allows non-browser unsafe API clients that do not send initiator headers", () => {
    const middleware = createTrustedOriginMiddleware();
    const req: any = {
      path: "/api/auth/logout",
      method: "POST",
      headers: {
        host: "upuse.example.com",
      },
      protocol: "https",
      get: (name: string) => (name.toLowerCase() === "host" ? "upuse.example.com" : undefined),
      app: {
        get: () => false,
      },
    };
    const res: any = {
      status: vi.fn(),
      json: vi.fn(),
    };
    const next = vi.fn();

    middleware(req, res, next);

    expect(next).toHaveBeenCalledOnce();
  });

  it("marks API responses as non-cacheable", () => {
    const middleware = createApiNoStoreMiddleware();
    const req: any = {
      path: "/api/dashboard",
    };
    const res: any = {
      setHeader: vi.fn(),
    };
    const next = vi.fn();

    middleware(req, res, next);

    expect(res.setHeader).toHaveBeenCalledWith("Cache-Control", "no-store");
    expect(res.setHeader).toHaveBeenCalledWith("Pragma", "no-cache");
    expect(next).toHaveBeenCalledOnce();
  });

  it("creates a per-request CSP nonce", () => {
    const middleware = createCspNonceMiddleware();
    const res: any = {
      locals: {},
    };
    const next = vi.fn();

    middleware({} as any, res, next);

    expect(typeof res.locals.cspNonce).toBe("string");
    expect(res.locals.cspNonce.length).toBeGreaterThan(10);
    expect(next).toHaveBeenCalledOnce();
  });

  it("allows Cloudflare Insights scripts with a per-request nonce", () => {
    const directives = createContentSecurityPolicyDirectives();
    const imgSrc = directives["img-src"];
    const scriptSrc = directives["script-src"];
    const connectSrc = directives["connect-src"];

    expect(imgSrc).toEqual([
      "'self'",
      "data:",
      "blob:",
      "https:",
    ]);
    expect(scriptSrc[0]).toBe("'self'");
    expect(scriptSrc[1]).toBe(CLOUDFLARE_INSIGHTS_SCRIPT_ORIGIN);
    expect(scriptSrc[2]({} as any, { locals: { cspNonce: "test-nonce" } } as any)).toBe("'nonce-test-nonce'");
    expect(connectSrc).toEqual([
      "'self'",
      CLOUDFLARE_INSIGHTS_BEACON_ORIGIN,
    ]);
  });
});
