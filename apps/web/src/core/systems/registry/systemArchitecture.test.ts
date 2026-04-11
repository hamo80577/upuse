import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function readSource(relativePath: string) {
  return fs.readFileSync(path.join(process.cwd(), "src", relativePath), "utf8");
}

describe("web system architecture boundaries", () => {
  it("keeps shared endpoint composition free of system-owned API imports", () => {
    const source = readSource("shared/api/endpoints.ts");

    expect(source).not.toContain("systems/upuse");
    expect(source).not.toContain("systems/scano");
  });

  it("keeps the shared top bar driven by system manifests instead of workspace literals", () => {
    const source = readSource("app/shell/TopBar.tsx");

    expect(source).not.toContain('"upuse"');
    expect(source).not.toContain('"scano"');
    expect(source).toContain("system.switcher");
    expect(source).toContain("getAccountNavigation");
  });

  it("uses generic capability route guards instead of UPuse-specific app guards", () => {
    const source = readSource("app/router/guards.tsx");

    expect(source).toContain("CapabilityRoute");
    expect(source).not.toContain("UpuseAdminRoute");
  });
});
