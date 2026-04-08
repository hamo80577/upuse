import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AUTH_FORBIDDEN_EVENT, AUTH_UNAUTHORIZED_EVENT, requestJson } from "./httpClient";

describe("httpClient", () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends same-origin credentials by default so httpOnly cookies can flow to the api", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    await requestJson<{ ok: boolean }>("/api/auth/me");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit | undefined];
    expect(init?.credentials).toBe("same-origin");
  });

  it("dispatches an unauthorized event for expired protected sessions", async () => {
    const unauthorizedListener = vi.fn();
    window.addEventListener(AUTH_UNAUTHORIZED_EVENT, unauthorizedListener);

    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ message: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      }),
    );

    await expect(requestJson<{ ok: boolean }>("/api/auth/me")).rejects.toThrow("Unauthorized");

    expect(unauthorizedListener).toHaveBeenCalledTimes(1);
    window.removeEventListener(AUTH_UNAUTHORIZED_EVENT, unauthorizedListener);
  });

  it("does not broadcast the unauthorized event for business-api 401 responses when the auth recheck succeeds", async () => {
    const unauthorizedListener = vi.fn();
    window.addEventListener(AUTH_UNAUTHORIZED_EVENT, unauthorizedListener);

    fetchMock
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ message: "Scano catalog token is invalid." }), {
          status: 401,
          headers: { "Content-Type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true, user: { id: 1 } }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );

    await expect(requestJson<{ ok: boolean }>("/api/scano/settings/test")).rejects.toThrow("Scano catalog token is invalid.");

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1]?.[0]).toBe("/api/auth/me");
    expect(unauthorizedListener).not.toHaveBeenCalled();
    window.removeEventListener(AUTH_UNAUTHORIZED_EVENT, unauthorizedListener);
  });

  it("dispatches a single unauthorized event only after a business-api 401 recheck confirms the session expired", async () => {
    const unauthorizedListener = vi.fn();
    window.addEventListener(AUTH_UNAUTHORIZED_EVENT, unauthorizedListener);

    fetchMock
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ message: "Unauthorized" }), {
          status: 401,
          headers: { "Content-Type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ message: "Unauthorized" }), {
          status: 401,
          headers: { "Content-Type": "application/json" },
        }),
      );

    await expect(requestJson<{ ok: boolean }>("/api/scano/chains")).rejects.toThrow("Unauthorized");

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1]?.[0]).toBe("/api/auth/me");
    expect(unauthorizedListener).toHaveBeenCalledTimes(1);
    window.removeEventListener(AUTH_UNAUTHORIZED_EVENT, unauthorizedListener);
  });

  it("reuses a single in-flight auth recheck for concurrent business-api 401 responses", async () => {
    const unauthorizedListener = vi.fn();
    window.addEventListener(AUTH_UNAUTHORIZED_EVENT, unauthorizedListener);

    fetchMock.mockImplementation(async (url: string | URL | Request) => {
      const nextUrl = typeof url === "string" ? url : url instanceof URL ? url.toString() : url.url;
      if (nextUrl === "/api/auth/me") {
        return new Response(JSON.stringify({ message: "Unauthorized" }), {
          status: 401,
          headers: { "Content-Type": "application/json" },
        });
      }

      return new Response(JSON.stringify({ message: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    });

    await Promise.allSettled([
      requestJson<{ ok: boolean }>("/api/scano/chains"),
      requestJson<{ ok: boolean }>("/api/scano/branches?chainId=1"),
    ]);

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls.filter(([url]) => url === "/api/auth/me")).toHaveLength(1);
    expect(unauthorizedListener).toHaveBeenCalledTimes(1);
    window.removeEventListener(AUTH_UNAUTHORIZED_EVENT, unauthorizedListener);
  });

  it("does not broadcast the unauthorized event for a normal login failure", async () => {
    const unauthorizedListener = vi.fn();
    window.addEventListener(AUTH_UNAUTHORIZED_EVENT, unauthorizedListener);

    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ message: "Invalid email or password" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      }),
    );

    await expect(
      requestJson<{ ok: boolean }>("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "admin@example.com", password: "wrong" }),
      }),
    ).rejects.toThrow("Invalid email or password");

    expect(unauthorizedListener).not.toHaveBeenCalled();
    window.removeEventListener(AUTH_UNAUTHORIZED_EVENT, unauthorizedListener);
  });

  it("dispatches a forbidden event for admin-only user management requests", async () => {
    const forbiddenListener = vi.fn();
    window.addEventListener(AUTH_FORBIDDEN_EVENT, forbiddenListener);

    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ message: "Forbidden" }), {
        status: 403,
        headers: { "Content-Type": "application/json" },
      }),
    );

    await expect(requestJson<{ ok: boolean }>("/api/auth/users")).rejects.toThrow("Forbidden");

    expect(forbiddenListener).toHaveBeenCalledTimes(1);
    window.removeEventListener(AUTH_FORBIDDEN_EVENT, forbiddenListener);
  });

  it("does not dispatch a forbidden event for non-admin routes", async () => {
    const forbiddenListener = vi.fn();
    window.addEventListener(AUTH_FORBIDDEN_EVENT, forbiddenListener);

    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ message: "Forbidden" }), {
        status: 403,
        headers: { "Content-Type": "application/json" },
      }),
    );

    await expect(requestJson<{ ok: boolean }>("/api/settings")).rejects.toThrow("Forbidden");

    expect(forbiddenListener).not.toHaveBeenCalled();
    window.removeEventListener(AUTH_FORBIDDEN_EVENT, forbiddenListener);
  });

  it("converts html error pages into a friendly tunnel message", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        "<!doctype html><html><head><title>Cloudflare Tunnel error | upuse.org | Cloudflare</title></head><body>offline</body></html>",
        {
          status: 530,
          headers: { "Content-Type": "text/html" },
        },
      ),
    );

    await expect(requestJson<{ ok: boolean }>("/api/dashboard")).rejects.toThrow(
      "Cloudflare tunnel is temporarily unavailable. Please try again in a moment.",
    );
  });

  it("converts successful html payloads into a friendly api error", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        "<!doctype html><html><head><title>Cloudflare Tunnel error | upuse.org | Cloudflare</title></head><body>offline</body></html>",
        {
          status: 200,
          headers: { "Content-Type": "text/html" },
        },
      ),
    );

    await expect(requestJson<{ ok: boolean }>("/api/dashboard")).rejects.toThrow(
      "Cloudflare tunnel is temporarily unavailable. Please try again in a moment.",
    );
  });
});
