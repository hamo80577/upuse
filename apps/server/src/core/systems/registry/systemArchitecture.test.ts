import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

function readSource(relativePath: string) {
  return fs.readFileSync(fileURLToPath(new URL(`../../../${relativePath}`, import.meta.url)), "utf8");
}

describe("server system architecture boundaries", () => {
  it("keeps shared session auth free of direct UPuse and Scano policy imports", () => {
    const source = readSource("shared/http/auth/sessionAuth.ts");

    expect(source).not.toContain("systems/upuse");
    expect(source).not.toContain("systems/scano");
    expect(source).not.toContain("accessRegistry");
    expect(source).toContain("core/systems/auth/registry");
    expect(source).toContain("authorizeSystemUpgradeFromCookieHeader");
  });

  it("registers Ops as a first-class server system", () => {
    const source = readSource("core/systems/registry/index.ts");

    expect(source).toContain("opsSystemModule");
  });

  it("composes DB migration through registered system DB modules", () => {
    const source = readSource("shared/db/migrate.ts");

    expect(source).toContain("getServerSystems");
    expect(source).not.toContain("systems/scano/db");
  });

  it("keeps the legacy orders mirror service as a pure compatibility barrel", () => {
    const source = readSource("services/ordersMirrorStore.ts").trim();

    expect(source).toBe('export * from "../systems/upuse/services/orders-mirror/index.js";');
  });

  it("keeps the orders mirror runtime and public barrel split from orchestration internals", () => {
    const runtimeSource = readSource("systems/upuse/services/orders-mirror/runtime.ts");
    const indexSource = readSource("systems/upuse/services/orders-mirror/index.ts");

    expect(runtimeSource).not.toContain('./index.js');
    expect(runtimeSource).toContain('./syncOrchestrator.js');
    expect(indexSource).toContain('./syncOrchestrator.js');
    expect(indexSource).not.toContain("db.prepare");
    expect(indexSource).not.toContain("getWithRetry");
  });
});
