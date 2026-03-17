import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  prepareRuntimeDataDir,
  resolveRuntimeDataDir,
  resolveRuntimeDbFilePath,
  RUNTIME_DATABASE_FILE_NAME,
} from "./runtimeData.js";

const tempDirs: string[] = [];

function createTempWorkspace() {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "upuse-runtime-data-"));
  tempDirs.push(rootDir);
  fs.mkdirSync(path.join(rootDir, "apps", "server"), { recursive: true });
  return {
    workspaceRootDir: rootDir,
    serverRootDir: path.join(rootDir, "apps", "server"),
  };
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const tempDir = tempDirs.pop();
    if (tempDir) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  }
});

describe("runtime data", () => {
  it("resolves the development default data directory outside git-tracked paths and not from cwd", () => {
    const { workspaceRootDir, serverRootDir } = createTempWorkspace();
    const originalCwd = process.cwd();

    try {
      process.chdir(os.tmpdir());
      expect(resolveRuntimeDataDir({ env: {}, serverRootDir })).toBe(path.join(workspaceRootDir, ".upuse-data"));
      expect(resolveRuntimeDbFilePath({ env: {}, serverRootDir })).toBe(
        path.join(workspaceRootDir, ".upuse-data", RUNTIME_DATABASE_FILE_NAME),
      );
    } finally {
      process.chdir(originalCwd);
    }
  });

  it("resolves relative UPUSE_DATA_DIR values from the server root", () => {
    const { serverRootDir } = createTempWorkspace();

    expect(resolveRuntimeDataDir({
      env: { UPUSE_DATA_DIR: "custom-data" },
      serverRootDir,
    })).toBe(path.join(serverRootDir, "custom-data"));
  });

  it("uses an external OS data directory by default in production", () => {
    const { workspaceRootDir, serverRootDir } = createTempWorkspace();
    const env =
      process.platform === "win32"
        ? { NODE_ENV: "production", LOCALAPPDATA: path.join(os.tmpdir(), "upuse-local-appdata") }
        : process.platform === "darwin"
          ? { NODE_ENV: "production" }
          : { NODE_ENV: "production", XDG_DATA_HOME: path.join(os.tmpdir(), "upuse-xdg-data") };
    const resolved = resolveRuntimeDataDir({
      env,
      serverRootDir,
      homeDir: path.join(os.tmpdir(), "upuse-home"),
      platform: process.platform,
    });

    expect(resolved).not.toBe(path.join(workspaceRootDir, ".upuse-data"));
    expect(path.relative(workspaceRootDir, resolved).startsWith(`..${path.sep}`) || path.relative(workspaceRootDir, resolved) === "..").toBe(true);
  });

  it("fails fast in production when the resolved runtime data directory is inside the repo checkout", () => {
    const { serverRootDir } = createTempWorkspace();

    expect(() => prepareRuntimeDataDir({
      env: {
        NODE_ENV: "production",
        UPUSE_DATA_DIR: "data",
      },
      serverRootDir,
      log: vi.fn(),
      warn: vi.fn(),
    })).toThrow(/unsafe in production/i);
  });

  it("migrates legacy repo-local runtime data once without overwriting the target", () => {
    const { workspaceRootDir, serverRootDir } = createTempWorkspace();
    const legacyDir = path.join(serverRootDir, "data");
    const targetDir = path.join(workspaceRootDir, ".upuse-data");
    const legacyDbPath = path.join(legacyDir, RUNTIME_DATABASE_FILE_NAME);
    const targetDbPath = path.join(targetDir, RUNTIME_DATABASE_FILE_NAME);
    const log = vi.fn();
    const warn = vi.fn();

    fs.mkdirSync(legacyDir, { recursive: true });
    fs.writeFileSync(legacyDbPath, "legacy-db", "utf8");
    fs.writeFileSync(path.join(legacyDir, `${RUNTIME_DATABASE_FILE_NAME}-wal`), "legacy-wal", "utf8");
    fs.writeFileSync(path.join(legacyDir, `${RUNTIME_DATABASE_FILE_NAME}-shm`), "legacy-shm", "utf8");
    fs.writeFileSync(path.join(legacyDir, ".dev-secret"), "legacy-secret\n", "utf8");

    const first = prepareRuntimeDataDir({
      env: {},
      serverRootDir,
      log,
      warn,
    });

    expect(first.dataDir).toBe(targetDir);
    expect(first.migratedFrom).toBe(legacyDir);
    expect(fs.readFileSync(targetDbPath, "utf8")).toBe("legacy-db");
    expect(fs.readFileSync(path.join(targetDir, `${RUNTIME_DATABASE_FILE_NAME}-wal`), "utf8")).toBe("legacy-wal");
    expect(fs.readFileSync(path.join(targetDir, `${RUNTIME_DATABASE_FILE_NAME}-shm`), "utf8")).toBe("legacy-shm");
    expect(fs.readFileSync(path.join(targetDir, ".dev-secret"), "utf8")).toBe("legacy-secret\n");
    expect(fs.readFileSync(legacyDbPath, "utf8")).toBe("legacy-db");

    fs.writeFileSync(targetDbPath, "target-db", "utf8");
    fs.writeFileSync(legacyDbPath, "changed-legacy-db", "utf8");

    const second = prepareRuntimeDataDir({
      env: {},
      serverRootDir,
      log,
      warn,
    });

    expect(second.migratedFrom).toBeNull();
    expect(fs.readFileSync(targetDbPath, "utf8")).toBe("target-db");
    expect(warn).not.toHaveBeenCalled();
  });
});
