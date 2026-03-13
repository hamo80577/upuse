import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  resolveDataDir,
  resolveDbFilePath,
  resolveServerRootDir,
  resolveVendorCatalogCsvPath,
  resolveWebDistDir,
  resolveWorkspaceRootDir,
} from "./paths.js";

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

  it("resolves the web dist directory relative to the workspace, not cwd", () => {
    const serverRootDir = resolveServerRootDir();
    const workspaceRootDir = resolveWorkspaceRootDir(serverRootDir);
    const expected = path.join(workspaceRootDir, "apps", "web", "dist");
    const originalCwd = process.cwd();

    try {
      process.chdir(path.join(serverRootDir, "src"));
      expect(resolveWebDistDir()).toBe(expected);

      process.chdir(path.dirname(workspaceRootDir));
      expect(resolveWebDistDir()).toBe(expected);
    } finally {
      process.chdir(originalCwd);
    }
  });

  it("resolves the vendor catalog CSV relative to the workspace root by default", () => {
    const serverRootDir = resolveServerRootDir();
    const workspaceRootDir = resolveWorkspaceRootDir(serverRootDir);

    expect(resolveVendorCatalogCsvPath({ env: {}, serverRootDir })).toBe(path.join(workspaceRootDir, "vendors.csv"));
  });

  it("resolves relative UPUSE_VENDOR_CATALOG_CSV_PATH values from the workspace root", () => {
    const serverRootDir = resolveServerRootDir();
    const workspaceRootDir = resolveWorkspaceRootDir(serverRootDir);

    expect(resolveVendorCatalogCsvPath({
      env: { UPUSE_VENDOR_CATALOG_CSV_PATH: "config/vendors/prod.csv" },
      serverRootDir,
    })).toBe(path.join(workspaceRootDir, "config", "vendors", "prod.csv"));
  });
});
