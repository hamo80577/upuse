import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveDataDir, resolveDbFilePath, resolveServerRootDir } from "./paths.js";

describe("config paths", () => {
  it("resolves the default data directory relative to the server root, not cwd", () => {
    const serverRootDir = resolveServerRootDir();
    const originalCwd = process.cwd();
    const expected = path.join(serverRootDir, "data");

    try {
      process.chdir(path.dirname(serverRootDir));
      const fromParent = resolveDataDir({ env: {} });

      process.chdir(path.join(serverRootDir, "src"));
      const fromNested = resolveDataDir({ env: {} });

      expect(fromParent).toBe(expected);
      expect(fromNested).toBe(expected);
      expect(resolveDbFilePath({ env: {} })).toBe(path.join(expected, "upuse.sqlite"));
    } finally {
      process.chdir(originalCwd);
    }
  });

  it("resolves relative UPUSE_DATA_DIR values from the server root", () => {
    const serverRootDir = resolveServerRootDir();

    const dataDir = resolveDataDir({
      env: { UPUSE_DATA_DIR: "custom-data" },
      serverRootDir,
    });

    expect(dataDir).toBe(path.join(serverRootDir, "custom-data"));
    expect(resolveDbFilePath({
      env: { UPUSE_DATA_DIR: "custom-data" },
      serverRootDir,
    })).toBe(path.join(serverRootDir, "custom-data", "upuse.sqlite"));
  });
});
