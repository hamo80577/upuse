import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AUTH_UNAUTHORIZED_EVENT, requestJson } from "./httpClient";

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
});
