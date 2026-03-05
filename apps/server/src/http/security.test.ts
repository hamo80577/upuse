import { afterEach, describe, expect, it, vi } from "vitest";
import { createApiAccessMiddleware } from "./security.js";

function createMockRequest(params: {
  path: string;
  method?: string;
  authorization?: string;
}) {
  return {
    path: params.path,
    method: params.method ?? "GET",
    header(name: string) {
      if (name.toLowerCase() === "authorization") {
        return params.authorization;
      }

      return undefined;
    },
  };
}

function createMockResponse() {
  return {
    statusCode: 200,
    payload: null as unknown,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.payload = payload;
      return this;
    },
  };
}

describe("security.createApiAccessMiddleware", () => {
  const originalAdminKey = process.env.UPUSE_ADMIN_KEY;

  afterEach(() => {
    if (originalAdminKey === undefined) {
      delete process.env.UPUSE_ADMIN_KEY;
      return;
    }

    process.env.UPUSE_ADMIN_KEY = originalAdminKey;
  });

  it("keeps /api/health unprotected when an admin key is set", () => {
    process.env.UPUSE_ADMIN_KEY = "audit-key";
    const middleware = createApiAccessMiddleware();
    const next = vi.fn();

    middleware(
      createMockRequest({ path: "/api/health" }) as any,
      createMockResponse() as any,
      next,
    );

    expect(next).toHaveBeenCalledOnce();
  });

  it("protects /api/stream when an admin key is set", () => {
    process.env.UPUSE_ADMIN_KEY = "audit-key";
    const middleware = createApiAccessMiddleware();
    const next = vi.fn();
    const res = createMockResponse();

    middleware(
      createMockRequest({ path: "/api/stream" }) as any,
      res as any,
      next,
    );

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(401);
    expect(res.payload).toEqual({
      ok: false,
      message: "Unauthorized",
    });
  });

  it("accepts protected requests with the correct bearer token", () => {
    process.env.UPUSE_ADMIN_KEY = "audit-key";
    const middleware = createApiAccessMiddleware();
    const next = vi.fn();

    middleware(
      createMockRequest({
        path: "/api/dashboard",
        authorization: "Bearer audit-key",
      }) as any,
      createMockResponse() as any,
      next,
    );

    expect(next).toHaveBeenCalledOnce();
  });
});
