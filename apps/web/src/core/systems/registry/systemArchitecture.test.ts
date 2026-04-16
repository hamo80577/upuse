import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function readSource(relativePath: string) {
  return fs.readFileSync(path.join(process.cwd(), "src", relativePath), "utf8");
}

describe("web system architecture boundaries", () => {
  it("keeps shared auth types and provider capability-driven instead of legacy system flags", () => {
    const typesSource = readSource("core/systems/types.ts");
    const authProviderSource = readSource("app/providers/AuthProvider.tsx");

    expect(typesSource).not.toContain("resolveLegacyAuth");
    expect(typesSource).not.toContain("canAccessUpuse");
    expect(typesSource).not.toContain("canManageScanoTasks");
    expect(authProviderSource).not.toContain("legacyAuth");
    expect(authProviderSource).not.toContain("canAccessUpuse");
    expect(authProviderSource).toContain("createSystemAccessHelpers");
  });

  it("registers Ops as a first-class web system", () => {
    const source = readSource("core/systems/registry/index.ts");

    expect(source).toContain("opsSystemModule");
  });

  it("keeps shared HTTP helpers free of system-owned API imports", () => {
    const source = readSource("shared/api/httpClient.ts");

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

  it("keeps the Scano task runner experience focused on composition instead of direct API orchestration", () => {
    const source = readSource("systems/scano/features/task-runner/ui/ScanoTaskRunnerExperience.tsx");

    expect(source).not.toContain('from "../../../api/client"');
    expect(source).toContain("useScanoTaskRunnerProductFlow");
    expect(source).toContain("useScanoTaskRunnerLifecycle");
    expect(source).toContain("useScanoTaskRunnerDerivedState");
  });
});
