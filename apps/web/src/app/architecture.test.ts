import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const webSrcRoot = resolve(process.cwd(), "src");

const legacyPageFiles = [
  "pages/Login.tsx",
  "pages/Branches.tsx",
  "pages/Settings.tsx",
  "pages/Thresholds.tsx",
  "pages/Users.tsx",
  "pages/Mapping.tsx",
  "pages/Dashboard.tsx",
];

const legacyComponentFiles = [
  "components/TopBar.tsx",
  "components/BranchCard.tsx",
  "components/BranchDetailDialog.tsx",
  "components/ReportDownloadDialog.tsx",
];

const bannedImportFragments = [
  "components/TopBar",
  "components/BranchCard",
  "components/BranchDetailDialog",
  "components/ReportDownloadDialog",
  "pages/Login",
  "pages/Branches",
  "pages/Settings",
  "pages/Thresholds",
  "pages/Users",
  "pages/Mapping",
  "pages/Dashboard",
];

function collectRuntimeSourceFiles(dirPath: string): string[] {
  return readdirSync(dirPath).flatMap((entry) => {
    const entryPath = resolve(dirPath, entry);
    const stats = statSync(entryPath);

    if (stats.isDirectory()) {
      return collectRuntimeSourceFiles(entryPath);
    }

    if (!/\.(ts|tsx)$/.test(entryPath) || /\.test\.(ts|tsx)$/.test(entryPath)) {
      return [];
    }

    return [entryPath];
  });
}

describe("frontend architecture guardrails", () => {
  it("removes legacy page and component entrypoints", () => {
    for (const relativePath of [...legacyPageFiles, ...legacyComponentFiles]) {
      expect(existsSync(resolve(webSrcRoot, relativePath)), `${relativePath} should not exist`).toBe(false);
    }
  });

  it("keeps runtime source free of legacy page/component imports", () => {
    const runtimeFiles = collectRuntimeSourceFiles(webSrcRoot);

    for (const filePath of runtimeFiles) {
      const source = readFileSync(filePath, "utf8");
      for (const fragment of bannedImportFragments) {
        expect(source.includes(fragment), `${filePath} still references ${fragment}`).toBe(false);
      }
    }
  });

  it("keeps /mapping as redirect-only route", () => {
    const routerSource = readFileSync(resolve(webSrcRoot, "app/router.tsx"), "utf8");

    expect(routerSource).toContain('path="/mapping"');
    expect(routerSource).toContain('<Navigate to="/branches" replace />');
    expect(routerSource).not.toContain("MappingPage");
  });
});
