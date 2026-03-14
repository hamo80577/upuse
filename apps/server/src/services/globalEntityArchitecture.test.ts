import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const serverSrcDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRootDir = path.resolve(serverSrcDir, "..", "..", "..");
const webSrcDir = path.join(repoRootDir, "apps", "web", "src");
const removedConstantNames = [
  ["FIXED", "GLOBAL", "ENTITY", "ID"].join("_"),
  ["DEFAULT", "GLOBAL", "ENTITY", "ID"].join("_"),
].join("|");
const fixedEntityPattern = new RegExp(
  String.raw`\b(${removedConstantNames})\b|["']HF_[A-Z0-9_]+["']`,
);

function collectRuntimeSourceFiles(dir: string): string[] {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectRuntimeSourceFiles(fullPath));
      continue;
    }
    if (!entry.isFile()) continue;
    if (!fullPath.endsWith(".ts") && !fullPath.endsWith(".tsx")) continue;
    if (fullPath.endsWith(".test.ts") || fullPath.endsWith(".test.tsx")) continue;
    files.push(fullPath);
  }

  return files;
}

describe("globalEntityId runtime architecture", () => {
  it("ordersMirrorStore no longer contains a fixed global entity fallback", () => {
    const source = fs.readFileSync(fileURLToPath(new URL("./ordersMirrorStore.ts", import.meta.url)), "utf8");

    expect(source).not.toMatch(fixedEntityPattern);
  });

  it("runtime server and web sources do not retain fixed global entity constants or literals", () => {
    const runtimeFiles = [
      ...collectRuntimeSourceFiles(serverSrcDir),
      ...collectRuntimeSourceFiles(webSrcDir),
    ];

    for (const filePath of runtimeFiles) {
      const source = fs.readFileSync(filePath, "utf8");
      expect(source, path.relative(repoRootDir, filePath)).not.toMatch(fixedEntityPattern);
    }
  });
});
