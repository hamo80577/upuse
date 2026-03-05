import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearStoredAdminKey, getStoredAdminKey, setStoredAdminKey } from "./adminKeyStorage";

describe("adminKeyStorage", () => {
  const nowSpy = vi.spyOn(Date, "now");

  beforeEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
    nowSpy.mockReturnValue(1_700_000_000_000);
    clearStoredAdminKey();
  });

  afterEach(() => {
    nowSpy.mockRestore();
    clearStoredAdminKey();
  });

  it("migrates legacy localStorage key once to session storage", () => {
    window.localStorage.setItem("upuse.adminKey", "legacy-secret");

    const value = getStoredAdminKey();

    expect(value).toBe("legacy-secret");
    expect(window.localStorage.getItem("upuse.adminKey")).toBeNull();
    const rawSession = window.sessionStorage.getItem("upuse.adminKey.session");
    expect(rawSession).toContain("legacy-secret");
  });

  it("clears expired session keys", () => {
    window.sessionStorage.setItem(
      "upuse.adminKey.session",
      JSON.stringify({
        value: "expired-secret",
        expiresAt: 1_699_999_999_000,
      }),
    );

    expect(getStoredAdminKey()).toBe("");
    expect(window.sessionStorage.getItem("upuse.adminKey.session")).toBeNull();
  });

  it("stores and reads active key", () => {
    setStoredAdminKey("active-secret");
    expect(getStoredAdminKey()).toBe("active-secret");
  });
});
