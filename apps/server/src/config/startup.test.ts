import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveStartupConfig } from "./startup.js";

describe("startup config", () => {
  it("does not sync the vendor catalog on startup unless explicitly enabled", () => {
    expect(resolveStartupConfig({
      env: { NODE_ENV: "production", UPUSE_SECRET: "production-secret" },
      serverRootDir: "/srv/upuse/apps/server",
    })).toEqual({
      syncVendorCatalogOnStartup: false,
      vendorCatalogCsvPath: null,
    });
  });

  it("rejects invalid startup sync flag values", () => {
    expect(() =>
      resolveStartupConfig({
        env: {
          NODE_ENV: "development",
          UPUSE_SYNC_VENDOR_CATALOG_ON_STARTUP: "maybe",
        },
        serverRootDir: "/srv/upuse/apps/server",
      }),
    ).toThrow(/UPUSE_SYNC_VENDOR_CATALOG_ON_STARTUP must be one of/i);
  });

  it("requires an explicit vendor catalog path when startup sync is enabled in production", () => {
    expect(() =>
      resolveStartupConfig({
        env: {
          NODE_ENV: "production",
          UPUSE_SECRET: "production-secret",
          UPUSE_SYNC_VENDOR_CATALOG_ON_STARTUP: "true",
        },
        serverRootDir: "/srv/upuse/apps/server",
      }),
    ).toThrow(/UPUSE_VENDOR_CATALOG_CSV_PATH is required/i);
  });

  it("resolves a workspace-relative vendor catalog path when startup sync is enabled", () => {
    const serverRootDir = path.join("C:\\", "srv", "upuse", "apps", "server");

    expect(resolveStartupConfig({
      env: {
        NODE_ENV: "production",
        UPUSE_SECRET: "production-secret",
        UPUSE_SYNC_VENDOR_CATALOG_ON_STARTUP: "true",
        UPUSE_VENDOR_CATALOG_CSV_PATH: "deploy/vendors.csv",
      },
      serverRootDir,
    })).toEqual({
      syncVendorCatalogOnStartup: true,
      vendorCatalogCsvPath: path.join("C:\\", "srv", "upuse", "deploy", "vendors.csv"),
    });
  });
});
